import { useState, useEffect, useCallback } from 'react';
import { fetchSetting, saveSetting } from '../api';
import type {
  PinnedFilesSetting,
  IgnorePatternsSetting,
  ProjectContextOverrideSetting,
} from '../types';

interface PinnedUserfileIdsSetting {
  ids: string[];
}

export interface UsePersistedSettingsReturn {
  pinnedFiles: string[];
  setPinnedFiles: React.Dispatch<React.SetStateAction<string[]>>;
  ignorePatterns: string[];
  setIgnorePatterns: React.Dispatch<React.SetStateAction<string[]>>;
  projectContextOverride: ProjectContextOverrideSetting;
  setProjectContextOverride: React.Dispatch<React.SetStateAction<ProjectContextOverrideSetting>>;
  addPinnedFile: (file: string) => void;
  removePinnedFile: (file: string) => void;
  pinnedUserfileIds: string[];
  togglePinnedUserfile: (id: string) => void;
  clearPinnedUserfiles: () => void;
}

export function usePersistedSettings(isAuthed: boolean): UsePersistedSettingsReturn {
  const [pinnedFiles, setPinnedFiles] = useState<string[]>([]);
  const [ignorePatterns, setIgnorePatterns] = useState<string[]>([]);
  const [projectContextOverride, setProjectContextOverride] = useState<ProjectContextOverrideSetting>({
    enabled: false,
    summary: '',
  });
  const [pinnedUserfileIds, setPinnedUserfileIds] = useState<string[]>([]);

  // Load pinned files
  useEffect(() => {
    if (!isAuthed) return;
    let isMounted = true;

    const loadPinned = async () => {
      try {
        const stored = await fetchSetting('pinnedFiles');
        const value = stored.value as PinnedFilesSetting | null;
        if (!isMounted) return;
        const files = value && Array.isArray((value as PinnedFilesSetting).files)
          ? (value as PinnedFilesSetting).files.filter((f): f is string => typeof f === 'string')
          : [];
        setPinnedFiles(files);
      } catch {
        if (!isMounted) return;
        setPinnedFiles([]);
      }
    };

    loadPinned();
    return () => { isMounted = false; };
  }, [isAuthed]);

  // Load ignore patterns
  useEffect(() => {
    if (!isAuthed) return;
    let isMounted = true;

    const loadIgnorePatterns = async () => {
      try {
        const stored = await fetchSetting('ignorePatterns');
        const value = stored.value as IgnorePatternsSetting | null;
        if (!isMounted) return;
        const patterns = value && Array.isArray((value as IgnorePatternsSetting).patterns)
          ? (value as IgnorePatternsSetting).patterns.filter((p): p is string => typeof p === 'string')
          : [];
        setIgnorePatterns(patterns);
      } catch {
        if (!isMounted) return;
        setIgnorePatterns([]);
      }
    };

    loadIgnorePatterns();
    return () => { isMounted = false; };
  }, [isAuthed]);

  // Load project context override
  useEffect(() => {
    if (!isAuthed) return;
    let isMounted = true;

    const loadProjectContextOverride = async () => {
      try {
        const stored = await fetchSetting('projectContextOverride');
        const value = stored.value as ProjectContextOverrideSetting | null;
        if (!isMounted) return;
        const next = value && typeof value === 'object'
          ? {
              enabled: Boolean((value as ProjectContextOverrideSetting).enabled),
              summary: typeof (value as ProjectContextOverrideSetting).summary === 'string'
                ? (value as ProjectContextOverrideSetting).summary
                : '',
            }
          : { enabled: false, summary: '' };
        setProjectContextOverride(next);
      } catch {
        if (!isMounted) return;
        setProjectContextOverride({ enabled: false, summary: '' });
      }
    };

    loadProjectContextOverride();
    return () => { isMounted = false; };
  }, [isAuthed]);

  // Load pinned userfile IDs
  useEffect(() => {
    if (!isAuthed) return;
    let isMounted = true;

    const loadPinnedUserfiles = async () => {
      try {
        const stored = await fetchSetting('pinnedUserfileIds');
        const value = stored.value as PinnedUserfileIdsSetting | null;
        if (!isMounted) return;
        const ids = value && Array.isArray((value as PinnedUserfileIdsSetting).ids)
          ? (value as PinnedUserfileIdsSetting).ids.filter((id): id is string => typeof id === 'string')
          : [];
        setPinnedUserfileIds(ids);
      } catch {
        if (!isMounted) return;
        setPinnedUserfileIds([]);
      }
    };

    loadPinnedUserfiles();
    return () => { isMounted = false; };
  }, [isAuthed]);

  // Persist pinned files
  useEffect(() => {
    if (!isAuthed) return;
    saveSetting('pinnedFiles', { files: pinnedFiles }).catch(() => {});
  }, [isAuthed, pinnedFiles]);

  // Persist ignore patterns
  useEffect(() => {
    if (!isAuthed) return;
    saveSetting('ignorePatterns', { patterns: ignorePatterns }).catch(() => {});
  }, [isAuthed, ignorePatterns]);

  // Persist project context override
  useEffect(() => {
    if (!isAuthed) return;
    saveSetting('projectContextOverride', projectContextOverride).catch(() => {});
  }, [isAuthed, projectContextOverride]);

  // Persist pinned userfile IDs
  useEffect(() => {
    if (!isAuthed) return;
    saveSetting('pinnedUserfileIds', { ids: pinnedUserfileIds }).catch(() => {});
  }, [isAuthed, pinnedUserfileIds]);

  const addPinnedFile = useCallback((file: string) => {
    setPinnedFiles((prev) => (prev.includes(file) ? prev : [...prev, file]));
  }, []);

  const removePinnedFile = useCallback((file: string) => {
    setPinnedFiles((prev) => prev.filter((f) => f !== file));
  }, []);

  const togglePinnedUserfile = useCallback((id: string) => {
    setPinnedUserfileIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }, []);

  const clearPinnedUserfiles = useCallback(() => {
    setPinnedUserfileIds([]);
  }, []);

  return {
    pinnedFiles,
    setPinnedFiles,
    ignorePatterns,
    setIgnorePatterns,
    projectContextOverride,
    setProjectContextOverride,
    addPinnedFile,
    removePinnedFile,
    pinnedUserfileIds,
    togglePinnedUserfile,
    clearPinnedUserfiles,
  };
}
