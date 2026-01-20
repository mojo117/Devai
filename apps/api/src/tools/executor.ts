import { isToolWhitelisted, getToolDefinition } from './registry.js';
import * as fsTools from './fs.js';
import * as gitTools from './git.js';
import * as githubTools from './github.js';
import * as logsTools from './logs.js';
import { config } from '../config.js';

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

type ToolArgs = Record<string, unknown>;

export async function executeTool(
  toolName: string,
  args: ToolArgs
): Promise<ToolExecutionResult> {
  // Verify the tool is whitelisted
  if (!isToolWhitelisted(toolName)) {
    return {
      success: false,
      error: `Tool "${toolName}" is not whitelisted`,
    };
  }

  const start = Date.now();

  try {
    const execution = (async () => {
      switch (toolName) {
        // File System Tools
        case 'fs.listFiles':
          return fsTools.listFiles(args.path as string);

        case 'fs.readFile':
          return fsTools.readFile(args.path as string);

        case 'fs.writeFile':
          return fsTools.writeFile(
            args.path as string,
            args.content as string
          );

        case 'fs.glob':
          return fsTools.globFiles(
            args.pattern as string,
            args.path as string | undefined
          );

        case 'fs.grep':
          return fsTools.grepFiles(
            args.pattern as string,
            args.path as string,
            args.glob as string | undefined
          );

        case 'fs.edit':
          return fsTools.editFile(
            args.path as string,
            args.old_string as string,
            args.new_string as string
          );

        case 'fs.mkdir':
          return fsTools.makeDirectory(args.path as string);

        case 'fs.move':
          return fsTools.moveFile(
            args.source as string,
            args.destination as string
          );

        case 'fs.delete':
          return fsTools.deleteFile(args.path as string);

        // Git Tools
        case 'git.status':
          return gitTools.gitStatus();

        case 'git.diff':
          return gitTools.gitDiff(args.staged as boolean | undefined);

        case 'git.commit':
          return gitTools.gitCommit(args.message as string);

        // GitHub Tools
        case 'github.triggerWorkflow':
          return githubTools.triggerWorkflow(
            args.workflow as string,
            args.ref as string,
            args.inputs as Record<string, string> | undefined
          );

        case 'github.getWorkflowRunStatus':
          return githubTools.getWorkflowRunStatus(args.runId as number);

        // Logs Tools
        case 'logs.getStagingLogs':
          return logsTools.getStagingLogs(args.lines as number | undefined);

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    })();

    const result = await withTimeout(execution, config.toolTimeoutMs, toolName);

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
