import { useEffect, useState } from 'react';
import { fetchLooperPrompts } from '../api';
import type { LooperPrompt } from '../types';

export function PromptsPanelContent() {
  const [prompts, setPrompts] = useState<LooperPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  const loadPrompts = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLooperPrompts();
      setPrompts(result.prompts);
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load prompts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      if (!isMounted) return;
      await loadPrompts();
    };
    void run();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-devai-text-secondary">Looper Prompts</h2>
          <p className="text-[10px] text-devai-text-muted mt-1">
            {prompts.length} prompt{prompts.length === 1 ? '' : 's'}
          </p>
          {loadedAt && (
            <p className="text-[10px] text-devai-text-muted mt-1">
              Loaded: {new Date(loadedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-[10px] text-devai-text-muted">Loading...</span>}
          <button
            onClick={() => void loadPrompts()}
            className="text-[10px] text-devai-text-secondary hover:text-devai-text disabled:opacity-50"
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-300 mb-3">
          {error}
        </div>
      )}

      {prompts.length > 0 && (
        <div className="space-y-3">
          {prompts.map((item) => (
            <div key={item.id} className="bg-devai-bg rounded-lg p-3">
              <div className="text-[11px] text-devai-accent font-semibold mb-2">{item.title}</div>
              <pre className="text-xs text-devai-text-secondary whitespace-pre-wrap font-mono">{item.prompt}</pre>
            </div>
          ))}
        </div>
      )}

      {prompts.length === 0 && !loading && !error && (
        <p className="text-xs text-devai-text-muted">No prompts loaded.</p>
      )}
    </div>
  );
}
