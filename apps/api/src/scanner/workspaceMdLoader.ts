import { readFile, access } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

export type WorkspaceLoadMode = 'main' | 'shared';

export interface WorkspaceMdFile {
  role: string;
  path: string;
  content: string;
  truncated: boolean;
  originalLength: number;
}

export interface WorkspaceMdDiagnostics {
  workspaceRoot: string;
  mode: WorkspaceLoadMode;
  missingFiles: string[];
  truncatedFiles: string[];
  totalChars: number;
  capped: boolean;
}

export interface WorkspaceMdContext {
  files: WorkspaceMdFile[];
  combined: string;
  diagnostics: WorkspaceMdDiagnostics;
}

interface WorkspaceFileSpec {
  role: string;
  relativePath: string;
  required: boolean;
}

const MAX_CONTENT_SIZE = 24000;
const MAX_FILE_SIZE = 6000;

function getRepoRoot(): string {
  // apps/api/src/scanner -> repo root
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, '../../../..');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function formatDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getWorkspaceFileSpecs(mode: WorkspaceLoadMode): WorkspaceFileSpec[] {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const specs: WorkspaceFileSpec[] = [
    { role: 'AGENTS', relativePath: 'AGENTS.md', required: true },
    { role: 'SOUL', relativePath: 'SOUL.md', required: true },
    { role: 'USER', relativePath: 'USER.md', required: true },
    { role: 'TOOLS', relativePath: 'TOOLS.md', required: true },
    { role: 'Memory Today', relativePath: `memory/${formatDateStamp(today)}.md`, required: false },
    { role: 'Memory Yesterday', relativePath: `memory/${formatDateStamp(yesterday)}.md`, required: false },
  ];

  if (mode === 'main') {
    specs.push({ role: 'Long-Term Memory', relativePath: 'MEMORY.md', required: false });
  }

  return specs;
}

async function resolveWorkspaceRoot(override?: string | null): Promise<string> {
  if (override) {
    const resolved = resolve(override);
    if (await pathExists(resolved)) return resolved;
  }

  const envRoot = process.env.DEVAI_WORKSPACE_PATH ? resolve(process.env.DEVAI_WORKSPACE_PATH) : null;
  const repoRoot = getRepoRoot();
  const candidates = [
    envRoot,
    '/opt/Devai/workspace',
    '/opt/Klyde/projects/Devai/workspace',
    join(repoRoot, 'workspace'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }

  return '/opt/Devai/workspace';
}

function formatFileSection(file: WorkspaceMdFile): string {
  if (file.role === 'SOUL') {
    return `\n\n<!-- Role: ${file.role} | From: ${file.path} -->\n\n**This defines who you are. Embody it naturally — don't recite or list it when asked. Live the personality, don't describe it.**\n\n${file.content}`;
  }
  return `\n\n<!-- Role: ${file.role} | From: ${file.path} -->\n\n${file.content}`;
}

export async function loadWorkspaceMdContext(
  options: { mode?: WorkspaceLoadMode; workspaceRoot?: string | null } = {}
): Promise<WorkspaceMdContext> {
  const mode = options.mode || 'main';
  const workspaceRoot = await resolveWorkspaceRoot(options.workspaceRoot);
  const specs = getWorkspaceFileSpecs(mode);
  const files: WorkspaceMdFile[] = [];
  const missingFiles: string[] = [];
  const truncatedFiles: string[] = [];

  let combined = '';
  let totalChars = 0;
  let capped = false;

  for (const spec of specs) {
    const path = join(workspaceRoot, spec.relativePath);
    if (!(await pathExists(path))) {
      if (spec.required) missingFiles.push(spec.relativePath);
      continue;
    }

    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch {
      if (spec.required) missingFiles.push(spec.relativePath);
      continue;
    }

    const trimmed = content.trim();
    if (!trimmed) {
      if (spec.required) missingFiles.push(spec.relativePath);
      continue;
    }

    const originalLength = trimmed.length;
    let limited = trimmed;
    let truncated = false;

    if (limited.length > MAX_FILE_SIZE) {
      limited = `${limited.slice(0, MAX_FILE_SIZE)}\n\n[Truncated: ${spec.relativePath} exceeded ${MAX_FILE_SIZE} chars]`;
      truncated = true;
      truncatedFiles.push(spec.relativePath);
    }

    const file = {
      role: spec.role,
      path,
      content: limited,
      truncated,
      originalLength,
    };
    const section = formatFileSection(file);

    if (totalChars + section.length > MAX_CONTENT_SIZE) {
      capped = true;
      break;
    }

    files.push(file);
    combined += section;
    totalChars += section.length;
  }

  if (capped) {
    combined += `\n\n[Truncated: Workspace context exceeded ${MAX_CONTENT_SIZE} chars]`;
  }

  return {
    files,
    combined: combined.trim(),
    diagnostics: {
      workspaceRoot,
      mode,
      missingFiles,
      truncatedFiles,
      totalChars,
      capped,
    },
  };
}

export function formatWorkspaceMdBlock(context: WorkspaceMdContext): string {
  if (!context.combined) return '';
  return `\n\n## Workspace Instructions (AGENTS/MEMORY)\n\n${context.combined}`;
}
