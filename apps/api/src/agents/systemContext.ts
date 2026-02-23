import * as stateManager from './stateManager.js';
import { loadWorkspaceMdContext, formatWorkspaceMdBlock, type WorkspaceLoadMode } from '../scanner/workspaceMdLoader.js';
import { getSetting } from '../db/queries.js';
import { MEMORY_BEHAVIOR_BLOCK } from '../prompts/context.js';
import { getSchedulerErrors } from '../scheduler/schedulerService.js';
import { retrieveRelevantMemories } from '../memory/service.js';
import { config } from '../config.js';

const GLOBAL_CONTEXT_MAX_CHARS = 4000;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const lastContextProfileSignatures = new Map<string, string>();

type GatheredInfoRecord = Record<string, unknown>;

export type ContextBlockPriority = 'high' | 'medium' | 'low';
export type ContextBlockFreshness = 'static' | 'cached' | 'session' | 'dynamic' | 'live';
export type ContextBlockSensitivity = 'low' | 'medium' | 'high';

export interface ContextBlockMeta {
  kind: string;
  source: string;
  priority: ContextBlockPriority;
  freshness: ContextBlockFreshness;
  sensitivity: ContextBlockSensitivity;
}

interface ContextBlock {
  meta: ContextBlockMeta;
  content: string;
}

export interface SystemContextProfileEntry extends ContextBlockMeta {
  chars: number;
  tokensEstimate: number;
  sharePct: number;
}

export interface SystemContextProfile {
  totalChars: number;
  totalTokensEstimate: number;
  entries: SystemContextProfileEntry[];
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / CHARS_PER_TOKEN_ESTIMATE));
}

function escapeMetaValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatContextHeader(meta: ContextBlockMeta, tokensEstimate: number): string {
  return `[CTX kind="${escapeMetaValue(meta.kind)}" source="${escapeMetaValue(meta.source)}" priority="${meta.priority}" freshness="${meta.freshness}" sensitivity="${meta.sensitivity}" tokens_est=${tokensEstimate}]`;
}

export function formatContextBlock(meta: ContextBlockMeta, content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  const tokensEstimate = estimateTokens(trimmed);
  return `${formatContextHeader(meta, tokensEstimate)}\n${trimmed}`;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseGlobalContextSetting(raw: string | null): { content: string; enabled: boolean } {
  if (!raw) return { content: '', enabled: false };

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      return { content: parsed, enabled: true };
    }
    if (parsed && typeof parsed === 'object') {
      const content = typeof parsed.content === 'string' ? parsed.content : '';
      const enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : true;
      return { content, enabled };
    }
  } catch {
    return { content: raw, enabled: true };
  }

  return { content: '', enabled: false };
}

function resolveWorkspaceMode(sessionId: string): WorkspaceLoadMode {
  const state = stateManager.getState(sessionId);
  const info = state?.taskContext.gatheredInfo || {};

  const candidates = [
    info.workspaceContextMode,
    info.chatMode,
    info.sessionMode,
    info.visibility,
  ];

  for (const candidate of candidates) {
    if (candidate === 'shared') return 'shared';
    if (candidate === 'main') return 'main';
  }

  return 'main';
}

export async function getWorkspaceMdBlockForSession(sessionId: string): Promise<string> {
  const state = stateManager.getState(sessionId);
  const mode = resolveWorkspaceMode(sessionId);
  const cachedMode = (state?.taskContext.gatheredInfo.workspaceMdMode as WorkspaceLoadMode | undefined) || null;
  const existing = state?.taskContext.gatheredInfo.workspaceMdBlock || '';

  if (cachedMode === mode && existing) return existing;

  try {
    const ctx = await loadWorkspaceMdContext({ mode });
    const block = formatWorkspaceMdBlock(ctx);
    stateManager.setGatheredInfo(sessionId, 'workspaceMdBlock', block);
    stateManager.setGatheredInfo(sessionId, 'workspaceMdSourcePaths', ctx.files.map((file) => file.path));
    stateManager.setGatheredInfo(sessionId, 'workspaceMdMode', mode);
    stateManager.setGatheredInfo(sessionId, 'workspaceMdDiagnostics', ctx.diagnostics);
    return block;
  } catch {
    return existing;
  }
}

export async function warmMemoryRetrievalForSession(
  sessionId: string,
  userQuery: string,
): Promise<void> {
  try {
    const memories = await retrieveRelevantMemories(userQuery);
    if (memories.length === 0) {
      stateManager.setGatheredInfo(sessionId, 'memoryRetrievalBlock', '');
      return;
    }
    const lines = memories
      .slice(0, 5)
      .map((m) => `- [${m.namespace}] ${m.content}`);
    const block = `## Relevant Memories (vector search)\n${lines.join('\n')}`;
    stateManager.setGatheredInfo(sessionId, 'memoryRetrievalBlock', block);
  } catch {
    stateManager.setGatheredInfo(sessionId, 'memoryRetrievalBlock', '');
  }
}

export async function refreshGlobalContextBlockForSession(sessionId: string): Promise<string> {
  const raw = await getSetting('globalContext');
  const parsed = parseGlobalContextSetting(raw);
  const content = parsed.content.trim();

  if (!parsed.enabled || !content) {
    stateManager.setGatheredInfo(sessionId, 'globalContextBlock', '');
    return '';
  }

  const limited = content.length > GLOBAL_CONTEXT_MAX_CHARS
    ? `${content.slice(0, GLOBAL_CONTEXT_MAX_CHARS)}\n\n[Truncated: globalContext exceeded ${GLOBAL_CONTEXT_MAX_CHARS} chars]`
    : content;

  const block = `\n\n## User Global Context\n\n${limited}`;
  stateManager.setGatheredInfo(sessionId, 'globalContextBlock', block);
  stateManager.setGatheredInfo(sessionId, 'globalContextSource', 'settings.globalContext');
  return block;
}

function buildContextBlocks(sessionId: string): ContextBlock[] {
  const state = stateManager.getState(sessionId);
  const info = (state?.taskContext.gatheredInfo || {}) as GatheredInfoRecord;
  const schedulerErrors = getSchedulerErrors();
  const schedulerErrorBlock = schedulerErrors.length > 0
    ? [
      '## Recent Scheduler Errors',
      ...schedulerErrors.slice(-5).map((entry) =>
        `- [${entry.timestamp}] ${entry.jobName} (${entry.jobId}): ${entry.error}`
      ),
    ].join('\n')
    : '';

  // Inject communication platform so CHAPO knows which channel the user is on
  const platform = info.platform || '';
  const platformBlock = platform
    ? `## Communication Channel\nThe user is currently communicating via: **${platform === 'telegram' ? 'Telegram' : 'Web-UI'}**.\nSend files to the user ${platform === 'telegram' ? 'via Telegram (telegram_send_document)' : 'via Web-UI download (deliver_document)'}.`
    : '';

  const workspaceDiagnostics =
    info.workspaceMdDiagnostics && typeof info.workspaceMdDiagnostics === 'object'
      ? (info.workspaceMdDiagnostics as { workspaceRoot?: unknown; mode?: unknown })
      : null;
  const workspaceRoot = asNonEmptyString(workspaceDiagnostics?.workspaceRoot);
  const workspaceMode = asNonEmptyString(workspaceDiagnostics?.mode);
  const workspaceSource = workspaceRoot
    ? `${workspaceRoot}${workspaceMode ? ` (mode=${workspaceMode})` : ''}`
    : 'workspace/*.md';

  const platformName = asNonEmptyString(info.platform) || 'unknown';

  // NOTE: devai_instructions (devai.md) and project_instructions (CLAUDE.md) were removed.
  // Essential runtime context is now baked into the CHAPO system prompt directly,
  // avoiding ~13KB of developer-facing CLAUDE.md content in every session.
  const primaryCandidates: ContextBlock[] = [
    {
      meta: {
        kind: 'workspace_policy',
        source: workspaceSource,
        priority: 'high',
        freshness: 'cached',
        sensitivity: 'medium',
      },
      content: asNonEmptyString(info.workspaceMdBlock) || '',
    },
    {
      meta: {
        kind: 'memory_retrieval',
        source: 'memory.vectorSearch',
        priority: 'medium',
        freshness: 'dynamic',
        sensitivity: 'low',
      },
      content: asNonEmptyString(info.memoryRetrievalBlock) || '',
    },
    {
      meta: {
        kind: 'user_global_context',
        source: asNonEmptyString(info.globalContextSource) || 'settings.globalContext',
        priority: 'medium',
        freshness: 'cached',
        sensitivity: 'high',
      },
      content: asNonEmptyString(info.globalContextBlock) || '',
    },
    {
      meta: {
        kind: 'scheduler_errors',
        source: 'scheduler.error_buffer',
        priority: 'low',
        freshness: 'live',
        sensitivity: 'low',
      },
      content: schedulerErrorBlock,
    },
    {
      meta: {
        kind: 'channel_context',
        source: `session.platform:${platformName}`,
        priority: 'medium',
        freshness: 'session',
        sensitivity: 'low',
      },
      content: platformBlock,
    },
  ];
  const primaryBlocks = primaryCandidates.filter((block) => block.content.trim().length > 0);

  if (primaryBlocks.length === 0) return [];

  primaryBlocks.push({
    meta: {
      kind: 'memory_behavior_policy',
      source: 'prompts/context.ts',
      priority: 'high',
      freshness: 'static',
      sensitivity: 'low',
    },
    content: MEMORY_BEHAVIOR_BLOCK.trim(),
  });

  return primaryBlocks;
}

function buildSystemContextProfile(blocks: ContextBlock[]): SystemContextProfile {
  const entries = blocks.map((block) => {
    const trimmed = block.content.trim();
    return {
      ...block.meta,
      chars: trimmed.length,
      tokensEstimate: estimateTokens(trimmed),
      sharePct: 0,
    };
  });

  const totalChars = entries.reduce((sum, entry) => sum + entry.chars, 0);
  const totalTokensEstimate = entries.reduce((sum, entry) => sum + entry.tokensEstimate, 0);
  const withShare = entries.map((entry) => ({
    ...entry,
    sharePct: totalTokensEstimate > 0
      ? Number(((entry.tokensEstimate / totalTokensEstimate) * 100).toFixed(1))
      : 0,
  }));

  return {
    totalChars,
    totalTokensEstimate,
    entries: withShare,
  };
}

function logSystemContextProfile(sessionId: string, profile: SystemContextProfile): void {
  if (profile.entries.length === 0) return;

  const signature = profile.entries
    .map((entry) => `${entry.kind}|${entry.source}|${entry.tokensEstimate}`)
    .join('::');

  if (lastContextProfileSignatures.get(sessionId) === signature) {
    return;
  }
  lastContextProfileSignatures.set(sessionId, signature);

  console.info('[systemContext] assembled profile', {
    sessionId,
    totalChars: profile.totalChars,
    totalTokensEstimate: profile.totalTokensEstimate,
    blocks: profile.entries.map((entry) => ({
      kind: entry.kind,
      source: entry.source,
      tokensEstimate: entry.tokensEstimate,
      sharePct: entry.sharePct,
    })),
  });
}

export function getSystemContextProfile(sessionId: string): SystemContextProfile {
  return buildSystemContextProfile(buildContextBlocks(sessionId));
}

export function getCombinedSystemContextBlock(sessionId: string): string {
  const blocks = buildContextBlocks(sessionId);
  if (blocks.length === 0) return '';

  const profile = buildSystemContextProfile(blocks);
  logSystemContextProfile(sessionId, profile);

  if (!config.contextProvenanceTags) {
    return blocks.map((entry) => entry.content.trim()).join('\n');
  }

  return blocks
    .map((entry) => formatContextBlock(entry.meta, entry.content))
    .filter(Boolean)
    .join('\n\n');
}

export async function warmSystemContextForSession(
  sessionId: string,
  projectRoot: string | null,
): Promise<void> {
  await getWorkspaceMdBlockForSession(sessionId);
  await refreshGlobalContextBlockForSession(sessionId);
}
