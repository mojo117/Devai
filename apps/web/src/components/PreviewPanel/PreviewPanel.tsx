import type { Artifact } from './artifactParser';
import { HtmlRenderer } from './HtmlRenderer';

interface PreviewPanelProps {
  artifact: Artifact | null;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function PreviewPanel({ artifact, onClose, collapsed, onToggleCollapse }: PreviewPanelProps) {
  // When collapsed: show thin vertical strip with "Preview" label rotated 90deg and expand button
  if (collapsed) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center bg-devai-card border-l border-devai-border cursor-pointer hover:bg-devai-surface transition-colors"
        onClick={onToggleCollapse}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapse();
          }
        }}
      >
        <span className="text-devai-text-muted text-xs font-mono [writing-mode:vertical-rl] rotate-180 select-none">
          Preview
        </span>
        <span className="text-devai-text-muted mt-2 text-sm">{'\u25C0'}</span>
      </div>
    );
  }

  // Full panel
  return (
    <div className="h-full flex flex-col bg-devai-card border-l border-devai-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-devai-border shrink-0">
        <div className="flex items-center gap-2">
          {artifact ? (
            <>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-devai-surface text-devai-accent border border-devai-border">
                {artifact.type.toUpperCase()}
              </span>
              {artifact.title && (
                <span className="text-xs text-devai-text-secondary truncate max-w-[200px]">
                  {artifact.title}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-devai-text-muted font-mono">Preview</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleCollapse}
            className="p-1 text-devai-text-muted hover:text-devai-text transition-colors"
            title="Collapse preview"
          >
            {'\u25B6'}
          </button>
          <button
            onClick={onClose}
            className="p-1 text-devai-text-muted hover:text-red-400 transition-colors"
            title="Close preview"
          >
            {'\u2715'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {artifact ? (
          <HtmlRenderer content={artifact.content} />
        ) : (
          <div className="h-full flex items-center justify-center p-6">
            <div className="text-center space-y-2">
              <p className="text-devai-text-muted text-sm">No preview available</p>
              <p className="text-devai-text-muted/60 text-xs max-w-[240px]">
                Send a message with HTML or SVG code to see a live preview here.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
