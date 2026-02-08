import { useEffect, useState } from 'react';
import { fetchSystemPrompt } from '../api';

export function PromptsPanelContent() {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadPrompt = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchSystemPrompt();
        if (!isMounted) return;
        setPrompt(result.prompt);
        setLoadedAt(new Date().toISOString());
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load prompt');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadPrompt();
    return () => {
      isMounted = false;
    };
  }, []);

  const formatPrompt = (text: string) => {
    const sections = text.split(/\n(?=[A-Z][A-Z\s]+:)/);
    return sections.map((section, index) => {
      const lines = section.split('\n');
      const firstLine = lines[0];
      const isHeader = /^[A-Z][A-Z\s]+:/.test(firstLine);

      if (isHeader) {
        const headerMatch = firstLine.match(/^([A-Z][A-Z\s]+):(.*)/);
        if (headerMatch) {
          const [, header, rest] = headerMatch;
          return (
            <div key={index} className="mb-3">
              <div className="text-blue-400 font-semibold text-xs uppercase tracking-wide mb-1">
                {header}
              </div>
              <div className="text-gray-300 text-xs whitespace-pre-wrap">
                {rest.trim()}
                {lines.slice(1).join('\n')}
              </div>
            </div>
          );
        }
      }

      return (
        <div key={index} className="text-gray-300 text-xs whitespace-pre-wrap mb-3">
          {section}
        </div>
      );
    });
  };

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemPrompt();
      setPrompt(result.prompt);
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load prompt');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-400">System Prompt</h2>
          {loadedAt && (
            <p className="text-[10px] text-gray-600 mt-1">
              Loaded: {new Date(loadedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-[10px] text-gray-500">Loading...</span>}
          <button
            onClick={handleRefresh}
            className="text-[10px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
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

      {prompt && (
        <div className="bg-gray-900 rounded-lg p-3">
          {formatPrompt(prompt)}
        </div>
      )}

      {!prompt && !loading && !error && (
        <p className="text-xs text-gray-500">No prompt loaded.</p>
      )}
    </div>
  );
}
