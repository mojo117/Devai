import { resolve, join } from 'path';
import { readFile as fsReadFile, writeFile as fsWriteFile, access } from 'fs/promises';
import { config } from '../config.js';
import { getSkillById } from './registry.js';
import type { ApiClient, SkillContext, SkillResult } from '@devai/shared';

/** Execution timeout for skills (30 seconds) */
const SKILL_TIMEOUT_MS = 30_000;

/** Create a lightweight API client with pre-configured auth */
function createApiClient(baseUrl: string, apiKey: string | undefined): ApiClient {
  const available = !!apiKey;

  async function request(path: string, options?: RequestInit): Promise<Response> {
    if (!available) throw new Error(`API not configured — missing API key for ${baseUrl}`);
    return globalThis.fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(options?.headers as Record<string, string> | undefined),
      },
    });
  }

  return {
    available,
    request,
    async get<T>(path: string): Promise<T> {
      const res = await request(path, { method: 'GET' });
      if (!res.ok) throw new Error(`API GET ${path} failed (${res.status}): ${await res.text()}`);
      return res.json() as Promise<T>;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      const res = await request(path, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`API POST ${path} failed (${res.status}): ${await res.text()}`);
      return res.json() as Promise<T>;
    },
  };
}

/** Check if an absolute path is within allowed roots and not in denied paths */
function isPathAllowed(absolutePath: string): boolean {
  const inAllowedRoot = config.allowedRoots.some(
    (root) => absolutePath.startsWith(resolve(root) + '/') || absolutePath === resolve(root)
  );
  if (!inAllowedRoot) return false;

  const inDeniedPath = config.deniedPaths.some(
    (denied) => absolutePath.startsWith(resolve(denied) + '/') || absolutePath === resolve(denied)
  );
  return !inDeniedPath;
}

/** Build a sandboxed SkillContext for skill execution */
function buildContext(skillId: string): SkillContext {
  const logs: string[] = [];

  return {
    fetch: globalThis.fetch,
    env: Object.freeze({ ...process.env }) as Readonly<Record<string, string | undefined>>,
    apis: {
      openai: createApiClient('https://api.openai.com', process.env.OPENAI_API_KEY),
      firecrawl: createApiClient('https://api.firecrawl.dev', process.env.FIRECRAWL_API_KEY),
    },

    async readFile(path: string): Promise<string> {
      const absolutePath = resolve(path);
      if (!isPathAllowed(absolutePath)) {
        throw new Error(`Skill "${skillId}": readFile denied — path "${path}" outside allowed roots`);
      }
      return fsReadFile(absolutePath, 'utf-8');
    },

    async writeFile(path: string, content: string): Promise<void> {
      const absolutePath = resolve(path);
      if (!isPathAllowed(absolutePath)) {
        throw new Error(`Skill "${skillId}": writeFile denied — path "${path}" outside allowed roots`);
      }
      await fsWriteFile(absolutePath, content, 'utf-8');
    },

    log(message: string): void {
      const entry = `[skill:${skillId}] ${message}`;
      logs.push(entry);
      console.info(entry);
    },
  };
}

/** Execute a skill by ID with the given arguments */
export async function executeSkill(
  skillId: string,
  args: Record<string, unknown>
): Promise<SkillResult> {
  const manifest = getSkillById(skillId);
  if (!manifest) {
    return { success: false, error: `Skill "${skillId}" not found` };
  }

  const executeFilePath = join(resolve(config.skillsDir), skillId, 'execute.ts');
  try {
    await access(executeFilePath);
  } catch {
    return { success: false, error: `Skill "${skillId}" has no execute.ts` };
  }

  const ctx = buildContext(skillId);

  try {
    // Dynamic import of the skill's execute.ts
    // tsx runtime handles TypeScript transpilation
    const skillModule = await import(executeFilePath);

    if (typeof skillModule.execute !== 'function') {
      return { success: false, error: `Skill "${skillId}" does not export an execute() function` };
    }

    // Run with timeout
    const result = await Promise.race<SkillResult>([
      skillModule.execute(args, ctx),
      new Promise<SkillResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Skill "${skillId}" timed out after ${SKILL_TIMEOUT_MS}ms`)), SKILL_TIMEOUT_MS)
      ),
    ]);

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    ctx.log(`Execution failed: ${message}`);
    return { success: false, error: `Skill "${skillId}" failed: ${message}` };
  }
}
