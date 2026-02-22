import { getSupabase } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecentTopic {
  id: string;
  topic: string;
  parent_topic: string | null;
  file_paths: string[];
  directories: string[];
  strength: number;
  touch_count: number;
  session_count: number;
  first_seen_at: string;
  last_touched_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface TopicUpsertInput {
  topic: string;
  file_paths?: string[];
  directories?: string[];
}

interface RecentDecayResult {
  decayed: number;
  pruned: number;
}

// ---------------------------------------------------------------------------
// 1. getActiveTopics — fetch all active topics ordered by strength DESC
// ---------------------------------------------------------------------------

export async function getActiveTopics(limit?: number): Promise<RecentTopic[]> {
  try {
    const supabase = getSupabase();

    let query = supabase
      .from('devai_recent_topics')
      .select('*')
      .eq('is_active', true)
      .order('strength', { ascending: false });

    if (limit && limit > 0) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[recentFocus] getActiveTopics failed:', error);
      return [];
    }

    return (data as RecentTopic[]) ?? [];
  } catch (err) {
    console.error('[recentFocus] getActiveTopics failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 2. findTopicByName — exact match lookup (lowercase, is_active=true)
// ---------------------------------------------------------------------------

export async function findTopicByName(topic: string): Promise<RecentTopic | null> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('devai_recent_topics')
      .select('*')
      .eq('is_active', true)
      .ilike('topic', topic.toLowerCase())
      .single();

    if (error) {
      // PGRST116 = no rows found — not a real error
      if (error.code === 'PGRST116') return null;
      console.error('[recentFocus] findTopicByName failed:', error);
      return null;
    }

    return (data as RecentTopic) ?? null;
  } catch (err) {
    console.error('[recentFocus] findTopicByName failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. upsertTopic — insert or update a topic
// ---------------------------------------------------------------------------

export async function upsertTopic(input: TopicUpsertInput): Promise<void> {
  try {
    const supabase = getSupabase();
    const normalizedTopic = input.topic.toLowerCase().trim();
    const newFilePaths = input.file_paths ?? [];
    const newDirectories = input.directories ?? [];

    // Check if topic already exists
    const existing = await findTopicByName(normalizedTopic);

    if (existing) {
      // Merge arrays and deduplicate
      const mergedFilePaths = [...new Set([...existing.file_paths, ...newFilePaths])];
      const mergedDirectories = [...new Set([...existing.directories, ...newDirectories])];

      const { error } = await supabase
        .from('devai_recent_topics')
        .update({
          file_paths: mergedFilePaths,
          directories: mergedDirectories,
          strength: 1.0,
          touch_count: existing.touch_count + 1,
          last_touched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) {
        console.error('[recentFocus] upsertTopic update failed:', error);
      }
    } else {
      // Determine parent_topic: if topic has 2 parts, look for established parent
      let parentTopic: string | null = null;
      const parts = normalizedTopic.split(/[\s\/\-:]+/);

      if (parts.length >= 2) {
        const potentialParent = parts[0];
        const { data: parentData, error: parentError } = await supabase
          .from('devai_recent_topics')
          .select('topic, session_count')
          .eq('is_active', true)
          .ilike('topic', potentialParent)
          .single();

        if (!parentError && parentData) {
          const parent = parentData as { topic: string; session_count: number };
          if (parent.session_count >= 3) {
            parentTopic = parent.topic;
          }
        }
      }

      const { error } = await supabase
        .from('devai_recent_topics')
        .insert({
          topic: normalizedTopic,
          parent_topic: parentTopic,
          file_paths: newFilePaths,
          directories: newDirectories,
          strength: 1.0,
          touch_count: 1,
          session_count: 1,
        });

      if (error) {
        console.error('[recentFocus] upsertTopic insert failed:', error);
      }
    }
  } catch (err) {
    console.error('[recentFocus] upsertTopic failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 4. incrementSessionCount — increment session_count for a topic
// ---------------------------------------------------------------------------

export async function incrementSessionCount(topicName: string): Promise<void> {
  try {
    const supabase = getSupabase();

    const existing = await findTopicByName(topicName);
    if (!existing) {
      console.error(`[recentFocus] incrementSessionCount: topic "${topicName}" not found`);
      return;
    }

    const { error } = await supabase
      .from('devai_recent_topics')
      .update({
        session_count: existing.session_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (error) {
      console.error('[recentFocus] incrementSessionCount failed:', error);
    }
  } catch (err) {
    console.error('[recentFocus] incrementSessionCount failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 5. runRecentTopicDecay — decay all active topics, prune weak ones
// ---------------------------------------------------------------------------

export async function runRecentTopicDecay(): Promise<RecentDecayResult> {
  const result: RecentDecayResult = { decayed: 0, pruned: 0 };

  try {
    const supabase = getSupabase();

    const { data: topics, error } = await supabase
      .from('devai_recent_topics')
      .select('id, strength, last_touched_at')
      .eq('is_active', true);

    if (error) {
      console.error('[recentFocus] runRecentTopicDecay query failed:', error);
      return result;
    }

    if (!topics || topics.length === 0) {
      return result;
    }

    const now = Date.now();

    for (const topic of topics as Array<{
      id: string;
      strength: number;
      last_touched_at: string;
    }>) {
      const lastTouched = new Date(topic.last_touched_at).getTime();
      const daysSince = (now - lastTouched) / (1000 * 60 * 60 * 24);

      if (daysSince <= 0) continue;

      const newStrength = topic.strength * Math.pow(0.9, daysSince);

      // Prune if strength dropped below threshold
      if (newStrength < 0.05) {
        const { error: pruneError } = await supabase
          .from('devai_recent_topics')
          .update({
            is_active: false,
            strength: newStrength,
            updated_at: new Date().toISOString(),
          })
          .eq('id', topic.id);

        if (pruneError) {
          console.error(`[recentFocus] runRecentTopicDecay prune failed for ${topic.id}:`, pruneError);
        } else {
          result.pruned++;
        }
        continue;
      }

      // Apply decay if meaningful change
      if (Math.abs(newStrength - topic.strength) > 0.001) {
        const { error: updateError } = await supabase
          .from('devai_recent_topics')
          .update({
            strength: newStrength,
            updated_at: new Date().toISOString(),
          })
          .eq('id', topic.id);

        if (updateError) {
          console.error(`[recentFocus] runRecentTopicDecay update failed for ${topic.id}:`, updateError);
        } else {
          result.decayed++;
        }
      }
    }

    return result;
  } catch (err) {
    console.error('[recentFocus] runRecentTopicDecay failed:', err);
    return result;
  }
}

// ---------------------------------------------------------------------------
// 6. deactivateTopic — mark topic as inactive
// ---------------------------------------------------------------------------

export async function deactivateTopic(topicName: string): Promise<void> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('devai_recent_topics')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .ilike('topic', topicName.toLowerCase());

    if (error) {
      console.error('[recentFocus] deactivateTopic failed:', error);
    }
  } catch (err) {
    console.error('[recentFocus] deactivateTopic failed:', err);
  }
}
