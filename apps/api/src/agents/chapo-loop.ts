/**
 * ChapoLoop — CHAPO Decision Loop
 *
 * A continuous loop where the LLM's tool_calls ARE the decisions:
 *   - No tool_calls = ANSWER → normalize → respond → exit
 *   - askUser = ASK → pause loop → wait for user reply
 *   - delegateToDevo = DELEGATE → run DEVO sub-loop → feed result back
 *   - delegateToCaio = DELEGATE → run CAIO sub-loop → feed result back
 *   - delegateParallel = DELEGATE → run multiple delegations concurrently
 *   - delegateToScout = DELEGATE → run SCOUT → feed result back
 *   - any other tool = TOOL → execute → feed result back → continue
 *
 * Errors at any point feed back into the loop as context.
 */

import { AgentErrorHandler } from './error-handler.js';
import { AnswerValidator, type DecisionPathInsights } from './answer-validator.js';
import { ConversationManager } from './conversation-manager.js';
import { llmRouter } from '../llm/router.js';
import { getCombinedSystemContextBlock, warmSystemContextForSession, warmMemoryRetrievalForSession } from './systemContext.js';
import { SessionLogger } from '../audit/sessionLogger.js';
import { getAgent, getToolsForAgent } from './router.js';
import { getToolsForLLM } from '../tools/registry.js';
import * as stateManager from './stateManager.js';
import { SubAgentRunner } from './sub-agent-runner.js';
import { type ParallelDelegation } from './chapo-loop/delegationUtils.js';
import { type DelegationRunnerDeps } from './chapo-loop/delegationRunner.js';
import { ChapoLoopContextManager } from './chapo-loop/contextManager.js';
import { ChapoLoopGateManager } from './chapo-loop/gateManager.js';
import { ChapoToolExecutor } from './chapo-loop/toolExecutor.js';
import { buildToolResultContent } from './utils.js';
import { config as appConfig } from '../config.js';
import { logSchedulerExecution } from '../db/schedulerQueries.js';
import type {
  AgentStreamEvent,
  ModelSelection,
  ChapoLoopResult,
  LoopDelegationResult,
  LoopDelegationStatus,
  ToolEvidence,
  RiskLevel,
} from './types.js';
import type { LLMProvider, ContentBlock } from '../llm/types.js';
import { getTextContent } from '../llm/types.js';
import { tagCurrentWork } from '../memory/topicTagger.js';
import type { QueueQuestionOptions } from './chapo-loop/gateManager.js';

export type SendEventFn = (event: AgentStreamEvent) => void;

interface ChapoLoopConfig {
  maxIterations: number;
}

export class ChapoLoop {
  private errorHandler: AgentErrorHandler;
  private answerValidator: AnswerValidator;
  private conversation: ConversationManager;
  private sessionLogger?: SessionLogger;
  private subAgentRunner = new SubAgentRunner();
  private iteration = 0;
  private totalTokensUsed = 0;
  private contextManager: ChapoLoopContextManager;
  private gateManager: ChapoLoopGateManager;
  private traceId = '';

  // Execution metrics for structured logging (3.2)
  private toolCallLog: Array<{ name: string; durationMs: number; success: boolean }> = [];
  private delegationLog: Array<{ target: string; durationMs: number; status: string }> = [];

  constructor(
    private sessionId: string,
    private sendEvent: SendEventFn,
    private projectRoot: string | null,
    private modelSelection: ModelSelection,
    private config: ChapoLoopConfig,
    traceId?: string,
  ) {
    this.errorHandler = new AgentErrorHandler(3);
    this.conversation = new ConversationManager(180_000);
    this.sessionLogger = SessionLogger.getActive(sessionId);
    this.answerValidator = new AnswerValidator(this.sessionLogger);
    this.contextManager = new ChapoLoopContextManager(this.sessionId, this.sendEvent, this.conversation);
    this.gateManager = new ChapoLoopGateManager(this.sessionId, this.sendEvent);
    this.traceId = traceId || '';
  }

  dispose(): void {
    this.contextManager.dispose();
  }

  private deriveDelegationStatus(
    evidence: ToolEvidence[],
    escalated: boolean,
    hasContent: boolean,
  ): LoopDelegationStatus {
    if (escalated) return 'escalated';
    if (evidence.length === 0 && !hasContent) return 'failed';

    const failures = evidence.filter((e) => !e.success && !e.pendingApproval);
    const successes = evidence.filter((e) => e.success);
    const pending = evidence.filter((e) => e.pendingApproval);

    if (failures.length === 0 && successes.length > 0) return 'success';
    if (successes.length > 0 && failures.length > 0) return 'partial';
    if (failures.length > 0 && successes.length === 0) return 'failed';
    if (pending.length > 0 && successes.length === 0 && failures.length === 0) return 'partial';
    return 'success';
  }

  private buildVerificationEnvelope(
    delegation: ParallelDelegation,
    result: LoopDelegationResult,
  ): string {
    const lines: string[] = [
      `[DELEGATION RESULT — ${delegation.target.toUpperCase()}]`,
      `Objective: ${delegation.objective}`,
    ];

    if (delegation.expectedOutcome) {
      lines.push(`Expected Outcome: ${delegation.expectedOutcome}`);
    }

    lines.push('');
    lines.push(`Status: ${result.status.toUpperCase()}`);

    if (result.toolEvidence.length > 0) {
      lines.push('Evidence:');
      for (const ev of result.toolEvidence.slice(-12)) {
        const icon = ev.success ? 'OK' : (ev.pendingApproval ? 'PENDING' : 'ERROR');
        const extra = ev.externalId ? ` id=${ev.externalId}` : '';
        lines.push(`  - [${icon}] ${ev.tool}${extra}: ${ev.summary}`);
      }
    }

    if (result.escalation) {
      lines.push(`\nEscalation: ${result.escalation}`);
    }

    if (result.findings) {
      if (result.findings.recommendations.length > 0) {
        lines.push(`\nRecommendations: ${result.findings.recommendations.join('; ')}`);
      }
    }

    lines.push(`\nAgent Response:\n${result.summary}`);
    return lines.join('\n');
  }

  private emitDecisionPath(insights: DecisionPathInsights): void {
    this.sendEvent({
      type: 'tool_result',
      agent: 'chapo',
      toolName: 'decision_path',
      result: insights,
      success: true,
    });
  }

  private getActiveTurnId(): string | null {
    return stateManager.getActiveTurnId(this.sessionId);
  }

  async run(userMessage: string | ContentBlock[], conversationHistory: Array<{ role: string; content: string }>): Promise<ChapoLoopResult> {
    const runStartTime = Date.now();
    const userText = getTextContent(userMessage);
    stateManager.ensureActiveTurnId(this.sessionId);
    this.contextManager.setPinnedRequest(userText);

    // 1. Warm system context + query-relevant memories
    await warmSystemContextForSession(this.sessionId, this.projectRoot);
    await warmMemoryRetrievalForSession(this.sessionId, userText);
    const systemContextBlock = getCombinedSystemContextBlock(this.sessionId);

    // 2. Set system prompt on conversation manager
    const chapo = getAgent('chapo');
    const systemPrompt = `${chapo.systemPrompt}
${systemContextBlock}
${this.projectRoot ? `Working Directory: ${this.projectRoot}` : ''}

You are Chapo in the decision loop. Execute tasks DIRECTLY:
- Delegate development tasks (domain "development") to DEVO
- Delegate communication/admin tasks (domain "communication") to CAIO
- Delegate research tasks (domain "research") to SCOUT
- When delegating: provide domain + objective + optional constraints/context/expectedOutcome
- Never mention specific tool names in delegations; the target agent picks their own tools
- Use direct read-only tools only for context gathering or quick fact checks
- Use delegateParallel only for independent sub-tasks
- Use askUser ONLY when you genuinely need clarification
- When you have the answer, respond directly WITHOUT tool calls`;

    this.conversation.setSystemPrompt(systemPrompt);

    // 3. Load conversation history
    for (const msg of conversationHistory) {
      if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
        this.conversation.addMessage({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        });
      }
    }

    // 4. Add user message
    this.conversation.addMessage({ role: 'user', content: userMessage });

    // 5. Emit start event — StateProjection handles setPhase + setActiveAgent
    this.sendEvent({ type: 'agent_start', agent: 'chapo', phase: 'execution' });

    // 6. Enter runLoop with inbox lifecycle
    stateManager.setLoopRunning(this.sessionId, true);
    let result: ChapoLoopResult;
    try {
      result = await this.runLoop(userMessage);
    } finally {
      stateManager.setLoopRunning(this.sessionId, false);
      this.dispose();
    }

    // 7. Store token usage on session state (for heartbeat / telemetry)
    if (this.totalTokensUsed > 0) {
      stateManager.setGatheredInfo(this.sessionId, 'lastRunTokens', this.totalTokensUsed);
    }

    // 7b. Structured execution log (3.2)
    const runDurationMs = Date.now() - runStartTime;
    logSchedulerExecution({
      jobId: `chapo-loop:${this.sessionId}`,
      jobName: 'chapo-loop',
      executionType: 'internal',
      phase: result.status === 'error' ? 'failure' : 'success',
      message: `Loop completed: ${result.totalIterations || this.iteration} iterations, ${this.totalTokensUsed} tokens, ${runDurationMs}ms`,
      metadata: {
        traceId: this.traceId || undefined,
        iterations: result.totalIterations || this.iteration,
        totalTokens: this.totalTokensUsed,
        durationMs: runDurationMs,
        exitReason: result.status,
        provider: `${this.modelSelection.provider || 'anthropic'}/${this.modelSelection.model}`,
        toolCalls: this.toolCallLog.length,
        delegations: this.delegationLog.length,
      },
    }).catch((logErr) => console.error('[chapo-loop] execution log failed:', logErr));

    // 8. Emit completion
    this.sendEvent({ type: 'agent_complete', agent: 'chapo', result: result.answer });
    this.sendEvent({
      type: 'agent_history',
      entries: stateManager.getHistory(this.sessionId),
    });

    return result;
  }

  private async runLoop(userMessage: string | ContentBlock[]): Promise<ChapoLoopResult> {
    const chapo = getAgent('chapo');
    const chapoToolNames = getToolsForAgent('chapo');
    const tools = getToolsForLLM().filter((t) => chapoToolNames.includes(t.name));

    const provider = (this.modelSelection.provider || 'anthropic') as LLMProvider;
    const model = this.modelSelection.model || chapo.model;
    const sameProviderFallbacks = this.modelSelection.sameProviderFallbacks;
    const trace = this.traceId ? `[trace:${this.traceId}] ` : '';

    // --- Resilience state ---
    const loopStartTime = Date.now();
    let lastProgressAt = Date.now();
    let costCapInjected = false;
    let consecutiveNoProgress = 0;
    let lastErrorMessage = '';
    const PROGRESS_THRESHOLD = 3;

    console.log(`${trace}[chapo-loop] Tools: ${tools.length}`);

    for (this.iteration = 0; this.iteration < this.config.maxIterations; this.iteration++) {
      const elapsed = Date.now() - loopStartTime;

      // --- Stall Timeout: only fires when no progress for hardTimeoutMs ---
      const timeSinceProgress = Date.now() - lastProgressAt;
      if (timeSinceProgress > appConfig.loopHardTimeoutMs) {
        console.warn(`${trace}[chapo-loop] Stall timeout: ${Math.round(timeSinceProgress / 1000)}s without progress, iteration ${this.iteration}`);
        stateManager.setGatheredInfo(this.sessionId, 'timeoutSnapshot', {
          iteration: this.iteration,
          elapsed,
          tokensUsed: this.totalTokensUsed,
          timestamp: new Date().toISOString(),
        });
        await stateManager.flushState(this.sessionId);

        return this.queueQuestion(
          `Seit ${Math.round(timeSinceProgress / 1000)}s kein Fortschritt. ` +
          `Bisheriger Stand: ${this.iteration} Iterationen, ${Math.round(elapsed / 1000)}s Laufzeit. Soll ich weitermachen?`,
          this.iteration,
          { kind: 'continue', turnId: this.getActiveTurnId() || undefined },
        );
      }

      this.sendEvent({
        type: 'agent_thinking',
        agent: 'chapo',
        status: this.iteration === 0 ? 'Analyzing request...' : `Iteration ${this.iteration + 1}...`,
      });

      // Check if compaction needed before LLM call
      await this.contextManager.checkAndCompact();

      // Call LLM with conversation + tools
      const t0 = Date.now();
      console.log(`${trace}[chapo-loop] LLM call #${this.iteration} starting (${provider}/${model}, ${tools.length} tools)`);
      const [response, err] = await this.errorHandler.safe('llm_call', () =>
        llmRouter.generateWithFallback(provider, {
          model,
          messages: this.conversation.buildLLMMessages(),
          systemPrompt: this.conversation.getSystemPrompt(),
          tools,
          toolsEnabled: true,
          sameProviderFallbacks,
        })
      );

      const llmDuration = Date.now() - t0;
      console.log(`${trace}[chapo-loop] LLM call #${this.iteration} completed in ${llmDuration}ms, err=${err?.message || 'none'}, content=${response?.content?.slice(0, 100) || 'null'}, toolCalls=${response?.toolCalls?.length || 0}`);

      // LLM responded — reset progress tracker
      if (response) lastProgressAt = Date.now();

      // Accumulate token usage
      if (response?.usage) {
        this.totalTokensUsed += response.usage.inputTokens + response.usage.outputTokens;
      }

      // --- 2.5 Cost Safety Cap ---
      if (!costCapInjected && this.totalTokensUsed > appConfig.costCapPerRunTokens) {
        costCapInjected = true;
        this.conversation.addMessage({
          role: 'system',
          content: `[COST WARNING] Token budget exhausted (${this.totalTokensUsed} tokens used, limit: ${appConfig.costCapPerRunTokens}). Deliver final answer NOW.`,
        });
        console.warn(`${trace}[chapo-loop] Cost cap reached: ${this.totalTokensUsed} tokens`);
      }

      if (err) {
        // --- 2.2 Error Deduplication ---
        const errorText = this.errorHandler.formatForLLM(err);
        if (errorText !== lastErrorMessage) {
          this.conversation.addMessage({
            role: 'system',
            content: `[LLM Error] ${errorText}`,
          });
          lastErrorMessage = errorText;
        } else {
          this.conversation.addMessage({
            role: 'system',
            content: `[LLM Error] Same error repeated (${errorText.slice(0, 80)}...). Trying different approach.`,
          });
        }
        this.sendEvent({ type: 'error', agent: 'chapo', error: err.message });

        if (!this.errorHandler.canRetry('llm_call')) {
          return {
            answer: `Error during processing: ${err.message}`,
            status: 'error',
            totalIterations: this.iteration + 1,
          };
        }
        consecutiveNoProgress++;
        continue;
      }

      // No tool calls → ACTION: ANSWER (direct — loop ends)
      if (!response.toolCalls || response.toolCalls.length === 0) {
        const answer = response.content || '';
        const userText = getTextContent(userMessage);
        return this.answerValidator.validateAndNormalize(userText, answer, this.iteration, this.emitDecisionPath.bind(this));
      }

      // Add assistant message with tool calls to conversation
      this.conversation.addMessage({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      });

      const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];
      let earlyReturn: ChapoLoopResult | null = null;
      const toolExecutor = new ChapoToolExecutor({
        sessionId: this.sessionId,
        iteration: this.iteration,
        sendEvent: this.sendEvent,
        errorHandler: this.errorHandler,
        queueQuestion: this.queueQuestion.bind(this),
        queueApproval: this.queueApproval.bind(this),
        emitDecisionPath: this.emitDecisionPath.bind(this),
        getDelegationRunnerDeps: this.getDelegationRunnerDeps.bind(this),
        buildVerificationEnvelope: this.buildVerificationEnvelope.bind(this),
        buildToolResultContent,
      });

      for (const toolCall of response.toolCalls) {
        // --- 1.5 Iteration Try-Catch: wrap each tool execution ---
        const toolT0 = Date.now();
        try {
          const outcome = await toolExecutor.execute({
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          });
          const toolDuration = Date.now() - toolT0;
          if (outcome.earlyReturn) {
            earlyReturn = outcome.earlyReturn;
            // Log delegation metrics if this was a delegation
            if (toolCall.name.startsWith('delegate')) {
              this.delegationLog.push({
                target: toolCall.name.replace('delegateTo', '').replace('delegateParallel', 'parallel'),
                durationMs: toolDuration,
                status: earlyReturn.status,
              });
            }
            break;
          }
          if (outcome.toolResult) {
            toolResults.push(outcome.toolResult);
            this.toolCallLog.push({ name: toolCall.name, durationMs: toolDuration, success: !outcome.toolResult.isError });
            // Structured reflection: inject thinking after tool failures
            if (outcome.toolResult.isError) {
              this.conversation.addThinking(
                `Tool "${toolCall.name}" failed: ${outcome.toolResult.result}. ` +
                `Before retrying or trying a different approach, consider: ` +
                `Why did this fail? Is there a different approach? Should I inform the user?`
              );
            }
          }
        } catch (toolError) {
          const msg = toolError instanceof Error ? toolError.message : String(toolError);
          console.error(`${trace}[chapo-loop] Uncaught tool error (${toolCall.name}):`, msg);
          toolResults.push({
            toolUseId: toolCall.id,
            result: `[INTERNAL ERROR] Tool "${toolCall.name}" crashed: ${msg}. This is a system error, not a tool error.`,
            isError: true,
          });
          this.toolCallLog.push({ name: toolCall.name, durationMs: Date.now() - toolT0, success: false });
        }
      }

      // If we got an early return (ASK or approval), exit the loop
      if (earlyReturn) {
        return earlyReturn;
      }

      // --- 2.1 Deadlock Detection ---
      const hadMeaningfulAction = toolResults.some((r) => !r.isError);
      if (hadMeaningfulAction) {
        consecutiveNoProgress = 0;
        lastProgressAt = Date.now();
      } else {
        consecutiveNoProgress++;
      }
      if (consecutiveNoProgress >= PROGRESS_THRESHOLD) {
        this.conversation.addMessage({
          role: 'system',
          content: `[PROGRESS WARNING] ${consecutiveNoProgress} consecutive iterations without successful tool execution. ` +
            `Either: (1) deliver a partial answer, (2) try a different approach, or (3) ask the user for help. ` +
            `Do NOT repeat the same failing approach.`,
        });
        consecutiveNoProgress = 0;
      }

      // Feed tool results back to LLM for the next iteration
      this.conversation.addMessage({
        role: 'user',
        content: '',
        toolResults,
      });

      // --- 2.3 Checkpoint after significant operations ---
      if (toolResults.length > 0) {
        stateManager.setGatheredInfo(this.sessionId, 'loopCheckpoint', {
          iteration: this.iteration,
          tokensUsed: this.totalTokensUsed,
          timestamp: new Date().toISOString(),
        });
        // Debounced flush is sufficient for checkpoints (not crash-critical like gates)
      }

      // Fire-and-forget: tag current work topic for recent focus
      if (response.toolCalls && response.toolCalls.length > 0) {
        const toolNames = response.toolCalls.map((tc) => tc.name);
        const filePaths = this.extractFilePathsFromToolCalls(response.toolCalls);
        tagCurrentWork(this.sessionId, {
          userMessage: getTextContent(userMessage).slice(0, 300),
          toolCalls: toolNames,
          assistantResponse: (response.content || '').slice(0, 300),
          filePaths,
        }).catch((tagErr) => console.error(`${trace}[chapo-loop] topic tagging failed:`, tagErr));
      }
    }

    // Loop exhaustion — ask user if they want to continue
    return this.queueQuestion(
      'This request needed more steps than allowed. Should I continue?',
      this.iteration,
      {
        kind: 'continue',
        turnId: this.getActiveTurnId() || undefined,
        fingerprint: `limit:plain:${this.getActiveTurnId() || 'none'}`,
      },
    );
  }

  private extractFilePathsFromToolCalls(toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>): string[] {
    const paths: string[] = [];
    for (const tc of toolCalls) {
      const args = tc.arguments;
      if (typeof args.path === 'string') paths.push(args.path);
      if (typeof args.file_path === 'string') paths.push(args.file_path);
      if (typeof args.filePath === 'string') paths.push(args.filePath);
      if (typeof args.target === 'string' && args.target.includes('/')) paths.push(args.target);
    }
    return [...new Set(paths)];
  }

  private queueQuestion(
    question: string,
    totalIterations: number,
    options?: QueueQuestionOptions,
  ): Promise<ChapoLoopResult> {
    return this.gateManager.queueQuestion(question, totalIterations, options);
  }

  private queueApproval(
    description: string,
    riskLevel: RiskLevel,
    totalIterations: number,
  ): Promise<ChapoLoopResult> {
    return this.gateManager.queueApproval(description, riskLevel, totalIterations);
  }

  private getDelegationRunnerDeps(): DelegationRunnerDeps {
    return {
      sessionId: this.sessionId,
      projectRoot: this.projectRoot,
      modelSelection: this.modelSelection,
      sendEvent: this.sendEvent,
      errorHandler: this.errorHandler,
      subAgentRunner: this.subAgentRunner,
      deriveDelegationStatus: this.deriveDelegationStatus.bind(this),
      buildToolResultContent,
    };
  }
}
