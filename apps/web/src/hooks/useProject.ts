import { useEffect, useCallback, useRef } from 'react';
import { fetchProject, refreshProject } from '../api';
import type { ProjectContext } from '../types';
import { useAsyncData } from './useAsyncData';

interface ProjectData {
  context: ProjectContext;
  loadedAt: string;
}

export interface UseProjectReturn {
  projectContext: ProjectContext | null;
  projectContextLoadedAt: string | null;
  projectLoading: boolean;
  handleRefreshProject: () => Promise<void>;
}

export function useProject(
  isAuthed: boolean,
  projectRoot: string | undefined,
  onError?: (msg: string) => void
): UseProjectReturn {
  const shouldRefreshRef = useRef(false);

  const fetchFn = useCallback(async (): Promise<ProjectData> => {
    const fetcher = shouldRefreshRef.current ? refreshProject : fetchProject;
    shouldRefreshRef.current = false;
    const data = await fetcher(projectRoot!);
    return { context: data.context, loadedAt: new Date().toISOString() };
  }, [projectRoot]);

  const { data, loading, error, refresh } = useAsyncData(
    fetchFn,
    [projectRoot],
    { enabled: isAuthed && !!projectRoot },
  );

  // Forward errors to parent callback
  useEffect(() => {
    if (error) onError?.(error);
  }, [error, onError]);

  const handleRefreshProject = useCallback(async () => {
    if (!projectRoot) return;
    shouldRefreshRef.current = true;
    refresh();
  }, [projectRoot, refresh]);

  return {
    projectContext: data?.context ?? null,
    projectContextLoadedAt: data?.loadedAt ?? null,
    projectLoading: loading,
    handleRefreshProject,
  };
}
