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
import { config } from '../config.js';
import { mcpManager } from '../mcp/index.js';
import { join } from 'path';
import { stat } from 'fs/promises';
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
}

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

    const execution = (async () => {
      switch (normalizedToolName) {
        // File System Tools
        case 'fs_listFiles':
          return fsTools.listFiles(args.path as string);

        case 'fs_readFile':
          return fsTools.readFile(args.path as string);

        case 'fs_writeFile':
          return fsTools.writeFile(
            args.path as string,
            args.content as string
          );

        case 'fs_glob':
          return fsTools.globFiles(
            args.pattern as string,
            args.path as string | undefined
          );

        case 'fs_grep':
          return fsTools.grepFiles(
            args.pattern as string,
            args.path as string,
            args.glob as string | undefined
          );

        case 'fs_edit':
          return fsTools.editFile(
            args.path as string,
            args.old_string as string,
            args.new_string as string,
            args.replace_all as boolean | undefined
          );

        case 'fs_mkdir':
          return fsTools.makeDirectory(args.path as string);

        case 'fs_move':
          return fsTools.moveFile(
            args.source as string,
            args.destination as string
          );

        case 'fs_delete':
          return fsTools.deleteFile(
            args.path as string,
            args.recursive as boolean | undefined
          );

        // Git Tools
        case 'git_status':
          return gitTools.gitStatus();

        case 'git_diff':
          return gitTools.gitDiff(args.staged as boolean | undefined);

        case 'git_commit':
          return gitTools.gitCommit(args.message as string);

        case 'git_push':
          return gitTools.gitPush(
            args.remote as string | undefined,
            args.branch as string | undefined
          );

        case 'git_pull':
          return gitTools.gitPull(
            args.remote as string | undefined,
            args.branch as string | undefined
          );

        case 'git_add':
          return gitTools.gitAdd(args.files as string[] | undefined);

        // GitHub Tools
        case 'github_triggerWorkflow':
          return githubTools.triggerWorkflow(
            args.workflow as string,
            args.ref as string,
            args.inputs as Record<string, string> | undefined
          );

        case 'github_getWorkflowRunStatus':
          return githubTools.getWorkflowRunStatus(args.runId as number);

        // Logs Tools
        case 'logs_getStagingLogs':
          return logsTools.getStagingLogs(args.lines as number | undefined);

        // Web Tools (SCOUT agent)
        case 'web_search': {
          const result = await webTools.webSearch(args.query as string, {
            complexity: args.complexity as 'simple' | 'detailed' | 'deep' | undefined,
            recency: args.recency as 'day' | 'week' | 'month' | 'year' | undefined,
          });
          // Format the result with citations for display
          return webTools.formatWebSearchResult(result);
        }

        case 'web_fetch':
          return webTools.webFetch(args.url as string, {
            timeout: args.timeout as number | undefined,
          });

        // DevOps Tools - Bash
        case 'bash_execute':
          return bashTools.executeBash(args.command as string, {
            cwd: args.cwd as string | undefined,
            timeout: args.timeout as number | undefined,
          });

        // DevOps Tools - SSH
        case 'ssh_execute':
          return sshTools.executeSSH(
            args.host as string,
            args.command as string,
            { timeout: args.timeout as number | undefined }
          );

        // DevOps Tools - PM2
        case 'pm2_status':
          return pm2Tools.pm2Status(args.host as string | undefined);

        case 'pm2_restart':
          return pm2Tools.pm2Restart(
            args.processName as string,
            args.host as string | undefined
          );

        case 'pm2_stop':
          return pm2Tools.pm2Stop(
            args.processName as string,
            args.host as string | undefined
          );

        case 'pm2_start':
          return pm2Tools.pm2Start(
            args.processName as string,
            args.host as string | undefined
          );

        case 'pm2_logs':
          return pm2Tools.pm2Logs(
            args.processName as string,
            args.lines as number | undefined,
            args.host as string | undefined
          );

        case 'pm2_reloadAll':
          return pm2Tools.pm2ReloadAll(args.host as string | undefined);

        case 'pm2_save':
          return pm2Tools.pm2Save(args.host as string | undefined);

        // DevOps Tools - NPM
        case 'npm_install':
          return bashTools.npmInstall(
            args.packageName as string | undefined,
            args.cwd as string | undefined
          );

        case 'npm_run':
          return bashTools.npmRun(
            args.script as string,
            args.cwd as string | undefined
          );

        // Context Tools (read-only document access)
        case 'context_listDocuments':
          return contextTools.listDocuments(await pickContextRoot());

        case 'context_readDocument':
          return contextTools.readDocument(
            await pickContextRoot(),
            args.path as string
          );

        case 'context_searchDocuments':
          return contextTools.searchDocuments(
            await pickContextRoot(),
            args.query as string
          );

        // Workspace Memory Tools
        case 'memory_remember':
          return memoryTools.memoryRemember(args.content as string, {
            promoteToLongTerm: args.promoteToLongTerm as boolean | undefined,
            sessionId: args.sessionId as string | undefined,
            source: 'tool.memory_remember',
          });

        case 'memory_search':
          return memoryTools.memorySearch(args.query as string, {
            limit: args.limit as number | undefined,
            includeLongTerm: args.includeLongTerm as boolean | undefined,
          });

        case 'memory_readToday':
          return memoryTools.memoryReadToday();

        default:
          // Route MCP tools to the MCP manager
          if (mcpManager.isMcpTool(normalizedToolName)) {
            const mcpResult = await mcpManager.executeTool(normalizedToolName, args);
            if (!mcpResult.success) {
              throw new Error(`MCP tool "${normalizedToolName}" failed: ${mcpResult.error}`);
            }
            return mcpResult.result;
          }
          throw new Error(`Unknown tool: ${normalizedToolName}`);
      }
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
