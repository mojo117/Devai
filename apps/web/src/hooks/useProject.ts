import { useState, useEffect, useCallback } from 'react';
import { fetchProject, refreshProject } from '../api';
import type { ProjectContext } from '../types';

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
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);
  const [projectContextLoadedAt, setProjectContextLoadedAt] = useState<string | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);

  // Load project context
  useEffect(() => {
    if (!isAuthed || !projectRoot) return;
    setProjectLoading(true);
    fetchProject(projectRoot)
      .then((data) => {
        setProjectContext(data.context);
        setProjectContextLoadedAt(new Date().toISOString());
      })
      .catch((err) => onError?.(err.message))
      .finally(() => setProjectLoading(false));
  }, [isAuthed, projectRoot, onError]);

  const handleRefreshProject = useCallback(async () => {
    if (!projectRoot) return;
    setProjectLoading(true);
    try {
      const data = await refreshProject(projectRoot);
      setProjectContext(data.context);
      setProjectContextLoadedAt(new Date().toISOString());
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to refresh project');
    } finally {
      setProjectLoading(false);
    }
  }, [projectRoot, onError]);

  return {
    projectContext,
    projectContextLoadedAt,
    projectLoading,
    handleRefreshProject,
  };
}
