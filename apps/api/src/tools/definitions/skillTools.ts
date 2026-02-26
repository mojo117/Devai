import type { ToolDefinition } from '../registry.js';

export const skillTools: ToolDefinition[] = [
  {
    name: 'skill_create',
    description: 'Create a new skill. Writes skill.json manifest and execute.ts code, then registers it as a tool.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique skill ID (lowercase, hyphens allowed, e.g. "generate-image")' },
        name: { type: 'string', description: 'Human-readable skill name' },
        description: { type: 'string', description: 'What the skill does (shown to agents as tool description)' },
        parameters: { type: 'object', description: 'Skill parameters as { paramName: { type, description, required?, default? } }' },
        code: { type: 'string', description: 'TypeScript source code for execute.ts. Must export async function execute(args, ctx).' },
        tags: { type: 'string', description: 'Comma-separated tags for categorization' },
      },
      required: ['id', 'name', 'description', 'code'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'skill_update',
    description: 'Update an existing skill. Overwrites code and/or manifest fields, then re-registers the tool.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID to update' },
        code: { type: 'string', description: 'New execute.ts source code (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        parameters: { type: 'object', description: 'New parameters definition (optional)' },
      },
      required: ['id'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'skill_delete',
    description: 'Delete a skill and unregister its tool.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID to delete' },
      },
      required: ['id'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'skill_reload',
    description: 'Reload all skills from disk and re-register their tools.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
  {
    name: 'skill_list',
    description: 'List all loaded skills with their status.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
];
