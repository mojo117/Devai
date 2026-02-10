import { readFile } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

export interface DevaiMdContext {
  path: string;
  content: string;
}

const MAX_CONTENT_SIZE = 32000;
const DEVAI_MD_NAMES = ['devai.md', 'DEVAI.md'];

function getRepoRoot(): string {
  // apps/api/src/scanner -> repo root
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, '../../../..');
}

async function tryRead(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return content;
  } catch {
    return null;
  }
}

export async function loadDevaiMdContext(): Promise<DevaiMdContext | null> {
  // Allow an override via env var if needed.
  const override = process.env.DEVAI_MD_PATH;
  if (override) {
    const content = await tryRead(resolve(override));
    if (content != null) return { path: resolve(override), content };
  }

  // Prefer DeviSpace-local overrides (so operators can tweak behavior without touching the repo).
  for (const name of DEVAI_MD_NAMES) {
    const p = resolve('/opt/Klyde/projects/DeviSpace', name);
    const content = await tryRead(p);
    if (content != null) return { path: p, content };
  }

  // Repo root fallback (versioned).
  const repoRoot = getRepoRoot();
  for (const name of DEVAI_MD_NAMES) {
    const p = join(repoRoot, name);
    const content = await tryRead(p);
    if (content != null) return { path: p, content };
  }

  return null;
}

export function formatDevaiMdBlock(ctx: DevaiMdContext | null, runtime?: { uiHost?: string | null }): string {
  if (!ctx?.content?.trim()) return '';
  const trimmed = ctx.content.trim();
  const limited = trimmed.length > MAX_CONTENT_SIZE
    ? trimmed.slice(0, MAX_CONTENT_SIZE) + `\n\n[Truncated: devai.md exceeded ${MAX_CONTENT_SIZE} characters]`
    : trimmed;

  const host = (runtime?.uiHost || '').trim();
  const uiHostLine = host ? `\n\nRuntime UI Host: ${host}\n(Use this as <domain> when suggesting http://<domain>:PORT)` : '';

  return `\n\n## DevAI Instructions (devai.md)\n\n<!-- From: ${ctx.path} -->\n\n${limited}${uiHostLine}`;
}
