function normalizeMessage(text: string): string {
  return (text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/g, '');
}

const GREETINGS = new Set([
  'hi', 'hello', 'hey', 'yo',
  'hallo', 'moin', 'servus',
  'guten morgen', 'guten tag', 'guten abend',
]);

const MEDIA_KEYWORDS = [
  'image',
  'picture',
  'photo',
  'screenshot',
  'scan',
  'ocr',
  'attachment',
  'attached',
  'document',
  'file',
  'pdf',
  'bild',
  'foto',
  'anhang',
  'dokument',
  'datei',
  'im bild',
  'in dem bild',
  'in der datei',
  'im anhang',
];

const MEDIA_REFERENCE_PHRASES = [
  'text from the image',
  'text in the image',
  'text in picture',
  'what is in the image',
  'what does the image say',
  'what does it say in the image',
  'was steht im bild',
  'was steht auf dem bild',
  'was steht in der datei',
  'was steht im anhang',
];

export function isGreeting(text: string): boolean {
  const normalized = normalizeMessage(text);
  if (!normalized) return false;
  return GREETINGS.has(normalized);
}

/**
 * Pinned media context should only be injected for messages that
 * likely refer to an uploaded image/document. This avoids stale media
 * context leaking into unrelated text prompts like "Hi".
 */
export function shouldAttachPinnedContext(text: string): boolean {
  const normalized = normalizeMessage(text);
  if (!normalized) return false;
  if (isGreeting(normalized)) return false;

  if (MEDIA_REFERENCE_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }

  return MEDIA_KEYWORDS.some((keyword) => normalized.includes(keyword));
}
