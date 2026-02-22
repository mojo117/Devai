import { executeToolWithApprovalBridge } from '../../actions/approvalBridge.js';
import * as stateManager from '../stateManager.js';
import type { AgentErrorHandler } from '../error-handler.js';
import type { DecisionPathInsights } from '../answer-validator.js';
import type {
  AgentStreamEvent,
  ChapoLoopResult,
  LoopDelegationResult,
  RiskLevel,
} from '../types.js';
import {
  buildDelegation,
  parseParallelDelegations,
  type ParallelDelegation,
} from './delegationUtils.js';
import {
  buildDelegationDecisionPath,
  buildDelegationThinkingStatus,
  delegateParallel as runParallelDelegations,
  delegateToAgent as runDelegationToAgent,
  resolveDelegationTarget,
  type DelegationRunnerDeps,
} from './delegationRunner.js';

interface ToolCallLike {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResultPayload {
  toolUseId: string;
  result: string;
  isError: boolean;
}

export interface ToolCallOutcome {
  toolResult?: ToolResultPayload;
  earlyReturn?: ChapoLoopResult;
}

interface ToolExecutorDeps {
  sessionId: string;
  iteration: number;
  sendEvent: (event: AgentStreamEvent) => void;
  errorHandler: AgentErrorHandler;
  queueQuestion: (question: string, totalIterations: number) => Promise<ChapoLoopResult>;
  queueApproval: (
    description: string,
    riskLevel: RiskLevel,
    totalIterations: number,
  ) => Promise<ChapoLoopResult>;
  emitDecisionPath: (insights: DecisionPathInsights) => void;
  getDelegationRunnerDeps: () => DelegationRunnerDeps;
  buildVerificationEnvelope: (delegation: ParallelDelegation, result: LoopDelegationResult) => string;
  buildToolResultContent: (
    result: { success: boolean; result?: unknown; error?: string },
  ) => { content: string; isError: boolean };
  markExternalActionToolSuccess: (toolName: string, success: boolean) => void;
}

export class ChapoToolExecutor {
  constructor(private deps: ToolExecutorDeps) {}

  async execute(toolCall: ToolCallLike): Promise<ToolCallOutcome> {
    // ACTION: ASK — pause loop, wait for user
    if (toolCall.name === 'askUser') {
      const question = (toolCall.arguments.question as string) || 'Kannst du das genauer beschreiben?';
      const earlyReturn = await this.deps.queueQuestion(question, this.deps.iteration + 1);
      return { earlyReturn };
    }

    // ACTION: DELEGATE in parallel to multiple agents
    if (toolCall.name === 'delegateParallel') {
      const delegations = parseParallelDelegations(toolCall.arguments.delegations);
      if (delegations.length === 0) {
        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: 'Error: delegateParallel benoetigt mindestens eine gueltige Delegation.',
            isError: true,
          },
        };
      }

      this.deps.emitDecisionPath({
        path: 'tool',
        reason: `Unabhaengige Teilaufgaben werden parallel delegiert (${delegations.length}).`,
        confidence: 0.8,
        unresolvedAssumptions: [],
      });

      this.deps.sendEvent({
        type: 'agent_thinking',
        agent: 'chapo',
        status: `Delegiere parallel (${delegations.length} Aufgaben)...`,
      });

      const [parallelSummary, parallelErr] = await this.deps.errorHandler.safe(
        `delegate:parallel:${this.deps.iteration}`,
        () => runParallelDelegations(
          this.deps.getDelegationRunnerDeps(),
          delegations,
          this.deps.buildVerificationEnvelope,
        ),
      );

      if (parallelErr) {
        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: `Parallel-Delegation Fehler: ${this.deps.errorHandler.formatForLLM(parallelErr)}`,
            isError: true,
          },
        };
      }

      this.deps.sendEvent({
        type: 'tool_result',
        agent: 'chapo',
        toolName: toolCall.name,
        result: { delegated: true, parallel: delegations.length },
        success: true,
      });
      return {
        toolResult: {
          toolUseId: toolCall.id,
          result: parallelSummary,
          isError: false,
        },
      };
    }

    // ACTION: DELEGATE to DEVO/CAIO/SCOUT through one unified pipeline
    const delegationTarget = resolveDelegationTarget(toolCall.name);
    if (delegationTarget) {
      const delegation = buildDelegation(delegationTarget, toolCall.arguments);
      this.deps.emitDecisionPath(buildDelegationDecisionPath(delegation));

      this.deps.sendEvent({
        type: 'agent_thinking',
        agent: 'chapo',
        status: buildDelegationThinkingStatus(delegation),
      });

      const [delegationResult, delegationErr] = await this.deps.errorHandler.safe(
        `delegate:${delegation.target}:${this.deps.iteration}`,
        () => runDelegationToAgent(this.deps.getDelegationRunnerDeps(), delegation, 'chapo'),
      );

      if (delegationErr) {
        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: `${delegation.target.toUpperCase()} Fehler: ${this.deps.errorHandler.formatForLLM(delegationErr)}`,
            isError: true,
          },
        };
      }

      const envelope = this.deps.buildVerificationEnvelope(delegation, delegationResult);
      this.deps.sendEvent({
        type: 'tool_result',
        agent: 'chapo',
        toolName: toolCall.name,
        result: { delegated: true, agent: delegation.target, status: delegationResult.status },
        success: delegationResult.status === 'success' || delegationResult.status === 'partial',
      });
      return {
        toolResult: {
          toolUseId: toolCall.id,
          result: envelope,
          isError: delegationResult.status === 'failed',
        },
      };
    }

    // requestApproval — handle as user question
    if (toolCall.name === 'requestApproval') {
      const description = (toolCall.arguments.description as string) || 'Freigabe erforderlich';
      const riskLevel = ((toolCall.arguments.riskLevel as RiskLevel) || 'medium');
      const earlyReturn = await this.deps.queueApproval(description, riskLevel, this.deps.iteration + 1);
      return { earlyReturn };
    }

    // ACTION: TOOL — execute any regular tool
    this.deps.emitDecisionPath({
      path: 'tool',
      reason: `Direkter Tool-Aufruf (${toolCall.name}) fuer verifizierbare Zwischenergebnisse.`,
      confidence: 0.76,
      unresolvedAssumptions: [],
    });

    this.deps.sendEvent({
      type: 'tool_call',
      agent: 'chapo',
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const [toolResult, toolErr] = await this.deps.errorHandler.safe(
      `tool:${toolCall.name}:${this.deps.iteration}`,
      () => executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
        agentName: 'chapo',
        onActionPending: (action) => {
          this.deps.sendEvent({
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

    if (toolErr) {
      this.deps.sendEvent({
        type: 'tool_result',
        agent: 'chapo',
        toolName: toolCall.name,
        result: { error: toolErr.message },
        success: false,
      });
      return {
        toolResult: {
          toolUseId: toolCall.id,
          result: `Error: ${toolErr.message}`,
          isError: true,
        },
      };
    }

    const success = toolResult.success;
    const content = this.deps.buildToolResultContent(toolResult);

    this.deps.sendEvent({
      type: 'tool_result',
      agent: 'chapo',
      toolName: toolCall.name,
      result: toolResult.result,
      success,
    });
    this.deps.markExternalActionToolSuccess(toolCall.name, success);

    // Track gathered files
    if (toolCall.name === 'fs_readFile' && success) {
      const path = toolCall.arguments.path as string;
      stateManager.addGatheredFile(this.deps.sessionId, path);
    }

    return {
      toolResult: {
        toolUseId: toolCall.id,
        result: content.content,
        isError: content.isError,
      },
    };
  }
}
