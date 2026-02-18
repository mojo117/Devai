import { useState, useEffect } from 'react';

interface IgnorePatternsSectionProps {
  ignorePatterns: string[];
  onUpdateIgnorePatterns: (patterns: string[]) => void;
}

export function IgnorePatternsSection({
  ignorePatterns,
  onUpdateIgnorePatterns,
}: IgnorePatternsSectionProps) {
  const [ignoreInput, setIgnoreInput] = useState('');

  useEffect(() => {
    setIgnoreInput(ignorePatterns.join('\n'));
  }, [ignorePatterns]);

  const handleApply = () => {
    const patterns = ignoreInput
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    onUpdateIgnorePatterns(patterns);
  };

  return (
    <div className="mt-4">
      <div className="text-[11px] uppercase tracking-wide text-devai-text-muted mb-1">
        Ignore Patterns
      </div>
      <textarea
        value={ignoreInput}
        onChange={(e) => setIgnoreInput(e.target.value)}
        rows={3}
        placeholder="e.g. node_modules/**, **/dist/**"
        className="w-full bg-devai-bg border border-devai-border rounded px-2 py-1 text-[11px] text-devai-text"
      />
      <div className="mt-2 flex items-center justify-between text-[10px] text-devai-text-muted">
        <span>{ignorePatterns.length} active</span>
        <button
          onClick={handleApply}
          className="text-[10px] text-devai-text-secondary hover:text-devai-text"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
