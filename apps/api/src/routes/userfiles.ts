import { FastifyPluginAsync } from 'fastify';
import { getSupabase } from '../db/index.js';
import {
  listUserfiles as listUserfilesDb,
  getUserfileById,
  deleteUserfile as deleteUserfileDb,
} from '../db/userfileQueries.js';
import { uploadUserfileFromBuffer, isUploadError } from '../services/userfileService.js';

const STORAGE_BUCKET = 'userfiles';

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

    const buffer = await data.toBuffer();
    const originalName = data.filename;
    const mimeType = data.mimetype || 'application/octet-stream';

    const result = await uploadUserfileFromBuffer(buffer, originalName, mimeType);

    if (isUploadError(result)) {
      const status = result.error.startsWith('Storage upload failed')
        || result.error === 'Failed to save file record'
        ? 500
        : 400;

      const body: { error: string; allowed?: string } = { error: result.error };
      if (result.allowed) {
        body.allowed = result.allowed;
      }
      return reply.status(status).send(body);
    }

    return reply.send({
      success: true,
      file: {
        id: result.file.id,
        name: result.file.filename,
        original_name: result.file.originalName,
        mime_type: result.file.mimeType,
        size: result.file.sizeBytes,
        parse_status: result.file.parseStatus,
        uploaded_at: result.file.uploadedAt,
        expires_at: result.file.expiresAt,
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
