import type { FastifyReply } from 'fastify';
import { z } from 'zod';

export function parseOrReply400<T extends z.ZodTypeAny>(
  reply: FastifyReply,
  schema: T,
  input: unknown,
  errorMessage: string = 'Invalid request',
): z.infer<T> | null {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    reply.status(400).send({
      error: errorMessage,
      details: parsed.error.issues,
    });
    return null;
  }
  return parsed.data;
}
