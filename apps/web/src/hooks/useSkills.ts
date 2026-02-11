import { useState, useEffect, useCallback } from 'react';
import { fetchSkills, reloadSkills, fetchSetting, saveSetting } from '../api';
import type { SkillSummary } from '../types';

export interface UseSkillsReturn {
  skills: SkillSummary[];
  skillsLoadedAt: string | null;
  skillsErrors: string[];
  selectedSkillIds: string[];
  skillsLoading: boolean;
  handleToggleSkill: (skillId: string) => void;
  handleReloadSkills: () => Promise<void>;
}

export function useSkills(isAuthed: boolean, onError?: (msg: string) => void): UseSkillsReturn {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillsLoadedAt, setSkillsLoadedAt] = useState<string | null>(null);
  const [skillsErrors, setSkillsErrors] = useState<string[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);

  // Load skills and stored selection
  useEffect(() => {
    if (!isAuthed) return;
    let isMounted = true;

    const load = async () => {
      setSkillsLoading(true);
      try {
        const [skillsData, storedSetting] = await Promise.all([
          fetchSkills(),
          fetchSetting('selectedSkills'),
        ]);

        if (!isMounted) return;
        setSkills(skillsData.skills);
        setSkillsLoadedAt(skillsData.loadedAt);
        setSkillsErrors(skillsData.errors || []);

        const storedIds = Array.isArray(storedSetting.value)
          ? storedSetting.value.filter((id): id is string => typeof id === 'string')
          : [];
        const validIds = new Set(skillsData.skills.map((skill) => skill.id));
        const filtered = storedIds.filter((id) => validIds.has(id));
        setSelectedSkillIds(filtered);
      } catch (err) {
        if (!isMounted) return;
        onError?.(err instanceof Error ? err.message : 'Failed to load skills');
      } finally {
        if (isMounted) {
          setSkillsLoading(false);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [isAuthed, onError]);

  // Persist selected skills
  useEffect(() => {
    if (!isAuthed) return;
    saveSetting('selectedSkills', selectedSkillIds).catch(() => {
      // Non-blocking persistence; ignore errors.
    });
  }, [isAuthed, selectedSkillIds]);

  const handleToggleSkill = useCallback((skillId: string) => {
    setSelectedSkillIds((prev) =>
      prev.includes(skillId)
        ? prev.filter((id) => id !== skillId)
        : [...prev, skillId]
    );
  }, []);

  const handleReloadSkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const data = await reloadSkills();
      setSkills(data.skills);
      setSkillsLoadedAt(data.loadedAt);
      setSkillsErrors(data.errors || []);
      const validIds = new Set(data.skills.map((skill) => skill.id));
      setSelectedSkillIds((prev) => {
        const filteredIds = prev.filter((id) => validIds.has(id));
        saveSetting('selectedSkills', filteredIds).catch(() => {});
        return filteredIds;
      });
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to reload skills');
    } finally {
      setSkillsLoading(false);
    }
  }, [onError]);

  return {
    skills,
    skillsLoadedAt,
    skillsErrors,
    selectedSkillIds,
    skillsLoading,
    handleToggleSkill,
    handleReloadSkills,
  };
}
