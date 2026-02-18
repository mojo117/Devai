import { nanoid } from 'nanoid';
import { createAction } from './manager.js';
import type { Action } from './types.js';
import { buildActionPreview } from './preview.js';
import { checkPermission } from '../permissions/checker.js';
import { executeTool, type ToolExecutionResult } from '../tools/executor.js';
import { normalizeToolName, toolRequiresConfirmation } from '../tools/registry.js';

export interface ApprovalBridgeOptions {
  userId?: string;
  onActionPending?: (action: Action) => void | Promise<void>;
}

export interface ApprovalBridgeExecutionResult extends ToolExecutionResult {
  pendingApproval?: boolean;
  actionId?: string;
  description?: string;
}

function generateToolDescription(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'fs_writeFile':
      return `Write to file: ${args.path}`;
    case 'fs_edit':
      return `Edit file: ${args.path}`;
    case 'fs_mkdir':
      return `Create directory: ${args.path}`;
    case 'fs_move':
      return `Move: ${args.source} -> ${args.destination}`;
    case 'fs_delete':
      return `Delete: ${args.path}`;
    case 'git_commit':
      return `Git commit: "${args.message}"`;
    case 'git_push':
      return `Git push to ${args.remote || 'origin'}/${args.branch || 'current branch'}`;
    case 'git_pull':
      return `Git pull from ${args.remote || 'origin'}/${args.branch || 'current branch'}`;
    case 'github_triggerWorkflow':
      return `Trigger workflow: ${args.workflow} on ${args.ref}`;
    case 'bash_execute':
      return `Execute: ${args.command}`;
    case 'ssh_execute':
      return `SSH to ${args.host}: ${args.command}`;
    case 'pm2_restart':
      return `PM2 restart: ${args.processName}`;
    case 'pm2_stop':
      return `PM2 stop: ${args.processName}`;
    case 'pm2_start':
      return `PM2 start: ${args.processName}`;
    case 'pm2_reloadAll':
      return 'PM2 reload all processes';
    case 'npm_install':
      return args.packageName ? `npm install ${args.packageName}` : 'npm install';
    case 'npm_run':
      return `npm run ${args.script}`;
    default:
      return `Execute: ${toolName}`;
  }
}

export async function executeToolWithApprovalBridge(
  toolName: string,
  toolArgs: Record<string, unknown>,
  options?: ApprovalBridgeOptions
): Promise<ApprovalBridgeExecutionResult> {
  const normalizedToolName = normalizeToolName(toolName);
  const permission = await checkPermission(normalizedToolName, toolArgs, options?.userId);

  if (!permission.allowed) {
    return {
      success: false,
      error: permission.reason || `Tool "${normalizedToolName}" is denied by policy`,
    };
  }

  if (permission.requiresConfirmation) {
    const description = generateToolDescription(normalizedToolName, toolArgs);
    const preview = await buildActionPreview(normalizedToolName, toolArgs).catch(() => undefined);

    const action = await createAction({
      id: nanoid(),
      toolName: normalizedToolName,
      toolArgs,
      description,
      preview,
    });

    if (options?.onActionPending) {
      await options.onActionPending(action);
    }

    return {
      success: true,
      pendingApproval: true,
      actionId: action.id,
      description: action.description,
      result: `Action created for approval: ${action.description} (Action ID: ${action.id})`,
    };
  }

  const needsBypass = toolRequiresConfirmation(normalizedToolName);
  if (needsBypass) {
    return executeTool(normalizedToolName, toolArgs, { bypassConfirmation: true });
  }

  return executeTool(normalizedToolName, toolArgs);
}
