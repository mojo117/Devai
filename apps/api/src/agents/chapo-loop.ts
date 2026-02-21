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
import { getAgent, getToolsForAgent, spawnScout } from './router.js';
import { getToolsForLLM } from '../tools/registry.js';
import * as stateManager from './stateManager.js';
import type {
  AgentStreamEvent,
  ModelSelection,
  ChapoLoopResult,
  DelegationDomain,
  ScoutScope,
  UserQuestion,
  ApprovalRequest,
  RiskLevel,
  ValidationResult,
  LoopDelegationResult,
  LoopDelegationStatus,
  ToolEvidence,
  ScoutFindings,
} from './types.js';
import type { LLMMessage, LLMProvider } from '../llm/types.js';

export type SendEventFn = (event: AgentStreamEvent) => void;

interface ChapoLoopConfig {
  selfValidationEnabled: boolean;
  maxIterations: number;
}

type ParallelAgent = 'devo' | 'caio' | 'scout';

interface ParallelDelegation {
  target: ParallelAgent;
  domain: DelegationDomain;
  objective: string;
  context?: string;
  contextFacts: string[];
  constraints: string[];
  expectedOutcome?: string;
  scope?: ScoutScope;
}

interface ToolPreflightResult {
  ok: boolean;
  error?: string;
}

interface NormalizedToolOutcome {
  success: boolean;
  pendingApproval: boolean;
  data?: unknown;
  error?: string;
}

interface CaioEvidence {
  tool: string;
  success: boolean;
  pendingApproval?: boolean;
  externalId?: string;
  summary: string;
  error?: string;
  nextStep?: string;
  timestamp: string;
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
  private iteration = 0;
  private successfulExternalTools = new Set<string>();
  private toolDirectiveRegex: RegExp | null = null;
  private originalUserMessage = '';

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

    if (failures.length === 0 && successes.length > 0) return 'success';
    if (successes.length > 0 && failures.length > 0) return 'partial';
    if (failures.length > 0 && successes.length === 0) return 'failed';
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

  async run(userMessage: string, conversationHistory: Array<{ role: string; content: string }>): Promise<ChapoLoopResult> {
    this.originalUserMessage = userMessage;

    // 1. Warm system context
    await warmSystemContextForSession(this.sessionId, this.projectRoot, userMessage);
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
      if (msg.role === 'user' || msg.role === 'assistant') {
        this.conversation.addMessage({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    // 4. Add user message
    this.conversation.addMessage({ role: 'user', content: userMessage });

    // 5. Emit start event — StateProjection handles setPhase + setActiveAgent
    this.sendEvent({ type: 'agent_start', agent: 'chapo', phase: 'execution' });

    // 6. Enter runLoop
    const result = await this.runLoop(userMessage);

    // 7. Emit completion
    this.sendEvent({ type: 'agent_complete', agent: 'chapo', result: result.answer });
    this.sendEvent({
      type: 'agent_history',
      entries: stateManager.getHistory(this.sessionId),
    });

    return result;
  }

  private async runLoop(userMessage: string): Promise<ChapoLoopResult> {
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
        if (this.shouldConvertInlineClarificationToAsk(userMessage, answer)) {
          return this.queueQuestion(
            this.extractClarificationQuestion(answer),
            this.iteration + 1,
          );
        }
        return this.handleAnswer(userMessage, answer);
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

        // ACTION: DELEGATE to DEVO
        if (toolCall.name === 'delegateToKoda' || toolCall.name === 'delegateToDevo') {
          const delegation = this.buildDelegation('devo', toolCall.arguments);

          this.sendEvent({
            type: 'agent_thinking',
            agent: 'chapo',
            status: `Delegiere an DEVO (${delegation.domain}): ${delegation.objective.slice(0, 60)}...`,
          });

          const [devoResult, devoErr] = await this.errorHandler.safe(
            `delegate:devo:${this.iteration}`,
            () => this.delegateToDevo(delegation),
          );

          if (devoErr) {
            toolResults.push({
              toolUseId: toolCall.id,
              result: `DEVO Fehler: ${this.errorHandler.formatForLLM(devoErr)}`,
              isError: true,
            });
          } else {
            this.sendEvent({
              type: 'tool_result',
              agent: 'chapo',
              toolName: toolCall.name,
              result: { delegated: true, agent: 'devo' },
              success: true,
            });
            toolResults.push({
              toolUseId: toolCall.id,
              result: devoResult || 'DEVO hat die Aufgabe ausgefuehrt.',
              isError: false,
            });
          }
          continue;
        }

        // ACTION: DELEGATE to CAIO
        if (toolCall.name === 'delegateToCaio') {
          const delegation = this.buildDelegation('caio', toolCall.arguments);

          this.sendEvent({
            type: 'agent_thinking',
            agent: 'chapo',
            status: `Delegiere an CAIO (${delegation.domain}): ${delegation.objective.slice(0, 60)}...`,
          });

          const [caioResult, caioErr] = await this.errorHandler.safe(
            `delegate:caio:${this.iteration}`,
            () => this.delegateToCaio(delegation),
          );

          if (caioErr) {
            toolResults.push({
              toolUseId: toolCall.id,
              result: `CAIO Fehler: ${this.errorHandler.formatForLLM(caioErr)}`,
              isError: true,
            });
          } else {
            this.sendEvent({
              type: 'tool_result',
              agent: 'chapo',
              toolName: toolCall.name,
              result: { delegated: true, agent: 'caio' },
              success: true,
            });
            toolResults.push({
              toolUseId: toolCall.id,
              result: caioResult || 'CAIO hat die Aufgabe ausgefuehrt.',
              isError: false,
            });
          }
          continue;
        }

        // ACTION: DELEGATE in parallel to multiple agents
        if (toolCall.name === 'delegateParallel') {
          const delegations = this.parseParallelDelegations(toolCall.arguments.delegations);
          if (delegations.length === 0) {
            toolResults.push({
              toolUseId: toolCall.id,
              result: 'Error: delegateParallel benoetigt mindestens eine gueltige Delegation.',
              isError: true,
            });
            continue;
          }

          this.sendEvent({
            type: 'agent_thinking',
            agent: 'chapo',
            status: `Delegiere parallel (${delegations.length} Aufgaben)...`,
          });

          const [parallelSummary, parallelErr] = await this.errorHandler.safe(
            `delegate:parallel:${this.iteration}`,
            () => this.delegateParallel(delegations),
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

        // ACTION: DELEGATE to SCOUT
        if (toolCall.name === 'delegateToScout') {
          const delegation = this.buildDelegation('scout', toolCall.arguments);
          const scope = delegation.scope || 'both';

          this.sendEvent({
            type: 'agent_thinking',
            agent: 'chapo',
            status: `Spawne SCOUT (${delegation.domain}) fuer: ${delegation.objective.slice(0, 60)}...`,
          });
          this.sendEvent({
            type: 'delegation',
            from: 'chapo',
            to: 'scout',
            task: delegation.objective,
            domain: delegation.domain,
            objective: delegation.objective,
            constraints: delegation.constraints,
            expectedOutcome: delegation.expectedOutcome,
          });

          const [scoutResult, scoutErr] = await this.errorHandler.safe(
            `delegate:scout:${this.iteration}`,
            () => spawnScout(this.sessionId, delegation.objective, {
              scope,
              context: this.formatDelegationContext(delegation),
              sendEvent: this.sendEvent,
            }),
          );

          if (scoutErr) {
            toolResults.push({
              toolUseId: toolCall.id,
              result: `SCOUT Fehler: ${this.errorHandler.formatForLLM(scoutErr)}`,
              isError: true,
            });
          } else {
            this.sendEvent({
              type: 'tool_result',
              agent: 'chapo',
              toolName: toolCall.name,
              result: scoutResult,
              success: true,
            });
            toolResults.push({
              toolUseId: toolCall.id,
              result: JSON.stringify(scoutResult, null, 2),
              isError: false,
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
    }

    // Loop exhaustion — ask user
    return this.queueQuestion(
      'Die Anfrage hat mehr Schritte benoetigt als erlaubt. Soll ich weitermachen?',
      this.iteration
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

    if (this.config.selfValidationEnabled && answer.length > 20) {
      const [validation] = await this.errorHandler.safe('validation', () =>
        this.validator.validate(userMessage, answer),
      );

      if (validation) {
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

  /**
   * DELEGATE to DEVO: Run a sub-loop with DEVO agent for code/devops tasks.
   */
  private async delegateToDevo(delegation: ParallelDelegation): Promise<string> {
    const devo = getAgent('devo');
    const provider = (this.modelSelection.provider || 'anthropic') as LLMProvider;
    const devoToolNames = getToolsForAgent('devo');
    const tools = getToolsForLLM().filter((t) => devoToolNames.includes(t.name));
    const systemContextBlock = getCombinedSystemContextBlock(this.sessionId);
    const delegationContext = this.formatDelegationContext(delegation);

    // StateProjection handles setActiveAgent via agent.switched event
    this.sendEvent({
      type: 'agent_switch',
      from: 'chapo',
      to: 'devo',
      reason: `Delegiere (${delegation.domain}): ${delegation.objective.slice(0, 80)}`,
    });
    this.sendEvent({
      type: 'delegation',
      from: 'chapo',
      to: 'devo',
      task: delegation.objective,
      domain: delegation.domain,
      objective: delegation.objective,
      constraints: delegation.constraints,
      expectedOutcome: delegation.expectedOutcome,
    });

    const systemPrompt = `${devo.systemPrompt}
${systemContextBlock}
${this.projectRoot ? `Working Directory: ${this.projectRoot}` : ''}
${delegationContext ? `\nDELEGATIONSKONTEXT VON CHAPO:\n${delegationContext}` : ''}

AUFGABE: ${delegation.objective}

Führe die Aufgabe aus. Bei Problemen nutze escalateToChapo().`;

    const messages: LLMMessage[] = [
      { role: 'user', content: delegation.objective },
    ];

    let turn = 0;
    const MAX_TURNS = 10;
    let finalContent = '';

    while (turn < MAX_TURNS) {
      turn++;
      this.sendEvent({ type: 'agent_thinking', agent: 'devo', status: `Turn ${turn}...` });

      const response = await llmRouter.generateWithFallback(provider, {
        model: devo.model,
        messages,
        systemPrompt,
        tools,
        toolsEnabled: true,
      });

      if (response.content) {
        finalContent = response.content;
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      messages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      });

      const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];

      for (const toolCall of response.toolCalls) {
        // Handle escalation back to CHAPO
        if (toolCall.name === 'escalateToChapo') {
          const desc = (toolCall.arguments.description as string) || 'Unknown issue';
          toolResults.push({
            toolUseId: toolCall.id,
            result: `Eskalation wird von CHAPO verarbeitet: ${desc}`,
            isError: false,
          });
          this.sendEvent({
            type: 'agent_switch',
            from: 'devo',
            to: 'chapo',
            reason: 'DEVO eskaliert an CHAPO',
          });
          this.sendEvent({ type: 'agent_complete', agent: 'devo', result: `DEVO eskaliert: ${desc}` });
          return `DEVO eskaliert: ${desc}\n\nBisheriges Ergebnis:\n${finalContent}`;
        }

        // Handle scout delegation from DEVO
        if (toolCall.name === 'delegateToScout') {
          const query = toolCall.arguments.query as string;
          const scope = (toolCall.arguments.scope as ScoutScope) || 'both';
          const scoutContext = toolCall.arguments.context as string | undefined;

          try {
            const scoutResult = await spawnScout(this.sessionId, query, {
              scope,
              context: scoutContext,
              sendEvent: this.sendEvent,
            });
            toolResults.push({
              toolUseId: toolCall.id,
              result: JSON.stringify(scoutResult, null, 2),
              isError: false,
            });
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : 'SCOUT spawn failed';
            toolResults.push({
              toolUseId: toolCall.id,
              result: `Error: ${errMsg}`,
              isError: true,
            });
          }
          continue;
        }

        this.sendEvent({
          type: 'tool_call',
          agent: 'devo',
          toolName: toolCall.name,
          args: toolCall.arguments,
        });

        const startTime = Date.now();
        const [result, toolErr] = await this.errorHandler.safe(
          `devo-tool:${toolCall.name}:${turn}`,
          () => executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
            agentName: 'devo',
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
        const duration = Date.now() - startTime;

        if (toolErr) {
          this.sendEvent({
            type: 'tool_result',
            agent: 'devo',
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
          this.sendEvent({
            type: 'tool_result',
            agent: 'devo',
            toolName: toolCall.name,
            result: result.result,
            success: result.success,
          });

          const content = this.buildToolResultContent(result);
          toolResults.push({
            toolUseId: toolCall.id,
            result: content.content,
            isError: content.isError,
          });
        }
      }

      messages.push({
        role: 'user',
        content: '',
        toolResults,
      });
    }

    // Switch back to CHAPO — StateProjection handles setActiveAgent
    this.sendEvent({
      type: 'agent_switch',
      from: 'devo',
      to: 'chapo',
      reason: 'DEVO Delegation abgeschlossen',
    });
    this.sendEvent({ type: 'agent_complete', agent: 'devo', result: finalContent });

    return finalContent;
  }

  /**
   * DELEGATE to CAIO: Run a sub-loop with CAIO for communication/admin tasks.
   */
  private async delegateToCaio(delegation: ParallelDelegation): Promise<string> {
    const caio = getAgent('caio');
    const provider = (this.modelSelection.provider || 'anthropic') as LLMProvider;
    const caioToolNames = getToolsForAgent('caio');
    const tools = getToolsForLLM().filter((t) => caioToolNames.includes(t.name));
    const systemContextBlock = getCombinedSystemContextBlock(this.sessionId);
    const delegationContext = this.formatDelegationContext(delegation);

    this.sendEvent({
      type: 'agent_switch',
      from: 'chapo',
      to: 'caio',
      reason: `Delegiere (${delegation.domain}): ${delegation.objective.slice(0, 80)}`,
    });
    this.sendEvent({
      type: 'delegation',
      from: 'chapo',
      to: 'caio',
      task: delegation.objective,
      domain: delegation.domain,
      objective: delegation.objective,
      constraints: delegation.constraints,
      expectedOutcome: delegation.expectedOutcome,
    });

    const systemPrompt = `${caio.systemPrompt}
${systemContextBlock}
${delegationContext ? `\nDELEGATIONSKONTEXT VON CHAPO:\n${delegationContext}` : ''}

AUFGABE: ${delegation.objective}

Fuehre die Aufgabe aus. Bei Problemen nutze escalateToChapo().`;

    const messages: LLMMessage[] = [
      { role: 'user', content: delegation.objective },
    ];

    let turn = 0;
    const MAX_TURNS = 10;
    let finalContent = '';
    const evidenceLog: CaioEvidence[] = [];

    while (turn < MAX_TURNS) {
      turn++;
      this.sendEvent({ type: 'agent_thinking', agent: 'caio', status: `Turn ${turn}...` });

      const response = await llmRouter.generateWithFallback(provider, {
        model: caio.model,
        messages,
        systemPrompt,
        tools,
        toolsEnabled: true,
      });

      if (response.content) {
        finalContent = response.content;
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      console.info('[caio-loop] Tool calls received', {
        turn,
        names: response.toolCalls.map((t) => t.name),
        sessionId: this.sessionId,
      });

      messages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      });

      const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];

      for (const toolCall of response.toolCalls) {
        if (toolCall.name === 'escalateToChapo') {
          const desc = (toolCall.arguments.description as string) || 'Unknown issue';
          toolResults.push({
            toolUseId: toolCall.id,
            result: `Eskalation wird von CHAPO verarbeitet: ${desc}`,
            isError: false,
          });
          this.sendEvent({
            type: 'agent_switch',
            from: 'caio',
            to: 'chapo',
            reason: 'CAIO eskaliert an CHAPO',
          });
          this.sendEvent({ type: 'agent_complete', agent: 'caio', result: `CAIO eskaliert: ${desc}` });
          return `CAIO eskaliert: ${desc}\n\nBisheriges Ergebnis:\n${finalContent}`;
        }

        if (toolCall.name === 'delegateToScout') {
          const query = toolCall.arguments.query as string;
          const scope = (toolCall.arguments.scope as ScoutScope) || 'both';
          const scoutContext = toolCall.arguments.context as string | undefined;

          try {
            const scoutResult = await spawnScout(this.sessionId, query, {
              scope,
              context: scoutContext,
              sendEvent: this.sendEvent,
            });
            toolResults.push({
              toolUseId: toolCall.id,
              result: JSON.stringify(scoutResult, null, 2),
              isError: false,
            });
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : 'SCOUT spawn failed';
            toolResults.push({
              toolUseId: toolCall.id,
              result: `Error: ${errMsg}`,
              isError: true,
            });
          }
          continue;
        }

        const preflight = this.preflightCaioToolCall(toolCall.name, toolCall.arguments);
        if (!preflight.ok) {
          const evidence = this.buildCaioEvidence(toolCall.name, {
            success: false,
            pendingApproval: false,
            error: preflight.error || 'Preflight validation failed',
          });
          evidenceLog.push(evidence);

          this.sendEvent({
            type: 'tool_result',
            agent: 'caio',
            toolName: toolCall.name,
            result: evidence,
            success: false,
          });
          toolResults.push({
            toolUseId: toolCall.id,
            result: JSON.stringify(evidence),
            isError: true,
          });
          continue;
        }

        this.sendEvent({
          type: 'tool_call',
          agent: 'caio',
          toolName: toolCall.name,
          args: toolCall.arguments,
        });

        const [result, toolErr] = await this.errorHandler.safe(
          `caio-tool:${toolCall.name}:${turn}`,
          () => executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
            agentName: 'caio',
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
          const evidence = this.buildCaioEvidence(toolCall.name, {
            success: false,
            pendingApproval: false,
            error: toolErr.message,
          });
          evidenceLog.push(evidence);

          this.sendEvent({
            type: 'tool_result',
            agent: 'caio',
            toolName: toolCall.name,
            result: evidence,
            success: false,
          });
          toolResults.push({
            toolUseId: toolCall.id,
            result: JSON.stringify(evidence),
            isError: true,
          });
        } else {
          const normalized = this.normalizeToolOutcome(result);
          const evidence = this.buildCaioEvidence(toolCall.name, normalized);
          evidenceLog.push(evidence);

          this.sendEvent({
            type: 'tool_result',
            agent: 'caio',
            toolName: toolCall.name,
            result: evidence,
            success: normalized.success,
          });
          this.markExternalActionToolSuccess(toolCall.name, normalized.success);

          toolResults.push({
            toolUseId: toolCall.id,
            result: JSON.stringify(evidence),
            isError: !normalized.success,
          });
        }
      }

      messages.push({
        role: 'user',
        content: '',
        toolResults,
      });
    }

    finalContent = this.applyCaioEvidenceSummary(finalContent, evidenceLog);

    this.sendEvent({
      type: 'agent_switch',
      from: 'caio',
      to: 'chapo',
      reason: 'CAIO Delegation abgeschlossen',
    });
    this.sendEvent({ type: 'agent_complete', agent: 'caio', result: finalContent });

    return finalContent;
  }

  private preflightCaioToolCall(toolName: string, args: Record<string, unknown>): ToolPreflightResult {
    const missing: string[] = [];
    const requireString = (field: string) => {
      if (!this.isNonEmptyString(args[field])) {
        missing.push(field);
      }
    };

    switch (toolName) {
      case 'send_email': {
        requireString('to');
        requireString('subject');
        requireString('body');
        if (this.isNonEmptyString(args.to) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.to.trim())) {
          return { ok: false, error: 'Preflight fehlgeschlagen: "to" ist keine gueltige E-Mail-Adresse.' };
        }
        break;
      }
      case 'taskforge_create_task':
        requireString('title');
        requireString('description');
        break;
      case 'taskforge_move_task':
        requireString('taskId');
        requireString('newStatus');
        break;
      case 'taskforge_add_comment':
        requireString('taskId');
        requireString('comment');
        break;
      case 'scheduler_create':
        requireString('name');
        requireString('cronExpression');
        requireString('instruction');
        break;
      case 'scheduler_update': {
        requireString('id');
        const hasUpdatePayload = this.isNonEmptyString(args.name)
          || this.isNonEmptyString(args.cronExpression)
          || this.isNonEmptyString(args.instruction)
          || args.notificationChannel !== undefined
          || typeof args.enabled === 'boolean';
        if (!hasUpdatePayload) {
          return { ok: false, error: 'Preflight fehlgeschlagen: scheduler_update benoetigt mindestens ein Update-Feld.' };
        }
        break;
      }
      case 'scheduler_delete':
        requireString('id');
        break;
      case 'reminder_create': {
        requireString('message');
        requireString('datetime');
        if (this.isNonEmptyString(args.datetime) && Number.isNaN(Date.parse(args.datetime))) {
          return { ok: false, error: 'Preflight fehlgeschlagen: "datetime" ist kein gueltiges Datum.' };
        }
        break;
      }
      case 'notify_user':
        requireString('message');
        break;
      default:
        return { ok: true };
    }

    if (missing.length > 0) {
      return {
        ok: false,
        error: `Preflight fehlgeschlagen fuer ${toolName}. Fehlende Pflichtfelder: ${missing.join(', ')}.`,
      };
    }

    return { ok: true };
  }

  private normalizeToolOutcome(result: {
    success: boolean;
    result?: unknown;
    error?: string;
    pendingApproval?: boolean;
  }): NormalizedToolOutcome {
    if (result.pendingApproval) {
      return {
        success: false,
        pendingApproval: true,
        data: result.result,
        error: result.error || 'Aktion wartet auf Freigabe.',
      };
    }

    if (!result.success) {
      return {
        success: false,
        pendingApproval: false,
        error: result.error || 'Tool-Ausfuehrung fehlgeschlagen.',
      };
    }

    const payload = this.asRecord(result.result);
    if (payload && typeof payload.success === 'boolean') {
      if (!payload.success) {
        return {
          success: false,
          pendingApproval: false,
          data: payload.result,
          error: this.isNonEmptyString(payload.error) ? payload.error : 'Tool lieferte kein erfolgreiches Ergebnis.',
        };
      }

      return {
        success: true,
        pendingApproval: false,
        data: payload.result !== undefined ? payload.result : payload,
      };
    }

    return {
      success: true,
      pendingApproval: false,
      data: result.result,
    };
  }

  private buildCaioEvidence(toolName: string, outcome: NormalizedToolOutcome): CaioEvidence {
    const externalId = this.extractExternalId(outcome.data);
    const summary = outcome.success
      ? this.summarizeEvidenceData(outcome.data, `${toolName} erfolgreich ausgefuehrt.`)
      : (outcome.pendingApproval
        ? 'Aktion wartet auf Freigabe und wurde noch nicht final ausgefuehrt.'
        : this.summarizeEvidenceData(outcome.data, outcome.error || `${toolName} fehlgeschlagen.`));

    return {
      tool: toolName,
      success: outcome.success,
      pendingApproval: outcome.pendingApproval ? true : undefined,
      externalId,
      summary,
      error: !outcome.success && outcome.error ? outcome.error : undefined,
      nextStep: outcome.success
        ? undefined
        : (outcome.pendingApproval
          ? 'Freigabe abwarten und danach den Schritt fortsetzen.'
          : 'Fehlende Infos nachfragen oder bei Blockade an CHAPO eskalieren.'),
      timestamp: new Date().toISOString(),
    };
  }

  private applyCaioEvidenceSummary(finalContent: string, evidenceLog: CaioEvidence[]): string {
    if (evidenceLog.length === 0) {
      return finalContent;
    }

    if (finalContent.includes('Ausfuehrungsnachweis (CAIO):')) {
      return finalContent;
    }

    const lines = evidenceLog.slice(-8).map((entry) => {
      const status = entry.success ? '[OK]' : (entry.pendingApproval ? '[PENDING]' : '[ERROR]');
      const idPart = entry.externalId ? ` id=${entry.externalId}` : '';
      const detail = entry.error ? ` (${entry.error})` : '';
      return `- ${status} ${entry.tool}${idPart}: ${entry.summary}${detail}`;
    });

    const summaryBlock = `Ausfuehrungsnachweis (CAIO):\n${lines.join('\n')}`;
    const base = finalContent.trim();
    return base ? `${base}\n\n${summaryBlock}` : summaryBlock;
  }

  private extractExternalId(data: unknown): string | undefined {
    const record = this.asRecord(data);
    if (!record) return undefined;

    const candidateKeys = ['id', 'taskId', 'approvalId', 'actionId', 'runId', 'executionId'];
    for (const key of candidateKeys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    const nested = this.asRecord(record.result);
    if (nested) {
      for (const key of candidateKeys) {
        const value = nested[key];
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
    }

    return undefined;
  }

  private summarizeEvidenceData(data: unknown, fallback: string): string {
    if (typeof data === 'string' && data.trim().length > 0) {
      return data.trim();
    }

    const record = this.asRecord(data);
    if (record) {
      const preferred = ['message', 'summary', 'status', 'content'];
      for (const key of preferred) {
        const value = record[key];
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }

      const nested = this.asRecord(record.result);
      if (nested) {
        for (const key of preferred) {
          const value = nested[key];
          if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
          }
        }
      }

      try {
        const serialized = JSON.stringify(record);
        if (serialized.length > 0) {
          return serialized.length > 240 ? `${serialized.slice(0, 240)}...` : serialized;
        }
      } catch {
        // Ignore serialization issues and fall through to fallback.
      }
    }

    return fallback;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private parseParallelDelegations(raw: unknown): ParallelDelegation[] {
    if (!Array.isArray(raw)) return [];
    const parsed: ParallelDelegation[] = [];

    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const candidate = entry as Record<string, unknown>;
      const target = candidate.agent;

      if (target !== 'devo' && target !== 'caio' && target !== 'scout') {
        continue;
      }

      parsed.push(this.buildDelegation(target, candidate));
    }

    return parsed.filter((item) => item.objective.trim().length > 0);
  }

  private async delegateParallel(delegations: ParallelDelegation[]): Promise<string> {
    const jobs = delegations.map(async (delegation) => {
      try {
        if (delegation.target === 'devo') {
          const result = await this.delegateToDevo(delegation);
          return { ...delegation, success: true as const, result };
        }
        if (delegation.target === 'caio') {
          const result = await this.delegateToCaio(delegation);
          return { ...delegation, success: true as const, result };
        }

        const scoutResult = await spawnScout(this.sessionId, delegation.objective, {
          scope: delegation.scope || 'both',
          context: this.formatDelegationContext(delegation),
          sendEvent: this.sendEvent,
        });
        return { ...delegation, success: true as const, result: JSON.stringify(scoutResult, null, 2) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ...delegation, success: false as const, error: message };
      }
    });

    const settled = await Promise.allSettled(jobs);
    const results = settled.map((entry, index) => {
      if (entry.status === 'fulfilled') return entry.value;
      return {
        ...delegations[index],
        success: false as const,
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
        const content = (result.result || '').toString();
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

    return lines.join('\n');
  }

  private buildDelegation(target: ParallelAgent, args: Record<string, unknown>): ParallelDelegation {
    const defaultDomain = this.defaultDomainForAgent(target);
    const domain = this.normalizeDelegationDomain(args.domain, defaultDomain);
    const objectiveRaw = this.readFirstString(args, ['objective', 'task', 'query']) || 'Aufgabe ausfuehren';
    const objective = this.sanitizeDelegationText(objectiveRaw);
    const contextFacts = this.readStringArray(args.contextFacts).map((item) => this.sanitizeDelegationText(item));
    const context = this.normalizeDelegationContext(args.context);
    const constraints = this.readStringArray(args.constraints).map((item) => this.sanitizeDelegationText(item));
    const expectedOutcome = this.readFirstString(args, ['expectedOutcome']) || undefined;
    const scopeRaw = this.readFirstString(args, ['scope']);
    const scope: ScoutScope | undefined =
      scopeRaw === 'codebase' || scopeRaw === 'web' || scopeRaw === 'both'
        ? scopeRaw
        : undefined;

    return {
      target,
      domain,
      objective,
      context,
      contextFacts,
      constraints,
      expectedOutcome,
      scope,
    };
  }

  private defaultDomainForAgent(target: ParallelAgent): DelegationDomain {
    if (target === 'devo') return 'development';
    if (target === 'caio') return 'communication';
    return 'research';
  }

  private normalizeDelegationDomain(value: unknown, fallback: DelegationDomain): DelegationDomain {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'development' || normalized === 'communication' || normalized === 'research') {
      return normalized;
    }
    return fallback;
  }

  private readFirstString(source: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }

  private readStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
  }

  private normalizeDelegationContext(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const sanitized = this.sanitizeDelegationText(value.trim());
      return sanitized.length > 0 ? sanitized : undefined;
    }
    if (value && typeof value === 'object') {
      try {
        return this.sanitizeDelegationText(JSON.stringify(value, null, 2));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private getToolDirectiveRegex(): RegExp | null {
    if (this.toolDirectiveRegex) return this.toolDirectiveRegex;
    const toolNames = getToolsForLLM()
      .map((tool) => tool.name)
      .filter((name) => !name.startsWith('delegate') && name !== 'askUser' && name !== 'requestApproval')
      .sort((a, b) => b.length - a.length);

    if (toolNames.length === 0) return null;

    const escaped = toolNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    this.toolDirectiveRegex = new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
    return this.toolDirectiveRegex;
  }

  private sanitizeDelegationText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return trimmed;
    const regex = this.getToolDirectiveRegex();
    if (!regex) return trimmed;
    return trimmed.replace(regex, 'passendes Tool');
  }

  private formatDelegationContext(delegation: ParallelDelegation): string | undefined {
    const lines: string[] = [
      `Domain: ${delegation.domain}`,
      `Objective: ${delegation.objective}`,
    ];
    if (delegation.expectedOutcome) {
      lines.push(`Expected Outcome: ${delegation.expectedOutcome}`);
    }
    if (delegation.contextFacts.length > 0) {
      lines.push(`Context Facts: ${delegation.contextFacts.join('; ')}`);
    }
    if (delegation.constraints.length > 0) {
      lines.push(`Constraints: ${delegation.constraints.join('; ')}`);
    }
    if (delegation.context) {
      lines.push(`Context: ${delegation.context}`);
    }
    lines.push('Waehle die konkreten Tools innerhalb deiner Domaene selbst.');
    return lines.join('\n');
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
