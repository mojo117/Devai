import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { resolveWorkspaceRoot, ensureWorkspaceMemoryStructure } from './workspaceMemory.js';
import { getActiveTopics, upsertTopic, deactivateTopic } from './recentFocus.js';
import type { RecentTopic } from './recentFocus.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECENT_FOCUS_FILENAME = 'RECENT_FOCUS.md';
const ACTIVE_THRESHOLD = 0.4;
const MAX_CONTEXT_CHARS = 3200;
const TOPIC_LINE_PATTERN = /^-\s+\*\*(.+?)\*\*/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  if (diffMs < 0 || diffMs < 60_000) return 'just now';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(diffMs / 86_400_000);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function strengthLabel(strength: number): string {
  if (strength >= 0.8) return '';
  if (strength >= 0.4) return ', fading';
  return ', weak';
}

// ---------------------------------------------------------------------------
// Internal: format a single topic line for the markdown file
// ---------------------------------------------------------------------------

function formatTopicLine(topic: RecentTopic): string {
  const timeAgo = formatTimeAgo(topic.last_touched_at);
  const files = topic.file_paths.length > 0
    ? `\n  files: ${topic.file_paths.join(', ')}`
    : '';
  const dirs = topic.directories.length > 0
    ? `\n  dirs: ${topic.directories.join(', ')}`
    : '';

  return `- **${topic.topic}** | ${topic.session_count} session${topic.session_count === 1 ? '' : 's'} | last: ${timeAgo} | strength: ${topic.strength.toFixed(2)}${files}${dirs}`;
}

// ---------------------------------------------------------------------------
// Internal: format a single topic line for the system prompt block
// ---------------------------------------------------------------------------

function formatTopicBlockLine(topic: RecentTopic): string {
  const timeAgo = formatTimeAgo(topic.last_touched_at);
  const label = strengthLabel(topic.strength);

  const filePart = topic.file_paths.length > 0
    ? topic.file_paths.join(', ')
    : '';
  const dirPart = topic.directories.length > 0
    ? ` @ ${topic.directories.join(', ')}`
    : '';
  const locationPart = filePart || dirPart
    ? ` — ${filePart}${dirPart}`
    : '';

  return `- **${topic.topic}** (${topic.session_count} session${topic.session_count === 1 ? '' : 's'}, last touched ${timeAgo}${label})${locationPart}`;
}

// ---------------------------------------------------------------------------
// 1. renderRecentFocusMd — generate RECENT_FOCUS.md from DB state
// ---------------------------------------------------------------------------

export async function renderRecentFocusMd(workspaceRoot?: string): Promise<string> {
  try {
    const root = await ensureWorkspaceMemoryStructure(workspaceRoot);
    const filePath = join(root, 'memory', RECENT_FOCUS_FILENAME);

    const topics = await getActiveTopics();

    if (topics.length === 0) {
      const content = [
        '# Recent Focus',
        '> Auto-generated. Manual edits are respected — removals and additions sync back.',
        `> Last updated: ${new Date().toISOString()}`,
        '',
        'No recent topics tracked yet.',
        '',
      ].join('\n');

      await writeFile(filePath, content, 'utf-8');
      return filePath;
    }

    const active = topics.filter((t) => t.strength >= ACTIVE_THRESHOLD);
    const fading = topics.filter((t) => t.strength < ACTIVE_THRESHOLD);

    const lines: string[] = [
      '# Recent Focus',
      '> Auto-generated. Manual edits are respected — removals and additions sync back.',
      `> Last updated: ${new Date().toISOString()}`,
      '',
    ];

    if (active.length > 0) {
      lines.push('## Active');
      for (const topic of active) {
        lines.push(formatTopicLine(topic));
      }
      lines.push('');
    }

    if (fading.length > 0) {
      lines.push('## Fading');
      for (const topic of fading) {
        lines.push(formatTopicLine(topic));
      }
      lines.push('');
    }

    await writeFile(filePath, lines.join('\n'), 'utf-8');
    return filePath;
  } catch (err) {
    console.error('[recentFocusRenderer] renderRecentFocusMd failed:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. syncManualEdits — diff RECENT_FOCUS.md against DB, apply user edits
// ---------------------------------------------------------------------------

export async function syncManualEdits(workspaceRoot?: string): Promise<void> {
  try {
    const root = await resolveWorkspaceRoot(workspaceRoot);
    const filePath = join(root, 'memory', RECENT_FOCUS_FILENAME);

    let fileContent: string;
    try {
      fileContent = await readFile(filePath, 'utf-8');
    } catch {
      // File doesn't exist yet — nothing to sync
      return;
    }

    // Parse topic names from the file
    const fileTopics = new Set<string>();
    for (const line of fileContent.split('\n')) {
      const match = line.match(TOPIC_LINE_PATTERN);
      if (match) {
        fileTopics.add(match[1].toLowerCase().trim());
      }
    }

    // Get current DB topics
    const dbTopics = await getActiveTopics();
    const dbTopicNames = new Set(dbTopics.map((t) => t.topic.toLowerCase()));

    // Topics in DB but not in file → user removed them → deactivate
    for (const dbTopic of dbTopics) {
      if (!fileTopics.has(dbTopic.topic.toLowerCase())) {
        console.log(`[recentFocusRenderer] syncManualEdits: deactivating removed topic "${dbTopic.topic}"`);
        await deactivateTopic(dbTopic.topic);
      }
    }

    // Topics in file but not in DB → user added them → upsert with empty arrays
    for (const fileTopic of fileTopics) {
      if (!dbTopicNames.has(fileTopic)) {
        console.log(`[recentFocusRenderer] syncManualEdits: adding new topic "${fileTopic}"`);
        await upsertTopic({ topic: fileTopic, file_paths: [], directories: [] });
      }
    }
  } catch (err) {
    console.error('[recentFocusRenderer] syncManualEdits failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 3. buildRecentFocusBlock — format active topics for system prompt injection
// ---------------------------------------------------------------------------

export async function buildRecentFocusBlock(): Promise<string> {
  try {
    const topics = await getActiveTopics();

    if (topics.length === 0) return '';

    const header = '## Recent Focus (cross-session awareness)\n\nYou\'ve been actively working on:\n';
    let block = header;

    for (const topic of topics) {
      const line = formatTopicBlockLine(topic) + '\n';

      // Respect token budget (approx 3200 chars)
      if (block.length + line.length > MAX_CONTEXT_CHARS) {
        break;
      }

      block += line;
    }

    return block;
  } catch (err) {
    console.error('[recentFocusRenderer] buildRecentFocusBlock failed:', err);
    return '';
  }
}
