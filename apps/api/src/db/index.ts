import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let supabase: SupabaseClient | null = null;

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

  // Ensure default user exists
  await ensureDefaultUser();
}

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return supabase;
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
