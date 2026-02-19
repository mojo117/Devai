import { FastifyPluginAsync } from 'fastify';
import OpenAI, { toFile } from 'openai';
import { config } from '../config.js';

const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB (Whisper limit)

export const transcribeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/transcribe', async (request, reply) => {
    if (!config.openaiApiKey) {
      return reply.status(500).send({ error: 'OpenAI API key not configured' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No audio file provided' });
    }

    const buffer = await data.toBuffer();
    if (buffer.length > MAX_AUDIO_SIZE) {
      return reply.status(400).send({ error: 'Audio file too large (max 25MB)' });
    }

    if (buffer.length === 0) {
      return reply.status(400).send({ error: 'Audio file is empty' });
    }

    const client = new OpenAI({ apiKey: config.openaiApiKey });

    const file = await toFile(buffer, data.filename || 'recording.webm', {
      type: data.mimetype || 'audio/webm',
    });

    const transcription = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
    });

    return reply.send({ text: transcription.text });
  });
};
