export { retrieveRelevantMemories, triggerSessionEndExtraction } from './service.js';
export { runExtractionPipeline } from './extraction.js';
export { compactMessages } from './compaction.js';
export { runDecay, searchMemories } from './memoryStore.js';
export { generateEmbedding } from './embeddings.js';
export type { MemoryCandidate, StoredMemory, MemoryType, MemoryPriority, MemorySource } from './types.js';
