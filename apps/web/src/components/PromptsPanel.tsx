import { useEffect, useState } from 'react';
import { fetchSystemPrompt } from '../api';

export function PromptsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchSystemPrompt();
        if (!isMounted) return;
        setPrompt(result.prompt);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load prompt');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

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

  return (
    <div className="fixed right-0 top-[calc(50%-180px)] -translate-y-1/2 z-40">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="absolute right-0 top-1/2 -translate-y-1/2 bg-blue-700 hover:bg-blue-600 text-gray-200 px-2 py-4 rounded-l-lg shadow-lg transition-all"
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        {isOpen ? '>' : '<'} AI Prompts
      </button>

      <div
        className={`bg-gray-800 border-l border-gray-700 shadow-xl transition-all duration-300 overflow-hidden ${
          isOpen ? 'w-96' : 'w-0'
        }`}
      >
        <div className="w-96 h-screen overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-400">System Prompt</h2>
            {loading && <span className="text-[10px] text-gray-500">Loading...</span>}
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
      </div>
    </div>
  );
}
