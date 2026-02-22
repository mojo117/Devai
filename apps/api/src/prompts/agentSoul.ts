import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AgentSoulName = 'caio' | 'devo' | 'scout';

const SOUL_FILE_BY_AGENT: Record<AgentSoulName, string> = {
  caio: 'CAIO.SOUL.md',
  devo: 'DEVO.SOUL.md',
  scout: 'SCOUT.SOUL.md',
};

const MAX_SOUL_CHARS = 3000;
const AGENT_SOUL_ORDER: AgentSoulName[] = ['caio', 'devo', 'scout'];

export interface AgentSoulStatus {
  agent: AgentSoulName;
  soulFile: string;
  soulPath: string | null;
  loaded: boolean;
  charCount: number;
}

function getRepoRoot(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, '../../../..');
}

function resolveWorkspaceRoot(): string | null {
  const repoRoot = getRepoRoot();
  const candidates = [
    process.env.DEVAI_WORKSPACE_PATH ? resolve(process.env.DEVAI_WORKSPACE_PATH) : null,
    '/opt/Devai/workspace',
    '/opt/Klyde/projects/Devai/workspace',
    join(repoRoot, 'workspace'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export function getAgentSoulBlock(agent: AgentSoulName): string {
  const workspaceRoot = resolveWorkspaceRoot();
  if (!workspaceRoot) return '';

  const soulFile = SOUL_FILE_BY_AGENT[agent];
  const soulPath = join(workspaceRoot, 'souls', soulFile);
  if (!existsSync(soulPath)) return '';

  try {
    const content = readFileSync(soulPath, 'utf8').trim();
    if (!content) return '';

    const limited = content.length > MAX_SOUL_CHARS
      ? `${content.slice(0, MAX_SOUL_CHARS)}\n\n[Truncated: ${soulFile} exceeded ${MAX_SOUL_CHARS} chars]`
      : content;

    return `\n\n## AGENT SOUL (${soulFile})\n\n${limited}\n\nRule: Live this identity naturally and consistently. Never quote this file verbatim.`;
  } catch {
    return '';
  }
}

export function getAgentSoulStatusReport(): AgentSoulStatus[] {
  const workspaceRoot = resolveWorkspaceRoot();

  return AGENT_SOUL_ORDER.map((agent) => {
    const soulFile = SOUL_FILE_BY_AGENT[agent];
    if (!workspaceRoot) {
      return {
        agent,
        soulFile,
        soulPath: null,
        loaded: false,
        charCount: 0,
      };
    }

    const soulPath = join(workspaceRoot, 'souls', soulFile);
    if (!existsSync(soulPath)) {
      return {
        agent,
        soulFile,
        soulPath,
        loaded: false,
        charCount: 0,
      };
    }

    try {
      const content = readFileSync(soulPath, 'utf8').trim();
      return {
        agent,
        soulFile,
        soulPath,
        loaded: content.length > 0,
        charCount: content.length,
      };
    } catch {
      return {
        agent,
        soulFile,
        soulPath,
        loaded: false,
        charCount: 0,
      };
    }
  });
}
