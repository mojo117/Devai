import { access, readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { z } from 'zod';
import type { SkillManifest } from '@devai/shared';

const SkillManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().optional(),
  systemPrompt: z.string().optional(),
  toolAllowList: z.array(z.string()).optional(),
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
        skills.push(await loadSkillFromFile(manifestPath));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const manifestPath = join(resolvedDir, entry.name);
        skills.push(await loadSkillFromFile(manifestPath));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(message);
    }
  }

  return { skills, errors };
}
