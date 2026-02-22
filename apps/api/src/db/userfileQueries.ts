/**
 * Database queries for user_files table.
 * Follows patterns from queries.ts.
 */

import { nanoid } from 'nanoid';
import { getSupabase } from './index.js';

export interface UserfileRow {
  id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  uploaded_at: string;
  expires_at: string;
  parsed_content: string | null;
  parse_status: string;
}

export function generateUserfileId(): string {
  return nanoid();
}

export async function insertUserfile(file: UserfileRow): Promise<UserfileRow | null> {
  const { error } = await getSupabase()
    .from('user_files')
    .insert(file);

  if (error) {
    console.error('Failed to insert userfile:', error);
    return null;
  }

  return file;
}

export async function listUserfiles(): Promise<UserfileRow[]> {
  const { data, error } = await getSupabase()
    .from('user_files')
    .select('*')
    .order('uploaded_at', { ascending: false });

  if (error) {
    console.error('Failed to list userfiles:', error);
    return [];
  }

  return (data || []) as UserfileRow[];
}

export async function getUserfileById(id: string): Promise<UserfileRow | null> {
  const { data, error } = await getSupabase()
    .from('user_files')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Failed to get userfile:', error);
    return null;
  }

  return data as UserfileRow;
}

export async function getUserfilesByIds(ids: string[]): Promise<UserfileRow[]> {
  if (ids.length === 0) return [];

  const { data, error } = await getSupabase()
    .from('user_files')
    .select('*')
    .in('id', ids);

  if (error) {
    console.error('Failed to get userfiles by ids:', error);
    return [];
  }

  return (data || []) as UserfileRow[];
}

export async function deleteUserfile(id: string): Promise<boolean> {
  const { error } = await getSupabase()
    .from('user_files')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Failed to delete userfile:', error);
    return false;
  }

  return true;
}

export async function getExpiredUserfiles(): Promise<UserfileRow[]> {
  const now = new Date().toISOString();

  const { data, error } = await getSupabase()
    .from('user_files')
    .select('*')
    .lt('expires_at', now);

  if (error) {
    console.error('Failed to get expired userfiles:', error);
    return [];
  }

  return (data || []) as UserfileRow[];
}

export async function deleteExpiredUserfiles(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await getSupabase()
    .from('user_files')
    .delete()
    .in('id', ids);

  if (error) {
    console.error('Failed to delete expired userfiles:', error);
  }
}
