import { getCombinedSystemContextBlock } from '../systemContext.js';
import { getAgent, getToolsForAgent, spawnScout } from '../router.js';
import { getToolsForLLM } from '../../tools/registry.js';
import type { AgentErrorHandler } from '../error-handler.js';
import type { SubAgentRunner } from '../sub-agent-runner.js';
import type {
  AgentStreamEvent,
  LoopDelegationResult,
  LoopDelegationStatus,
  ModelSelection,
  ScoutFindings,
  ToolEvidence,
} from '../types.js';
import type { LLMProvider } from '../../llm/types.js';
import {
  applyCaioEvidenceSummary,
  buildCaioEvidence,
  type CaioEvidence,
} from './caioEvidence.js';
import {
  formatConversationHistoryForScout,
  loadRecentConversationHistory,
} from '../router/requestUtils.js';
import { formatDelegationContext, isDelegationSuccessful, type ParallelDelegation } from './delegationUtils.js';
import { handleToolCall, devoStrategy, caioStrategy, type RunnerToolCall } from './toolCallHandler.js';

export type DelegationSourceAgent = 'chapo' | 'devo' | 'caio';

export interface DelegationDecisionPath {
  path: 'delegate_devo' | 'delegate_caio' | 'delegate_scout';
  reason: string;
  confidence: number;
  unresolvedAssumptions: string[];
}

export interface ParallelJobResult extends ParallelDelegation {
  success: boolean;
  result?: string;
  loopResult?: LoopDelegationResult;
  error?: string;
}

export interface ParallelDelegationSummary {
  summary: string;
  results: ParallelJobResult[];
}

export interface DelegationRunnerDeps {
  sessionId: string;
  projectRoot: string | null;
  modelSelection: ModelSelection;
  sendEvent: (event: AgentStreamEvent) => void;
  errorHandler: AgentErrorHandler;
  subAgentRunner: SubAgentRunner;
  markExternalActionToolSuccess: (toolName: string, success: boolean) => void;
  deriveDelegationStatus: (
    evidence: ToolEvidence[],
    escalated: boolean,
    hasContent: boolean,
  ) => LoopDelegationStatus;
  buildToolResultContent: (
    result: { success: boolean; result?: unknown; error?: string },
  ) => { content: string; isError: boolean };
}

function mapCaioEvidence(evidenceLog: CaioEvidence[]): ToolEvidence[] {
  return evidenceLog.map(({ error, timestamp, ...base }) => base);
}

async function delegateToSubAgent(
  deps: DelegationRunnerDeps,
  delegation: ParallelDelegation,
  fromAgent: DelegationSourceAgent,
): Promise<LoopDelegationResult> {
  const target = delegation.target;
  if (target !== 'devo' && target !== 'caio') {
    throw new Error(`Unsupported sub-agent delegation target: ${target}`);
  }

  const agentDefinition = getAgent(target);
  const provider = (deps.modelSelection.provider || 'anthropic') as LLMProvider;
  const toolNames = getToolsForAgent(target);
  const tools = getToolsForLLM().filter((t) => toolNames.includes(t.name));
  const systemContextBlock = getCombinedSystemContextBlock(deps.sessionId);
  const delegationContext = formatDelegationContext(delegation);

  deps.sendEvent({
    type: 'agent_switch',
    from: fromAgent,
    to: target,
    reason: `Delegiere (${delegation.domain}): ${delegation.objective.slice(0, 80)}`,
  });
  deps.sendEvent({
    type: 'delegation',
    from: fromAgent,
    to: target,
    task: delegation.objective,
    domain: delegation.domain,
    objective: delegation.objective,
    constraints: delegation.constraints,
    expectedOutcome: delegation.expectedOutcome,
  });

  const systemPrompt = `${agentDefinition.systemPrompt}
${systemContextBlock}
${deps.projectRoot ? `Working Directory: ${deps.projectRoot}` : ''}
${delegationContext ? `\nDELEGATIONSKONTEXT VON CHAPO:\n${delegationContext}` : ''}

AUFGABE: ${delegation.objective}

Fuehre die Aufgabe aus. Bei Problemen nutze escalateToChapo().`;

  const devoEvidence: ToolEvidence[] = [];
  const caioEvidenceLog: CaioEvidence[] = [];
  const runResult = await deps.subAgentRunner.run({
    sessionId: deps.sessionId,
    agent: target,
    provider,
    model: agentDefinition.model,
    objective: delegation.objective,
    systemPrompt,
    tools,
    errorHandler: deps.errorHandler,
    sendEvent: deps.sendEvent,
    handleToolCall: async ({ toolCall, turn }) => {
      if (target === 'devo') {
        return handleToolCall(devoStrategy, deps, delegation, devoEvidence, turn, toolCall as RunnerToolCall, delegateToAgent);
      }
      return handleToolCall(caioStrategy, deps, delegation, caioEvidenceLog, turn, toolCall as RunnerToolCall, delegateToAgent);
    },
  });

  if (target === 'devo' && runResult.exit === 'llm_error' && runResult.llmError) {
    devoEvidence.push({
      tool: 'devo_llm',
      success: false,
      summary: runResult.llmError,
    });
  }
  if (target === 'caio' && runResult.exit === 'llm_error' && runResult.llmError) {
    caioEvidenceLog.push(buildCaioEvidence('caio_llm', {
      success: false,
      pendingApproval: false,
      error: runResult.llmError,
    }));
  }

  const finalContent = target === 'caio'
    ? applyCaioEvidenceSummary(runResult.finalContent, caioEvidenceLog)
    : runResult.finalContent;
  const targetUpper = target.toUpperCase();

  deps.sendEvent({
    type: 'agent_switch',
    from: target,
    to: fromAgent,
    reason: runResult.exit === 'escalated'
      ? `${targetUpper} eskaliert an ${fromAgent.toUpperCase()}`
      : `${targetUpper} Delegation abgeschlossen`,
  });
  deps.sendEvent({
    type: 'agent_complete',
    agent: target,
    result: runResult.exit === 'escalated'
      ? `${targetUpper} eskaliert: ${runResult.escalationDescription || 'unknown issue'}`
      : finalContent,
  });

  const toolEvidence = target === 'caio'
    ? mapCaioEvidence(caioEvidenceLog)
    : devoEvidence;

  if (runResult.exit === 'escalated') {
    const desc = runResult.escalationDescription || 'Unknown issue';
    return {
      status: 'escalated',
      summary: `${targetUpper} eskaliert: ${desc}\n\nBisheriges Ergebnis:\n${finalContent}`,
      toolEvidence,
      escalation: desc,
    };
  }

  const baseStatus = deps.deriveDelegationStatus(toolEvidence, false, finalContent.length > 0);
  const status = runResult.exit === 'max_turns' && baseStatus === 'success' ? 'partial' : baseStatus;
  return {
    status,
    summary: finalContent || (runResult.llmError ? `${targetUpper} Sub-loop LLM Fehler: ${runResult.llmError}` : ''),
    toolEvidence,
  };
}

async function delegateToScout(
  deps: DelegationRunnerDeps,
  delegation: ParallelDelegation,
  fromAgent: DelegationSourceAgent,
): Promise<LoopDelegationResult> {
  deps.sendEvent({
    type: 'agent_switch',
    from: fromAgent,
    to: 'scout',
    reason: `Delegiere (${delegation.domain}): ${delegation.objective.slice(0, 80)}`,
  });
  deps.sendEvent({
    type: 'delegation',
    from: fromAgent,
    to: 'scout',
    task: delegation.objective,
    domain: delegation.domain,
    objective: delegation.objective,
    constraints: delegation.constraints,
    expectedOutcome: delegation.expectedOutcome,
  });

  try {
    const history = await loadRecentConversationHistory(deps.sessionId);
    const historyContext = formatConversationHistoryForScout(history);
    const scoutContext = [
      historyContext,
      formatDelegationContext(delegation),
    ].filter((part) => part && part.trim().length > 0).join('\n\n');

    const scoutResult = await spawnScout(deps.sessionId, delegation.objective, {
      scope: delegation.scope || 'both',
      context: scoutContext || undefined,
      sendEvent: deps.sendEvent,
    });
    const scoutFindings: ScoutFindings = {
      relevantFiles: scoutResult.relevantFiles || [],
      codePatterns: scoutResult.codePatterns || {},
      webFindings: scoutResult.webFindings || [],
      recommendations: scoutResult.recommendations || [],
      confidence: scoutResult.confidence || 'low',
    };
    const loopResult: LoopDelegationResult = {
      status: scoutFindings.confidence === 'low' ? 'partial' : 'success',
      summary: scoutResult.summary || JSON.stringify(scoutResult, null, 2),
      toolEvidence: [{
        tool: 'scout_research',
        success: true,
        summary: `SCOUT found ${scoutFindings.relevantFiles.length} files, ${scoutFindings.recommendations.length} recommendations (confidence: ${scoutFindings.confidence})`,
      }],
      findings: scoutFindings,
    };

    deps.sendEvent({
      type: 'agent_switch',
      from: 'scout',
      to: fromAgent,
      reason: 'SCOUT Delegation abgeschlossen',
    });
    deps.sendEvent({
      type: 'agent_complete',
      agent: 'scout',
      result: loopResult.summary,
    });
    return loopResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.sendEvent({
      type: 'agent_switch',
      from: 'scout',
      to: fromAgent,
      reason: 'SCOUT Delegation fehlgeschlagen',
    });
    deps.sendEvent({
      type: 'agent_complete',
      agent: 'scout',
      result: `SCOUT Fehler: ${message}`,
    });
    throw error;
  }
}

export function resolveDelegationTarget(toolName: string): ParallelDelegation['target'] | null {
  if (toolName === 'delegateToKoda' || toolName === 'delegateToDevo') return 'devo';
  if (toolName === 'delegateToCaio') return 'caio';
  if (toolName === 'delegateToScout') return 'scout';
  return null;
}

export function buildDelegationDecisionPath(delegation: ParallelDelegation): DelegationDecisionPath {
  if (delegation.target === 'devo') {
    return {
      path: 'delegate_devo',
      reason: `Aufgabe erfordert Entwicklungs-/DevOps-Ausfuehrung in Domaene "${delegation.domain}".`,
      confidence: 0.82,
      unresolvedAssumptions: delegation.constraints.slice(0, 2),
    };
  }
  if (delegation.target === 'caio') {
    return {
      path: 'delegate_caio',
      reason: `Aufgabe ist kommunikativ/administrativ und passt zu CAIO (${delegation.domain}).`,
      confidence: 0.82,
      unresolvedAssumptions: delegation.constraints.slice(0, 2),
    };
  }
  return {
    path: 'delegate_scout',
    reason: `Recherchemodus aktiviert (${delegation.scope || 'both'}) fuer zusaetzliche Evidenz.`,
    confidence: 0.78,
    unresolvedAssumptions: delegation.constraints.slice(0, 2),
  };
}

export function buildDelegationThinkingStatus(delegation: ParallelDelegation): string {
  if (delegation.target === 'scout') {
    return `Spawne SCOUT (${delegation.domain}) fuer: ${delegation.objective.slice(0, 60)}...`;
  }
  return `Delegiere an ${delegation.target.toUpperCase()} (${delegation.domain}): ${delegation.objective.slice(0, 60)}...`;
}

export async function delegateToAgent(
  deps: DelegationRunnerDeps,
  delegation: ParallelDelegation,
  fromAgent: DelegationSourceAgent,
): Promise<LoopDelegationResult> {
  if (delegation.target === 'scout') {
    return delegateToScout(deps, delegation, fromAgent);
  }
  return delegateToSubAgent(deps, delegation, fromAgent);
}

export async function delegateParallel(
  deps: DelegationRunnerDeps,
  delegations: ParallelDelegation[],
  buildVerificationEnvelope: (delegation: ParallelDelegation, result: LoopDelegationResult) => string,
): Promise<ParallelDelegationSummary> {
  const jobs = delegations.map(async (delegation): Promise<ParallelJobResult> => {
    try {
      const loopResult = await delegateToAgent(deps, delegation, 'chapo');
      return {
        ...delegation,
        success: isDelegationSuccessful(loopResult.status),
        result: loopResult.summary,
        loopResult,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...delegation, success: false, error: message };
    }
  });

  const settled = await Promise.allSettled(jobs);
  const results: ParallelJobResult[] = settled.map((entry, index) => {
    if (entry.status === 'fulfilled') return entry.value;
    return {
      ...delegations[index],
      success: false,
      error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
    };
  });

  const okCount = results.filter((r) => r.success).length;
  const failCount = results.length - okCount;
  const lines: string[] = [
    `Parallel delegation completed: ${okCount}/${results.length} successful.`,
  ];

  if (okCount > 0) {
    lines.push('Successful delegations:');
    for (const result of results.filter((r) => r.success)) {
      const content = result.loopResult
        ? buildVerificationEnvelope(result, result.loopResult)
        : ((result.result || '').toString());
      const preview = content.length > 1200 ? `${content.slice(0, 1200)}\n...[truncated]` : content;
      lines.push(`- [${result.target}/${result.domain}] ${result.objective}`);
      lines.push(preview || '(no content)');
    }
  }

  if (failCount > 0) {
    lines.push('Failed delegations:');
    for (const result of results.filter((r) => !r.success)) {
      lines.push(`- [${result.target}/${result.domain}] ${result.objective}: ${result.error || 'unknown error'}`);
    }
  }

  return {
    summary: lines.join('\n'),
    results,
  };
}
