export interface Artifact {
  id: string;
  type: 'html' | 'svg' | 'webapp' | 'pdf' | 'scrape' | 'markdown';
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
    type?: 'html' | 'svg' | 'webapp' | 'pdf' | 'scrape' | 'markdown';
  };
}

/** Minimal shape of a tool event — avoids importing the full ToolEvent type */
export interface ToolEventLike {
  type: string;
  name?: string;
  arguments?: unknown;
  result?: unknown;
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
  markdown: 'markdown',
  md: 'markdown',
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
  '.md': 'markdown',
  '.markdown': 'markdown',
};

/** Tool names that write file content */
const WRITE_TOOLS = new Set([
  'fs_writeFile',
  'fs_write_file',
  'create_text_file',
  'writeFile',
]);

/** Tool names that edit existing files (no full content in args) */
const EDIT_TOOLS = new Set([
  'fs_edit',
]);

/** Mime-type prefix → artifact type (order matters — specific before generic) */
const MIME_TYPE_MAP: [string, Artifact['type']][] = [
  ['application/pdf', 'pdf'],
  ['image/svg+xml', 'svg'],
  ['text/html', 'html'],
  ['image/', 'html'],
];

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
    if (!ev.name) continue;

    // Handle tool_result events from edit tools (content must be fetched)
    if (ev.type === 'tool_result' && EDIT_TOOLS.has(ev.name)) {
      const res = ev.result as Record<string, unknown> | null;
      const filePath = String(res?.path ?? '');
      if (!filePath) continue;

      const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
      const type = FILE_EXT_MAP[ext];
      if (!type) continue;

      const fileName = filePath.split('/').pop() || filePath;

      artifacts.push({
        id: djb2Hash(`${filePath}\n${Date.now()}`),
        type,
        language: type === 'webapp' ? ext.slice(1) || 'ts' : type,
        content: undefined,
        title: fileName,
        filePath,
        sourceKind: 'tool_event',
      });
      continue;
    }

    // Only process tool_call events from here on
    if (ev.type !== 'tool_call') continue;

    const args = ev.arguments as Record<string, unknown> | null;
    if (!args) continue;

    // Handle show_in_preview — userfile with signed URL ready to display
    if (ev.name === 'show_in_preview') {
      const signedUrl = args.signedUrl as string | undefined;
      const filename = args.filename as string | undefined;
      const mimeType = args.mimeType as string | undefined;
      const userfileId = args.userfileId as string | undefined;
      const inlineContent = args.content as string | undefined;
      if (!signedUrl && !inlineContent) continue;

      // Check filename first for markdown (most reliable)
      const isMarkdown = filename && (filename.endsWith('.md') || filename.endsWith('.markdown'));
      
      // For markdown files, require inline content - skip if missing
      // This allows code block parsing to pick up the content instead
      if (isMarkdown && !inlineContent) {
        console.log(`[artifactParser] Skipping show_in_preview for ${filename} - no inline content, code block parser will handle it`);
        continue;
      }

      // Resolve artifact type
      let artifactType: Artifact['type'] = 'html';
      if (isMarkdown) {
        artifactType = 'markdown';
      } else if (mimeType) {
        for (const [prefix, type] of MIME_TYPE_MAP) {
          if (mimeType === prefix || mimeType.startsWith(prefix)) {
            artifactType = type;
            break;
          }
        }
      }

      artifacts.push({
        id: djb2Hash(userfileId || signedUrl || inlineContent || ''),
        type: artifactType,
        language: artifactType,
        title: filename || 'Preview',
        sourceKind: 'tool_event',
        content: inlineContent,
        remote: signedUrl ? {
          id: userfileId || djb2Hash(signedUrl),
          status: 'ready',
          signedUrl,
          mimeType,
          type: artifactType,
        } : undefined,
      });
      continue;
    }

    if (!WRITE_TOOLS.has(ev.name)) continue;

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

    // First check tool events — explicit tool actions (show_in_preview, fs_writeFile)
    // take priority over incidental fenced code blocks in message text
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

    // Then check fenced code blocks in message text
    const textArtifacts = parseArtifacts(msg.content);
    if (textArtifacts.length > 0) {
      const latest = textArtifacts[textArtifacts.length - 1];
      return { ...latest, messageId: msg.id };
    }
  }

  return null;
}
