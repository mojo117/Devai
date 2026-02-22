import { executeToolWithApprovalBridge } from '../../actions/approvalBridge.js';
import {
  buildCaioEvidence,
  normalizeToolOutcome,
  preflightCaioToolCall,
  type CaioEvidence,
  type ToolPreflightResult,
} from './caioEvidence.js';
import { buildScoutDelegationFromArgs, isDelegationSuccessful, type ParallelDelegation } from './delegationUtils.js';
import type { DelegationRunnerDeps, DelegationSourceAgent } from './delegationRunner.js';
import type { SubAgentToolCallOutcome } from '../sub-agent-runner.js';
import type { ToolEvidence, LoopDelegationResult } from '../types.js';

export interface RunnerToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface EvidenceStrategy<E> {
  agentName: 'devo' | 'caio';
  preflight?(toolName: string, args: Record<string, unknown>): ToolPreflightResult;
  buildErrorEvidence(toolName: string, error: string): E;
  buildScoutErrorEvidence(error: string): E;
  buildScoutSuccessEvidence(success: boolean, scoutResult: { summary: string; findings?: { confidence?: string } }, scoutObjective: string): E;
  buildToolEvidence(toolName: string, rawResult: { success: boolean; result?: unknown; error?: string; pendingApproval?: boolean }, duration: number): E;
  formatToolResult(evidence: E, deps: DelegationRunnerDeps, rawResult: { success: boolean; result?: unknown; error?: string }): string;
  formatToolErrorResult(evidence: E, errorMessage: string): string;
  formatScoutErrorResult(evidence: E, errMsg: string): string;
  formatScoutSuccessResult(evidence: E, scoutLoopResult: LoopDelegationResult): string;
  formatEventResult(evidence: E, rawResult: { success: boolean; result?: unknown; error?: string }): unknown;
  formatEventError(evidence: E, errorMessage: string): unknown;
  onToolComplete?(deps: DelegationRunnerDeps, toolName: string, success: boolean): void;
}

export const devoStrategy: EvidenceStrategy<ToolEvidence> = {
  agentName: 'devo',
  // No preflight for DEVO
  buildErrorEvidence(toolName, error) {
    return { tool: toolName, success: false, summary: error };
  },
  buildScoutErrorEvidence(error) {
    return { tool: 'delegateToScout', success: false, summary: error };
  },
  buildScoutSuccessEvidence(success, scoutResult, scoutObjective) {
    return {
      tool: 'delegateToScout',
      success,
      summary: success ? `SCOUT: ${(scoutObjective || '').slice(0, 80)}` : scoutResult.summary,
    };
  },
  buildToolEvidence(toolName, rawResult, duration) {
    const pendingApproval = rawResult.pendingApproval === true;
    return {
      tool: toolName,
      success: rawResult.success,
      pendingApproval: pendingApproval ? true : undefined,
      summary: pendingApproval
        ? 'Aktion wartet auf Freigabe.'
        : (rawResult.success
          ? `${toolName} OK (${duration}ms)`
          : (rawResult.error || `${toolName} failed`)),
    };
  },
  formatToolResult(_evidence, deps, rawResult) {
    const content = deps.buildToolResultContent(rawResult);
    return content.content;
  },
  formatToolErrorResult(_evidence, errorMessage) {
    return `Error: ${errorMessage}`;
  },
  formatScoutErrorResult(_evidence, errMsg) {
    return `Error: ${errMsg}`;
  },
  formatScoutSuccessResult(_evidence, scoutLoopResult) {
    return JSON.stringify({
      summary: scoutLoopResult.summary,
      findings: scoutLoopResult.findings,
    }, null, 2);
  },
  formatEventResult(_evidence, rawResult) {
    return rawResult.result;
  },
  formatEventError(_evidence, errorMessage) {
    return { error: errorMessage };
  },
  // No onToolComplete for DEVO
};

export const caioStrategy: EvidenceStrategy<CaioEvidence> = {
  agentName: 'caio',
  preflight: preflightCaioToolCall,
  buildErrorEvidence(toolName, error) {
    return buildCaioEvidence(toolName, { success: false, pendingApproval: false, error });
  },
  buildScoutErrorEvidence(error) {
    return buildCaioEvidence('delegateToScout', { success: false, pendingApproval: false, error });
  },
  buildScoutSuccessEvidence(success, scoutResult, _scoutObjective) {
    return success
      ? buildCaioEvidence('delegateToScout', {
        success: true,
        pendingApproval: false,
        data: { summary: scoutResult.summary, confidence: scoutResult.findings?.confidence },
      })
      : buildCaioEvidence('delegateToScout', {
        success: false,
        pendingApproval: false,
        error: scoutResult.summary,
      });
  },
  buildToolEvidence(toolName, rawResult) {
    const normalized = normalizeToolOutcome(rawResult);
    return buildCaioEvidence(toolName, normalized);
  },
  formatToolResult(evidence) {
    return JSON.stringify(evidence);
  },
  formatToolErrorResult(evidence) {
    return JSON.stringify(evidence);
  },
  formatScoutErrorResult(evidence) {
    return JSON.stringify(evidence);
  },
  formatScoutSuccessResult(evidence) {
    return JSON.stringify(evidence);
  },
  formatEventResult(evidence) {
    return evidence;
  },
  formatEventError(evidence) {
    return evidence;
  },
  onToolComplete(deps, toolName, success) {
    deps.markExternalActionToolSuccess(toolName, success);
  },
};

type DelegateToAgentFn = (
  deps: DelegationRunnerDeps,
  delegation: ParallelDelegation,
  fromAgent: DelegationSourceAgent,
) => Promise<LoopDelegationResult>;

export async function handleToolCall<E>(
  strategy: EvidenceStrategy<E>,
  deps: DelegationRunnerDeps,
  delegation: ParallelDelegation,
  evidenceLog: E[],
  turn: number,
  toolCall: RunnerToolCall,
  delegateToAgent: DelegateToAgentFn,
): Promise<SubAgentToolCallOutcome> {
  // 1. escalateToChapo — identical for both agents
  if (toolCall.name === 'escalateToChapo') {
    const desc = (toolCall.arguments.description as string) || 'Unknown issue';
    return {
      toolResult: {
        toolUseId: toolCall.id,
        result: `Eskalation wird von CHAPO verarbeitet: ${desc}`,
        isError: false,
      },
      escalated: desc,
    };
  }

  // 2. delegateToScout — shared structure, evidence via strategy
  if (toolCall.name === 'delegateToScout') {
    const scoutDelegation = buildScoutDelegationFromArgs(toolCall.arguments, delegation.objective);
    const [scoutLoopResult, scoutErr] = await deps.errorHandler.safe(
      `delegate:${strategy.agentName}:scout:${turn}`,
      () => delegateToAgent(deps, scoutDelegation, strategy.agentName),
    );
    if (scoutErr) {
      const errMsg = deps.errorHandler.formatForLLM(scoutErr);
      const evidence = strategy.buildScoutErrorEvidence(errMsg);
      evidenceLog.push(evidence);
      return {
        toolResult: {
          toolUseId: toolCall.id,
          result: strategy.formatScoutErrorResult(evidence, errMsg),
          isError: true,
        },
      };
    }

    const success = isDelegationSuccessful(scoutLoopResult.status);
    const evidence = strategy.buildScoutSuccessEvidence(success, scoutLoopResult, scoutDelegation.objective);
    evidenceLog.push(evidence);
    return {
      toolResult: {
        toolUseId: toolCall.id,
        result: strategy.formatScoutSuccessResult(evidence, scoutLoopResult),
        isError: !success,
      },
    };
  }

  // 3. Preflight (CAIO only, no-op for DEVO)
  if (strategy.preflight) {
    const preflight = strategy.preflight(toolCall.name, toolCall.arguments);
    if (!preflight.ok) {
      const evidence = strategy.buildErrorEvidence(toolCall.name, preflight.error || 'Preflight validation failed');
      evidenceLog.push(evidence);

      deps.sendEvent({
        type: 'tool_result',
        agent: strategy.agentName,
        toolName: toolCall.name,
        result: strategy.formatEventError(evidence, preflight.error || 'Preflight validation failed'),
        success: false,
      });
      return {
        toolResult: {
          toolUseId: toolCall.id,
          result: strategy.formatToolResult(evidence, deps, { success: false, error: preflight.error }),
          isError: true,
        },
      };
    }
  }

  // 4. Send tool_call event
  deps.sendEvent({
    type: 'tool_call',
    agent: strategy.agentName,
    toolName: toolCall.name,
    args: toolCall.arguments,
  });

  // 5. Execute tool
  const startTime = Date.now();
  const [result, toolErr] = await deps.errorHandler.safe(
    `${strategy.agentName}-tool:${toolCall.name}:${turn}`,
    () => executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
      agentName: strategy.agentName,
      onActionPending: (action) => {
        deps.sendEvent({
          type: 'action_pending',
          actionId: action.id,
          toolName: action.toolName,
          toolArgs: action.toolArgs,
          description: action.description,
          preview: action.preview,
        });
      },
    }),
  );
  const duration = Date.now() - startTime;

  // 6. Handle tool execution error
  if (toolErr) {
    const evidence = strategy.buildErrorEvidence(toolCall.name, toolErr.message);
    evidenceLog.push(evidence);

    deps.sendEvent({
      type: 'tool_result',
      agent: strategy.agentName,
      toolName: toolCall.name,
      result: strategy.formatEventError(evidence, toolErr.message),
      success: false,
    });
    return {
      toolResult: {
        toolUseId: toolCall.id,
        result: strategy.formatToolErrorResult(evidence, toolErr.message),
        isError: true,
      },
    };
  }

  // 7. Handle tool execution success
  const normalizedResult = result as { success: boolean; result?: unknown; error?: string; pendingApproval?: boolean };
  const evidence = strategy.buildToolEvidence(toolCall.name, normalizedResult, duration);
  evidenceLog.push(evidence);

  deps.sendEvent({
    type: 'tool_result',
    agent: strategy.agentName,
    toolName: toolCall.name,
    result: strategy.formatEventResult(evidence, normalizedResult),
    success: normalizedResult.success,
  });

  if (strategy.onToolComplete) {
    strategy.onToolComplete(deps, toolCall.name, normalizedResult.success);
  }

  const formattedResult = strategy.formatToolResult(evidence, deps, normalizedResult);
  return {
    toolResult: {
      toolUseId: toolCall.id,
      result: formattedResult,
      isError: !normalizedResult.success,
    },
  };
}
