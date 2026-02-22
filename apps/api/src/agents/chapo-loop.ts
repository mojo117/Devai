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
import { getCombinedSystemContextBlock, warmSystemContextForSession } from './systemContext.js';
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
  private contextManager: ChapoLoopContextManager;
  private gateManager: ChapoLoopGateManager;

  constructor(
    private sessionId: string,
    private sendEvent: SendEventFn,
    private projectRoot: string | null,
    private modelSelection: ModelSelection,
    private config: ChapoLoopConfig,
  ) {
    this.errorHandler = new AgentErrorHandler(3);
    this.conversation = new ConversationManager(180_000);
    this.sessionLogger = SessionLogger.getActive(sessionId);
    this.answerValidator = new AnswerValidator(this.sessionLogger);
    this.contextManager = new ChapoLoopContextManager(this.sessionId, this.sendEvent, this.conversation);
    this.gateManager = new ChapoLoopGateManager(this.sessionId, this.sendEvent);
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
    const userText = getTextContent(userMessage);
    stateManager.ensureActiveTurnId(this.sessionId);
    this.contextManager.setPinnedRequest(userText);

    // 1. Warm system context
    await warmSystemContextForSession(this.sessionId, this.projectRoot, userText);
    const systemContextBlock = getCombinedSystemContextBlock(this.sessionId);

    // 2. Set system prompt on conversation manager
    const chapo = getAgent('chapo');
    const systemPrompt = `${chapo.systemPrompt}
${systemContextBlock}
${this.projectRoot ? `Working Directory: ${this.projectRoot}` : ''}

Du bist CHAPO im Decision Loop. Fuehre Aufgaben DIREKT aus:
- Delegiere Entwicklungsaufgaben in der Domaene "development" an DEVO
- Delegiere Kommunikations/Admin-Aufgaben in der Domaene "communication" an CAIO
- Delegiere Rechercheaufgaben in der Domaene "research" an SCOUT
- Wenn du delegierst: gib domain + objective + optional constraints/context/expectedOutcome
- Nenne in Delegationen keine konkreten Toolnamen; der Ziel-Agent waehlt die Tools selbst
- Nutze direkte Read-Only Tools nur fuer Kontextsammlung oder kurze Faktenchecks
- Nutze delegateParallel nur fuer unabhaengige Teilaufgaben
- Nutze askUser NUR wenn du wirklich eine Rueckfrage brauchst
- Wenn du die Antwort hast, antworte direkt OHNE Tool-Calls`;

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

    // 7. Emit completion
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

    for (this.iteration = 0; this.iteration < this.config.maxIterations; this.iteration++) {
      this.sendEvent({
        type: 'agent_thinking',
        agent: 'chapo',
        status: this.iteration === 0 ? 'Analysiere Anfrage...' : `Iteration ${this.iteration + 1}...`,
      });

      // Check if compaction needed before LLM call
      await this.contextManager.checkAndCompact();

      // Call LLM with conversation + tools
      const [response, err] = await this.errorHandler.safe('llm_call', () =>
        llmRouter.generateWithFallback(provider, {
          model,
          messages: this.conversation.buildLLMMessages(),
          systemPrompt: this.conversation.getSystemPrompt(),
          tools,
          toolsEnabled: true,
        })
      );

      if (err) {
        // Feed error back as context — CHAPO sees it and decides what to do
        this.conversation.addMessage({
          role: 'system',
          content: `[LLM Error] ${this.errorHandler.formatForLLM(err)}`,
        });
        this.sendEvent({ type: 'error', agent: 'chapo', error: err.message });

        if (!this.errorHandler.canRetry('llm_call')) {
          return {
            answer: `Fehler bei der Verarbeitung: ${err.message}`,
            status: 'error',
            totalIterations: this.iteration + 1,
          };
        }
        continue;
      }

      // No tool calls → ACTION: ANSWER
      if (!response.toolCalls || response.toolCalls.length === 0) {
        // Check inbox before finalizing — catch late-arriving messages
        const hasNew = this.contextManager.checkInbox();
        if (hasNew) {
          // Save current answer as intermediate response, continue loop
          this.conversation.addMessage({
            role: 'assistant',
            content: response.content || '',
          });
          continue;
        }

        const answer = response.content || '';
        const userText = getTextContent(userMessage);

        if (this.answerValidator.shouldConvertToAsk(userText, answer)) {
          return this.queueQuestion(
            this.answerValidator.extractClarificationQuestion(answer),
            this.iteration + 1,
            { kind: 'clarification', turnId: this.getActiveTurnId() || undefined },
          );
        }
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
        buildToolResultContent: this.buildToolResultContent.bind(this),
        markExternalActionToolSuccess: this.markExternalActionToolSuccess.bind(this),
      });

      for (const toolCall of response.toolCalls) {
        const outcome = await toolExecutor.execute({
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });
        if (outcome.earlyReturn) {
          earlyReturn = outcome.earlyReturn;
          break;
        }
        if (outcome.toolResult) {
          toolResults.push(outcome.toolResult);
        }
      }

      // If we got an early return (ASK or approval), exit the loop
      if (earlyReturn) {
        return earlyReturn;
      }

      // Feed tool results back to LLM for the next iteration
      this.conversation.addMessage({
        role: 'user',
        content: '',
        toolResults,
      });

      // Fire-and-forget: tag current work topic for recent focus
      if (response.toolCalls && response.toolCalls.length > 0) {
        const toolNames = response.toolCalls.map((tc) => tc.name);
        const filePaths = this.extractFilePathsFromToolCalls(response.toolCalls);
        tagCurrentWork(this.sessionId, {
          userMessage: getTextContent(userMessage).slice(0, 300),
          toolCalls: toolNames,
          assistantResponse: (response.content || '').slice(0, 300),
          filePaths,
        }).catch((err) => console.error('[chapo-loop] topic tagging failed:', err));
      }

      // Check inbox for new messages between iterations
      this.contextManager.checkInbox();
    }

    // Loop exhaustion — check for unprocessed inbox messages
    const remaining = this.contextManager.drainRemainingMessages();
    if (remaining.length > 0) {
      const extras = remaining.map((m) => m.content).join('; ');
      return this.queueQuestion(
        `Ich habe mein Iterationslimit erreicht. Du hattest auch noch gefragt: "${extras}"\n\nSoll ich damit weitermachen?`,
        this.iteration,
        {
          kind: 'continue',
          turnId: this.getActiveTurnId() || undefined,
          fingerprint: `limit:inbox:${this.getActiveTurnId() || 'none'}:${extras}`,
        },
      );
    }

    return this.queueQuestion(
      'Die Anfrage hat mehr Schritte benoetigt als erlaubt. Soll ich weitermachen?',
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

  private markExternalActionToolSuccess(toolName: string, success: boolean): void {
    if (success) {
      this.answerValidator.markExternalToolSuccess(toolName);
    }
  }

  private getDelegationRunnerDeps(): DelegationRunnerDeps {
    return {
      sessionId: this.sessionId,
      projectRoot: this.projectRoot,
      modelSelection: this.modelSelection,
      sendEvent: this.sendEvent,
      errorHandler: this.errorHandler,
      subAgentRunner: this.subAgentRunner,
      markExternalActionToolSuccess: this.markExternalActionToolSuccess.bind(this),
      deriveDelegationStatus: this.deriveDelegationStatus.bind(this),
      buildToolResultContent: this.buildToolResultContent.bind(this),
    };
  }

  private buildToolResultContent(result: { success: boolean; result?: unknown; error?: string }): { content: string; isError: boolean } {
    if (result.success) {
      const value = result.result === undefined ? '' : JSON.stringify(result.result);
      return { content: value || 'OK', isError: false };
    }
    const content = result.error ? `Error: ${result.error}` : 'Error: Tool failed without a message.';
    return { content, isError: true };
  }
}
