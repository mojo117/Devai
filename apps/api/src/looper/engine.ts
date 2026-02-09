// ──────────────────────────────────────────────
// Looper-AI  –  Core Loop Engine
// The main orchestrator that keeps running until
// the task is done (or the budget is exhausted).
// ──────────────────────────────────────────────

import { nanoid } from 'nanoid';
import type {
  LooperConfig,
  LooperEvent,
  LooperStep,
  LooperStreamEvent,
  LooperStatus,
  DecisionResult,
  ValidationResult,
} from '@devai/shared';
import type { LLMProvider } from '../llm/types.js';
import { DecisionEngine } from './decision-engine.js';
import { ConversationManager } from './conversation-manager.js';
import { SelfValidator } from './self-validation.js';
import { LooperErrorHandler } from './error-handler.js';
import { createAgents, type LooperAgent, type AgentResult } from './agents/index.js';
import { getProjectContext } from '../scanner/projectScanner.js';
import { config as appConfig } from '../config.js';
import type { ConversationSnapshot } from './conversation-manager.js';
import type { LooperErrorHandlerSnapshot } from './error-handler.js';

/** Default configuration values. */
const DEFAULTS: LooperConfig = {
  maxIterations: 25,
  maxConversationTokens: 120_000,
  maxToolRetries: 3,
  minValidationConfidence: 0.7,
  selfValidationEnabled: true,
};

export type StreamCallback = (event: LooperStreamEvent) => void;

export interface LoopRunResult {
  answer: string;
  steps: LooperStep[];
  totalIterations: number;
  status: LooperStatus;
}

export interface LooperEngineSnapshot {
  provider: LLMProvider;
  cfg: LooperConfig;
  conversation: ConversationSnapshot;
  steps: LooperStep[];
  status: LooperStatus;
  errorHandler: LooperErrorHandlerSnapshot;
}

/**
 * The LooperEngine is the heart of the AI agent loop.
 *
 * Flow:
 *   User message → Decision Engine classifies intent
 *     → TOOL_CALL   : Route to agent → execute tool → feed result back as event
 *     → CLARIFY      : Return question to user → pause loop
 *     → ANSWER       : (optionally) self-validate → return to user
 *   Each step's result feeds back into the loop as a new event.
 */
export class LooperEngine {
  private cfg: LooperConfig;
  private conversation: ConversationManager;
  private decisionEngine: DecisionEngine;
  private validator: SelfValidator;
  private errorHandler: LooperErrorHandler;
  private agents: Map<string, LooperAgent>;
  private steps: LooperStep[] = [];
  private status: LooperStatus = 'idle';
  private onStream?: StreamCallback;

  constructor(
    private provider: LLMProvider,
    configOverrides?: Partial<LooperConfig>
  ) {
    this.cfg = { ...DEFAULTS, ...configOverrides };
    this.conversation = new ConversationManager(this.cfg.maxConversationTokens);
    this.decisionEngine = new DecisionEngine(provider);
    this.validator = new SelfValidator(provider);
    this.errorHandler = new LooperErrorHandler(this.cfg.maxToolRetries);
    this.agents = createAgents(provider);
  }

  snapshot(): LooperEngineSnapshot {
    return {
      provider: this.provider,
      cfg: this.cfg,
      conversation: this.conversation.snapshot(),
      steps: this.steps,
      status: this.status,
      errorHandler: this.errorHandler.snapshot(),
    };
  }

  static fromSnapshot(snapshot: LooperEngineSnapshot): LooperEngine {
    const engine = new LooperEngine(snapshot.provider, snapshot.cfg);
    engine.conversation.restore(snapshot.conversation);
    engine.steps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
    engine.status = snapshot.status || 'idle';
    engine.errorHandler.restore(snapshot.errorHandler);
    return engine;
  }

  /** Register a streaming callback for real-time events. */
  setStreamCallback(cb: StreamCallback): void {
    this.onStream = cb;
  }

  /**
   * Run the full agent loop for a given user message.
   * This is the main entry point.
   */
  async run(userMessage: string, projectRoot?: string): Promise<LoopRunResult> {
    this.status = 'running';
    this.steps = [];
    this.errorHandler.clear();

    // Build system prompt with project context
    const systemPrompt = await this.buildSystemPrompt(projectRoot);
    this.conversation.setSystemPrompt(systemPrompt);

    // Add the user message to the conversation
    this.conversation.addMessage({ role: 'user', content: userMessage });

    // Create the initial event
    let currentEvent: LooperEvent = {
      id: nanoid(),
      type: 'user_message',
      payload: userMessage,
      timestamp: new Date().toISOString(),
    };

    this.emit({ type: 'status', data: { status: 'running' }, timestamp: now() });

    let iteration = 0;

    // ─── THE LOOP ─────────────────────────────
    while (iteration < this.cfg.maxIterations && this.status === 'running') {
      iteration++;
      const stepStart = Date.now();

      this.emit({
        type: 'thinking',
        data: { iteration, event: currentEvent.type, tokenUsage: this.conversation.getSummary() },
        timestamp: now(),
      });

      // 1. Decision Engine: what should we do?
      const [decision, decisionError] = await this.errorHandler.safe(
        `decision-${iteration}`,
        () => this.decisionEngine.decide(this.conversation, currentEvent)
      );

      if (decisionError) {
        // Decision engine failed – create an error event and loop again
        currentEvent = this.makeErrorEvent(decisionError.message);
        this.recordStep(iteration, { intent: 'continue', reasoning: 'Decision engine failed' }, null, decisionError.message, stepStart);
        continue;
      }

      const decisionResult = decision!;

      this.emit({
        type: 'step',
        data: { iteration, decision: decisionResult },
        timestamp: now(),
      });

      // 2. Act on the decision
      switch (decisionResult.intent) {
        // ── TOOL CALL ──────────────────────
        case 'tool_call': {
          const agentResult = await this.executeAgent(decisionResult, userMessage);
          this.conversation.addMessage({
            role: 'assistant',
            content: agentResult.output,
          });
          this.recordStep(iteration, decisionResult, agentResult.output, agentResult.success ? undefined : 'Agent execution had issues', stepStart);

          // Feed result back into the loop
          currentEvent = {
            id: nanoid(),
            type: agentResult.success ? 'tool_result' : 'error',
            payload: agentResult.output,
            sourceAgent: decisionResult.agent,
            timestamp: now(),
          };

          // If the agent doesn't need follow-up AND it was the only step,
          // let the decision engine decide on the next iteration.
          break;
        }

        // ── CLARIFY ────────────────────────
        case 'clarify': {
          const question = decisionResult.clarificationQuestion || 'Could you provide more details?';
          this.conversation.addMessage({ role: 'assistant', content: question });
          this.recordStep(iteration, decisionResult, question, undefined, stepStart);

          this.status = 'waiting_for_user';
          this.emit({ type: 'clarify', data: { question }, timestamp: now() });

          return {
            answer: question,
            steps: this.steps,
            totalIterations: iteration,
            status: 'waiting_for_user',
          };
        }

        // ── ANSWER ─────────────────────────
        case 'answer': {
          let answer = decisionResult.answerText || '';

          // Self-validation
          if (this.cfg.selfValidationEnabled && answer.length > 0) {
            const validation = await this.selfValidate(userMessage, answer);

            if (!validation.isComplete && validation.confidence < this.cfg.minValidationConfidence) {
              // Validation says answer is incomplete – loop again
              this.conversation.addThinking(
                `Self-validation flagged issues: ${validation.issues.join(', ')}. ` +
                `Confidence: ${validation.confidence}. Suggestion: ${validation.suggestion || 'improve answer'}`
              );
              this.recordStep(iteration, decisionResult, answer, `Validation: ${validation.issues.join(', ')}`, stepStart);

              currentEvent = {
                id: nanoid(),
                type: 'self_validation',
                payload: validation,
                timestamp: now(),
              };
              continue;
            }

            this.emit({ type: 'validation', data: validation, timestamp: now() });
          }

          this.conversation.addMessage({ role: 'assistant', content: answer });
          this.recordStep(iteration, decisionResult, answer, undefined, stepStart);
          this.status = 'completed';

          this.emit({ type: 'answer', data: { answer }, timestamp: now() });

          return {
            answer,
            steps: this.steps,
            totalIterations: iteration,
            status: 'completed',
          };
        }

        // ── CONTINUE / SELF_VALIDATE ───────
        case 'continue':
        case 'self_validate': {
          this.recordStep(iteration, decisionResult, null, undefined, stepStart);
          // Just loop again with the same event context
          break;
        }

        default: {
          // Unknown intent – treat as answer
          const fallbackAnswer = decisionResult.answerText || decisionResult.reasoning || 'I could not determine the next step.';
          this.conversation.addMessage({ role: 'assistant', content: fallbackAnswer });
          this.recordStep(iteration, decisionResult, fallbackAnswer, undefined, stepStart);
          this.status = 'completed';

          return {
            answer: fallbackAnswer,
            steps: this.steps,
            totalIterations: iteration,
            status: 'completed',
          };
        }
      }
    }

    // ─── LOOP EXHAUSTED ──────────────────────
    this.status = this.status === 'running' ? 'completed' : this.status;
    const exhaustionAnswer = this.buildExhaustionSummary();
    this.emit({ type: 'answer', data: { answer: exhaustionAnswer }, timestamp: now() });

    return {
      answer: exhaustionAnswer,
      steps: this.steps,
      totalIterations: iteration,
      status: this.status,
    };
  }

  /**
   * Continue the loop after the user provides a clarification.
   */
  async continueWithClarification(clarification: string): Promise<LoopRunResult> {
    this.status = 'running';
    this.conversation.addMessage({ role: 'user', content: clarification });

    const event: LooperEvent = {
      id: nanoid(),
      type: 'clarification_response',
      payload: clarification,
      timestamp: now(),
    };

    // Re-use the original user message from the conversation
    const originalUserMsg = this.conversation.getMessages().find(m => m.role === 'user');
    return this.runFromEvent(event, originalUserMsg?.content || clarification);
  }

  // ── Private helpers ──────────────────────

  private async runFromEvent(startEvent: LooperEvent, userMessage: string): Promise<LoopRunResult> {
    let currentEvent = startEvent;
    let iteration = this.steps.length;

    while (iteration < this.cfg.maxIterations && this.status === 'running') {
      iteration++;
      const stepStart = Date.now();

      const [decision, decisionError] = await this.errorHandler.safe(
        `decision-${iteration}`,
        () => this.decisionEngine.decide(this.conversation, currentEvent)
      );

      if (decisionError) {
        currentEvent = this.makeErrorEvent(decisionError.message);
        this.recordStep(iteration, { intent: 'continue', reasoning: 'Decision engine failed' }, null, decisionError.message, stepStart);
        continue;
      }

      const decisionResult = decision!;

      switch (decisionResult.intent) {
        case 'tool_call': {
          const agentResult = await this.executeAgent(decisionResult, userMessage);
          this.conversation.addMessage({ role: 'assistant', content: agentResult.output });
          this.recordStep(iteration, decisionResult, agentResult.output, agentResult.success ? undefined : 'Agent error', stepStart);
          currentEvent = {
            id: nanoid(),
            type: agentResult.success ? 'tool_result' : 'error',
            payload: agentResult.output,
            sourceAgent: decisionResult.agent,
            timestamp: now(),
          };
          break;
        }
        case 'clarify': {
          const q = decisionResult.clarificationQuestion || 'Could you clarify?';
          this.conversation.addMessage({ role: 'assistant', content: q });
          this.recordStep(iteration, decisionResult, q, undefined, stepStart);
          this.status = 'waiting_for_user';
          this.emit({ type: 'clarify', data: { question: q }, timestamp: now() });
          return { answer: q, steps: this.steps, totalIterations: iteration, status: 'waiting_for_user' };
        }
        case 'answer': {
          const answer = decisionResult.answerText || '';
          this.conversation.addMessage({ role: 'assistant', content: answer });
          this.recordStep(iteration, decisionResult, answer, undefined, stepStart);
          this.status = 'completed';
          this.emit({ type: 'answer', data: { answer }, timestamp: now() });
          return { answer, steps: this.steps, totalIterations: iteration, status: 'completed' };
        }
        default:
          this.recordStep(iteration, decisionResult, null, undefined, stepStart);
          break;
      }
    }

    const exhaustion = this.buildExhaustionSummary();
    this.status = 'completed';
    return { answer: exhaustion, steps: this.steps, totalIterations: iteration, status: 'completed' };
  }

  private async executeAgent(decision: DecisionResult, userMessage: string): Promise<AgentResult> {
    const agentType = decision.agent || 'developer';
    const agent = this.agents.get(agentType);

    if (!agent) {
      return {
        success: false,
        output: `Unknown agent type: ${agentType}`,
        needsFollowUp: true,
        followUpHint: `Agent "${agentType}" not found.`,
      };
    }

    this.emit({
      type: 'tool_call',
      data: { agent: agentType, tool: decision.toolName, args: decision.toolArgs },
      timestamp: now(),
    });

    const previousResults = this.steps
      .filter(s => s.output)
      .map(s => String(s.output))
      .slice(-5); // Last 5 results for context

    const [result, agentError] = await this.errorHandler.safe(
      `agent-${agentType}-${decision.toolName || 'reason'}`,
      () => agent.execute({
        userMessage,
        toolName: decision.toolName,
        toolArgs: decision.toolArgs,
        previousResults,
      })
    );

    if (agentError) {
      const errorOutput = this.errorHandler.formatForLLM(agentError);
      this.emit({ type: 'error', data: { agent: agentType, error: errorOutput }, timestamp: now() });
      return {
        success: false,
        output: errorOutput,
        needsFollowUp: this.errorHandler.canRetry(`agent-${agentType}-${decision.toolName || 'reason'}`),
        followUpHint: agentError.message,
      };
    }

    const agentResult = result!;
    this.emit({
      type: 'tool_result',
      data: { agent: agentType, success: agentResult.success, output: agentResult.output.slice(0, 500) },
      timestamp: now(),
    });

    return agentResult;
  }

  private async selfValidate(userRequest: string, answer: string): Promise<ValidationResult> {
    const [validation, err] = await this.errorHandler.safe(
      'self-validation',
      () => this.validator.validate(userRequest, answer)
    );

    if (err) {
      return { isComplete: true, confidence: 0.5, issues: ['Validation failed to run'] };
    }
    return validation!;
  }

  private makeErrorEvent(message: string): LooperEvent {
    return {
      id: nanoid(),
      type: 'error',
      payload: { message },
      timestamp: now(),
    };
  }

  private recordStep(
    index: number,
    decision: DecisionResult,
    output: unknown,
    error: string | undefined,
    startTime: number
  ): void {
    this.steps.push({
      stepIndex: index,
      intent: decision.intent,
      agent: decision.agent,
      toolName: decision.toolName,
      input: decision.toolArgs || decision.clarificationQuestion || decision.reasoning,
      output,
      durationMs: Date.now() - startTime,
      error,
      timestamp: now(),
    });
  }

  private async buildSystemPrompt(projectRoot?: string): Promise<string> {
    const parts: string[] = [
      `You are Chapo, a general-purpose AI agent and assistant.`,
      `You can develop code, search and research, manage documents, and execute commands.`,
      `You run in a persistent loop – you NEVER give up on errors. Instead, you report them and try alternative approaches.`,
      `You think step by step and validate your own work before delivering final answers.`,
      '',
      'Capabilities:',
      '- Developer: Write, edit, and reason about code',
      '- Searcher: Research topics, read documentation, gather information',
      '- Document Manager: Read, write, list, organise files',
      '- Commander: Run git commands, GitHub workflows, system operations',
      '',
      'Tools available: fs.listFiles, fs.readFile, fs.writeFile, git.status, git.diff, git.commit, github.triggerWorkflow, github.getWorkflowRunStatus, logs.getStagingLogs',
    ];

    const root = appConfig.projectRoot || projectRoot;
    if (root) {
      try {
        const ctx = await getProjectContext(root);
        if (ctx) {
          parts.push(`\nProject Context:\n${ctx.summary}`);
        }
      } catch {
        // Non-critical – continue without project context
      }
    }

    return parts.join('\n');
  }

  private buildExhaustionSummary(): string {
    const successSteps = this.steps.filter(s => !s.error);
    const errorSteps = this.steps.filter(s => s.error);
    const lastOutput = this.steps.length > 0
      ? String(this.steps[this.steps.length - 1].output || '')
      : '';

    return [
      `I've completed ${this.steps.length} steps (${successSteps.length} successful, ${errorSteps.length} with issues).`,
      '',
      lastOutput ? `Latest result:\n${lastOutput}` : '',
      '',
      errorSteps.length > 0
        ? `Issues encountered:\n${errorSteps.map(s => `- Step ${s.stepIndex}: ${s.error}`).join('\n')}`
        : '',
      '',
      `Loop reached the maximum iteration limit (${this.cfg.maxIterations}). If you need more work done, please send a follow-up message.`,
    ].filter(Boolean).join('\n');
  }

  private emit(event: LooperStreamEvent): void {
    if (this.onStream) {
      this.onStream(event);
    }
  }
}

function now(): string {
  return new Date().toISOString();
}
