import { useState } from 'react';

export function ThinkingPreview({ text, isActive }: { text: string; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;

  const isLong = text.length > 200;

  return (
    <div
      className={`mt-1 ml-5 pl-3 border-l border-devai-border ${
        !expanded && isLong ? 'thinking-fade max-h-[8em] overflow-hidden cursor-pointer' : ''
      }`}
      onClick={isLong && !expanded ? () => setExpanded(true) : undefined}
      title={isLong && !expanded ? 'Click to expand' : undefined}
    >
      <p className="text-[11px] text-devai-text-muted font-mono leading-relaxed whitespace-pre-wrap">
        {text}
        {isActive && <span className="animate-pulse">|</span>}
      </p>
      {expanded && isLong && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          className="text-[10px] text-devai-text-muted/50 hover:text-devai-text-muted mt-1"
        >
          collapse
        </button>
      )}
    </div>
  );
}
