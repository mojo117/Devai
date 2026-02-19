import { FastifyPluginAsync } from 'fastify';
import { extname, basename } from 'path';
import { getSupabase } from '../db/index.js';
import {
  generateUserfileId,
  insertUserfile,
  listUserfiles as listUserfilesDb,
  getUserfileById,
  deleteUserfile as deleteUserfileDb,
} from '../db/userfileQueries.js';
import { parseFileContent } from '../services/fileParser.js';

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

function sanitizeFilename(name: string): string {
  const base = basename(name).replace(/\0/g, '');
  return base.replace(/[^a-zA-Z0-9.\-_ ]/g, '_');
}

export const userfilesRoutes: FastifyPluginAsync = async (app) => {
  // List files (from DB)
  app.get('/userfiles', async (_request, reply) => {
    try {
      const files = await listUserfilesDb();
      return reply.send({
        files: files.map((f) => ({
          id: f.id,
          name: f.filename,
          original_name: f.original_name,
          mime_type: f.mime_type,
          size: f.size_bytes,
          parse_status: f.parse_status,
          uploaded_at: f.uploaded_at,
          expires_at: f.expires_at,
        })),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ error: msg });
    }
  });

  // Upload file → Supabase Storage + DB + parse
  app.post('/userfiles', async (request, reply) => {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'No file provided' });
    }

    const originalName = data.filename;
    const ext = extname(originalName).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return reply.status(400).send({
        error: `File type not allowed: ${ext}`,
        allowed: Array.from(ALLOWED_EXTENSIONS).join(', '),
      });
    }

    const buffer = await data.toBuffer();

    if (buffer.length > MAX_FILE_SIZE) {
      return reply.status(400).send({ error: 'File too large (max 10MB)' });
    }

    const safeName = sanitizeFilename(originalName);
    if (!safeName || safeName === '.' || safeName === '..') {
      return reply.status(400).send({ error: 'Invalid filename' });
    }

    const fileId = generateUserfileId();
    const storagePath = `${fileId}/${safeName}`;
    const mimeType = data.mimetype || 'application/octet-stream';

    // Upload to Supabase Storage
    const { error: storageError } = await getSupabase()
      .storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (storageError) {
      console.error('Supabase Storage upload failed:', storageError);
      return reply.status(500).send({ error: `Storage upload failed: ${storageError.message}` });
    }

    // Parse file content
    const parseResult = await parseFileContent(buffer, safeName, mimeType);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const row = await insertUserfile({
      id: fileId,
      filename: safeName,
      original_name: originalName,
      mime_type: mimeType,
      size_bytes: buffer.length,
      storage_path: storagePath,
      uploaded_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      parsed_content: parseResult.content,
      parse_status: parseResult.status,
    });

    if (!row) {
      // Cleanup storage on DB failure
      await getSupabase().storage.from(STORAGE_BUCKET).remove([storagePath]);
      return reply.status(500).send({ error: 'Failed to save file record' });
    }

    return reply.send({
      success: true,
      file: {
        id: row.id,
        name: row.filename,
        original_name: row.original_name,
        mime_type: row.mime_type,
        size: row.size_bytes,
        parse_status: row.parse_status,
        uploaded_at: row.uploaded_at,
        expires_at: row.expires_at,
      },
    });
  });

  // Get parsed content for a file
  app.get<{ Params: { id: string } }>('/userfiles/:id/content', async (request, reply) => {
    const { id } = request.params;
    const file = await getUserfileById(id);

    if (!file) {
      return reply.status(404).send({ error: 'File not found' });
    }

    return reply.send({
      id: file.id,
      filename: file.filename,
      parse_status: file.parse_status,
      parsed_content: file.parsed_content,
    });
  });

  // Delete file (by ID) — removes from Storage + DB
  app.delete<{ Params: { id: string } }>('/userfiles/:id', async (request, reply) => {
    const { id } = request.params;
    const file = await getUserfileById(id);

    if (!file) {
      return reply.status(404).send({ error: 'File not found' });
    }

    // Remove from Supabase Storage
    const { error: storageError } = await getSupabase()
      .storage
      .from(STORAGE_BUCKET)
      .remove([file.storage_path]);

    if (storageError) {
      console.error('Supabase Storage delete failed:', storageError);
      // Continue with DB delete even if storage cleanup fails
    }

    const deleted = await deleteUserfileDb(id);
    if (!deleted) {
      return reply.status(500).send({ error: 'Failed to delete file record' });
    }

    return reply.send({ success: true });
  });
};
