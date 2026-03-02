// ──────────────────────────────────────────────
// Prompt: Memory Behavior Block
// Injected into system context
// ──────────────────────────────────────────────

export const MEMORY_BEHAVIOR_BLOCK = `
## Memory Behavior

- When the user explicitly asks you to remember something, call memory_remember with the exact note.
- When the user asks what's stored, use memory_search before answering.
- Keep memory notes concise and factual.
- IMPORTANT: Injected memories are past observations, not verified facts.
  When asked about files, lists, or current data — always read the actual file with
  fs_readFile instead of citing memory content. Memory is a hint for WHERE to look,
  not WHAT to answer.`;
