import { useState } from 'react';

interface VisualProofCardProps {
  imageUrl: string;
  caption?: string;
  sourceUrl?: string;
}

export function VisualProofCard({ imageUrl, caption, sourceUrl }: VisualProofCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="flex justify-start">
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2 text-xs text-red-400 max-w-[85%]">
          <span className="font-medium">Screenshot failed to load</span>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 opacity-70 hover:opacity-100"
            >
              ({sourceUrl})
            </a>
          )}
        </div>
      </div>
    );
  }

  const hostname = sourceUrl ? (() => {
    try {
      return new URL(sourceUrl).hostname;
    } catch {
      return sourceUrl;
    }
  })() : null;

  return (
    <div className="flex justify-start">
      <div className="rounded-xl border border-devai-border bg-devai-card max-w-[85%] overflow-hidden">
        <div
          className={`cursor-pointer ${expanded ? '' : 'max-h-[240px] overflow-hidden'}`}
          onClick={() => setExpanded(!expanded)}
        >
          <img
            src={imageUrl}
            alt={caption || 'Visual proof'}
            className="w-full object-contain"
            onError={() => setError(true)}
          />
        </div>

        <div className="flex items-center justify-between px-3 py-2 border-t border-devai-border">
          <div className="min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs text-emerald-400 font-medium">Visual Proof</span>
              {hostname && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-devai-text-muted hover:text-devai-accent truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  {hostname}
                </a>
              )}
            </div>
            {caption && (
              <p className="text-xs text-devai-text-secondary truncate mt-0.5">{caption}</p>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="text-[10px] text-devai-text-muted hover:text-devai-text px-2 py-1 rounded hover:bg-devai-surface/50 transition-colors shrink-0"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
    </div>
  );
}
