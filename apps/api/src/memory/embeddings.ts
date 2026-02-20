import OpenAI from 'openai';
import { config } from '../config.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 512;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY required for embeddings');
    }
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data[0].embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const truncated = texts.map((t) => t.slice(0, 8000));
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncated,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
