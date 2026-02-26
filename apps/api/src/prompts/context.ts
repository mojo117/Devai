// ──────────────────────────────────────────────
// Prompt: Memory Behavior Block
// Injected into system context
// ──────────────────────────────────────────────

export const MEMORY_BEHAVIOR_BLOCK = `
## Memory Behavior

- When the user explicitly asks you to remember something, call memory_remember with the exact note.
- When the user asks what's stored, use memory_search before answering.
- Keep memory notes concise and factual.`;
