export interface Artifact {
  id: string;
  type: 'html' | 'svg' | 'webapp' | 'pdf' | 'scrape';
  language: string;
  content?: string;
  title?: string;
  filePath?: string;
  sourceKind: 'inline' | 'tool_event';
  messageId?: string;
  remote?: {
    id: string;
    status: 'queued' | 'building' | 'ready' | 'failed';
    signedUrl?: string;
    signedUrlExpiresAt?: string;
    error?: string | null;
    mimeType?: string | null;
    type?: 'html' | 'svg' | 'webapp' | 'pdf' | 'scrape';
  };
}

/** Minimal shape of a tool event — avoids importing the full ToolEvent type */
export interface ToolEventLike {
  type: string;
  name?: string;
  arguments?: unknown;
}

const SUPPORTED_TYPES: Record<string, Artifact['type']> = {
  html: 'html',
  svg: 'svg',
  ts: 'webapp',
  tsx: 'webapp',
  js: 'webapp',
  jsx: 'webapp',
  javascript: 'webapp',
  typescript: 'webapp',
  pdf: 'pdf',
};

/** File extensions that map to artifact types */
const FILE_EXT_MAP: Record<string, Artifact['type']> = {
  '.html': 'html',
  '.htm': 'html',
  '.svg': 'svg',
  '.ts': 'webapp',
  '.tsx': 'webapp',
  '.js': 'webapp',
  '.jsx': 'webapp',
  '.mjs': 'webapp',
  '.cjs': 'webapp',
  '.pdf': 'pdf',
};

/** Tool names that write file content */
const WRITE_TOOLS = new Set([
  'fs_writeFile',
  'fs_write_file',
  'create_text_file',
  'writeFile',
]);

/** djb2 hash → first 8 hex chars for stable IDs */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8);
}

/**
 * Extract all renderable HTML/SVG artifacts from a text string.
 * Supports triple and quadruple backtick fences.
 * Optional artifact title via: ```html artifact:My Title
 */
export function parseArtifacts(text: string): Artifact[] {
  const regex = /`{3,4}(\w+)?(?:\s+artifact:([^\n]+))?\n([\s\S]*?)`{3,4}/g;
  const artifacts: Artifact[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const language = (match[1] ?? '').toLowerCase();
    const type = SUPPORTED_TYPES[language];
    if (!type) continue;

    const content = match[3];
    artifacts.push({
      id: djb2Hash(content),
      type,
      language,
      content,
      title: match[2]?.trim() || undefined,
      sourceKind: 'inline',
    });
  }

  return artifacts;
}

/**
 * Extract artifacts from tool events (e.g. fs_writeFile with .html content).
 * Looks at tool_call arguments for file-write tools that target HTML/SVG files.
 */
export function parseToolEventArtifacts(events: ToolEventLike[]): Artifact[] {
  const artifacts: Artifact[] = [];

  for (const ev of events) {
    if (ev.type !== 'tool_call' || !ev.name) continue;
    if (!WRITE_TOOLS.has(ev.name)) continue;

    const args = ev.arguments as Record<string, unknown> | null;
    if (!args) continue;

    // Extract file path and content from arguments
    const filePath = String(args.path ?? args.filePath ?? args.file_path ?? '');
    const contentRaw = args.content ?? args.text ?? args.data;
    const content = typeof contentRaw === 'string' ? contentRaw : undefined;
    if (!filePath) continue;

    // Check file extension
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    const type = FILE_EXT_MAP[ext];
    if (!type) continue;

    // Extract filename as title
    const fileName = filePath.split('/').pop() || filePath;

    artifacts.push({
      id: djb2Hash(`${filePath}\n${content || ''}`),
      type,
      language: type === 'webapp' ? ext.slice(1) || 'ts' : type,
      content,
      title: fileName,
      filePath,
      sourceKind: 'tool_event',
    });
  }

  return artifacts;
}

/**
 * Walk messages in reverse order and return the last artifact.
 * Checks both message text (fenced code blocks) and tool events
 * (file-write tool calls with HTML/SVG content).
 */
export function getLatestArtifact(
  messages: Array<{ id?: string; role: string; content: string }>,
  messageToolEvents?: Record<string, ToolEventLike[]>,
): Artifact | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;

    // First check fenced code blocks in message text
    const textArtifacts = parseArtifacts(msg.content);
    if (textArtifacts.length > 0) {
      const latest = textArtifacts[textArtifacts.length - 1];
      return { ...latest, messageId: msg.id };
    }

    // Then check tool events for file-write operations
    if (messageToolEvents && msg.id) {
      const events = messageToolEvents[msg.id];
      if (events) {
        const toolArtifacts = parseToolEventArtifacts(events);
        if (toolArtifacts.length > 0) {
          const latest = toolArtifacts[toolArtifacts.length - 1];
          return { ...latest, messageId: msg.id };
        }
      }
    }
  }

  return null;
}
