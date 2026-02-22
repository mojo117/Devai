import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let supabase: SupabaseClient | null = null;
const DEFAULT_PING_TIMEOUT_MS = 3000;

export interface SupabaseHealthStatus {
  initialized: boolean;
  healthy: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastLatencyMs: number | null;
}

export interface SupabasePingResult {
  ok: boolean;
  checkedAt: string;
  latencyMs: number | null;
  error: string | null;
  storageOk: boolean | null;
  storageError: string | null;
}

const supabaseHealthStatus: SupabaseHealthStatus = {
  initialized: false,
  healthy: false,
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  lastLatencyMs: null,
};

export async function initDb(): Promise<void> {
  if (supabase) {
    return;
  }

  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('Supabase URL and Service Key are required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
  }

  supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    // Ensure default user exists
    await ensureDefaultUser();

    // Verify pgvector memory table
    await verifyPgvector();

    // Verify recent topics table
    await verifyRecentTopics();

    const ping = await pingSupabase({ includeStorage: false, timeoutMs: DEFAULT_PING_TIMEOUT_MS });
    if (!ping.ok) {
      console.warn(`[db] Initial Supabase ping failed: ${ping.error || 'unknown error'}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markSupabaseFailure(message);
    throw error;
  }
}

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return supabase;
}

export function getSupabaseHealthStatus(): SupabaseHealthStatus {
  return { ...supabaseHealthStatus };
}

export async function pingSupabase(options?: {
  includeStorage?: boolean;
  timeoutMs?: number;
}): Promise<SupabasePingResult> {
  const checkedAt = new Date().toISOString();

  if (!supabase) {
    const result: SupabasePingResult = {
      ok: false,
      checkedAt,
      latencyMs: null,
      error: 'Database not initialized',
      storageOk: null,
      storageError: null,
    };
    markSupabaseFailure(result.error || 'Database not initialized');
    return result;
  }

  const includeStorage = options?.includeStorage ?? false;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  const start = Date.now();

  try {
    const queryPromise = supabase
      .from('users')
      .select('id')
      .limit(1);

    const queryResult = await withTimeout(
      Promise.resolve(queryPromise),
      timeoutMs,
      new Error(`Supabase ping timeout after ${timeoutMs}ms`),
    ) as { error: { message: string } | null };

    if (queryResult.error) {
      const result: SupabasePingResult = {
        ok: false,
        checkedAt,
        latencyMs: Date.now() - start,
        error: queryResult.error.message,
        storageOk: null,
        storageError: null,
      };
      markSupabaseFailure(result.error || 'Supabase ping failed');
      return result;
    }

    let storageOk: boolean | null = null;
    let storageError: string | null = null;

    if (includeStorage) {
      const storageResult = await withTimeout(
        Promise.resolve(supabase.storage.listBuckets()),
        timeoutMs,
        new Error(`Supabase storage ping timeout after ${timeoutMs}ms`),
      ) as { error: { message: string } | null };
      storageOk = !storageResult.error;
      storageError = storageResult.error ? storageResult.error.message : null;
    }

    const latencyMs = Date.now() - start;
    markSupabaseSuccess(latencyMs);
    return {
      ok: includeStorage ? storageOk !== false : true,
      checkedAt,
      latencyMs,
      error: null,
      storageOk,
      storageError,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: SupabasePingResult = {
      ok: false,
      checkedAt,
      latencyMs: Date.now() - start,
      error: message,
      storageOk: null,
      storageError: null,
    };
    markSupabaseFailure(message);
    return result;
  }
}

async function ensureDefaultUser(): Promise<void> {
  if (!supabase) return;

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('id', 'local')
    .single();

  if (existing) return;

  const { error } = await supabase
    .from('users')
    .insert({
      id: 'local',
      name: 'Local User',
    });

  if (error && !error.message.includes('duplicate')) {
    console.error('Failed to create default user:', error);
  }
}

async function verifyPgvector(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('devai_memories').select('id').limit(0);
  if (error) {
    console.warn('[db] devai_memories table not found — memory system disabled:', error.message);
  } else {
    console.info('[db] devai_memories table verified — memory system ready');
  }
}

async function verifyRecentTopics(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('devai_recent_topics').select('id').limit(0);
  if (error) {
    console.warn('[db] devai_recent_topics table not found — recent focus system disabled:', error.message);
  } else {
    console.info('[db] devai_recent_topics table verified — recent focus system ready');
  }
}

function markSupabaseSuccess(latencyMs: number): void {
  const now = new Date().toISOString();
  supabaseHealthStatus.initialized = Boolean(supabase);
  supabaseHealthStatus.healthy = true;
  supabaseHealthStatus.lastCheckedAt = now;
  supabaseHealthStatus.lastSuccessAt = now;
  supabaseHealthStatus.lastLatencyMs = latencyMs;
  supabaseHealthStatus.lastError = null;
}

function markSupabaseFailure(error: string): void {
  const now = new Date().toISOString();
  supabaseHealthStatus.initialized = Boolean(supabase);
  supabaseHealthStatus.healthy = false;
  supabaseHealthStatus.lastCheckedAt = now;
  supabaseHealthStatus.lastErrorAt = now;
  supabaseHealthStatus.lastError = error;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: Error,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(timeoutError), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
