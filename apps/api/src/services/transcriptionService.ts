import OpenAI, { toFile } from 'openai';
import { config } from '../config.js';

const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB (Whisper limit)

export class TranscriptionError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TranscriptionError';
    this.statusCode = statusCode;
  }
}

/**
 * Transcribes an audio buffer using OpenAI Whisper.
 *
 * @param buffer  - The raw audio data to transcribe
 * @param filename - Original filename (used for MIME-type hinting)
 * @param mimetype - Optional MIME type of the audio (defaults to 'audio/webm')
 * @returns The transcribed text
 * @throws {TranscriptionError} on validation or configuration errors
 */
export async function transcribeBuffer(
  buffer: Buffer,
  filename: string,
  mimetype?: string,
): Promise<string> {
  if (!config.openaiApiKey) {
    throw new TranscriptionError('OpenAI API key not configured', 500);
  }

  if (buffer.length === 0) {
    throw new TranscriptionError('Audio file is empty', 400);
  }

  if (buffer.length > MAX_AUDIO_SIZE) {
    throw new TranscriptionError('Audio file too large (max 25MB)', 400);
  }

  const client = new OpenAI({ apiKey: config.openaiApiKey });

  const file = await toFile(buffer, filename, {
    type: mimetype || 'audio/webm',
  });

  const transcription = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file,
  });

  return transcription.text;
}
