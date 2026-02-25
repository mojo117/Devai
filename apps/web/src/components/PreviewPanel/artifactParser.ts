export interface Artifact {
  id: string;
  type: 'html' | 'svg';
  language: string;
  content: string;
  title?: string;
}

const SUPPORTED_TYPES: Record<string, Artifact['type']> = {
  html: 'html',
  svg: 'svg',
};

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
    });
  }

  return artifacts;
}

/**
 * Walk messages in reverse order and return the last artifact
 * from the first assistant message that contains any.
 */
export function getLatestArtifact(
  messages: Array<{ role: string; content: string }>,
): Artifact | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;

    const artifacts = parseArtifacts(msg.content);
    if (artifacts.length > 0) return artifacts[artifacts.length - 1];
  }

  return null;
}
