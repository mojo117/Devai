export type PreviewArtifactType = 'html' | 'svg' | 'webapp' | 'pdf' | 'scrape';

export type PreviewArtifactStatus = 'queued' | 'building' | 'ready' | 'failed';

export interface PreviewWorkspaceMount {
  workspaceId: string;
  path: string;
}

export interface PreviewSourceFile {
  workspaceId: string;
  path: string;
}

export interface PreviewArtifactRow {
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

export interface PreviewArtifactSummary {
  id: string;
  type: PreviewArtifactType;
  status: PreviewArtifactStatus;
  title: string | null;
  language: string | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  mimeType: string | null;
  signedUrl?: string;
  signedUrlExpiresAt?: string;
}

