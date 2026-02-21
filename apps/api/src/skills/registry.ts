import type { SkillManifest, SkillSummary } from '@devai/shared';
import { loadSkillsFromDir } from './loader.js';
import { config } from '../config.js';
import { toolRegistry } from '../tools/registry.js';

export interface SkillLoadSummary {
  skillsDir: string;
  count: number;
  loadedAt: string;
  errors: string[];
}

let cachedSkills: SkillManifest[] = [];
let loadErrors: string[] = [];
let loadedAt: string | null = null;

/** Build tool parameters from skill manifest parameters */
function buildToolParameters(manifest: SkillManifest): {
  type: 'object';
  properties: Record<string, { type: string; description: string; default?: unknown }>;
  required?: string[];
} {
  const properties: Record<string, { type: string; description: string; default?: unknown }> = {};
  const required: string[] = [];

  if (manifest.parameters) {
    for (const [key, param] of Object.entries(manifest.parameters)) {
      properties[key] = {
        type: param.type,
        description: param.description,
      };
      if (param.default !== undefined) {
        properties[key].default = param.default;
      }
      if (param.required !== false) {
        required.push(key);
      }
    }
  }

  return {
    type: 'object' as const,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/** Register a single skill as a tool in the unified registry */
function registerSkillTool(manifest: SkillManifest): void {
  const toolName = `skill_${manifest.id.replace(/-/g, '_')}`;

  toolRegistry.register({
    name: toolName,
    description: `[Skill] ${manifest.description}`,
    parameters: buildToolParameters(manifest),
    requiresConfirmation: false,
    category: 'native',
  });

  // Grant access to CHAPO and DEVO
  toolRegistry.grantAccess('chapo', toolName);
  toolRegistry.grantAccess('devo', toolName);

  console.info(`[skills] Registered skill tool: ${toolName}`);
}

export async function refreshSkills(): Promise<SkillLoadSummary> {
  const skillsDir = config.skillsDir;
  const result = await loadSkillsFromDir(skillsDir);

  cachedSkills = result.skills;
  loadErrors = result.errors;
  loadedAt = new Date().toISOString();

  // Register each skill as a tool
  for (const skill of cachedSkills) {
    registerSkillTool(skill);
  }

  console.info(`[skills] Loaded ${cachedSkills.length} skill(s), ${loadErrors.length} error(s)`);

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

export function getAllSkills(): SkillManifest[] {
  return [...cachedSkills];
}

export function getSkillLoadState(): { loadedAt: string | null; errors: string[] } {
  return {
    loadedAt,
    errors: loadErrors,
  };
}
