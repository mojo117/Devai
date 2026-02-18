import { useState, useEffect } from 'react';
import { listProjectFiles } from '../../api';
import type { ProjectFileEntry } from '../../types';
import { PanelSection } from './PanelSection';

interface FileBrowserSectionProps {
  allowedRoots?: string[];
  ignorePatterns: string[];
}

export function FileBrowserSection({ allowedRoots, ignorePatterns }: FileBrowserSectionProps) {
  const [filesPath, setFilesPath] = useState('.');
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedRoot, setSelectedRoot] = useState<string>('');

  useEffect(() => {
    if (allowedRoots && allowedRoots.length > 0) {
      setSelectedRoot((prev) => prev || allowedRoots[0]);
    }
  }, [allowedRoots]);

  useEffect(() => {
    setFilesPath('.');
  }, [selectedRoot]);

  useEffect(() => {
    if (!selectedRoot) return;
    setFilesLoading(true);
    setFilesError(null);
    const path = filesPath === '.' ? selectedRoot : `${selectedRoot}/${filesPath}`;
    listProjectFiles(path, ignorePatterns)
      .then((data) => setFiles(data.files))
      .catch((err) => setFilesError(err instanceof Error ? err.message : 'Failed to load files'))
      .finally(() => setFilesLoading(false));
  }, [filesPath, selectedRoot, ignorePatterns]);

  const handleOpenEntry = (entry: ProjectFileEntry) => {
    if (entry.type !== 'directory') return;
    setFilesPath((prev) => (prev === '.' ? entry.name : `${prev}/${entry.name}`));
  };

  const handleGoUp = () => {
    setFilesPath((prev) => {
      if (!prev || prev === '.') return '.';
      const parts = prev.split('/').filter(Boolean);
      if (parts.length <= 1) return '.';
      return parts.slice(0, -1).join('/');
    });
  };

  return (
    <PanelSection
      title="Project Files"
      onAction={handleGoUp}
      actionLabel="Up"
      actionDisabled={filesPath === '.'}
    >
      <p className="text-[10px] text-devai-text-muted mt-1">
        Root: {selectedRoot || 'none'} / {filesPath}
      </p>
      {!selectedRoot ? (
        <p className="text-xs text-devai-text-muted mt-2">No allowed root selected.</p>
      ) : (
        <>
          {allowedRoots && allowedRoots.length > 1 && (
            <div className="mt-2">
              <label className="text-[11px] text-devai-text-muted">Root</label>
              <select
                value={selectedRoot}
                onChange={(e) => setSelectedRoot(e.target.value)}
                className="mt-1 w-full bg-devai-bg border border-devai-border rounded px-2 py-1 text-xs text-devai-text"
              >
                {allowedRoots.map((root) => (
                  <option key={root} value={root}>{root}</option>
                ))}
              </select>
            </div>
          )}
          {filesError && <p className="text-xs text-red-300 mt-2">{filesError}</p>}
          {filesLoading ? (
            <p className="text-xs text-devai-text-muted mt-2">Loading files...</p>
          ) : (
            <div className="mt-2 space-y-1">
              {files.length === 0 ? (
                <p className="text-xs text-devai-text-muted">No files found.</p>
              ) : (
                files.map((entry) => (
                  <button
                    key={`${filesPath}/${entry.name}`}
                    onClick={() => handleOpenEntry(entry)}
                    className="w-full text-left text-xs bg-devai-bg hover:bg-devai-card rounded px-2 py-1 text-devai-text-secondary flex items-center justify-between"
                    disabled={entry.type !== 'directory'}
                  >
                    <span className="truncate">
                      {entry.type === 'directory' ? '[dir]' : '[file]'} {entry.name}
                    </span>
                    {entry.type === 'directory' && (
                      <span className="text-[10px] text-devai-text-muted">open</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
    </PanelSection>
  );
}
