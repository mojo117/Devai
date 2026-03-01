/**
 * ChapoLoop — CHAPO Decision Loop
 *
 * A continuous loop where the LLM's tool_calls ARE the decisions:
 *   - No tool_calls = ANSWER → normalize → respond → exit
 *   - askUser = ASK → pause loop → wait for user reply
 *   - any other tool = TOOL → execute → feed result back → continue
 *
 * Errors at any point feed back into the loop as context.
 */

import { AgentErrorHandler } from './error-handler.js';
import { ConversationManager } from './conversation-manager.js';
import { llmRouter } from '../llm/router.js';
import { getCombinedSystemContextBlock, warmSystemContextForSession, warmMemoryRetrievalForSession } from './systemContext.js';
import { SessionLogger } from '../audit/sessionLogger.js';
import { getAgent, getToolsForAgent } from './router.js';
import { getToolsForLLM } from '../tools/registry.js';
import * as stateManager from './stateManager.js';
import { ChapoLoopContextManager } from './chapo-loop/contextManager.js';
import { ChapoLoopGateManager } from './chapo-loop/gateManager.js';
import { ChapoToolExecutor } from './chapo-loop/toolExecutor.js';
import { buildToolResultContent } from './utils.js';
import { logSchedulerExecution } from '../db/schedulerQueries.js';
import { logAgentExecution } from '../db/agentExecutionQueries.js';
import type {
  AgentStreamEvent,
  ModelSelection,
  ChapoLoopResult,
  RiskLevel,
} from './types.js';
import type { LLMProvider, ContentBlock } from '../llm/types.js';
import { getTextContent } from '../llm/types.js';
import { tagCurrentWork } from '../memory/topicTagger.js'
import { extractTurnEpisode, extractToolEpisode } from '../memory/episodicExtraction.js'
import type { QueueQuestionOptions } from './chapo-loop/gateManager.js';

interface DecisionPathInsights {
  path: 'answer' | 'tool';
  reason: string;
  confidence: number;
  unresolvedAssumptions: string[];
}

export type SendEventFn = (event: AgentStreamEvent) => void;

interface ChapoLoopConfig {
  maxIterations: number;
}

/**
 * Heuristic: enable extended thinking for complex first-turn queries.
 * Thinking mode adds latency but improves reasoning on complex tasks.
 * Only fires on the first iteration (planning phase).
 */
function shouldEnableThinking(userMessage: string, iteration: number): boolean {
  if (iteration > 0) return false;

  const complexPattern = /\b(debug|fix|refactor|plan|architect|design|why|how|analy[sz]|investigat|review|explain|compar|evaluat|warum|wieso|erkl[aä]r|vergleich|untersu|fehler|problem|research|search|find|implement|create|build|write|develop)\b/i;
  if (complexPattern.test(userMessage)) return true;

  const multiStepPattern = /\b(and|then|after|before|also|plus|additionally|und|dann|danach|außerdem|anschließend)\b.*\b(create|implement|fix|update|add|remove|change|write|build)\b/i;
  if (multiStepPattern.test(userMessage)) return true;

  if (userMessage.length > 300) return true;

  return false;
}

// Module-level map for /stop to reach running loop instances
const activeLoopInstances = new Map<string, Map<string, ChapoLoop>>();

/** Abort all running ChapoLoop instances for a session (called by /stop). */
export function abortLoopInstances(sessionId: string): void {
  const instances = activeLoopInstances.get(sessionId);
  if (!instances) return;
  for (const loop of instances.values()) {
    loop.abort();
  }
}

export class ChapoLoop {
  private errorHandler: AgentErrorHandler;
  private conversation: ConversationManager;
  private sessionLogger?: SessionLogger;
  private iteration = 0;
  private totalTokensUsed = 0;
  private lastContent = '';
  private contextManager: ChapoLoopContextManager;
  private gateManager: ChapoLoopGateManager;
  private traceId = '';

  private toolCallLog: Array<{ name: string; durationMs: number; success: boolean }> = [];

  private parallelTurnId: string | undefined;
  private abortController = new AbortController();

  constructor(
    private sessionId: string,
    private sendEvent: SendEventFn,
    private projectRoot: string | null,
    private modelSelection: ModelSelection,
    private config: ChapoLoopConfig,
    traceId?: string,
    parallelTurnId?: string,
  ) {
    this.errorHandler = new AgentErrorHandler(3);
    this.conversation = new ConversationManager(80_000);
    this.sessionLogger = SessionLogger.getActive(sessionId);
    this.contextManager = new ChapoLoopContextManager(this.sessionId, this.sendEvent, this.conversation);
    this.gateManager = new ChapoLoopGateManager(this.sessionId, this.sendEvent);
    this.traceId = traceId || '';
    this.parallelTurnId = parallelTurnId;
  }

  /** Signal this loop to abort (used by /stop). */
  abort(): void {
    this.abortController.abort();
  }

  dispose(): void {
    this.contextManager.dispose();
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

    // Register in parallel loop buffer if this is a parallel loop
    if (this.parallelTurnId) {
      const words = userText.split(/\s+/).slice(0, 8).join(' ');
      const taskLabel = words.length < userText.length ? words + '...' : words;
      await stateManager.registerParallelLoop(this.sessionId, this.parallelTurnId, taskLabel, userText.slice(0, 500));
      // Track instance for /stop
      let sessionInstances = activeLoopInstances.get(this.sessionId);
      if (!sessionInstances) {
        sessionInstances = new Map();
        activeLoopInstances.set(this.sessionId, sessionInstances);
      }
      sessionInstances.set(this.parallelTurnId, this);
    }

    // 1. Warm system context + query-relevant memories
    await warmSystemContextForSession(this.sessionId, this.projectRoot);
    await warmMemoryRetrievalForSession(this.sessionId, userText);
    const systemContextBlock = getCombinedSystemContextBlock(this.sessionId);

    // 2. Set system prompt on conversation manager
    const chapo = getAgent('chapo');
    const systemPrompt = `${chapo.systemPrompt}
${systemContextBlock}
${this.projectRoot ? `Working Directory: ${this.projectRoot}` : ''}

You are Chapo in the decision loop. Execute ALL tasks directly using available tools.
- Do NOT describe what you would do — use your tools to actually do it.
- Use askUser ONLY when you genuinely need clarification from the user.
- Only respond without tool calls when your work is fully complete.`;

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
    if (!this.parallelTurnId) {
      // Serial mode: use global loop flag
      await stateManager.setLoopRunning(this.sessionId, true);
    }
    let result: ChapoLoopResult;
    try {
      result = await this.runLoop(userMessage);
    } finally {
      if (this.parallelTurnId) {
        // Parallel mode: update loop status and unregister
        const answer = result!?.answer || '';
        await stateManager.updateLoopStatus(this.sessionId, this.parallelTurnId, 'completed', answer.slice(0, 500));
        await stateManager.unregisterParallelLoop(this.sessionId, this.parallelTurnId);
        // Remove from instance map
        const sessionInstances = activeLoopInstances.get(this.sessionId);
        if (sessionInstances) {
          sessionInstances.delete(this.parallelTurnId);
          if (sessionInstances.size === 0) activeLoopInstances.delete(this.sessionId);
        }
      } else {
        await stateManager.setLoopRunning(this.sessionId, false);
      }
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
      },
    }).catch((logErr) => console.error('[chapo-loop] execution log failed:', logErr));

    logAgentExecution({
      sessionId: this.sessionId,
      agent: 'chapo',
      phase: result.status === 'error' ? 'failure' : 'success',
      durationMs: runDurationMs,
      iterations: result.totalIterations || this.iteration,
      tokensUsed: this.totalTokensUsed,
      toolCount: this.toolCallLog.length,
      model: this.modelSelection.model,
      provider: this.modelSelection.provider,
      errorMessage: result.status === 'error' ? result.answer : undefined,
      metadata: {
        traceId: this.traceId || undefined,
      },
    }).catch((logErr) => console.error('[chapo-loop] agent execution log failed:', logErr));

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
    const allTools = getToolsForLLM().filter((t) => chapoToolNames.includes(t.name));
    const userText = getTextContent(userMessage);

    const provider = (this.modelSelection.provider || 'anthropic') as LLMProvider;
    const model = this.modelSelection.model || chapo.model;
    const sameProviderFallbacks = this.modelSelection.sameProviderFallbacks;
    const trace = this.traceId ? `[trace:${this.traceId}] ` : '';

    let lastErrorMessage = '';

    console.log(`${trace}[chapo-loop] Tools (unfiltered): ${allTools.length}`);

    for (this.iteration = 0; this.iteration < this.config.maxIterations; this.iteration++) {
      if (this.abortController.signal.aborted) {
        if (this.parallelTurnId) {
          stateManager.updateLoopStatus(this.sessionId, this.parallelTurnId, 'aborted');
        }
        return { answer: 'Loop abgebrochen.', status: 'aborted' as const, totalIterations: this.iteration };
      }

      this.sendEvent({
        type: 'agent_thinking',
        agent: 'chapo',
        status: this.iteration === 0 ? 'Analyzing request...' : `Iteration ${this.iteration + 1}...`,
      });

      // Check if compaction needed before LLM call
      await this.contextManager.checkAndCompact();

      // Inject parallel context from other running loops
      if (this.parallelTurnId) {
        const parallelMsg = this.contextManager.buildParallelContextMessage(this.parallelTurnId);
        if (parallelMsg) {
          this.conversation.addMessage({ role: 'system', content: parallelMsg });
        }
      }

      const tools = allTools;

      const thinkingEnabled = shouldEnableThinking(userText, this.iteration);

      const isResearchQuery = /\b(search|research|find|look\s*up|documentation|latest|aktuell|suche|recherche|finde|investigate|explore)\b/i.test(userText);
      const kimiSearchEnabled = provider === 'moonshot' && isResearchQuery;
      const webSearchEnabled = provider === 'zai' && isResearchQuery;

      const t0 = Date.now();
      console.log(`${trace}[chapo-loop] LLM call #${this.iteration} starting (${provider}/${model}, ${tools.length}/${allTools.length} tools, thinking=${thinkingEnabled}${kimiSearchEnabled ? ', kimi-search' : ''}${webSearchEnabled ? ', glm-web-search' : ''})`);
      // On the first iteration, force the model to use at least one tool
      // instead of narrating what it would do.
      const toolChoice = this.iteration === 0 ? 'required' as const : 'auto' as const;

      const [response, err] = await this.errorHandler.safe('llm_call', () =>
        llmRouter.generateWithFallback(provider, {
          model,
          messages: this.conversation.buildLLMMessages(),
          systemPrompt: this.conversation.getSystemPrompt(),
          tools,
          toolsEnabled: true,
          toolChoice,
          sameProviderFallbacks,
          thinkingEnabled,
          kimiSearchEnabled,
          webSearchEnabled,
        })
      );

      const llmDuration = Date.now() - t0;
      console.log(`${trace}[chapo-loop] LLM call #${this.iteration} completed in ${llmDuration}ms, err=${err?.message || 'none'}, content=${response?.content?.slice(0, 100) || 'null'}, toolCalls=${response?.toolCalls?.length || 0}`);

      if (response?.usage) {
        this.totalTokensUsed += response.usage.inputTokens + response.usage.outputTokens;
      }

      if (err) {
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
        continue;
      }

      if (response.content) this.lastContent = response.content;

      if (!response.toolCalls || response.toolCalls.length === 0) {
        const answer = response.content || '';

        extractTurnEpisode(this.sessionId, {
          userMessage: userText.slice(0, 500),
          assistantAnswer: answer.slice(0, 500),
          toolsUsed: this.toolCallLog.map((t) => t.name),
          iteration: this.iteration,
        }).catch((err) => console.error(`${trace}[chapo-loop] episodic turn extraction failed:`, err))

        this.emitDecisionPath({
          path: 'answer',
          reason: 'No further tool calls needed; answer delivered directly.',
          confidence: 0.8,
          unresolvedAssumptions: [],
        });

        return {
          answer,
          status: 'completed',
          totalIterations: this.iteration + 1,
        };
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
        buildToolResultContent,
        projectRoot: this.projectRoot,
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
            break;
          }
          if (outcome.toolResult) {
            toolResults.push(outcome.toolResult);
            this.toolCallLog.push({ name: toolCall.name, durationMs: toolDuration, success: !outcome.toolResult.isError });
            // Log action to parallel buffer
            if (this.parallelTurnId) {
              stateManager.appendLoopAction(this.sessionId, this.parallelTurnId, {
                iteration: this.iteration,
                tool: toolCall.name,
                summary: buildActionSummary(toolCall.name, toolCall.arguments, outcome.toolResult),
              });
            }
            // Fire-and-forget: episodic extraction for significant tool results
            if (!outcome.toolResult.isError) {
              extractToolEpisode(this.sessionId, {
                toolName: toolCall.name,
                toolArgs: toolCall.arguments,
                toolResult: outcome.toolResult.result,
              }).catch((err) => console.error(`${trace}[chapo-loop] episodic tool extraction failed:`, err))
            }
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

      this.conversation.addMessage({
        role: 'user',
        content: '',
        toolResults,
      });

      if (toolResults.length > 0) {
        stateManager.setGatheredInfo(this.sessionId, 'loopCheckpoint', {
          iteration: this.iteration,
          tokensUsed: this.totalTokensUsed,
          timestamp: new Date().toISOString(),
        });
      }

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

    // Loop exhaustion — deliver whatever we have so far
    console.warn(`${trace}[chapo-loop] Loop exhausted after ${this.iteration} iterations, delivering last answer`);
    return {
      answer: this.lastContent || 'Maximum iterations reached. Please try again or break the task into smaller parts.',
      status: 'error' as const,
      totalIterations: this.iteration,
    };
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

}

/** Build a short 1-line summary for the parallel context buffer. */
function buildActionSummary(
  toolName: string,
  args: Record<string, unknown>,
  toolResult: { result: string; isError: boolean },
): string {
  const resultPreview = toolResult.result.slice(0, 80);
  const success = toolResult.isError ? 'Fehler' : 'OK';

  // File operations
  if (toolName === 'fs_readFile' || toolName === 'fs_glob' || toolName === 'fs_grep') {
    const path = typeof args.path === 'string' ? args.path.split('/').pop() : '?';
    return `${path} gelesen (${success})`;
  }
  if (toolName === 'fs_listFiles') {
    const path = typeof args.path === 'string' ? args.path : '?';
    return `${path} aufgelistet`;
  }

  // Web
  if (toolName === 'web_search') {
    const query = typeof args.query === 'string' ? args.query.slice(0, 40) : '?';
    return `Web-Suche: ${query}`;
  }
  if (toolName === 'web_fetch') {
    const url = typeof args.url === 'string' ? args.url.slice(0, 50) : '?';
    return `Web-Fetch: ${url}`;
  }

  // Git
  if (toolName === 'git_status' || toolName === 'git_diff') {
    return `${toolName} (${success})`;
  }

  // Generic fallback
  return `${toolName}: ${resultPreview}`;
}
