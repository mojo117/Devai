import { FastifyPluginAsync } from 'fastify';
import { resolve, extname, basename } from 'path';
import { writeFile, readdir, stat, unlink } from 'fs/promises';

const USERFILES_DIR = '/opt/Userfiles';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
  // Strip directory components and null bytes
  const base = basename(name).replace(/\0/g, '');
  // Replace anything that isn't alphanumeric, dot, dash, underscore, or space
  return base.replace(/[^a-zA-Z0-9.\-_ ]/g, '_');
}

export const userfilesRoutes: FastifyPluginAsync = async (app) => {
  // List files
  app.get('/userfiles', async (_request, reply) => {
    try {
      const entries = await readdir(USERFILES_DIR);
      const files = await Promise.all(
        entries.map(async (name) => {
          const filePath = resolve(USERFILES_DIR, name);
          try {
            const info = await stat(filePath);
            if (!info.isFile()) return null;
            return {
              name,
              size: info.size,
              modifiedAt: info.mtime.toISOString(),
            };
          } catch {
            return null;
          }
        })
      );
      return reply.send({
        files: files.filter(Boolean).sort(
          (a, b) => new Date(b!.modifiedAt).getTime() - new Date(a!.modifiedAt).getTime()
        ),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ error: msg });
    }
  });

  // Upload file
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

    // If file with same name exists, add timestamp suffix
    let finalName = safeName;
    const filePath = resolve(USERFILES_DIR, safeName);
    try {
      await stat(filePath);
      // File exists — add timestamp
      const nameWithoutExt = safeName.slice(0, safeName.length - ext.length);
      finalName = `${nameWithoutExt}_${Date.now()}${ext}`;
    } catch {
      // File doesn't exist, use original name
    }

    const finalPath = resolve(USERFILES_DIR, finalName);

    // Double-check path stays within USERFILES_DIR
    if (!finalPath.startsWith(USERFILES_DIR)) {
      return reply.status(400).send({ error: 'Invalid filename' });
    }

    await writeFile(finalPath, buffer);

    const info = await stat(finalPath);
    return reply.send({
      success: true,
      file: {
        name: finalName,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      },
    });
  });

  // Delete file
  app.delete<{ Params: { filename: string } }>('/userfiles/:filename', async (request, reply) => {
    const { filename } = request.params;
    const safeName = sanitizeFilename(filename);

    if (!safeName || safeName === '.' || safeName === '..') {
      return reply.status(400).send({ error: 'Invalid filename' });
    }

    const filePath = resolve(USERFILES_DIR, safeName);

    if (!filePath.startsWith(USERFILES_DIR)) {
      return reply.status(400).send({ error: 'Invalid filename' });
    }

    try {
      await unlink(filePath);
      return reply.send({ success: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return reply.status(404).send({ error: 'File not found' });
      }
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ error: msg });
    }
  });
};
