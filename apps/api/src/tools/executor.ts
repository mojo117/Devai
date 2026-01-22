import { isToolWhitelisted, getToolDefinition } from './registry.js';
import * as fsTools from './fs.js';
import * as gitTools from './git.js';
import * as githubTools from './github.js';
import * as logsTools from './logs.js';
import * as bashTools from './bash.js';
import * as sshTools from './ssh.js';
import * as pm2Tools from './pm2.js';
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
            args.new_string as string
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
