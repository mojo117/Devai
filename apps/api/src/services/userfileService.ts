/**
 * Userfile upload service — reusable upload logic extracted from the route handler.
 *
 * Handles:
 *  - Extension whitelist validation
 *  - Filename sanitization
 *  - Supabase Storage upload
 *  - File content parsing (via fileParser)
 *  - DB insert into user_files table
 */

import { extname, basename } from 'path';
import { getSupabase } from '../db/index.js';
import {
  generateUserfileId,
  insertUserfile,
  type UserfileRow,
} from '../db/userfileQueries.js';
import { parseFileContent } from './fileParser.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const STORAGE_BUCKET = 'userfiles';

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc', '.docx',
  '.xls', '.xlsx',
  '.ppt', '.pptx',
  '.txt', '.md', '.csv',
  '.msg', '.eml', '.oft',
  '.zip',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
]);

export interface UploadResult {
  success: boolean;
  file: {
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    parseStatus: string;
    uploadedAt: string;
    expiresAt: string;
  };
}

export interface UploadError {
  success: false;
  error: string;
  allowed?: string;
}

function sanitizeFilename(name: string): string {
  const base = basename(name).replace(/\0/g, '');
  return base.replace(/[^a-zA-Z0-9.\-_ ]/g, '_');
}

function isUploadError(result: UploadResult | UploadError): result is UploadError {
  return !result.success && 'error' in result;
}

export { isUploadError };

export async function uploadUserfileFromBuffer(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
): Promise<UploadResult | UploadError> {
  // Validate extension
  const ext = extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      success: false,
      error: `File type not allowed: ${ext}`,
      allowed: Array.from(ALLOWED_EXTENSIONS).join(', '),
    };
  }

  // Validate size
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      success: false,
      error: 'File too large (max 10MB)',
    };
  }

  // Sanitize filename
  const safeName = sanitizeFilename(originalName);
  if (!safeName || safeName === '.' || safeName === '..') {
    return {
      success: false,
      error: 'Invalid filename',
    };
  }

  const fileId = generateUserfileId();
  const storagePath = `${fileId}/${safeName}`;
  const resolvedMimeType = mimeType || 'application/octet-stream';

  // Upload to Supabase Storage
  const { error: storageError } = await getSupabase()
    .storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: resolvedMimeType,
      upsert: false,
    });

  if (storageError) {
    console.error('Supabase Storage upload failed:', storageError);
    return {
      success: false,
      error: `Storage upload failed: ${storageError.message}`,
    };
  }

  // Parse file content
  const parseResult = await parseFileContent(buffer, safeName, resolvedMimeType);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const rowData: UserfileRow = {
    id: fileId,
    filename: safeName,
    original_name: originalName,
    mime_type: resolvedMimeType,
    size_bytes: buffer.length,
    storage_path: storagePath,
    uploaded_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    parsed_content: parseResult.content,
    parse_status: parseResult.status,
  };

  const row = await insertUserfile(rowData);

  if (!row) {
    // Cleanup storage on DB failure
    await getSupabase().storage.from(STORAGE_BUCKET).remove([storagePath]);
    return {
      success: false,
      error: 'Failed to save file record',
    };
  }

  return {
    success: true,
    file: {
      id: row.id,
      filename: row.filename,
      originalName: row.original_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      storagePath: row.storage_path,
      parseStatus: row.parse_status,
      uploadedAt: row.uploaded_at,
      expiresAt: row.expires_at,
    },
  };
}
