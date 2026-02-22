import { config } from '../config.js';

const TELEGRAM_MESSAGE_MAX = 4000;
const TELEGRAM_CAPTION_MAX = 1024;
const TELEGRAM_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
const TELEGRAM_CHAT_ACTIONS = new Set(['typing', 'upload_photo', 'record_video', 'upload_video', 'record_voice', 'upload_voice', 'upload_document']);

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocumentResult {
  messageId: number;
  filename: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    voice?: TelegramVoice;
    document?: TelegramDocument;
    photo?: TelegramPhotoSize[];
    chat?: {
      id: number | string;
      type?: string;
    };
    from?: {
      id: number | string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    date?: number;
  };
}

function truncateTelegramMessage(text: string): string {
  if (text.length <= TELEGRAM_MESSAGE_MAX) return text;
  return `${text.slice(0, TELEGRAM_MESSAGE_MAX - 30)}\n\n...[truncated for Telegram]`;
}

export async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  const token = config.telegramBotToken;
  if (!token) {
    console.error('[Telegram] Bot token not configured');
    return;
  }

  const payload = {
    chat_id: String(chatId),
    text: truncateTelegramMessage(text || ''),
    parse_mode: 'Markdown',
  };

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (response.ok) return;

  const retry = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(chatId),
      text: truncateTelegramMessage(text || ''),
    }),
  });

  if (!retry.ok) {
    const responseText = await retry.text();
    console.error('[Telegram] Failed to send message:', responseText);
  }
}

interface TelegramSendDocumentResponse {
  ok: boolean;
  result?: {
    message_id: number;
    document?: { file_name?: string };
  };
  description?: string;
}

/**
 * Send a document (file) to a Telegram chat via the Bot API.
 * Uses multipart/form-data with FormData + Blob for the file upload.
 * Maximum file size: 50 MB (Telegram Bot API limit).
 */
export async function sendTelegramDocument(
  chatId: string | number,
  buffer: Buffer,
  filename: string,
  caption?: string
): Promise<TelegramDocumentResult> {
  const token = config.telegramBotToken;
  if (!token) {
    throw new Error('Telegram bot token not configured');
  }

  if (buffer.length > TELEGRAM_DOCUMENT_MAX_BYTES) {
    throw new Error(
      `File size ${buffer.length} bytes exceeds Telegram limit of ${TELEGRAM_DOCUMENT_MAX_BYTES} bytes (50 MB)`
    );
  }

  await sendTelegramChatAction(chatId, 'upload_document');

  const formData = new FormData();
  const bytes = Uint8Array.from(buffer.values());
  formData.append('chat_id', String(chatId));
  formData.append('document', new Blob([bytes]), filename);

  if (caption) {
    formData.append('caption', caption.slice(0, TELEGRAM_CAPTION_MAX));
    formData.append('parse_mode', 'Markdown');
  }

  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const data = (await response.json()) as TelegramSendDocumentResponse;

  if (!response.ok || !data.ok) {
    const errorMsg = data.description || `HTTP ${response.status}`;
    console.error('[Telegram] Failed to send document:', errorMsg);
    throw new Error(`Telegram sendDocument failed: ${errorMsg}`);
  }

  return {
    messageId: data.result!.message_id,
    filename,
  };
}

export async function sendTelegramChatAction(
  chatId: string | number,
  action: string = 'typing'
): Promise<void> {
  const token = config.telegramBotToken;
  if (!token) return;

  const normalizedAction = TELEGRAM_CHAT_ACTIONS.has(action) ? action : 'typing';
  const url = `https://api.telegram.org/bot${token}/sendChatAction`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(chatId),
      action: normalizedAction,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    console.error('[Telegram] Failed to send chat action:', responseText);
  }
}

function parseAllowedChatIds(raw: string): string[] {
  return raw
    .split(/[,\s;]+/)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

export function isAllowedChat(chatId: string | number): boolean {
  const allowed = parseAllowedChatIds(config.telegramAllowedChatId || '');
  if (allowed.length === 0) return false;
  if (allowed.includes('*')) return true;
  return allowed.includes(String(chatId));
}

interface TelegramFileResponse {
  ok: boolean;
  result?: { file_id: string; file_path?: string; file_size?: number };
}

/**
 * Download a file from Telegram servers by its file_id.
 * Uses the Bot API getFile + file download endpoint.
 */
export async function downloadTelegramFile(fileId: string): Promise<{
  buffer: Buffer;
  filePath: string;
}> {
  const token = config.telegramBotToken;
  if (!token) throw new Error('Telegram bot token not configured');

  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  if (!infoRes.ok) throw new Error(`Telegram getFile failed: ${infoRes.status}`);

  const fileInfo = (await infoRes.json()) as TelegramFileResponse;
  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error('Telegram getFile returned no file_path');
  }

  const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;
  const downloadRes = await fetch(fileUrl);
  if (!downloadRes.ok) throw new Error(`Telegram file download failed: ${downloadRes.status}`);

  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  return { buffer, filePath: fileInfo.result.file_path };
}

export interface ExtractedTelegramMessage {
  chatId: string;
  userId: string;
  text?: string;
  caption?: string;
  voice?: TelegramVoice;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
}

/**
 * Extract message data from a Telegram update.
 * Returns null if the message has no usable content (no text, voice, document, or photo).
 */
export function extractTelegramMessage(update: TelegramUpdate): ExtractedTelegramMessage | null {
  const msg = update.message;
  if (!msg) return null;

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  if (chatId === undefined || userId === undefined) return null;

  const text = msg.text?.trim();
  const caption = msg.caption?.trim();
  const hasContent = text || caption || msg.voice || msg.document || (msg.photo && msg.photo.length > 0);
  if (!hasContent) return null;

  return {
    chatId: String(chatId),
    userId: String(userId),
    text: text || undefined,
    caption: caption || undefined,
    voice: msg.voice,
    document: msg.document,
    photo: msg.photo && msg.photo.length > 0 ? msg.photo : undefined,
  };
}
