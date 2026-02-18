/**
 * ChapoLoop — CHAPO Decision Loop
 *
 * A continuous loop where the LLM's tool_calls ARE the decisions:
 *   - No tool_calls = ANSWER → self-validate → respond → exit
 *   - askUser = ASK → pause loop → wait for user reply
 *   - delegateToDevo = DELEGATE → run DEVO sub-loop → feed result back
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
import { SessionLogger } from '../audit/sessionLogger.js';
import { getAgent, getToolsForAgent, canAgentUseTool, spawnScout } from './router.js';
import { getToolsForLLM } from '../tools/registry.js';
import * as stateManager from './stateManager.js';
import type {
  AgentStreamEvent,
  ModelSelection,
  ChapoLoopResult,
  ScoutScope,
  UserQuestion,
  ApprovalRequest,
  RiskLevel,
} from './types.js';
import type { LLMMessage, LLMProvider } from '../llm/types.js';

export type SendEventFn = (event: AgentStreamEvent) => void;

interface ChapoLoopConfig {
  selfValidationEnabled: boolean;
  maxIterations: number;
}

export class ChapoLoop {
  private errorHandler: AgentErrorHandler;
  private validator: SelfValidator;
  private conversation: ConversationManager;
  private sessionLogger?: SessionLogger;
  private iteration = 0;

  constructor(
    private sessionId: string,
    private sendEvent: SendEventFn,
    private projectRoot: string | null,
    private modelSelection: ModelSelection,
    private config: ChapoLoopConfig,
  ) {
    this.errorHandler = new AgentErrorHandler(3);
    this.validator = new SelfValidator(modelSelection.provider as LLMProvider);
    this.conversation = new ConversationManager(120_000);
    this.sessionLogger = SessionLogger.getActive(sessionId);
  }

  async run(userMessage: string, conversationHistory: Array<{ role: string; content: string }>): Promise<ChapoLoopResult> {
    // 1. Warm system context
    await warmSystemContextForSession(this.sessionId, this.projectRoot);
    const systemContextBlock = getCombinedSystemContextBlock(this.sessionId);

    // 2. Set system prompt on conversation manager
    const chapo = getAgent('chapo');
    const systemPrompt = `${chapo.systemPrompt}
${systemContextBlock}
${this.projectRoot ? `Working Directory: ${this.projectRoot}` : ''}

Du bist CHAPO im Decision Loop. Fuehre Aufgaben DIREKT aus:
- Nutze Tools um Dateien zu lesen, Code zu suchen, Git-Status zu pruefen
- Delegiere an DEVO fuer Code-Aenderungen und DevOps-Aufgaben
- Delegiere an SCOUT fuer Web-Recherche oder tiefe Codebase-Exploration
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

    // 5. Emit start event
    stateManager.setPhase(this.sessionId, 'execution');
    stateManager.setActiveAgent(this.sessionId, 'chapo');
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
          const task = (toolCall.arguments.task as string) || 'Aufgabe ausfuehren';
          const context = toolCall.arguments.context as string | undefined;

          this.sendEvent({
            type: 'agent_thinking',
            agent: 'chapo',
            status: `Delegiere an DEVO: ${task.slice(0, 60)}...`,
          });

          const [devoResult, devoErr] = await this.errorHandler.safe(
            `delegate:devo:${this.iteration}`,
            () => this.delegateToDevo(task, context),
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

        // ACTION: DELEGATE to SCOUT
        if (toolCall.name === 'delegateToScout') {
          const query = toolCall.arguments.query as string;
          const scope = (toolCall.arguments.scope as ScoutScope) || 'both';
          const context = toolCall.arguments.context as string | undefined;

          this.sendEvent({
            type: 'agent_thinking',
            agent: 'chapo',
            status: `Spawne SCOUT für: ${query.slice(0, 60)}...`,
          });

          const [scoutResult, scoutErr] = await this.errorHandler.safe(
            `delegate:scout:${this.iteration}`,
            () => spawnScout(this.sessionId, query, { scope, context, sendEvent: this.sendEvent }),
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
    stateManager.addPendingQuestion(this.sessionId, questionPayload);
    stateManager.setPhase(this.sessionId, 'waiting_user');
    await stateManager.flushState(this.sessionId);
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
    stateManager.addPendingApproval(this.sessionId, approval);
    stateManager.setPhase(this.sessionId, 'waiting_user');
    await stateManager.flushState(this.sessionId);
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
      }
      // Advisory only — always deliver the answer
    }

    return {
      answer,
      status: 'completed',
      totalIterations: this.iteration + 1,
    };
  }

  /**
   * DELEGATE to DEVO: Run a sub-loop with DEVO agent for code/devops tasks.
   */
  private async delegateToDevo(task: string, context?: string): Promise<string> {
    const devo = getAgent('devo');
    const devoToolNames = getToolsForAgent('devo');
    const tools = getToolsForLLM().filter((t) => devoToolNames.includes(t.name));
    const systemContextBlock = getCombinedSystemContextBlock(this.sessionId);

    stateManager.setActiveAgent(this.sessionId, 'devo');
    this.sendEvent({
      type: 'agent_switch',
      from: 'chapo',
      to: 'devo',
      reason: `Delegiere: ${task.slice(0, 80)}`,
    });
    this.sendEvent({ type: 'delegation', from: 'chapo', to: 'devo', task });

    const systemPrompt = `${devo.systemPrompt}
${systemContextBlock}
${this.projectRoot ? `Working Directory: ${this.projectRoot}` : ''}
${context ? `\nKONTEXT VON CHAPO:\n${context}` : ''}

AUFGABE: ${task}

Führe die Aufgabe aus. Bei Problemen nutze escalateToChapo().`;

    const messages: LLMMessage[] = [
      { role: 'user', content: task },
    ];

    let turn = 0;
    const MAX_TURNS = 10;
    let finalContent = '';

    while (turn < MAX_TURNS) {
      turn++;
      this.sendEvent({ type: 'agent_thinking', agent: 'devo', status: `Turn ${turn}...` });

      const response = await llmRouter.generate('anthropic', {
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
          // Return the escalation info so CHAPO can handle it in the main loop
          stateManager.setActiveAgent(this.sessionId, 'chapo');
          return `DEVO eskaliert: ${desc}\n\nBisheriges Ergebnis:\n${finalContent}`;
        }

        // Verify tool is in agent's allowed list
        if (!canAgentUseTool('devo', toolCall.name)) {
          toolResults.push({
            toolUseId: toolCall.id,
            result: `Error: Tool "${toolCall.name}" is not available to devo`,
            isError: true,
          });
          continue;
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
        const result = await executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
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
        });
        const duration = Date.now() - startTime;

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

      messages.push({
        role: 'user',
        content: '',
        toolResults,
      });
    }

    // Switch back to CHAPO
    stateManager.setActiveAgent(this.sessionId, 'chapo');
    this.sendEvent({
      type: 'agent_switch',
      from: 'devo',
      to: 'chapo',
      reason: 'DEVO Delegation abgeschlossen',
    });
    this.sendEvent({ type: 'agent_complete', agent: 'devo', result: finalContent });

    return finalContent;
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
