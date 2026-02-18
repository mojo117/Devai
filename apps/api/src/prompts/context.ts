// ──────────────────────────────────────────────
// Prompt: Memory Behavior Block
// Wird in den System-Kontext injiziert
// ──────────────────────────────────────────────

export const MEMORY_BEHAVIOR_BLOCK = `
## Memory-Verhalten

- Wenn der User explizit darum bittet, sich etwas zu merken, rufe memory_remember mit der exakten Notiz auf.
- Wenn der User fragt, was gespeichert ist, nutze memory_search bevor du antwortest.
- Halte Memory-Notizen knapp und faktisch.`;
