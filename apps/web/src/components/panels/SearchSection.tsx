import { useState } from 'react';
import { searchProjectFiles, readProjectFile } from '../../api';
import type { ProjectSearchMatch } from '../../types';
import { PanelSection } from './PanelSection';

interface SearchSectionProps {
  selectedRoot: string;
  ignorePatterns: string[];
}

export function SearchSection({ selectedRoot, ignorePatterns }: SearchSectionProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchGlob, setSearchGlob] = useState('');
  const [searchResults, setSearchResults] = useState<ProjectSearchMatch[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [filePreviewPath, setFilePreviewPath] = useState<string | null>(null);
  const [filePreviewContent, setFilePreviewContent] = useState<string | null>(null);
  const [filePreviewError, setFilePreviewError] = useState<string | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim() || !selectedRoot) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const data = await searchProjectFiles(
        searchQuery.trim(),
        selectedRoot,
        searchGlob.trim() || undefined,
        ignorePatterns
      );
      setSearchResults(data.matches);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  };

  const handlePreviewFile = async (relativePath: string) => {
    if (!selectedRoot) return;
    const fullPath = `${selectedRoot}/${relativePath}`;
    setFilePreviewLoading(true);
    setFilePreviewError(null);
    setFilePreviewPath(relativePath);
    try {
      const data = await readProjectFile(fullPath);
      setFilePreviewContent(data.content);
    } catch (err) {
      setFilePreviewContent(null);
      setFilePreviewError(err instanceof Error ? err.message : 'Failed to read file');
    } finally {
      setFilePreviewLoading(false);
    }
  };

  return (
    <>
      <PanelSection
        title="Repo Search"
        loading={searchLoading}
        onAction={handleSearch}
        actionLabel="Run"
        actionDisabled={!searchQuery.trim() || !selectedRoot}
      >
        <div className="mt-2 space-y-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pattern"
            className="w-full bg-devai-bg border border-devai-border rounded px-2 py-1 text-xs text-devai-text"
          />
          <input
            value={searchGlob}
            onChange={(e) => setSearchGlob(e.target.value)}
            placeholder="Glob filter (optional)"
            className="w-full bg-devai-bg border border-devai-border rounded px-2 py-1 text-xs text-devai-text"
          />
        </div>
        {searchError && <p className="text-xs text-red-300 mt-2">{searchError}</p>}
        {searchResults.length > 0 && (
          <div className="mt-3 space-y-2">
            {searchResults.slice(0, 20).map((match, idx) => (
              <div key={`${match.file}-${match.line}-${idx}`} className="bg-devai-bg rounded p-2 text-xs text-devai-text">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-devai-accent truncate">
                    {match.file}:{match.line}
                  </span>
                  <button
                    onClick={() => handlePreviewFile(match.file)}
                    className="text-[10px] text-devai-text-secondary hover:text-devai-text"
                  >
                    Open
                  </button>
                </div>
                <p className="text-[11px] text-devai-text-secondary mt-1">{match.content}</p>
              </div>
            ))}
            {searchResults.length > 20 && (
              <p className="text-[10px] text-devai-text-muted">Showing first 20 matches.</p>
            )}
          </div>
        )}
      </PanelSection>

      {filePreviewPath && (
        <PanelSection
          title="File Preview"
          onAction={() => {
            setFilePreviewPath(null);
            setFilePreviewContent(null);
            setFilePreviewError(null);
          }}
          actionLabel="Close"
        >
          <p className="text-[10px] text-devai-text-muted mt-1 truncate">{filePreviewPath}</p>
          {filePreviewLoading && <p className="text-xs text-devai-text-muted mt-2">Loading preview...</p>}
          {filePreviewError && <p className="text-xs text-red-300 mt-2">{filePreviewError}</p>}
          {filePreviewContent && (
            <pre className="mt-2 text-[11px] bg-devai-bg p-2 rounded text-devai-text-secondary whitespace-pre-wrap max-h-48 overflow-y-auto">
              {filePreviewContent.length > 2000
                ? `${filePreviewContent.slice(0, 2000)}\n...`
                : filePreviewContent}
            </pre>
          )}
        </PanelSection>
      )}
    </>
  );
}
