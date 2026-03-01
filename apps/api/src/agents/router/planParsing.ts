import type { AgentName } from '../types.js';

function parseJsonObject(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (err) {
    console.warn('[planParsing] JSON parse failed:', err instanceof Error ? err.message : err);
  }
  return null;
}

export function parseJsonObjectFromModelOutput(content: string): Record<string, unknown> {
  const candidates: string[] = [];
  for (const match of content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const candidate = match[1]?.trim();
    if (candidate) candidates.push(candidate);
  }

  const trimmed = content.trim();
  if (trimmed) candidates.push(trimmed);

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of new Set(candidates)) {
    const parsed = parseJsonObject(candidate);
    if (parsed) return parsed;
  }

  return {};
}

export function parseAssignedAgent(value: unknown): AgentName {
  if (typeof value !== 'string') return 'chapo';

  const normalized = value.trim().toLowerCase();
  if (normalized === 'chapo') return 'chapo';

  return 'chapo';
}
