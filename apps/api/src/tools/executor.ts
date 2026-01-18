import { isToolWhitelisted, getToolDefinition } from './registry.js';
import * as fsTools from './fs.js';
import * as gitTools from './git.js';
import * as githubTools from './github.js';
import * as logsTools from './logs.js';

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
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

  try {
    let result: unknown;

    switch (toolName) {
      // File System Tools
      case 'fs.listFiles':
        result = await fsTools.listFiles(args.path as string);
        break;

      case 'fs.readFile':
        result = await fsTools.readFile(args.path as string);
        break;

      case 'fs.writeFile':
        result = await fsTools.writeFile(
          args.path as string,
          args.content as string
        );
        break;

      // Git Tools
      case 'git.status':
        result = await gitTools.gitStatus();
        break;

      case 'git.diff':
        result = await gitTools.gitDiff(args.staged as boolean | undefined);
        break;

      case 'git.commit':
        result = await gitTools.gitCommit(args.message as string);
        break;

      // GitHub Tools
      case 'github.triggerWorkflow':
        result = await githubTools.triggerWorkflow(
          args.workflow as string,
          args.ref as string,
          args.inputs as Record<string, string> | undefined
        );
        break;

      case 'github.getWorkflowRunStatus':
        result = await githubTools.getWorkflowRunStatus(args.runId as number);
        break;

      // Logs Tools
      case 'logs.getStagingLogs':
        result = await logsTools.getStagingLogs(args.lines as number | undefined);
        break;

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }

    return {
      success: true,
      result,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
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
