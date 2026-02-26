import { executeToolWithApprovalBridge } from '../../actions/approvalBridge.js';
import * as stateManager from '../stateManager.js';
import type { AgentErrorHandler } from '../error-handler.js';
import type { DecisionPathInsights } from '../answer-validator.js';
import type {
  AgentStreamEvent,
  ChapoLoopResult,
  RiskLevel,
} from '../types.js';
import type { QueueQuestionOptions } from './gateManager.js';
import {
  setChapoPlan,
} from './chapoControlTools.js';
import { getUserfileById, listUserfiles } from '../../db/userfileQueries.js';
import { createUserfileSignedUrl } from '../../services/userfileService.js';
import { runHooks } from '../../hooks/hookRunner.js';

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
  queueQuestion: (
    question: string,
    totalIterations: number,
    options?: QueueQuestionOptions,
  ) => Promise<ChapoLoopResult>;
  queueApproval: (
    description: string,
    riskLevel: RiskLevel,
    totalIterations: number,
  ) => Promise<ChapoLoopResult>;
  emitDecisionPath: (insights: DecisionPathInsights) => void;
  buildToolResultContent: (
    result: { success: boolean; result?: unknown; error?: string },
  ) => { content: string; isError: boolean };
  projectRoot: string | null;
}

export class ChapoToolExecutor {
  constructor(private deps: ToolExecutorDeps) {}

  async execute(toolCall: ToolCallLike): Promise<ToolCallOutcome> {
    // CHAPO control tools (state-aware meta utilities)
    if (toolCall.name === 'chapo_plan_set') {
      const result = setChapoPlan(this.deps.sessionId, {
        title: toolCall.arguments.title as string,
        steps: toolCall.arguments.steps as Array<{
          id: string;
          text: string;
          owner: 'chapo';
          status: 'todo' | 'doing' | 'done' | 'blocked';
        }>,
      });
      return {
        toolResult: {
          toolUseId: toolCall.id,
          result: JSON.stringify(result),
          isError: !result.success,
        },
      };
    }

    // ACTION: SHOW IN PREVIEW — display uploaded userfile in preview panel
    if (toolCall.name === 'show_in_preview') {
      const userfileId = toolCall.arguments.userfileId as string;
      if (!userfileId) {
        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: 'Error: userfileId ist erforderlich.',
            isError: true,
          },
        };
      }

      const file = await getUserfileById(userfileId);
      if (!file) {
        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: `Error: Datei mit ID "${userfileId}" nicht gefunden.`,
            isError: true,
          },
        };
      }

      try {
        const signed = await createUserfileSignedUrl(file.storage_path);

        // Emit tool_call event with preview metadata so frontend artifact detection picks it up
        this.deps.sendEvent({
          type: 'tool_call',
          agent: 'chapo',
          toolName: 'show_in_preview',
          args: {
            signedUrl: signed.url,
            filename: file.original_name,
            mimeType: file.mime_type,
            userfileId,
          },
        });

        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: `Datei "${file.original_name}" wird in der Preview angezeigt.`,
            isError: false,
          },
        };
      } catch (err) {
        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: `Error: Signed URL konnte nicht erstellt werden: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          },
        };
      }
    }

    // ACTION: SEARCH FILES — list/search uploaded userfiles
    if (toolCall.name === 'search_files') {
      const query = (toolCall.arguments.query as string)?.trim().toLowerCase() || '';
      try {
        const allFiles = await listUserfiles();
        const filtered = query
          ? allFiles.filter((f) => f.original_name.toLowerCase().includes(query))
          : allFiles.slice(0, 20);

        if (filtered.length === 0) {
          return {
            toolResult: {
              toolUseId: toolCall.id,
              result: query
                ? `Keine Dateien gefunden für "${query}".`
                : 'Keine hochgeladenen Dateien vorhanden.',
              isError: false,
            },
          };
        }

        const lines = filtered.map((f) =>
          `- **${f.original_name}** | ID: \`${f.id}\` | ${f.mime_type} | ${Math.round(f.size_bytes / 1024)}KB | ${new Date(f.uploaded_at).toLocaleDateString('de-DE')}`
        );
        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: `${filtered.length} Datei(en) gefunden:\n${lines.join('\n')}`,
            isError: false,
          },
        };
      } catch (err) {
        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: `Error: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          },
        };
      }
    }

    // ACTION: TODO — update self-managed todo list
    if (toolCall.name === 'todoWrite') {
      const todos = (toolCall.arguments.todos as Array<{ content: string; status: string }>) || [];
      const normalized = todos.map((t) => ({
        content: String(t.content || ''),
        status: (t.status === 'in_progress' || t.status === 'completed' ? t.status : 'pending') as 'pending' | 'in_progress' | 'completed',
      }));

      // Store in session state
      const state = stateManager.getOrCreateState(this.deps.sessionId);
      state.todos = normalized;

      // Emit todo_updated event for frontend
      this.deps.sendEvent({
        type: 'todo_updated',
        todos: normalized,
      });

      const completed = normalized.filter((t) => t.status === 'completed').length;
      const total = normalized.length;
      return {
        toolResult: {
          toolUseId: toolCall.id,
          result: `Todo-Liste aktualisiert: ${completed}/${total} erledigt.`,
          isError: false,
        },
      };
    }

    // ACTION: RESPOND — send intermediate response, continue loop
    if (toolCall.name === 'respondToUser') {
      const message = (toolCall.arguments.message as string) || '';
      const inReplyTo = toolCall.arguments.inReplyTo as string | undefined;

      // Emit partial_response event for frontend
      this.deps.sendEvent({
        type: 'partial_response',
        message,
        inReplyTo,
      });

      return {
        toolResult: {
          toolUseId: toolCall.id,
          result: 'delivered',
          isError: false,
        },
      };
    }

    // ACTION: ASK — pause loop (blocking) or continue (non-blocking)
    if (toolCall.name === 'askUser') {
      const question = (toolCall.arguments.question as string) || 'Kannst du das genauer beschreiben?';
      const blocking = toolCall.arguments.blocking !== false; // default true

      if (!blocking) {
        // Non-blocking: emit question to user, continue loop
        this.deps.sendEvent({
          type: 'user_question',
          question: {
            questionId: `nb-${toolCall.id}`,
            question,
            fromAgent: 'chapo',
            options: toolCall.arguments.options as string[] | undefined,
            timestamp: new Date().toISOString(),
          },
        });
        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: 'Frage gesendet, arbeite weiter. Antwort kommt via Inbox.',
            isError: false,
          },
        };
      }

      // Blocking: pause loop, wait for user reply (existing behavior)
      const earlyReturn = await this.deps.queueQuestion(question, this.deps.iteration + 1);
      return { earlyReturn };
    }

    // requestApproval — handle as user question
    if (toolCall.name === 'requestApproval') {
      const description = (toolCall.arguments.description as string) || 'Freigabe erforderlich';
      const riskLevel = ((toolCall.arguments.riskLevel as RiskLevel) || 'medium');
      const earlyReturn = await this.deps.queueApproval(description, riskLevel, this.deps.iteration + 1);
      return { earlyReturn };
    }

    // --- HOOK: before:tool ---
    const beforeHook = await runHooks('before:tool', {
      toolName: toolCall.name,
      toolArgs: toolCall.arguments,
      projectRoot: this.deps.projectRoot,
    });
    if (beforeHook.blocked) {
      return {
        toolResult: {
          toolUseId: toolCall.id,
          result: `[BLOCKED] ${beforeHook.blockReason}`,
          isError: true,
        },
      };
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
    // Track gathered files
    if (toolCall.name === 'fs_readFile' && success) {
      const path = toolCall.arguments.path as string;
      stateManager.addGatheredFile(this.deps.sessionId, path);
    }

    // --- HOOK: after:tool (fire-and-forget) ---
    runHooks(content.isError ? 'after:tool:error' : 'after:tool', {
      toolName: toolCall.name,
      toolArgs: toolCall.arguments,
      toolResult: content.content,
      projectRoot: this.deps.projectRoot,
    }).catch((err) => console.warn('[hooks] after:tool hook error:', err));

    return {
      toolResult: {
        toolUseId: toolCall.id,
        result: content.content,
        isError: content.isError,
      },
    };
  }
}
