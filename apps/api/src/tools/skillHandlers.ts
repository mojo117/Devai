import { join } from 'path';
import { writeFile as fsWriteFile, readFile as fsReadFile, mkdir, rm, access } from 'fs/promises';
import { config } from '../config.js';
import { refreshSkills, getSkillById, getSkillLoadState } from '../skills/registry.js';

type ToolArgs = Record<string, unknown>;

export async function skillCreate(args: ToolArgs): Promise<unknown> {
  const id = args.id as string;
  const name = args.name as string;
  const description = args.description as string;
  const code = args.code as string;
  const parameters = args.parameters as Record<string, unknown> | undefined;
  const tags = args.tags ? (args.tags as string).split(',').map((t) => t.trim()).filter(Boolean) : undefined;

  const skillDir = join(config.skillsDir, id);

  try {
    await access(skillDir);
    throw new Error(`Skill "${id}" already exists. Use skill_update to modify it.`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  const manifest = {
    id,
    name,
    description,
    version: '1.0.0',
    ...(parameters ? { parameters } : {}),
    createdBy: 'chapo',
    ...(tags ? { tags } : {}),
  };

  await mkdir(skillDir, { recursive: true });
  await fsWriteFile(join(skillDir, 'skill.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  await fsWriteFile(join(skillDir, 'execute.ts'), code, 'utf-8');

  const loadResult = await refreshSkills();
  const toolName = `skill_${id.replace(/-/g, '_')}`;

  return {
    created: true,
    skillId: id,
    toolName,
    skillsLoaded: loadResult.count,
    errors: loadResult.errors,
  };
}

export async function skillUpdate(args: ToolArgs): Promise<unknown> {
  const id = args.id as string;
  const skillDir = join(config.skillsDir, id);

  const existing = getSkillById(id);
  if (!existing) {
    throw new Error(`Skill "${id}" not found`);
  }

  if (args.code) {
    await fsWriteFile(join(skillDir, 'execute.ts'), args.code as string, 'utf-8');
  }

  if (args.description || args.parameters) {
    const manifestPath = join(skillDir, 'skill.json');
    const raw = await fsReadFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);

    if (args.description) manifest.description = args.description;
    if (args.parameters) manifest.parameters = args.parameters;

    await fsWriteFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  await refreshSkills();

  return { updated: true, skillId: id };
}

export async function skillDelete(args: ToolArgs): Promise<unknown> {
  const id = args.id as string;
  const skillDir = join(config.skillsDir, id);

  const existing = getSkillById(id);
  if (!existing) {
    throw new Error(`Skill "${id}" not found`);
  }

  await rm(skillDir, { recursive: true, force: true });
  await refreshSkills();

  return { deleted: true, skillId: id };
}

export async function skillReload(): Promise<unknown> {
  const result = await refreshSkills();
  return result;
}

export async function skillList(): Promise<unknown> {
  const { getSkillSummaries } = await import('../skills/registry.js');
  return {
    skills: getSkillSummaries(),
    ...getSkillLoadState(),
  };
}
