import { access, readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { z } from 'zod';
import type { SkillManifest } from '@devai/shared';

const SkillParameterSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  description: z.string(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

const SkillManifestSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'id must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().optional(),
  parameters: z.record(SkillParameterSchema).optional(),
  createdBy: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export interface SkillLoadResult {
  skills: SkillManifest[];
  errors: string[];
}

async function loadSkillFromFile(filePath: string): Promise<SkillManifest> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = SkillManifestSchema.safeParse(JSON.parse(raw));

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid skill manifest at ${filePath}: ${message}`);
  }

  return parsed.data;
}

/** Check if a skill has an execute.ts file */
async function hasExecuteFile(skillDir: string): Promise<boolean> {
  try {
    await access(join(skillDir, 'execute.ts'));
    return true;
  } catch {
    return false;
  }
}

export async function loadSkillsFromDir(skillsDir: string): Promise<SkillLoadResult> {
  const skills: SkillManifest[] = [];
  const errors: string[] = [];
  const resolvedDir = resolve(skillsDir);

  try {
    await access(resolvedDir);
  } catch {
    return { skills, errors };
  }

  const entries = await readdir(resolvedDir, { withFileTypes: true });

  for (const entry of entries) {
    try {
      if (entry.isDirectory()) {
        const manifestPath = join(resolvedDir, entry.name, 'skill.json');
        await access(manifestPath);
        const manifest = await loadSkillFromFile(manifestPath);

        // Check for execute.ts — skills without it are manifest-only (legacy)
        const hasCode = await hasExecuteFile(join(resolvedDir, entry.name));
        if (!hasCode) {
          errors.push(`Skill "${manifest.id}" has no execute.ts — skipped`);
          continue;
        }

        skills.push(manifest);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(message);
    }
  }

  return { skills, errors };
}
