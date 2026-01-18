import type { SkillManifest, SkillSummary } from '@devai/shared';
import { loadSkillsFromDir } from './loader.js';
import { config } from '../config.js';

export interface SkillLoadSummary {
  skillsDir: string;
  count: number;
  loadedAt: string;
  errors: string[];
}

let cachedSkills: SkillManifest[] = [];
let loadErrors: string[] = [];
let loadedAt: string | null = null;

export async function refreshSkills(): Promise<SkillLoadSummary> {
  const skillsDir = config.skillsDir;
  const result = await loadSkillsFromDir(skillsDir);

  cachedSkills = result.skills;
  loadErrors = result.errors;
  loadedAt = new Date().toISOString();

  return {
    skillsDir,
    count: cachedSkills.length,
    loadedAt,
    errors: loadErrors,
  };
}

export function getSkillSummaries(): SkillSummary[] {
  return cachedSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    tags: skill.tags,
  }));
}

export function getSkillById(id: string): SkillManifest | undefined {
  return cachedSkills.find((skill) => skill.id === id);
}

export function getSkillLoadState(): { loadedAt: string | null; errors: string[] } {
  return {
    loadedAt,
    errors: loadErrors,
  };
}
