import type { Artifact } from './artifactParser';
import { HtmlRenderer } from './HtmlRenderer';
import { MarkdownRenderer } from './MarkdownRenderer';
import { UrlRenderer } from './UrlRenderer';
import { PdfRenderer } from './PdfRenderer';

interface PreviewPanelProps {
  artifact: Artifact | null;
  onScrapeFallback?: (artifactId: string) => void;
}

export function PreviewPanel({
  artifact,
  onScrapeFallback,
}: PreviewPanelProps) {
  const remote = artifact?.remote;
  const hasRemoteUrl = Boolean(remote?.status === 'ready' && remote.signedUrl);
  const isBuilding = remote?.status === 'queued' || remote?.status === 'building';
  const isFailed = remote?.status === 'failed';

  return (
    <div className="h-full flex flex-col bg-devai-card border-l border-devai-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-devai-border shrink-0">
        <div className="flex items-center gap-2">
          {artifact ? (
            <>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-devai-surface text-devai-accent border border-devai-border">
                {(remote?.type || artifact.type).toUpperCase()}
              </span>
              {artifact.title && (
                <span className="text-xs text-devai-text-secondary truncate max-w-[200px]">
                  {artifact.title}
                </span>
              )}
              {isBuilding && (
                <span className="text-[10px] text-yellow-300/90 font-mono">BUILDING</span>
              )}
              {isFailed && (
                <span className="text-[10px] text-red-300/90 font-mono">FAILED</span>
              )}
            </>
          ) : (
            <span className="text-xs text-devai-text-muted font-mono">Preview</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {artifact ? (
          <div className="h-full relative">
            {artifact.type === 'markdown' && artifact.content ? (
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

            {(isBuilding || isFailed) && (
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
