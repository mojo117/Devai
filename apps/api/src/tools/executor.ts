import { isToolWhitelisted, getToolDefinition, normalizeToolName } from './registry.js';
import { config } from '../config.js';
import { mcpManager } from '../mcp/index.js';
import { join } from 'path';
import { stat } from 'fs/promises';
import { toRuntimePath } from '../utils/pathMapping.js';
import { executeSkill } from '../skills/runner.js';
import { getSkillById } from '../skills/registry.js';
import { TOOL_HANDLERS, READ_ONLY_TOOLS, type ToolArgs, type ToolExecutionContext } from './toolHandlers.js';

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface ToolExecutionOptions {
  bypassConfirmation?: boolean;
  agentName?: string;
}

export async function executeTool(
  toolName: string,
  args: ToolArgs,
  options?: ToolExecutionOptions
): Promise<ToolExecutionResult> {
  const normalizedToolName = normalizeToolName(toolName);

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
        } catch (err) {
          console.warn('[executor] Context root check failed:', err instanceof Error ? err.message : err);
        }
      }
      return await toRuntimePath(config.allowedRoots[0]);
    };

    const executionContext: ToolExecutionContext = {
      fsOptions: { selfInspection: true },
      pickContextRoot,
    };

    const execution = (async () => {
      const handler = TOOL_HANDLERS[normalizedToolName];
      if (handler) {
        return handler(args, executionContext);
      }

      if (normalizedToolName.startsWith('skill_')) {
        const skillId = normalizedToolName.slice(6).replace(/_/g, '-');
        const skill = getSkillById(skillId);
        if (skill) {
          return executeSkill(skillId, args);
        }
      }

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

export async function executeTools(
  tools: Array<{ name: string; args: ToolArgs }>
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];

  for (const tool of tools) {
    const toolDef = getToolDefinition(tool.name);

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

export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

export interface ParallelToolExecution {
  tools: Array<{ name: string; args: ToolArgs }>;
  results: ToolExecutionResult[];
  totalDuration: number;
  parallelCount: number;
  sequentialCount: number;
}

export async function executeToolsParallel(
  tools: Array<{ name: string; args: ToolArgs }>
): Promise<ParallelToolExecution> {
  const start = Date.now();

  const readOnlyTools: Array<{ name: string; args: ToolArgs; index: number }> = [];
  const writeTools: Array<{ name: string; args: ToolArgs; index: number }> = [];

  tools.forEach((tool, index) => {
    const toolDef = getToolDefinition(tool.name);

    if (toolDef?.requiresConfirmation) {
      writeTools.push({ ...tool, index });
    } else if (isReadOnlyTool(tool.name)) {
      readOnlyTools.push({ ...tool, index });
    } else {
      writeTools.push({ ...tool, index });
    }
  });

  const readOnlyPromises = readOnlyTools.map(async (tool) => ({
    index: tool.index,
    result: await executeTool(tool.name, tool.args),
  }));

  const readOnlyResults = await Promise.all(readOnlyPromises);

  const writeResults: Array<{ index: number; result: ToolExecutionResult }> = [];
  for (const tool of writeTools) {
    const result = await executeTool(tool.name, tool.args);
    writeResults.push({ index: tool.index, result });
  }

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
