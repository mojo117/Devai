import { useState, useEffect, useCallback, useRef } from 'react';
import type { Artifact } from './artifactParser';
import { HtmlRenderer } from './HtmlRenderer';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MarkdownEditor } from './MarkdownEditor';
import { UrlRenderer } from './UrlRenderer';
import { PdfRenderer } from './PdfRenderer';
import { computeUnifiedDiff } from './diffUtils';
import { savePreviewEdit } from '../../api';

interface PreviewPanelProps {
  artifact: Artifact | null;
  onScrapeFallback?: (artifactId: string) => void;
  sessionId?: string;
  onContentEdited?: (newContent: string) => void;
}

export function PreviewPanel({
  artifact,
  onScrapeFallback,
  sessionId,
  onContentEdited,
}: PreviewPanelProps) {
  const remote = artifact?.remote;
  const hasRemoteUrl = Boolean(remote?.status === 'ready' && remote.signedUrl);
  const isBuilding = remote?.status === 'queued' || remote?.status === 'building';
  const isFailed = remote?.status === 'failed';

  const [editing, setEditing] = useState(false);
  const [editableContent, setEditableContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const currentEditorContentRef = useRef<string | null>(null);

  // Reset editing when artifact changes
  useEffect(() => {
    setEditing(false);
    setEditableContent(null);
  }, [artifact?.id]);

  const isEditableMarkdown = artifact?.type === 'markdown' && !!artifact.content;

  const handleEditClick = useCallback(() => {
    if (!artifact?.content) return;
    setEditableContent(artifact.content);
    currentEditorContentRef.current = artifact.content;
    setEditing(true);
  }, [artifact?.content]);

  const handleCancel = useCallback(() => {
    setEditing(false);
  }, []);

  const handleSave = useCallback(async (newContent: string) => {
    if (!artifact || !editableContent) return;
    const title = artifact.title || 'document.md';
    const diff = computeUnifiedDiff(editableContent, newContent, title);

    // Update local state immediately so preview shows new content
    onContentEdited?.(newContent);
    setEditableContent(newContent);
    setEditing(false);

    // Persist to backend (non-blocking — UI already updated)
    setSaving(true);
    try {
      await savePreviewEdit({
        newContent,
        diff,
        sessionId,
        title,
        artifactId: artifact.remote?.id,
      });
    } catch (err) {
      console.error('[PreviewPanel] Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [artifact, editableContent, sessionId, onContentEdited]);

  return (
    <div className="h-full flex flex-col bg-devai-card border-l border-devai-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-devai-accent/20 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {artifact ? (
            <>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-devai-accent/10 text-devai-accent border border-devai-accent/30 shrink-0">
                {editing ? 'EDITING' : (remote?.type || artifact.type).toUpperCase()}
              </span>
              {artifact.title && (
                <span className="text-xs text-devai-accent/80 truncate max-w-[200px]">
                  {artifact.title}
                </span>
              )}
              {!editing && isBuilding && (
                <span className="text-[10px] text-yellow-300/90 font-mono">BUILDING</span>
              )}
              {!editing && isFailed && (
                <span className="text-[10px] text-red-300/90 font-mono">FAILED</span>
              )}
            </>
          ) : (
            <span className="text-xs text-devai-accent/50 font-mono">Preview</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {editing ? (
            <>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="text-[11px] px-2 py-1 rounded border border-devai-border text-devai-text-secondary hover:text-devai-text hover:border-devai-border-light disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const content = currentEditorContentRef.current ?? editableContent;
                  if (content !== null) handleSave(content);
                }}
                disabled={saving}
                className="text-[11px] px-2 py-1 rounded border border-devai-accent/60 bg-devai-accent/15 text-devai-accent hover:bg-devai-accent/25 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          ) : isEditableMarkdown ? (
            <button
              onClick={handleEditClick}
              className="p-1.5 rounded border border-devai-accent/30 text-devai-accent/70 hover:text-devai-accent hover:border-devai-accent/50 hover:bg-devai-accent/10 transition-colors"
              title="Edit markdown"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {artifact ? (
          <div className="h-full relative">
            {editing && editableContent !== null ? (
              <MarkdownEditor
                content={editableContent}
                onChange={(v) => { currentEditorContentRef.current = v; }}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            ) : artifact.type === 'markdown' && artifact.content ? (
              <MarkdownRenderer content={artifact.content} />
            ) : artifact.type === 'markdown' && hasRemoteUrl ? (
              <UrlRenderer url={remote!.signedUrl!} title={artifact.title || 'Artifact preview'} />
            ) : hasRemoteUrl ? (
              (remote?.type || artifact.type) === 'pdf' ? (
                <PdfRenderer url={remote!.signedUrl!} />
              ) : remote?.mimeType?.startsWith('image/') ? (
                <img
                  src={remote.signedUrl!}
                  alt={artifact.title || 'Preview'}
                  className="w-full h-full object-contain bg-black/20"
                />
              ) : (
                <UrlRenderer url={remote!.signedUrl!} title={artifact.title || 'Artifact preview'} />
              )
            ) : artifact.type === 'pdf' ? (
              <div className="h-full flex items-center justify-center p-6">
                <p className="text-devai-text-muted text-sm">PDF preview is waiting for artifact build.</p>
              </div>
            ) : artifact.content ? (
              <HtmlRenderer content={artifact.content} />
            ) : (
              <div className="h-full flex items-center justify-center p-6">
                <p className="text-devai-text-muted text-sm">No inline content available for this artifact.</p>
              </div>
            )}

            {!editing && (isBuilding || isFailed) && (
              <div className="absolute bottom-4 left-4 right-4 rounded-md border border-devai-border bg-devai-surface/95 p-3 text-xs">
                {isBuilding ? (
                  <p className="text-devai-text-muted">Preparing isolated preview artifact...</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-red-300">
                      Preview build failed{remote?.error ? `: ${remote.error}` : '.'}
                    </p>
                    {remote?.id && onScrapeFallback && (
                      <button
                        className="px-2 py-1 rounded border border-devai-border text-devai-text-secondary hover:text-devai-text"
                        onClick={() => onScrapeFallback(remote.id)}
                      >
                        Create scrape fallback
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center p-6">
            <div className="text-center space-y-2">
              <p className="text-devai-text-muted text-sm">No preview available</p>
              <p className="text-devai-text-muted/60 text-xs max-w-[240px]">
                Send HTML, SVG, TS/JS, or PDF content to see a live preview here.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
