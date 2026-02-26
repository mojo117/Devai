import { getSupabase } from './index.js';
import { DEFAULT_TRUST_MODE } from '../config/trust.js';
import { isValidEngine, type EngineName } from '../llm/engineProfiles.js';

const DEFAULT_USER_ID = 'local';

export async function getSetting(key: string, userId: string = DEFAULT_USER_ID): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', key)
    .single();

  if (error) {
    return null;
  }

  return data?.value ?? null;
}

export async function setSetting(key: string, value: string, userId: string = DEFAULT_USER_ID): Promise<void> {
  const now = new Date().toISOString();

  const { error } = await getSupabase()
    .from('settings')
    .upsert({
      user_id: userId,
      key,
      value,
      updated_at: now,
    }, {
      onConflict: 'user_id,key',
    });

  if (error) {
    console.error('Failed to save setting:', error);
    throw new Error(`Failed to save setting: ${error.message}`);
  }
}

/**
 * Get the current trust mode setting
 */
export async function getTrustMode(): Promise<'default' | 'trusted'> {
  const value = await getSetting('trustMode');
  if (value === 'trusted') {
    return 'trusted';
  }
  if (value === 'default') {
    return 'default';
  }
  return DEFAULT_TRUST_MODE;
}

/**
 * Set the trust mode
 */
export async function setTrustMode(mode: 'default' | 'trusted'): Promise<void> {
  await setSetting('trustMode', mode);
}

/**
 * Get the global default engine profile
 */
export async function getDefaultEngine(): Promise<EngineName> {
  const value = await getSetting('defaultEngine');
  if (value && isValidEngine(value)) return value;
  return 'glm';
}

/**
 * Set the global default engine profile
 */
export async function setDefaultEngine(engine: EngineName): Promise<void> {
  await setSetting('defaultEngine', engine);
}
