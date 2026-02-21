/**
 * ChapoLoop — CHAPO Decision Loop
 *
 * A continuous loop where the LLM's tool_calls ARE the decisions:
 *   - No tool_calls = ANSWER → self-validate → respond → exit
 *   - askUser = ASK → pause loop → wait for user reply
 *   - delegateToDevo = DELEGATE → run DEVO sub-loop → feed result back
 *   - delegateToCaio = DELEGATE → run CAIO sub-loop → feed result back
 *   - delegateParallel = DELEGATE → run multiple delegations concurrently
 *   - delegateToScout = DELEGATE → run SCOUT → feed result back
 *   - any other tool = TOOL → execute → feed result back → continue
 *
 * Errors at any point feed back into the loop as context.
 */

import { nanoid } from 'nanoid';
import { AgentErrorHandler } from './error-handler.js';
import { SelfValidator } from './self-validation.js';
import { ConversationManager } from './conversation-manager.js';
import { llmRouter } from '../llm/router.js';
import { executeToolWithApprovalBridge } from '../actions/approvalBridge.js';
import { getCombinedSystemContextBlock, warmSystemContextForSession } from './systemContext.js';
import { compactMessages } from '../memory/compaction.js';
import { SessionLogger } from '../audit/sessionLogger.js';
import { getAgent, getToolsForAgent } from './router.js';
import { getToolsForLLM } from '../tools/registry.js';
import * as stateManager from './stateManager.js';
import { SubAgentRunner } from './sub-agent-runner.js';
import { drainInbox, onInboxMessage, offInboxMessage } from './inbox.js';
import {
  buildDelegation,
  parseParallelDelegations,
  type ParallelDelegation,
} from './chapo-loop/delegationUtils.js';
import {
  buildDelegationDecisionPath,
  buildDelegationThinkingStatus,
  delegateParallel as runParallelDelegations,
  delegateToAgent as runDelegationToAgent,
  resolveDelegationTarget,
  type DelegationRunnerDeps,
} from './chapo-loop/delegationRunner.js';
import type {
  AgentStreamEvent,
  ModelSelection,
  ChapoLoopResult,
  UserQuestion,
  ApprovalRequest,
  RiskLevel,
  ValidationResult,
  LoopDelegationResult,
  LoopDelegationStatus,
  ToolEvidence,
  InboxMessage,
} from './types.js';
import type { LLMProvider, ContentBlock } from '../llm/types.js';
import { getTextContent } from '../llm/types.js';

export type SendEventFn = (event: AgentStreamEvent) => void;

interface ChapoLoopConfig {
  selfValidationEnabled: boolean;
  maxIterations: number;
}

interface DecisionPathInsights {
  path: 'answer' | 'delegate_devo' | 'delegate_caio' | 'delegate_scout' | 'tool';
  reason: string;
  confidence: number;
  unresolvedAssumptions: string[];
}

const EXTERNAL_ACTION_TOOLS = new Set([
  'send_email',
  'taskforge_create_task',
  'taskforge_move_task',
  'taskforge_add_comment',
  'scheduler_create',
  'scheduler_update',
  'scheduler_delete',
  'reminder_create',
  'notify_user',
]);

export class ChapoLoop {
  private errorHandler: AgentErrorHandler;
  private validator: SelfValidator;
  private conversation: ConversationManager;
  private sessionLogger?: SessionLogger;
  private subAgentRunner = new SubAgentRunner();
  private iteration = 0;
  private successfulExternalTools = new Set<string>();
  private originalUserMessage = '';
  private hasInboxMessages = false;
  private inboxHandler: ((msg: InboxMessage) => void) | null = null;

  constructor(
    private sessionId: string,
    private sendEvent: SendEventFn,
    private projectRoot: string | null,
    private modelSelection: ModelSelection,
    private config: ChapoLoopConfig,
  ) {
    this.errorHandler = new AgentErrorHandler(3);
    this.validator = new SelfValidator(modelSelection.provider as LLMProvider);
    this.conversation = new ConversationManager(180_000);
    this.sessionLogger = SessionLogger.getActive(sessionId);

    // Subscribe to inbox events for reactive awareness
    this.inboxHandler = (msg: InboxMessage) => {
      this.hasInboxMessages = true;
      this.sendEvent({
        type: 'message_queued',
        messageId: msg.id,
        preview: 'Got it — I\'ll handle that too',
      });
    };
    onInboxMessage(this.sessionId, this.inboxHandler);
  }

  dispose(): void {
    if (this.inboxHandler) {
      offInboxMessage(this.sessionId, this.inboxHandler);
      this.inboxHandler = null;
    }
  }

  private checkInbox(): void {
    if (!this.hasInboxMessages) return;
    this.hasInboxMessages = false;

    const messages = drainInbox(this.sessionId);
    if (messages.length === 0) return;

    const inboxBlock = messages
      .map(
        (m, i) => `[New message #${i + 1} from user while you were working]: "${m.content}"`,
      )
      .join('\n');

    this.conversation.addMessage({
      role: 'system',
      content:
        `${inboxBlock}\n\n` +
        `Classify each new message:\n` +
        `- PARALLEL: Independent task -> use delegateParallel or handle after current task\n` +
        `- AMENDMENT: Replaces/changes current task -> decide: abort (if early) or finish-then-pivot\n` +
        `- EXPANSION: Adds to current task scope -> integrate into current plan\n` +
        `Acknowledge each message to the user in your response.`,
    });

    this.sendEvent({ type: 'inbox_processing', count: messages.length });
  }

  private async checkAndCompact(): Promise<void> {
    const COMPACTION_THRESHOLD = 160_000;
    const usage = this.conversation.getTokenUsage();

    if (usage < COMPACTION_THRESHOLD) return;

    const messages = this.conversation.getMessages();
    // Compact the oldest ~60% of messages
    const compactCount = Math.floor(messages.length * 0.6);
    if (compactCount < 2) return;

    const toCompact = messages.slice(0, compactCount);
    const toKeep = messages.slice(compactCount);

    const result = await compactMessages(toCompact, this.sessionId);

    // Replace conversation: summary + kept messages
    this.conversation.clear();
    this.conversation.addMessage({
      role: 'system',
      content: `[Context compacted — ${result.droppedTokens} tokens summarized]\n\n${result.summary}`,
    });

    // Pin original user request so CHAPO never loses the goal (Ralph spec pinning)
    if (this.originalUserMessage) {
      this.conversation.addMessage({
        role: 'system',
        content: `[ORIGINAL REQUEST — pinned]\n${this.originalUserMessage}`,
      });
    }

    for (const msg of toKeep) {
      this.conversation.addMessage(msg);
    }

    this.sendEvent({
      type: 'agent_thinking',
      agent: 'chapo',
      status: `Context kompaktiert: ${result.droppedTokens} → ${result.summaryTokens} Tokens`,
    });
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

  private extractAssumptionsFromAnswer(answer: string, validation?: ValidationResult): string[] {
    const assumptions = new Set<string>();
    const text = answer.toLowerCase();

    if (validation) {
      for (const issue of validation.issues.slice(0, 3)) {
        if (issue.trim().length > 0) assumptions.add(issue.trim());
      }
    }

    if (/(vorausgesetzt|assuming|assume|falls|if )/.test(text)) {
      assumptions.add('Antwort enthaelt bedingte Annahmen.');
    }
    if (/(nicht verifiziert|unverified|unsicher|unclear)/.test(text)) {
      assumptions.add('Teile der Antwort sind nicht final verifiziert.');
    }

    return Array.from(assumptions).slice(0, 3);
  }

  async run(userMessage: string | ContentBlock[], conversationHistory: Array<{ role: string; content: string }>): Promise<ChapoLoopResult> {
    this.originalUserMessage = getTextContent(userMessage);

    // 1. Warm system context
    await warmSystemContextForSession(this.sessionId, this.projectRoot, getTextContent(userMessage));
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
      await this.checkAndCompact();

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
        const answer = response.content || '';
        if (this.shouldConvertInlineClarificationToAsk(getTextContent(userMessage), answer)) {
          return this.queueQuestion(
            this.extractClarificationQuestion(answer),
            this.iteration + 1,
          );
        }
        return this.handleAnswer(getTextContent(userMessage), answer);
      }

      // Add assistant message with tool calls to conversation
      this.conversation.addMessage({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      });

      const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];
      let earlyReturn: ChapoLoopResult | null = null;

      for (const toolCall of response.toolCalls) {
        // ACTION: ASK — pause loop, wait for user
        if (toolCall.name === 'askUser') {
          const question = (toolCall.arguments.question as string) || 'Kannst du das genauer beschreiben?';
          earlyReturn = await this.queueQuestion(question, this.iteration + 1);
          break;
        }

        // ACTION: DELEGATE in parallel to multiple agents
        if (toolCall.name === 'delegateParallel') {
          const delegations = parseParallelDelegations(toolCall.arguments.delegations);
          if (delegations.length === 0) {
            toolResults.push({
              toolUseId: toolCall.id,
              result: 'Error: delegateParallel benoetigt mindestens eine gueltige Delegation.',
              isError: true,
            });
            continue;
          }
          this.emitDecisionPath({
            path: 'tool',
            reason: `Unabhaengige Teilaufgaben werden parallel delegiert (${delegations.length}).`,
            confidence: 0.8,
            unresolvedAssumptions: [],
          });

          this.sendEvent({
            type: 'agent_thinking',
            agent: 'chapo',
            status: `Delegiere parallel (${delegations.length} Aufgaben)...`,
          });

          const [parallelSummary, parallelErr] = await this.errorHandler.safe(
            `delegate:parallel:${this.iteration}`,
            () => runParallelDelegations(
              this.getDelegationRunnerDeps(),
              delegations,
              this.buildVerificationEnvelope.bind(this),
            ),
          );

          if (parallelErr) {
            toolResults.push({
              toolUseId: toolCall.id,
              result: `Parallel-Delegation Fehler: ${this.errorHandler.formatForLLM(parallelErr)}`,
              isError: true,
            });
          } else {
            this.sendEvent({
              type: 'tool_result',
              agent: 'chapo',
              toolName: toolCall.name,
              result: { delegated: true, parallel: delegations.length },
              success: true,
            });
            toolResults.push({
              toolUseId: toolCall.id,
              result: parallelSummary,
              isError: false,
            });
          }
          continue;
        }

        // ACTION: DELEGATE to DEVO/CAIO/SCOUT through one unified pipeline
        const delegationTarget = resolveDelegationTarget(toolCall.name);
        if (delegationTarget) {
          const delegation = buildDelegation(delegationTarget, toolCall.arguments);
          this.emitDecisionPath(buildDelegationDecisionPath(delegation));

          this.sendEvent({
            type: 'agent_thinking',
            agent: 'chapo',
            status: buildDelegationThinkingStatus(delegation),
          });

          const [delegationResult, delegationErr] = await this.errorHandler.safe(
            `delegate:${delegation.target}:${this.iteration}`,
            () => runDelegationToAgent(this.getDelegationRunnerDeps(), delegation, 'chapo'),
          );

          if (delegationErr) {
            toolResults.push({
              toolUseId: toolCall.id,
              result: `${delegation.target.toUpperCase()} Fehler: ${this.errorHandler.formatForLLM(delegationErr)}`,
              isError: true,
            });
          } else {
            const envelope = this.buildVerificationEnvelope(delegation, delegationResult);
            this.sendEvent({
              type: 'tool_result',
              agent: 'chapo',
              toolName: toolCall.name,
              result: { delegated: true, agent: delegation.target, status: delegationResult.status },
              success: delegationResult.status === 'success' || delegationResult.status === 'partial',
            });
            toolResults.push({
              toolUseId: toolCall.id,
              result: envelope,
              isError: delegationResult.status === 'failed',
            });
          }
          continue;
        }

        // requestApproval — handle as user question
        if (toolCall.name === 'requestApproval') {
          const description = (toolCall.arguments.description as string) || 'Freigabe erforderlich';
          const riskLevel = ((toolCall.arguments.riskLevel as RiskLevel) || 'medium');
          earlyReturn = await this.queueApproval(description, riskLevel, this.iteration + 1);
          break;
        }

        // ACTION: TOOL — execute any regular tool
        this.emitDecisionPath({
          path: 'tool',
          reason: `Direkter Tool-Aufruf (${toolCall.name}) fuer verifizierbare Zwischenergebnisse.`,
          confidence: 0.76,
          unresolvedAssumptions: [],
        });
        this.sendEvent({
          type: 'tool_call',
          agent: 'chapo',
          toolName: toolCall.name,
          args: toolCall.arguments,
        });

        const [toolResult, toolErr] = await this.errorHandler.safe(
          `tool:${toolCall.name}:${this.iteration}`,
          () => executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
            agentName: 'chapo',
            onActionPending: (action) => {
              this.sendEvent({
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
          // Feed error back — CHAPO decides what to do
          this.sendEvent({
            type: 'tool_result',
            agent: 'chapo',
            toolName: toolCall.name,
            result: { error: toolErr.message },
            success: false,
          });
          toolResults.push({
            toolUseId: toolCall.id,
            result: `Error: ${toolErr.message}`,
            isError: true,
          });
        } else {
          const success = toolResult.success;
          const content = this.buildToolResultContent(toolResult);

          this.sendEvent({
            type: 'tool_result',
            agent: 'chapo',
            toolName: toolCall.name,
            result: toolResult.result,
            success,
          });
          this.markExternalActionToolSuccess(toolCall.name, success);

          // Track gathered files
          if (toolCall.name === 'fs_readFile' && success) {
            const path = toolCall.arguments.path as string;
            stateManager.addGatheredFile(this.sessionId, path);
          }

          toolResults.push({
            toolUseId: toolCall.id,
            result: content.content,
            isError: content.isError,
          });
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

      // Check inbox for new messages between iterations
      this.checkInbox();
    }

    // Loop exhaustion — check for unprocessed inbox messages
    const remaining = drainInbox(this.sessionId);
    if (remaining.length > 0) {
      const extras = remaining.map((m) => m.content).join('; ');
      return this.queueQuestion(
        `Ich habe mein Iterationslimit erreicht. Du hattest auch noch gefragt: "${extras}" — soll ich damit weitermachen?`,
        this.iteration,
      );
    }
    return this.queueQuestion(
      'Die Anfrage hat mehr Schritte benoetigt als erlaubt. Soll ich weitermachen?',
      this.iteration,
    );
  }

  private async queueQuestion(question: string, totalIterations: number): Promise<ChapoLoopResult> {
    const questionPayload: UserQuestion = {
      questionId: nanoid(),
      question,
      fromAgent: 'chapo',
      timestamp: new Date().toISOString(),
    };
    // State mutation + WS emission handled by projections via the event bus bridge:
    //   sendEvent → bridge → gate.question.queued → StateProjection + StreamProjection
    this.sendEvent({ type: 'user_question', question: questionPayload });

    return {
      answer: question,
      status: 'waiting_for_user',
      totalIterations,
      question,
    };
  }

  private async queueApproval(
    description: string,
    riskLevel: RiskLevel,
    totalIterations: number
  ): Promise<ChapoLoopResult> {
    const approval: ApprovalRequest = {
      approvalId: nanoid(),
      description,
      riskLevel,
      actions: [],
      fromAgent: 'chapo',
      timestamp: new Date().toISOString(),
    };
    // State mutation + WS emission handled by projections via the event bus bridge:
    //   sendEvent → bridge → gate.approval.queued → StateProjection + StreamProjection
    this.sendEvent({
      type: 'approval_request',
      request: approval,
      sessionId: this.sessionId,
    });

    return {
      answer: description,
      status: 'waiting_for_user',
      totalIterations,
      question: description,
    };
  }

  private async handleAnswer(userMessage: string, answer: string): Promise<ChapoLoopResult> {
    let finalAnswer = answer;
    let validationResult: ValidationResult | undefined;

    if (this.config.selfValidationEnabled && answer.length > 20) {
      const [validation] = await this.errorHandler.safe('validation', () =>
        this.validator.validate(userMessage, answer),
      );

      if (validation) {
        validationResult = validation;
        this.sessionLogger?.logAgentEvent({
          type: 'validation',
          confidence: validation.confidence,
          issues: validation.issues,
          isComplete: validation.isComplete,
        });

        if (!validation.isComplete && validation.confidence < 0.4 && validation.suggestion) {
          console.info('[chapo-loop] Self-validation flagged low confidence', {
            confidence: validation.confidence,
            issues: validation.issues,
          });
        }

        // Prevent known false-success claims (e.g. "email sent") from being returned
        // when validation already detected hallucination-like issues.
        if (this.shouldReplaceWithSafeFallback(validation, answer)) {
          finalAnswer = 'Ich konnte die Ausfuehrung nicht verlaesslich verifizieren. Es liegt kein bestaetigter Tool-Lauf fuer diese Aktion vor. Wenn du willst, fuehre ich den Schritt jetzt erneut mit nachvollziehbarer Tool-Ausfuehrung aus.';
          console.warn('[chapo-loop] Replacing unsafe final answer after failed validation', {
            confidence: validation.confidence,
            issues: validation.issues,
          });
        }
      }
    }

    finalAnswer = this.normalizeEmailDeliveryClaims(finalAnswer);
    const confidence = validationResult?.confidence ?? 0.8;
    const unresolvedAssumptions = this.extractAssumptionsFromAnswer(finalAnswer, validationResult);
    this.emitDecisionPath({
      path: 'answer',
      reason: 'Keine weiteren Tool-Calls notwendig; Antwort wurde direkt geliefert.',
      confidence,
      unresolvedAssumptions,
    });

    return {
      answer: finalAnswer,
      status: 'completed',
      totalIterations: this.iteration + 1,
    };
  }

  private shouldReplaceWithSafeFallback(validation: ValidationResult, answer: string): boolean {
    if (validation.isComplete || validation.confidence >= 0.4) {
      return false;
    }

    const issuesText = validation.issues.join(' ').toLowerCase();
    const answerText = answer.toLowerCase();

    const mentionsHallucination = /(halluz|halluc|falsch|faelsch|erfind|behauptet|invented)/.test(issuesText);
    if (!mentionsHallucination) {
      return false;
    }

    // Focus on side-effect claims where false positives are costly for users.
    const claimsExternalAction = /(e-?mail|email|gesendet|zugestellt|ticket|erstellt|verschoben|notification|benachrichtigung|scheduler)/.test(answerText);
    if (!claimsExternalAction) {
      return false;
    }

    return !this.hasMatchingActionEvidence(answerText);
  }

  private markExternalActionToolSuccess(toolName: string, success: boolean): void {
    if (success && EXTERNAL_ACTION_TOOLS.has(toolName)) {
      this.successfulExternalTools.add(toolName);
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

  private hasMatchingActionEvidence(answerText: string): boolean {
    if (/(e-?mail|email|mail|gesendet|zugestellt)/.test(answerText)) {
      if (this.successfulExternalTools.has('send_email')) {
        return true;
      }
    }

    if (/(taskforge|ticket|aufgabe|task|erstellt|verschoben|kommentar)/.test(answerText)) {
      for (const toolName of this.successfulExternalTools) {
        if (toolName.startsWith('taskforge_')) {
          return true;
        }
      }
    }

    if (/(scheduler|termin|kalender|reminder|erinnerung)/.test(answerText)) {
      if (
        this.successfulExternalTools.has('scheduler_create')
        || this.successfulExternalTools.has('scheduler_update')
        || this.successfulExternalTools.has('scheduler_delete')
        || this.successfulExternalTools.has('reminder_create')
      ) {
        return true;
      }
    }

    if (/(notification|benachrichtigung|notify)/.test(answerText)) {
      if (this.successfulExternalTools.has('notify_user')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Keep wording honest: `send_email` confirms provider acceptance, not guaranteed inbox placement.
   */
  private normalizeEmailDeliveryClaims(answer: string): string {
    if (!this.successfulExternalTools.has('send_email')) {
      return answer;
    }

    let normalized = answer;
    normalized = normalized.replace(
      /\bwurde erfolgreich(?:\s+\S+){0,4}\s+gesendet\b/gi,
      'wurde vom E-Mail-Provider zur Zustellung angenommen',
    );
    normalized = normalized.replace(
      /\bist jetzt unterwegs\b/gi,
      'ist beim Provider in der Zustellung',
    );
    return normalized;
  }

  private shouldConvertInlineClarificationToAsk(userMessage: string, answer: string): boolean {
    if (!this.isAmbiguousRequest(userMessage)) {
      return false;
    }
    return this.looksLikeClarification(answer);
  }

  private isAmbiguousRequest(userMessage: string): boolean {
    const normalized = userMessage.trim().toLowerCase().replace(/\s+/g, ' ');
    const normalizedNoPunctuation = normalized.replace(/[.!?]+$/g, '');
    if (!normalized || normalized.length > 120) {
      return false;
    }

    const explicitAmbiguousPhrases = new Set([
      'mach das besser',
      'mach es besser',
      'make it better',
      'fix it',
      'do it',
    ]);
    if (explicitAmbiguousPhrases.has(normalizedNoPunctuation)) {
      return true;
    }

    const hasVagueVerb = /\b(mach|mache|make|do|fix|improve|optimiere|optimize|update|aendere|change|verbesser|hilf|help)\b/.test(normalized);
    const hasAmbiguousObject = /\b(das|dies|dieses|es|it|this|that|something|anything|alles|everything)\b/.test(normalized);
    const wordCount = normalized.split(/\s+/).length;
    const hasSpecificAnchor = /[`'"]|\/|\\|\.[a-z0-9]{1,6}\b|\b(file|datei|funktion|function|component|api|endpoint|zeile|line|task|ticket)\b|\d/.test(normalized);

    return hasVagueVerb && hasAmbiguousObject && wordCount <= 10 && !hasSpecificAnchor;
  }

  private looksLikeClarification(answer: string): boolean {
    const normalized = answer.trim().toLowerCase();
    if (!normalized || !normalized.includes('?')) {
      return false;
    }

    const extracted = this.extractClarificationQuestion(answer).toLowerCase();
    if (!extracted.endsWith('?')) {
      return false;
    }

    const clarificationCue = /\b(was|welche|welches|wie|meinst du|genau|konkret|kannst du|koenntest du|moechtest du|soll ich|what|which|can you|could you|clarify|specify|details?)\b/;
    if (clarificationCue.test(extracted)) {
      return true;
    }

    return extracted.length > 0 && extracted.length <= 220;
  }

  private extractClarificationQuestion(answer: string): string {
    const trimmed = answer.trim();
    if (!trimmed) {
      return 'Kannst du genauer sagen, was ich verbessern soll?';
    }

    const firstQuestion = trimmed.match(/([^\n?]{6,220}\?)/);
    if (firstQuestion?.[1]) {
      return firstQuestion[1].trim().replace(/^[*-]\s*/, '');
    }

    const firstLine = trimmed
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (firstLine && firstLine.endsWith('?')) {
      return firstLine.replace(/^[*-]\s*/, '');
    }

    return 'Kannst du genauer sagen, was ich verbessern soll?';
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
