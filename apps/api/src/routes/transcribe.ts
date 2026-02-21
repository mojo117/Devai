import { FastifyPluginAsync } from 'fastify';
import { transcribeBuffer, TranscriptionError } from '../services/transcriptionService.js';

export const transcribeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/transcribe', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No audio file provided' });
    }

    const buffer = await data.toBuffer();
    const filename = data.filename || 'recording.webm';
    const mimetype = data.mimetype || undefined;

    try {
      const text = await transcribeBuffer(buffer, filename, mimetype);
      return reply.send({ text });
    } catch (err) {
      if (err instanceof TranscriptionError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });
};
