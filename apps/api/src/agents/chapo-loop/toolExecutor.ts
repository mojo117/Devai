import { executeToolWithApprovalBridge } from '../../actions/approvalBridge.js';
import * as stateManager from '../stateManager.js';
import type { AgentErrorHandler } from '../error-handler.js';
import type {
  AgentStreamEvent,
  ChapoLoopResult,
  RiskLevel,
} from '../types.js';
import type { QueueQuestionOptions } from './gateManager.js';

interface DecisionPathInsights {
  path: 'answer' | 'tool';
  reason: string;
  confidence: number;
  unresolvedAssumptions: string[];
}
import {
  setChapoPlan,
} from './chapoControlTools.js';
import { getUserfileById, getRecentUserfileByOriginalName, type UserfileRow } from '../../db/userfileQueries.js';
import { createUserfileSignedUrl, downloadUserfile, searchUserfiles, uploadUserfileFromBuffer } from '../../services/userfileService.js';
import { readFile } from 'fs/promises';
import { basename } from 'path';
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

    // ACTION: SHOW IN PREVIEW — display file in preview panel
    // Supports: userfileId (existing upload) or filePath (auto-upload with TTL freshness check)
    if (toolCall.name === 'show_in_preview') {
      const userfileId = toolCall.arguments.userfileId as string | undefined;
      const filePath = toolCall.arguments.filePath as string | undefined;

      if (!userfileId && !filePath) {
        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: 'Error: userfileId oder filePath ist erforderlich.',
            isError: true,
          },
        };
      }

      let file: UserfileRow | null = userfileId ? await getUserfileById(userfileId) : null;

      // If filePath provided, check for recent upload or upload fresh
      if (filePath && !file) {
        const filename = basename(filePath);
        const isTextFile = filename.endsWith('.md') || filename.endsWith('.txt') || 
          filename.endsWith('.markdown') || filename.endsWith('.json');
        
        // TTL: 5 minutes for text files, always fresh for others
        const ttlMs = isTextFile ? 5 * 60 * 1000 : 0;
        
        // Check for recent upload
        const recent = await getRecentUserfileByOriginalName(filename, ttlMs);
        
        if (recent) {
          console.log(`[show_in_preview] Using cached userfile ${recent.id} for ${filename} (${Math.round((Date.now() - new Date(recent.uploaded_at).getTime()) / 1000)}s old)`);
          file = recent;
        } else {
          // Upload fresh
          try {
            const buffer = await readFile(filePath);
            const mimeType = filename.endsWith('.md') || filename.endsWith('.markdown')
              ? 'text/markdown'
              : filename.endsWith('.txt')
                ? 'text/plain'
                : filename.endsWith('.json')
                  ? 'application/json'
                  : 'application/octet-stream';
            
            const uploadResult = await uploadUserfileFromBuffer(buffer, filename, mimeType);
            if (!uploadResult.success) {
              return {
                toolResult: {
                  toolUseId: toolCall.id,
                  result: `Error: Upload fehlgeschlagen für ${filename}`,
                  isError: true,
                },
              };
            }
            
            console.log(`[show_in_preview] Uploaded fresh ${filename} as ${uploadResult.file.id}`);
            file = {
              id: uploadResult.file.id,
              original_name: uploadResult.file.originalName,
              mime_type: uploadResult.file.mimeType,
              storage_path: uploadResult.file.storagePath,
              uploaded_at: uploadResult.file.uploadedAt,
              size_bytes: uploadResult.file.sizeBytes,
              filename: uploadResult.file.filename,
              expires_at: uploadResult.file.expiresAt,
              parsed_content: null,
              parse_status: uploadResult.file.parseStatus,
            } as UserfileRow;
          } catch (readErr) {
            return {
              toolResult: {
                toolUseId: toolCall.id,
                result: `Error: Datei nicht gefunden oder nicht lesbar: ${filePath}`,
                isError: true,
              },
            };
          }
        }
      }

      if (!file) {
        return {
          toolResult: {
            toolUseId: toolCall.id,
            result: `Error: Datei "${userfileId || filePath}" nicht gefunden.`,
            isError: true,
          },
        };
      }

      try {
        const signed = await createUserfileSignedUrl(file.storage_path);
        const isMarkdown = file.original_name.endsWith('.md') || 
          file.original_name.endsWith('.markdown') ||
          file.mime_type === 'text/markdown';
        const isTextFile = isMarkdown ||
          file.mime_type === 'text/plain' ||
          file.original_name.endsWith('.txt') ||
          file.original_name.endsWith('.json');
        
        let content: string | undefined;
        if (isTextFile) {
          try {
            const downloaded = await downloadUserfile(file.storage_path);
            if (downloaded) {
              content = downloaded.buffer.toString('utf-8');
              console.log(`[show_in_preview] Downloaded ${content.length} chars for ${file.original_name}`);
            } else {
              console.warn(`[show_in_preview] downloadUserfile returned null for ${file.storage_path}`);
            }
          } catch (downloadErr) {
            console.error(`[show_in_preview] Download error:`, downloadErr);
          }
        }

        this.deps.sendEvent({
          type: 'tool_call',
          agent: 'chapo',
          toolName: 'show_in_preview',
          args: {
            signedUrl: signed.url,
            filename: file.original_name,
            mimeType: file.mime_type,
            userfileId: file.id,
            content,
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
      const searchResult = await searchUserfiles(toolCall.arguments.query as string | undefined);
      return {
        toolResult: {
          toolUseId: toolCall.id,
          result: searchResult.result,
          isError: !searchResult.success,
        },
      };
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

      // Fire after:tool:error hook for crashed tools
      runHooks('after:tool:error', {
        toolName: toolCall.name,
        toolArgs: toolCall.arguments,
        toolResult: toolErr.message,
        projectRoot: this.deps.projectRoot,
      }).catch((hookErr) => console.warn('[hooks] after:tool:error hook error:', hookErr));

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

    // AUTO-DELIVER: When image generation succeeds, persist and show inline in chat
    if (toolCall.name === 'skill_generate_image' && success) {
      const imgResult = toolResult.result as Record<string, unknown> | undefined;
      const image = imgResult?.image as Record<string, unknown> | undefined;
      const imageUrl = image?.url as string | undefined;
      if (imageUrl) {
        try {
          await this.autoDeliverImage(imageUrl, image);
        } catch (err) {
          console.warn('[toolExecutor] auto-deliver image failed:', err);
        }
      }
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

  /**
   * Download a generated image from its temporary URL, persist to Supabase Storage,
   * and emit a deliver_document event so the frontend renders an inline image card.
   */
  private async autoDeliverImage(
    imageUrl: string,
    imageMeta: Record<string, unknown> | undefined,
  ): Promise<void> {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      console.warn(`[autoDeliverImage] Download failed: HTTP ${response.status}`);
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const prompt = (imageMeta?.revisedPrompt as string) || 'generated-image';
    const sanitized = prompt.slice(0, 40).replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-') || 'image';
    const filename = `${sanitized}.png`;

    const uploadResult = await uploadUserfileFromBuffer(buffer, filename, 'image/png');
    if (!uploadResult.success) {
      console.warn('[autoDeliverImage] Upload to Supabase failed');
      return;
    }

    console.log(`[autoDeliverImage] Persisted ${filename} as ${uploadResult.file.id} (${buffer.length} bytes)`);

    this.deps.sendEvent({
      type: 'tool_result',
      agent: 'chapo',
      toolName: 'deliver_document',
      result: {
        fileId: uploadResult.file.id,
        filename: uploadResult.file.originalName,
        mimeType: uploadResult.file.mimeType,
        sizeBytes: uploadResult.file.sizeBytes,
        downloadUrl: `/api/userfiles/${uploadResult.file.id}/download`,
        source: 'url',
        description: (imageMeta?.revisedPrompt as string) || undefined,
      },
      success: true,
    });
  }
}
