import { isToolWhitelisted, getToolDefinition, normalizeToolName } from './registry.js';
import * as fsTools from './fs.js';
import * as gitTools from './git.js';
import * as githubTools from './github.js';
import * as logsTools from './logs.js';
import * as bashTools from './bash.js';
import * as sshTools from './ssh.js';
import * as pm2Tools from './pm2.js';
import * as webTools from './web.js';
import * as contextTools from './context.js';
import * as memoryTools from './memory.js';
import * as schedulerTools from './scheduler.js';
import * as taskforgeTools from './taskforge.js';
import * as emailTools from './email.js';
import * as telegramTools from './telegram.js';
import { config } from '../config.js';
import { mcpManager } from '../mcp/index.js';
import { join } from 'path';
import { stat, writeFile as fsWriteFile, readFile as fsReadFile, mkdir, rm, access } from 'fs/promises';
import { executeSkill } from '../skills/runner.js';
import { refreshSkills, getSkillSummaries, getSkillById, getSkillLoadState } from '../skills/registry.js';
import { toRuntimePath } from '../utils/pathMapping.js';

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

type ToolArgs = Record<string, unknown>;

export interface ToolExecutionOptions {
  // Internal escape hatch used only after explicit user approval (e.g. approved action queue).
  bypassConfirmation?: boolean;
  // The agent requesting this tool — used for self-inspection access control.
  agentName?: string;
}

async function skillCreate(args: ToolArgs): Promise<unknown> {
  const id = args.id as string;
  const name = args.name as string;
  const description = args.description as string;
  const code = args.code as string;
  const parameters = args.parameters as Record<string, unknown> | undefined;
  const tags = args.tags ? (args.tags as string).split(',').map((t) => t.trim()).filter(Boolean) : undefined;

  const skillDir = join(config.skillsDir, id);

  // Check if skill already exists
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
    createdBy: 'devo',
    ...(tags ? { tags } : {}),
  };

  await mkdir(skillDir, { recursive: true });
  await fsWriteFile(join(skillDir, 'skill.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  await fsWriteFile(join(skillDir, 'execute.ts'), code, 'utf-8');

  // Reload to register the new skill as a tool
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

async function skillUpdate(args: ToolArgs): Promise<unknown> {
  const id = args.id as string;
  const skillDir = join(config.skillsDir, id);

  // Verify skill exists
  const existing = getSkillById(id);
  if (!existing) {
    throw new Error(`Skill "${id}" not found`);
  }

  // Update code if provided
  if (args.code) {
    await fsWriteFile(join(skillDir, 'execute.ts'), args.code as string, 'utf-8');
  }

  // Update manifest fields if provided
  if (args.description || args.parameters) {
    const manifestPath = join(skillDir, 'skill.json');
    const raw = await fsReadFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);

    if (args.description) manifest.description = args.description;
    if (args.parameters) manifest.parameters = args.parameters;

    await fsWriteFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  // Reload to re-register
  await refreshSkills();

  return { updated: true, skillId: id };
}

async function skillDelete(args: ToolArgs): Promise<unknown> {
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

interface ToolExecutionContext {
  fsOptions?: import('./fs.js').FsOptions;
  pickContextRoot: () => Promise<string>;
}

type ToolHandler = (args: ToolArgs, context: ToolExecutionContext) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  // File System Tools
  fs_listFiles: async (args, context) => fsTools.listFiles(args.path as string, context.fsOptions),
  fs_readFile: async (args, context) => fsTools.readFile(args.path as string, context.fsOptions),
  fs_writeFile: async (args) => fsTools.writeFile(args.path as string, args.content as string),
  fs_glob: async (args, context) => fsTools.globFiles(
    args.pattern as string,
    args.path as string | undefined,
    undefined, // ignore
    context.fsOptions,
  ),
  fs_grep: async (args, context) => fsTools.grepFiles(
    args.pattern as string,
    args.path as string,
    args.glob as string | undefined,
    undefined, // ignore
    context.fsOptions,
  ),
  fs_edit: async (args) => fsTools.editFile(
    args.path as string,
    args.old_string as string,
    args.new_string as string,
    args.replace_all as boolean | undefined,
  ),
  fs_mkdir: async (args) => fsTools.makeDirectory(args.path as string),
  fs_move: async (args) => fsTools.moveFile(args.source as string, args.destination as string),
  fs_delete: async (args) => fsTools.deleteFile(args.path as string, args.recursive as boolean | undefined),

  // Git Tools
  git_status: async () => gitTools.gitStatus(),
  git_diff: async (args) => gitTools.gitDiff(args.staged as boolean | undefined),
  git_commit: async (args) => gitTools.gitCommit(args.message as string),
  git_push: async (args) => gitTools.gitPush(args.remote as string | undefined, args.branch as string | undefined),
  git_pull: async (args) => gitTools.gitPull(args.remote as string | undefined, args.branch as string | undefined),
  git_add: async (args) => gitTools.gitAdd(args.files as string[] | undefined),

  // GitHub Tools
  github_triggerWorkflow: async (args) => githubTools.triggerWorkflow(
    args.workflow as string,
    args.ref as string,
    args.inputs as Record<string, string> | undefined,
  ),
  github_getWorkflowRunStatus: async (args) => githubTools.getWorkflowRunStatus(args.runId as number),

  // Logs Tools
  logs_getStagingLogs: async (args) => logsTools.getStagingLogs(args.lines as number | undefined),

  // Web Tools
  web_search: async (args) => {
    const result = await webTools.webSearch(args.query as string, {
      complexity: args.complexity as 'simple' | 'detailed' | 'deep' | undefined,
      recency: args.recency as 'day' | 'week' | 'month' | 'year' | undefined,
    });
    return webTools.formatWebSearchResult(result);
  },
  web_fetch: async (args) => webTools.webFetch(args.url as string, {
    timeout: args.timeout as number | undefined,
  }),

  // DevOps Tools
  bash_execute: async (args) => bashTools.executeBash(args.command as string, {
    cwd: args.cwd as string | undefined,
    timeout: args.timeout as number | undefined,
  }),
  ssh_execute: async (args) => sshTools.executeSSH(
    args.host as string,
    args.command as string,
    { timeout: args.timeout as number | undefined },
  ),
  pm2_status: async (args) => pm2Tools.pm2Status(args.host as string | undefined),
  pm2_restart: async (args) => pm2Tools.pm2Restart(args.processName as string, args.host as string | undefined),
  pm2_stop: async (args) => pm2Tools.pm2Stop(args.processName as string, args.host as string | undefined),
  pm2_start: async (args) => pm2Tools.pm2Start(args.processName as string, args.host as string | undefined),
  pm2_logs: async (args) => pm2Tools.pm2Logs(
    args.processName as string,
    args.lines as number | undefined,
    args.host as string | undefined,
  ),
  pm2_reloadAll: async (args) => pm2Tools.pm2ReloadAll(args.host as string | undefined),
  pm2_save: async (args) => pm2Tools.pm2Save(args.host as string | undefined),
  npm_install: async (args) => bashTools.npmInstall(
    args.packageName as string | undefined,
    args.cwd as string | undefined,
  ),
  npm_run: async (args) => bashTools.npmRun(args.script as string, args.cwd as string | undefined),

  // Context Tools
  context_listDocuments: async (_args, context) => contextTools.listDocuments(await context.pickContextRoot()),
  context_readDocument: async (args, context) => contextTools.readDocument(
    await context.pickContextRoot(),
    args.path as string,
  ),
  context_searchDocuments: async (args, context) => contextTools.searchDocuments(
    await context.pickContextRoot(),
    args.query as string,
  ),

  // Workspace Memory Tools
  memory_remember: async (args) => memoryTools.memoryRemember(args.content as string, {
    promoteToLongTerm: args.promoteToLongTerm as boolean | undefined,
    sessionId: args.sessionId as string | undefined,
    source: 'tool.memory_remember',
  }),
  memory_search: async (args) => memoryTools.memorySearch(args.query as string, {
    limit: args.limit as number | undefined,
    includeLongTerm: args.includeLongTerm as boolean | undefined,
  }),
  memory_readToday: async () => memoryTools.memoryReadToday(),

  // Scheduler Tools
  scheduler_create: async (args) => schedulerTools.schedulerCreate(
    args.name as string,
    args.cronExpression as string,
    args.instruction as string,
    args.notificationChannel as string | undefined,
  ),
  scheduler_list: async () => schedulerTools.schedulerList(),
  scheduler_update: async (args) => schedulerTools.schedulerUpdate(
    args.id as string,
    {
      name: args.name as string | undefined,
      cronExpression: args.cronExpression as string | undefined,
      instruction: args.instruction as string | undefined,
      notificationChannel: args.notificationChannel as string | null | undefined,
      enabled: args.enabled as boolean | undefined,
    },
  ),
  scheduler_delete: async (args) => schedulerTools.schedulerDelete(args.id as string),
  reminder_create: async (args) => schedulerTools.reminderCreate(
    args.message as string,
    args.datetime as string,
    args.notificationChannel as string | undefined,
  ),
  notify_user: async (args) => schedulerTools.notifyUser(
    args.message as string,
    args.channel as string | undefined,
  ),

  // TaskForge Tools
  taskforge_list_tasks: async (args) => taskforgeTools.taskforgeListTasks(
    args.project as string | undefined,
    args.status as string | undefined,
  ),
  taskforge_get_task: async (args) => taskforgeTools.taskforgeGetTask(args.taskId as string),
  taskforge_create_task: async (args) => taskforgeTools.taskforgeCreateTask(
    args.title as string,
    args.description as string,
    args.status as string | undefined,
  ),
  taskforge_move_task: async (args) => taskforgeTools.taskforgeMoveTask(
    args.taskId as string,
    args.newStatus as string,
  ),
  taskforge_add_comment: async (args) => taskforgeTools.taskforgeAddComment(
    args.taskId as string,
    args.comment as string,
  ),
  taskforge_search: async (args) => taskforgeTools.taskforgeSearch(args.query as string),

  // Communication Tools
  send_email: async (args) => emailTools.sendEmail(
    args.to as string,
    args.subject as string,
    args.body as string,
    args.replyTo as string | undefined,
  ),
  telegram_send_document: async (args) => telegramTools.telegramSendDocument(
    args.source as 'filesystem' | 'supabase' | 'url',
    args.path as string,
    args.caption as string | undefined,
    args.filename as string | undefined,
  ),
  deliver_document: async (args) => telegramTools.deliverDocument(
    args.source as 'filesystem' | 'supabase' | 'url',
    args.path as string,
    args.description as string | undefined,
    args.filename as string | undefined,
  ),

  // Skill Management Tools
  skill_create: async (args) => skillCreate(args),
  skill_update: async (args) => skillUpdate(args),
  skill_delete: async (args) => skillDelete(args),
  skill_reload: async () => refreshSkills(),
  skill_list: async () => ({
    skills: getSkillSummaries(),
    ...getSkillLoadState(),
  }),
};

export async function executeTool(
  toolName: string,
  args: ToolArgs,
  options?: ToolExecutionOptions
): Promise<ToolExecutionResult> {
  const normalizedToolName = normalizeToolName(toolName);

  // Verify the tool is whitelisted
  if (!isToolWhitelisted(normalizedToolName)) {
    return {
      success: false,
      error: `Tool "${toolName}" is not whitelisted`,
    };
  }

  const toolDef = getToolDefinition(normalizedToolName);
  if (toolDef?.requiresConfirmation && !options?.bypassConfirmation) {
    return {
      success: false,
      error: `Tool "${normalizedToolName}" requires user confirmation before execution`,
    };
  }

  const start = Date.now();

  try {
    const pickContextRoot = async (): Promise<string> => {
      for (const root of config.allowedRoots) {
        const runtimeRoot = await toRuntimePath(root);
        try {
          const s = await stat(join(runtimeRoot, 'context/documents'));
          if (s.isDirectory()) return runtimeRoot;
        } catch {
          // ignore
        }
      }
      return await toRuntimePath(config.allowedRoots[0]);
    };

    const executionContext: ToolExecutionContext = {
      // Self-inspection: only SCOUT gets read access to Devai's own codebase.
      fsOptions: options?.agentName === 'scout' ? { selfInspection: true } : undefined,
      pickContextRoot,
    };

    const execution = (async () => {
      const handler = TOOL_HANDLERS[normalizedToolName];
      if (handler) {
        return handler(args, executionContext);
      }

      // Route dynamic skill tools (skill_<id>) to the skill runner
      if (normalizedToolName.startsWith('skill_')) {
        // Extract skill ID: skill_generate_image -> generate-image
        const skillId = normalizedToolName.slice(6).replace(/_/g, '-');
        const skill = getSkillById(skillId);
        if (skill) {
          return executeSkill(skillId, args);
        }
      }

      // Route MCP tools to the MCP manager
      if (mcpManager.isMcpTool(normalizedToolName)) {
        const mcpResult = await mcpManager.executeTool(normalizedToolName, args);
        if (!mcpResult.success) {
          throw new Error(`MCP tool "${normalizedToolName}" failed: ${mcpResult.error}`);
        }
        return mcpResult.result;
      }
      throw new Error(`Unknown tool: ${normalizedToolName}`);
    })();

    const result = await withTimeout(execution, config.toolTimeoutMs, normalizedToolName);

    return {
      success: true,
      result,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: Date.now() - start,
    };
  }
}

// Execute multiple tools (for tools that don't require confirmation)
export async function executeTools(
  tools: Array<{ name: string; args: ToolArgs }>
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];

  for (const tool of tools) {
    const toolDef = getToolDefinition(tool.name);

    // Skip tools that require confirmation
    if (toolDef?.requiresConfirmation) {
      results.push({
        success: false,
        error: `Tool "${tool.name}" requires user confirmation`,
      });
      continue;
    }

    const result = await executeTool(tool.name, tool.args);
    results.push(result);
  }

  return results;
}

// Read-only tools that can be safely executed in parallel
const READ_ONLY_TOOLS = new Set([
  'fs_listFiles',
  'fs_readFile',
  'fs_glob',
  'fs_grep',
  'git_status',
  'git_diff',
  'github_getWorkflowRunStatus',
  'logs_getStagingLogs',
  'pm2_status',
  'pm2_logs',
  'web_search',
  'web_fetch',
  'context_listDocuments',
  'context_readDocument',
  'context_searchDocuments',
  'memory_search',
  'memory_readToday',
  'scheduler_list',
  'skill_list',
  'skill_reload',
]);

/**
 * Check if a tool is read-only (safe for parallel execution)
 */
export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

/**
 * Interface for parallel tool execution results
 */
export interface ParallelToolExecution {
  tools: Array<{ name: string; args: ToolArgs }>;
  results: ToolExecutionResult[];
  totalDuration: number;
  parallelCount: number;
  sequentialCount: number;
}

/**
 * Execute tools in parallel where safe, sequential otherwise
 *
 * Read-only tools are executed in parallel for performance.
 * Write tools are executed sequentially for safety.
 */
export async function executeToolsParallel(
  tools: Array<{ name: string; args: ToolArgs }>
): Promise<ParallelToolExecution> {
  const start = Date.now();

  // Separate read-only and write tools
  const readOnlyTools: Array<{ name: string; args: ToolArgs; index: number }> = [];
  const writeTools: Array<{ name: string; args: ToolArgs; index: number }> = [];

  tools.forEach((tool, index) => {
    const toolDef = getToolDefinition(tool.name);

    // Skip tools that require confirmation
    if (toolDef?.requiresConfirmation) {
      writeTools.push({ ...tool, index });
    } else if (isReadOnlyTool(tool.name)) {
      readOnlyTools.push({ ...tool, index });
    } else {
      writeTools.push({ ...tool, index });
    }
  });

  // Execute read-only tools in parallel
  const readOnlyPromises = readOnlyTools.map(async (tool) => ({
    index: tool.index,
    result: await executeTool(tool.name, tool.args),
  }));

  const readOnlyResults = await Promise.all(readOnlyPromises);

  // Execute write tools sequentially
  const writeResults: Array<{ index: number; result: ToolExecutionResult }> = [];
  for (const tool of writeTools) {
    const result = await executeTool(tool.name, tool.args);
    writeResults.push({ index: tool.index, result });
  }

  // Combine results in original order
  const allResults = [...readOnlyResults, ...writeResults];
  allResults.sort((a, b) => a.index - b.index);

  return {
    tools,
    results: allResults.map((r) => r.result),
    totalDuration: Date.now() - start,
    parallelCount: readOnlyTools.length,
    sequentialCount: writeTools.length,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}
