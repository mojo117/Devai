export type MemoryType = 'semantic' | 'episodic' | 'procedural';
export type MemoryPriority = 'highest' | 'high' | 'medium' | 'low';
export type MemorySource = 'user_stated' | 'error_resolution' | 'pattern' | 'discovery' | 'compaction';

export interface MemoryCandidate {
  content: string;
  type: MemoryType;
  namespace: string;
  source: MemorySource;
  priority?: MemoryPriority;
}

export interface StoredMemory {
  id: string;
  content: string;
  similarity: number;
  memory_type: MemoryType;
  namespace: string;
  strength: number;
  priority: MemoryPriority;
}

export interface MemoryInsert {
  content: string;
  embedding: number[];
  memory_type: MemoryType;
  namespace: string;
  priority: MemoryPriority;
  source: MemorySource;
  session_id?: string;
}
