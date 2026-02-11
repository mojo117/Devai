import { useState, useEffect, useCallback } from 'react';
import { fetchSetting, saveSetting } from '../api';
import type {
  PinnedFilesSetting,
  IgnorePatternsSetting,
  ProjectContextOverrideSetting,
} from '../types';

export interface UsePersistedSettingsReturn {
  pinnedFiles: string[];
  setPinnedFiles: React.Dispatch<React.SetStateAction<string[]>>;
  ignorePatterns: string[];
  setIgnorePatterns: React.Dispatch<React.SetStateAction<string[]>>;
  projectContextOverride: ProjectContextOverrideSetting;
  setProjectContextOverride: React.Dispatch<React.SetStateAction<ProjectContextOverrideSetting>>;
  addPinnedFile: (file: string) => void;
  removePinnedFile: (file: string) => void;
}

export function usePersistedSettings(isAuthed: boolean): UsePersistedSettingsReturn {
  const [pinnedFiles, setPinnedFiles] = useState<string[]>([]);
  const [ignorePatterns, setIgnorePatterns] = useState<string[]>([]);
  const [projectContextOverride, setProjectContextOverride] = useState<ProjectContextOverrideSetting>({
    enabled: false,
    summary: '',
  });

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

  const addPinnedFile = useCallback((file: string) => {
    setPinnedFiles((prev) => (prev.includes(file) ? prev : [...prev, file]));
  }, []);

  const removePinnedFile = useCallback((file: string) => {
    setPinnedFiles((prev) => prev.filter((f) => f !== file));
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
  };
}
