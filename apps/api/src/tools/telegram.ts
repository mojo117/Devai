/**
 * Telegram tool — sends documents via Telegram Bot API.
 * Supports filesystem, Supabase storage, and URL sources.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { getDefaultNotificationChannel } from '../db/schedulerQueries.js';
import { getUserfileById } from '../db/userfileQueries.js';
import { getSupabase } from '../db/index.js';
import { sendTelegramDocument } from '../external/telegram.js';
import type { ToolExecutionResult } from './executor.js';

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

interface DocumentSuccessResult {
  messageId: number;
  filename: string;
  sizeBytes: number;
  chatId: string;
  source: 'filesystem' | 'supabase' | 'url';
}

/**
 * Extract filename from a Content-Disposition header value.
 * Returns undefined if no filename is found.
 */
function parseFilenameFromContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined;

  // Try filename*= (RFC 5987 encoded) first
  const encodedMatch = header.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\s]+)/i);
  if (encodedMatch) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      // fall through
    }
  }

  // Try filename="..." or filename=...
  const plainMatch = header.match(/filename\s*=\s*"?([^";\s]+)"?/i);
  if (plainMatch) {
    return plainMatch[1];
  }

  return undefined;
}

/**
 * Extract a usable filename from a URL path.
 * Falls back to 'download' if nothing reasonable is found.
 */
function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split('/').filter(Boolean).pop();
    if (lastSegment && lastSegment.includes('.')) {
      return decodeURIComponent(lastSegment);
    }
  } catch {
    // invalid URL, fall through
  }
  return 'download';
}

/**
 * Resolve buffer + filename from a filesystem path.
 */
async function resolveFilesystem(filePath: string): Promise<{ buffer: Buffer; filename: string }> {
  const buffer = await readFile(filePath);
  const filename = basename(filePath);
  return { buffer, filename };
}

/**
 * Resolve buffer + filename from a Supabase userfile ID.
 */
async function resolveSupabase(fileId: string): Promise<{ buffer: Buffer; filename: string }> {
  const userfile = await getUserfileById(fileId);
  if (!userfile) {
    throw new Error(`Userfile not found: ${fileId}`);
  }

  const { data, error } = await getSupabase()
    .storage
    .from('userfiles')
    .download(userfile.storage_path);

  if (error || !data) {
    throw new Error(`Failed to download from Supabase storage: ${error?.message || 'no data returned'}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const filename = userfile.original_name || userfile.filename;
  return { buffer, filename };
}

/**
 * Resolve buffer + filename from a remote URL.
 */
async function resolveUrl(url: string): Promise<{ buffer: Buffer; filename: string }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`URL fetch failed: HTTP ${response.status} ${response.statusText}`);
  }

  const contentDisposition = response.headers.get('content-disposition');
  const filename = parseFilenameFromContentDisposition(contentDisposition) || filenameFromUrl(url);

  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, filename };
}

/**
 * Send a document to the default Telegram notification channel.
 *
 * Supports three source types:
 * - "filesystem": path is a local file path
 * - "supabase": path is a userfile ID
 * - "url": path is a remote URL
 *
 * Never throws — always returns a ToolExecutionResult.
 */
export async function telegramSendDocument(
  source: 'filesystem' | 'supabase' | 'url',
  path: string,
  caption?: string,
  overrideFilename?: string,
): Promise<ToolExecutionResult> {
  try {
    // 1. Resolve chat ID from default notification channel
    const channel = await getDefaultNotificationChannel();
    if (!channel) {
      return {
        success: false,
        error: 'No default notification channel configured. A Telegram chat must be set as the default channel first.',
      };
    }

    const chatId = channel.external_chat_id;

    // 2. Resolve file buffer + filename based on source
    let buffer: Buffer;
    let filename: string;

    switch (source) {
      case 'filesystem': {
        const result = await resolveFilesystem(path);
        buffer = result.buffer;
        filename = result.filename;
        break;
      }
      case 'supabase': {
        const result = await resolveSupabase(path);
        buffer = result.buffer;
        filename = result.filename;
        break;
      }
      case 'url': {
        const result = await resolveUrl(path);
        buffer = result.buffer;
        filename = result.filename;
        break;
      }
      default: {
        const exhaustive: never = source;
        return {
          success: false,
          error: `Unknown source type: ${String(exhaustive)}`,
        };
      }
    }

    // 3. Override filename if provided
    if (overrideFilename) {
      filename = overrideFilename;
    }

    // 4. Size check
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return {
        success: false,
        error: `File size ${buffer.length} bytes (${(buffer.length / (1024 * 1024)).toFixed(1)} MB) exceeds Telegram limit of 50 MB`,
      };
    }

    // 5. Send via Telegram Bot API
    const sendResult = await sendTelegramDocument(chatId, buffer, filename, caption);

    // 6. Return success
    const successResult: DocumentSuccessResult = {
      messageId: sendResult.messageId,
      filename: sendResult.filename,
      sizeBytes: buffer.length,
      chatId,
      source,
    };

    return {
      success: true,
      result: successResult,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
