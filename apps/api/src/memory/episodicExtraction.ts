/**
 * Episodic Memory Extraction — automatic learning from session activity.
 *
 * Three extraction triggers:
 * 1. Turn-end: summarize what happened when CHAPO answers
 * 2. Tool-result: capture significant state changes (file writes, commits)
 * 3. Topic promotion: promote mature recentFocus topics to long-term memory
 *
 * All extraction is fire-and-forget — never blocks the main loop.
 * Reuses existing dedup (findSimilarMemories), embeddings, and insertMemory.
 */

import { findSimilarMemories, insertMemory } from './memoryStore.js'
import { generateEmbedding } from './embeddings.js'
import { getActiveTopics } from './recentFocus.js'
import { getSupabase } from '../db/index.js'
import type { MemoryInsert } from './types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TurnEpisodeInput {
  userMessage: string
  assistantAnswer: string
  toolsUsed: string[]
  iteration: number
}

interface ToolEpisodeInput {
  toolName: string
  toolArgs: Record<string, unknown>
  toolResult: string
}

interface TemporalMemoryRow {
  id: string
  content: string
  memory_type: string
  namespace: string
  strength: number
  priority: string
  created_at: string
  session_id: string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGNIFICANT_TOOLS = new Set([
  'fs_writeFile',
  'fs_edit',
  'fs_delete',
  'fs_mkdir',
  'fs_move',
  'bash_execute',
  'ssh_execute',
  'git_commit',
  'git_push',
  'git_add',
  'npm_install',
  'npm_run',
  'memory_remember',
  'taskforge_create_task',
  'taskforge_move_task',
  'scheduler_create',
])

const PROMOTION_TOUCH_COUNT = 5
const PROMOTION_SESSION_COUNT = 2
const DEDUP_THRESHOLD = 0.9

// ---------------------------------------------------------------------------
// 1. Turn-End Episodic Extraction
// ---------------------------------------------------------------------------

export async function extractTurnEpisode(
  sessionId: string,
  input: TurnEpisodeInput,
): Promise<void> {
  // Skip trivial turns (no tools, short answer)
  if (input.toolsUsed.length === 0 && input.assistantAnswer.length < 100) return

  const timestamp = new Date().toISOString().slice(0, 16)
  const toolSummary = input.toolsUsed.length > 0
    ? ` (Tools: ${[...new Set(input.toolsUsed)].slice(0, 5).join(', ')})`
    : ''
  const userSnippet = input.userMessage.slice(0, 120)
  const answerSnippet = input.assistantAnswer.slice(0, 120)

  const content = `[${timestamp}] "${userSnippet}" -> ${answerSnippet}${toolSummary}`

  // Deduplicate
  const similar = await findSimilarMemories(content, 'devai/episodic/turn')
  if (similar.length > 0 && similar[0].similarity > DEDUP_THRESHOLD) return

  const embedding = await generateEmbedding(content)
  await insertMemory({
    content,
    embedding,
    memory_type: 'episodic',
    namespace: 'devai/episodic/turn',
    priority: 'low',
    source: 'episodic_turn',
    session_id: sessionId,
  })

  console.log(`[episodic] Turn episode stored: ${content.slice(0, 80)}...`)
}

// ---------------------------------------------------------------------------
// 2. Tool-Result Episodic Extraction
// ---------------------------------------------------------------------------

export async function extractToolEpisode(
  sessionId: string,
  input: ToolEpisodeInput,
): Promise<void> {
  if (!SIGNIFICANT_TOOLS.has(input.toolName)) return

  const timestamp = new Date().toISOString().slice(0, 16)
  const summary = buildToolSummary(input)
  const content = `[${timestamp}] ${summary}`

  // Deduplicate
  const similar = await findSimilarMemories(content, 'devai/episodic/tool')
  if (similar.length > 0 && similar[0].similarity > DEDUP_THRESHOLD) return

  const embedding = await generateEmbedding(content)
  await insertMemory({
    content,
    embedding,
    memory_type: 'episodic',
    namespace: 'devai/episodic/tool',
    priority: 'low',
    source: 'episodic_tool',
    session_id: sessionId,
  })
}

function buildToolSummary(input: ToolEpisodeInput): string {
  const args = input.toolArgs

  switch (input.toolName) {
    case 'fs_writeFile':
    case 'fs_edit': {
      const path = typeof args.path === 'string'
        ? args.path
        : typeof args.file_path === 'string'
          ? args.file_path
          : 'unknown'
      return `Datei bearbeitet: ${path.split('/').slice(-2).join('/')}`
    }
    case 'fs_delete': {
      const path = typeof args.path === 'string' ? args.path : 'unknown'
      return `Datei geloescht: ${path.split('/').slice(-2).join('/')}`
    }
    case 'bash_execute':
    case 'ssh_execute': {
      const cmd = typeof args.command === 'string' ? args.command.slice(0, 80) : 'unknown'
      return `${input.toolName === 'ssh_execute' ? 'SSH' : 'Bash'}: ${cmd}`
    }
    case 'git_commit': {
      const msg = typeof args.message === 'string' ? args.message.slice(0, 80) : 'commit'
      return `Git commit: ${msg}`
    }
    case 'git_push':
      return `Git push: ${typeof args.branch === 'string' ? args.branch : 'remote'}`
    case 'npm_install':
      return `npm install: ${typeof args.package === 'string' ? args.package : 'dependencies'}`
    case 'npm_run':
      return `npm run: ${typeof args.script === 'string' ? args.script : 'script'}`
    default:
      return `${input.toolName}: ${input.toolResult.slice(0, 100)}`
  }
}

// ---------------------------------------------------------------------------
// 3. Recent-Topic Promotion (session-end)
// ---------------------------------------------------------------------------

export async function promoteMaturedTopics(sessionId: string): Promise<void> {
  const topics = await getActiveTopics(50)

  for (const topic of topics) {
    const isMatured = topic.touch_count >= PROMOTION_TOUCH_COUNT
      || topic.session_count >= PROMOTION_SESSION_COUNT
    if (!isMatured) continue

    const timestamp = new Date().toISOString().slice(0, 10)
    const fileContext = topic.file_paths.length > 0
      ? ` (Dateien: ${topic.file_paths.slice(0, 3).map((p: string) => p.split('/').pop()).join(', ')})`
      : ''
    const content = `[${timestamp}] Wiederkehrendes Thema: "${topic.topic}" - ${topic.touch_count}x bearbeitet in ${topic.session_count} Sessions${fileContext}`

    // Dedup against existing promoted memories
    const similar = await findSimilarMemories(content, 'devai/episodic/promoted')
    if (similar.length > 0 && similar[0].similarity > 0.8) continue

    const embedding = await generateEmbedding(content)
    await insertMemory({
      content,
      embedding,
      memory_type: 'episodic',
      namespace: 'devai/episodic/promoted',
      priority: 'medium',
      source: 'topic_promotion',
      session_id: sessionId,
    })

    console.log(`[episodic] Topic promoted: ${topic.topic}`)
  }
}

// ---------------------------------------------------------------------------
// 4. Temporal Retrieval
// ---------------------------------------------------------------------------

export async function getMemoriesByTimeRange(
  startDate: string,
  endDate: string,
  limit: number = 20,
): Promise<TemporalMemoryRow[]> {
  const supabase = getSupabase()

  const { data, error } = await supabase.rpc('get_memories_by_timerange', {
    start_date: startDate,
    end_date: endDate,
    row_limit: limit,
  })

  if (error) {
    console.error('[episodic] getMemoriesByTimeRange RPC failed:', error)
    return []
  }

  // RPC get_memories_by_timerange returns rows matching TemporalMemoryRow shape
  return (data as TemporalMemoryRow[]) ?? []
}
