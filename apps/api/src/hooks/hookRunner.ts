/**
 * Hook Runner — executes user-configured hooks around tool calls.
 */

import { exec } from 'child_process';
import { matchHooks, getHooksForSession, type HookRule } from './hookConfig.js';

interface HookContext {
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  projectRoot: string | null;
}

export interface HookOutcome {
  blocked: boolean;
  blockReason?: string;
  executedCount: number;
}

/**
 * Run all matching hooks for an event.
 * Returns whether any blocking hook prevented execution.
 */
export async function runHooks(
  event: HookRule['event'],
  context: HookContext,
): Promise<HookOutcome> {
  const rules = await getHooksForSession(context.projectRoot);
  const matched = matchHooks(rules, event, context.toolName);

  if (matched.length === 0) {
    return { blocked: false, executedCount: 0 };
  }

  let executedCount = 0;

  for (const hook of matched) {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      HOOK_EVENT: event,
      HOOK_TOOL_NAME: context.toolName || '',
      HOOK_TOOL_ARGS: JSON.stringify(context.toolArgs || {}),
      HOOK_TOOL_RESULT: (context.toolResult || '').slice(0, 4000),
    };

    // Extract common tool args as convenience vars
    if (context.toolArgs) {
      const args = context.toolArgs;
      if (typeof args.path === 'string') env.HOOK_FILE_PATH = args.path;
      if (typeof args.file_path === 'string') env.HOOK_FILE_PATH = args.file_path;
      if (typeof args.command === 'string') env.HOOK_COMMAND = args.command;
    }

    const cwd = hook.cwd || context.projectRoot || '/tmp';

    try {
      await execCommand(hook.command, { cwd, env, timeout: hook.timeout || 10_000 });
      executedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[hooks] Hook failed (${event}/${context.toolName}): ${msg}`);

      if (hook.blocking && event === 'before:tool') {
        return {
          blocked: true,
          blockReason: `Hook blocked execution: ${msg}`,
          executedCount,
        };
      }
    }
  }

  return { blocked: false, executedCount };
}

function execCommand(
  command: string,
  options: { cwd: string; env: Record<string, string>; timeout: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      maxBuffer: 1024 * 256,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\nstderr: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}
