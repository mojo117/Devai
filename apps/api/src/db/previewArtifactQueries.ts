import { nanoid } from 'nanoid';
import { getSupabase } from './index.js';
import type {
  PreviewArtifactRow,
  PreviewArtifactStatus,
  PreviewArtifactType,
  PreviewSourceFile,
  PreviewWorkspaceMount,
} from '../preview/types.js';

interface PreviewArtifactDbRow {
  id: string;
  session_id: string;
  message_id: string | null;
  source_kind: 'inline' | 'tool_event' | 'manual';
  artifact_type: PreviewArtifactType;
  status: PreviewArtifactStatus;
  title: string | null;
  language: string | null;
  entrypoint: string | null;
  source_files: PreviewSourceFile[] | null;
  workspace_mounts: PreviewWorkspaceMount[] | null;
  inline_content: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePreviewArtifactParams {
  sessionId: string;
  messageId?: string | null;
  sourceKind: 'inline' | 'tool_event' | 'manual';
  artifactType: PreviewArtifactType;
  title?: string | null;
  language?: string | null;
  entrypoint?: string | null;
  sourceFiles?: PreviewSourceFile[] | null;
  workspaceMounts?: PreviewWorkspaceMount[] | null;
  inlineContent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdatePreviewArtifactParams {
  status?: PreviewArtifactStatus;
  storageBucket?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  inlineContent?: string | null;
}

function mapPreviewArtifactRow(row: PreviewArtifactDbRow): PreviewArtifactRow {
  return {
    ...row,
  };
}

export function generatePreviewArtifactId(): string {
  return `art_${nanoid(16)}`;
}

export async function createPreviewArtifact(params: CreatePreviewArtifactParams): Promise<PreviewArtifactRow> {
  const id = generatePreviewArtifactId();
  const now = new Date().toISOString();

  const row = {
    id,
    session_id: params.sessionId,
    message_id: params.messageId || null,
    source_kind: params.sourceKind,
    artifact_type: params.artifactType,
    status: 'queued' as const,
    title: params.title || null,
    language: params.language || null,
    entrypoint: params.entrypoint || null,
    source_files: params.sourceFiles || null,
    workspace_mounts: params.workspaceMounts || null,
    inline_content: params.inlineContent || null,
    storage_bucket: null,
    storage_path: null,
    mime_type: null,
    error_message: null,
    metadata: params.metadata || null,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await getSupabase()
    .from('preview_artifacts')
    .insert(row)
    .select('*')
    .single<PreviewArtifactDbRow>();

  if (error || !data) {
    throw new Error(`Failed to create preview artifact: ${error?.message || 'unknown error'}`);
  }

  return mapPreviewArtifactRow(data);
}

export async function updatePreviewArtifact(id: string, params: UpdatePreviewArtifactParams): Promise<PreviewArtifactRow> {
  const updates: Partial<PreviewArtifactDbRow> = {
    updated_at: new Date().toISOString(),
  };

  if (params.status) updates.status = params.status;
  if (params.storageBucket !== undefined) updates.storage_bucket = params.storageBucket;
  if (params.storagePath !== undefined) updates.storage_path = params.storagePath;
  if (params.mimeType !== undefined) updates.mime_type = params.mimeType;
  if (params.errorMessage !== undefined) updates.error_message = params.errorMessage;
  if (params.metadata !== undefined) updates.metadata = params.metadata;
  if (params.inlineContent !== undefined) updates.inline_content = params.inlineContent;

  const { data, error } = await getSupabase()
    .from('preview_artifacts')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single<PreviewArtifactDbRow>();

  if (error || !data) {
    throw new Error(`Failed to update preview artifact: ${error?.message || 'unknown error'}`);
  }

  return mapPreviewArtifactRow(data);
}

export async function getPreviewArtifactById(id: string): Promise<PreviewArtifactRow | null> {
  const { data, error } = await getSupabase()
    .from('preview_artifacts')
    .select('*')
    .eq('id', id)
    .single<PreviewArtifactDbRow>();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to read preview artifact: ${error.message}`);
  }

  return data ? mapPreviewArtifactRow(data) : null;
}

export async function listPreviewArtifactsBySession(sessionId: string, limit = 25): Promise<PreviewArtifactRow[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const { data, error } = await getSupabase()
    .from('preview_artifacts')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(boundedLimit)
    .returns<PreviewArtifactDbRow[]>();

  if (error) {
    throw new Error(`Failed to list preview artifacts: ${error.message}`);
  }

  return (data || []).map(mapPreviewArtifactRow);
}

