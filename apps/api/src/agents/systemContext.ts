import { resolve } from 'path';
import * as stateManager from './stateManager.js';
import { loadDevaiMdContext, formatDevaiMdBlock } from '../scanner/devaiMdLoader.js';
import { loadClaudeMdContext, formatClaudeMdBlock } from '../scanner/claudeMdLoader.js';
import { loadWorkspaceMdContext, formatWorkspaceMdBlock, type WorkspaceLoadMode } from '../scanner/workspaceMdLoader.js';
import { getSetting } from '../db/queries.js';
import { MEMORY_BEHAVIOR_BLOCK } from '../prompts/context.js';
import { getSchedulerErrors } from '../scheduler/schedulerService.js';
import { retrieveRelevantMemories } from '../memory/service.js';

const GLOBAL_CONTEXT_MAX_CHARS = 4000;

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

export async function getDevaiMdBlockForSession(sessionId: string): Promise<string> {
  const state = stateManager.getState(sessionId);
  if (state?.taskContext.gatheredInfo['devaiMdBlock']) {
    return String(state.taskContext.gatheredInfo['devaiMdBlock']);
  }

  const uiHost = (state?.taskContext.gatheredInfo['uiHost'] as string | undefined) || null;
  try {
    const ctx = await loadDevaiMdContext();
    const block = formatDevaiMdBlock(ctx, { uiHost });
    stateManager.setGatheredInfo(sessionId, 'devaiMdBlock', block);
    return block;
  } catch {
    return '';
  }
}

export async function getClaudeMdBlockForSession(sessionId: string, projectRoot: string | null): Promise<string> {
  const state = stateManager.getState(sessionId);
  const existing = (state?.taskContext.gatheredInfo['claudeMdBlock'] as string) || '';

  if (!projectRoot) return existing;

  const normalizedRoot = resolve(projectRoot);
  const cachedRoot = (state?.taskContext.gatheredInfo['claudeMdProjectRoot'] as string) || '';
  if (cachedRoot === normalizedRoot && existing) return existing;

  try {
    const ctx = await loadClaudeMdContext(normalizedRoot);
    const block = formatClaudeMdBlock(ctx);
    stateManager.setGatheredInfo(sessionId, 'claudeMdBlock', block);
    stateManager.setGatheredInfo(sessionId, 'claudeMdProjectRoot', normalizedRoot);
    stateManager.setGatheredInfo(sessionId, 'projectRoot', normalizedRoot);
    return block;
  } catch {
    return existing;
  }
}

export async function getWorkspaceMdBlockForSession(sessionId: string): Promise<string> {
  const state = stateManager.getState(sessionId);
  const mode = resolveWorkspaceMode(sessionId);
  const cachedMode = (state?.taskContext.gatheredInfo['workspaceMdMode'] as WorkspaceLoadMode | undefined) || null;
  const existing = (state?.taskContext.gatheredInfo['workspaceMdBlock'] as string) || '';

  if (cachedMode === mode && existing) return existing;

  try {
    const ctx = await loadWorkspaceMdContext({ mode });
    const block = formatWorkspaceMdBlock(ctx);
    stateManager.setGatheredInfo(sessionId, 'workspaceMdBlock', block);
    stateManager.setGatheredInfo(sessionId, 'workspaceMdMode', mode);
    stateManager.setGatheredInfo(sessionId, 'workspaceMdDiagnostics', ctx.diagnostics);
    return block;
  } catch {
    return existing;
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
  return block;
}

export async function warmMemoryBlockForSession(sessionId: string, userMessage: string): Promise<string> {
  const state = stateManager.getState(sessionId);
  const projectRoot = (state?.taskContext.gatheredInfo['projectRoot'] as string) || null;

  let projectName: string | undefined;
  if (projectRoot) {
    const parts = projectRoot.split('/').filter(Boolean);
    projectName = parts[parts.length - 1]?.toLowerCase();
  }

  try {
    const { block } = await retrieveRelevantMemories(userMessage, projectName);
    stateManager.setGatheredInfo(sessionId, 'memoryBlock', block);
    return block;
  } catch {
    return '';
  }
}

export function getCombinedSystemContextBlock(sessionId: string): string {
  const state = stateManager.getState(sessionId);
  const info = state?.taskContext.gatheredInfo || {};
  const schedulerErrors = getSchedulerErrors();
  const schedulerErrorBlock = schedulerErrors.length > 0
    ? [
      '## Letzte Scheduler-Fehler',
      ...schedulerErrors.slice(-5).map((entry) =>
        `- [${entry.timestamp}] ${entry.jobName} (${entry.jobId}): ${entry.error}`
      ),
    ].join('\n')
    : '';

  const blocks = [
    (info.devaiMdBlock as string) || '',
    (info.claudeMdBlock as string) || '',
    (info.workspaceMdBlock as string) || '',
    (info.globalContextBlock as string) || '',
    (info.memoryBlock as string) || '',
    schedulerErrorBlock,
  ]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (blocks.length === 0) return '';
  blocks.push(MEMORY_BEHAVIOR_BLOCK.trim());
  return blocks.join('\n');
}

export async function warmSystemContextForSession(
  sessionId: string,
  projectRoot: string | null,
  userMessage?: string
): Promise<void> {
  await getDevaiMdBlockForSession(sessionId);
  await getClaudeMdBlockForSession(sessionId, projectRoot);
  await getWorkspaceMdBlockForSession(sessionId);
  await refreshGlobalContextBlockForSession(sessionId);
  if (userMessage) {
    await warmMemoryBlockForSession(sessionId, userMessage);
  }
}
