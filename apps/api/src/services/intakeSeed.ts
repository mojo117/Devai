import type { TodoItem } from '../agents/types.js'
import type { LLMProvider } from '../llm/types.js'

const INTAKE_MODEL = 'glm-4.7'
const INTAKE_PROVIDER: LLMProvider = 'zai'

export function buildIntakeSeedPrompt(userMessage: string): string {
  return (
    'Extract all discrete requests from this user message.\n'
    + 'Return a JSON array: [{ "content": "..." }, ...]\n'
    + 'Rules:\n'
    + '- One item per independent request\n'
    + '- Single requests produce a single item\n'
    + '- No interpretation, no sub-tasks, no elaboration\n'
    + '- Greetings or smalltalk produce an empty array []\n'
    + '- Return ONLY the JSON array, compact, no extra whitespace\n\n'
    + `User message: "${userMessage}"`
  )
}

export function parseIntakeSeedResponse(raw: string): TodoItem[] {
  let cleaned = raw.trim()
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // Try to salvage truncated JSON — close any open braces/brackets
    const salvaged = cleaned
      .replace(/,\s*$/, '')          // trailing comma
      .replace(/"[^"]*$/, '"')       // unclosed string
      .replace(/\{[^}]*$/, '')       // remove last incomplete object
      .replace(/,\s*$/, '')          // trailing comma after removal
      + ']'
    try {
      parsed = JSON.parse(salvaged)
    } catch {
      return []
    }
  }

  if (!Array.isArray(parsed)) return []

  return parsed
    .filter((item): item is { content: string } =>
      typeof item === 'object'
      && item !== null
      && typeof (item as Record<string, unknown>).content === 'string'
      && (item as Record<string, unknown>).content !== ''
      && String((item as Record<string, unknown>).content).trim() !== '',
    )
    .map((item) => ({
      content: String(item.content).trim(),
      status: 'pending' as const,
    }))
}

export async function runIntakeSeed(
  userMessage: string,
): Promise<TodoItem[]> {
  const { llmRouter } = await import('../llm/router.js')

  try {
    const response = await llmRouter.generateWithFallback(INTAKE_PROVIDER, {
      model: INTAKE_MODEL,
      messages: [{ role: 'user', content: buildIntakeSeedPrompt(userMessage) }],
      toolsEnabled: false,
      maxTokens: 1024,
    })

    const todos = parseIntakeSeedResponse(response.content)
    if (todos.length > 0) {
      console.info('[intakeSeed] extracted', todos.length, 'todos:', todos.map(t => t.content))
    }
    return todos
  } catch (err) {
    console.warn('[intakeSeed] Failed, skipping seed:', err instanceof Error ? err.message : err)
    return []
  }
}
