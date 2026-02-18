import { useMemo, useState } from 'react';
import {
  fetchDailyWorkspaceMemory,
  rememberWorkspaceNote,
  searchWorkspaceMemory,
} from '../api';

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MemoryPanelContent() {
  const [noteInput, setNoteInput] = useState('');
  const [promoteToLongTerm, setPromoteToLongTerm] = useState(false);
  const [rememberLoading, setRememberLoading] = useState(false);
  const [rememberResult, setRememberResult] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<
    Array<{ filePath: string; line: number; snippet: string }>
  >([]);

  const [dailyDate, setDailyDate] = useState(getTodayDate());
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyContent, setDailyContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const noteCount = noteInput.length;
  const canSave = noteInput.trim().length > 0 && noteCount <= 4000;
  const canSearch = searchInput.trim().length > 0;

  const handleRemember = async () => {
    if (!canSave || rememberLoading) return;
    setRememberLoading(true);
    setError(null);
    setRememberResult(null);

    try {
      const saved = await rememberWorkspaceNote(noteInput.trim(), {
        promoteToLongTerm,
        source: 'ui.memory_panel',
      });
      const longTermInfo = saved.longTerm ? ` + ${saved.longTerm.filePath}` : '';
      setRememberResult(`Saved: ${saved.daily.filePath}${longTermInfo}`);
      setNoteInput('');
      setPromoteToLongTerm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setRememberLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!canSearch || searchLoading) return;
    setSearchLoading(true);
    setError(null);

    try {
      const result = await searchWorkspaceMemory(searchInput.trim(), {
        limit: 20,
        includeLongTerm: true,
      });
      setSearchResults(result.hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search memory');
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleLoadDaily = async () => {
    if (dailyLoading) return;
    setDailyLoading(true);
    setError(null);
    try {
      const result = await fetchDailyWorkspaceMemory(dailyDate);
      setDailyContent(result.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load daily memory');
      setDailyContent('');
    } finally {
      setDailyLoading(false);
    }
  };

  const emptySearchText = useMemo(() => {
    if (!searchInput.trim()) return 'Enter a search term to query memory.';
    if (searchLoading) return 'Searching...';
    if (searchResults.length === 0) return 'No memory hits found.';
    return null;
  }, [searchInput, searchLoading, searchResults.length]);

  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-devai-text-secondary">Memory</h2>
        <p className="text-[10px] text-devai-text-muted mt-1">
          Save durable notes and search previously remembered context.
        </p>
      </div>

      <section className="bg-devai-bg rounded-lg p-3 border border-devai-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-devai-text-secondary">Remember Note</h3>
          <span className={`text-[10px] ${noteCount > 4000 ? 'text-red-300' : 'text-devai-text-muted'}`}>
            {noteCount}/4000
          </span>
        </div>

        <textarea
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          placeholder="Remember this: DevAI and OpenClaw run in parallel on Clawd."
          rows={4}
          className="w-full bg-devai-surface border border-devai-border rounded px-2 py-2 text-xs text-devai-text resize-none"
        />

        <label className="flex items-center gap-2 mt-2 text-xs text-devai-text-secondary">
          <input
            type="checkbox"
            checked={promoteToLongTerm}
            onChange={(e) => setPromoteToLongTerm(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          Also save to long-term MEMORY.md
        </label>

        <div className="flex items-center justify-between mt-3">
          <button
            onClick={() => void handleRemember()}
            disabled={!canSave || rememberLoading}
            className="text-xs px-3 py-1.5 rounded bg-devai-accent text-white hover:bg-devai-accent-hover disabled:opacity-50"
          >
            {rememberLoading ? 'Saving...' : 'Save Note'}
          </button>
          {rememberResult && <span className="text-[10px] text-green-300">{rememberResult}</span>}
        </div>
      </section>

      <section className="bg-devai-bg rounded-lg p-3 border border-devai-border">
        <h3 className="text-xs font-semibold text-devai-text-secondary mb-2">Search Memory</h3>
        <div className="flex gap-2">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSearch();
            }}
            placeholder="Search remembered notes..."
            className="flex-1 bg-devai-surface border border-devai-border rounded px-2 py-1.5 text-xs text-devai-text"
          />
          <button
            onClick={() => void handleSearch()}
            disabled={!canSearch || searchLoading}
            className="text-xs px-3 py-1.5 rounded border border-devai-border text-devai-text-secondary hover:text-devai-text disabled:opacity-50"
          >
            Search
          </button>
        </div>

        <div className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
          {emptySearchText && (
            <p className="text-[11px] text-devai-text-muted">{emptySearchText}</p>
          )}
          {searchResults.map((hit, idx) => (
            <div key={`${hit.filePath}:${hit.line}:${idx}`} className="border border-devai-border rounded p-2 bg-devai-surface">
              <div className="text-[10px] text-devai-text-muted mb-1">
                {hit.filePath}:{hit.line}
              </div>
              <div className="text-xs text-devai-text-secondary">{hit.snippet}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-devai-bg rounded-lg p-3 border border-devai-border">
        <h3 className="text-xs font-semibold text-devai-text-secondary mb-2">Daily Memory</h3>
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={dailyDate}
            onChange={(e) => setDailyDate(e.target.value)}
            className="bg-devai-surface border border-devai-border rounded px-2 py-1.5 text-xs text-devai-text"
          />
          <button
            onClick={() => void handleLoadDaily()}
            disabled={dailyLoading}
            className="text-xs px-3 py-1.5 rounded border border-devai-border text-devai-text-secondary hover:text-devai-text disabled:opacity-50"
          >
            {dailyLoading ? 'Loading...' : 'Load'}
          </button>
        </div>
        <textarea
          value={dailyContent}
          readOnly
          rows={7}
          className="mt-2 w-full bg-devai-surface border border-devai-border rounded px-2 py-2 text-[11px] text-devai-text-secondary resize-none font-mono"
          placeholder="No content loaded yet."
        />
      </section>

      {error && (
        <div className="text-xs text-red-300 bg-red-900/30 border border-red-700/50 rounded p-2">
          {error}
        </div>
      )}
    </div>
  );
}
