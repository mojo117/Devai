import { appendFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { sanitize } from './logger.js';

const LOGS_DIR = resolve(process.cwd(), '../../var/logs');
const MAX_RESULT_LENGTH = 2000;
const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let dirReady = false;

function ensureLogsDir(): void {
  if (dirReady) return;
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
  } catch {
    // already exists
  }
  dirReady = true;
}

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function truncate(text: string, max: number = MAX_RESULT_LENGTH): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n... [truncated, ${text.length} total chars]`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export class SessionLogger {
  private static active = new Map<string, SessionLogger>();

  private filePath: string;
  private sessionId: string;

  constructor(sessionId: string, title: string, provider?: string) {
    ensureLogsDir();
    this.sessionId = sessionId;
    const date = new Date().toISOString().slice(0, 10);
    const shortId = sessionId.slice(0, 8);
    const filename = `${date}_${shortId}_${slug(title)}.md`;
    this.filePath = join(LOGS_DIR, filename);

    const header = [
      `# Session ${shortId} — "${title.slice(0, 80)}"`,
      `Started: ${ts()} | Provider: ${provider || 'unknown'} | Full ID: ${sessionId}`,
      '',
      '---',
      '',
    ].join('\n');

    this.append(header);
    SessionLogger.active.set(sessionId, this);
  }

  static getOrCreate(sessionId: string, title: string, provider?: string): SessionLogger {
    const existing = SessionLogger.active.get(sessionId);
    if (existing) return existing;
    return new SessionLogger(sessionId, title, provider);
  }

  static getActive(sessionId: string): SessionLogger | undefined {
    return SessionLogger.active.get(sessionId);
  }

  logUser(message: string): void {
    this.append(`## [${ts()}] User\n\n${message}\n\n`);
  }

  logAssistant(message: string): void {
    this.append(`## [${ts()}] Assistant\n\n${truncate(message)}\n\n`);
  }

  logToolCall(tool: string, args: Record<string, unknown>, agent?: string): void {
    const sanitizedArgs = sanitize(args) as Record<string, unknown>;
    const agentTag = agent ? ` (${agent})` : '';
    const argsStr = truncate(JSON.stringify(sanitizedArgs, null, 2));

    this.append([
      `### [${ts()}] Tool Call — ${tool}${agentTag}`,
      '',
      '**Args:**',
      '```json',
      argsStr,
      '```',
      '',
    ].join('\n'));
  }

  logToolResult(tool: string, success: boolean, result: unknown, durationMs?: number): void {
    const status = success ? 'success' : 'FAILED';
    const duration = durationMs !== undefined ? ` | ${durationMs}ms` : '';
    const resultStr = truncate(formatValue(result));

    const lines = [
      `**Result:** ${status}${duration}`,
    ];

    if (resultStr.length > 200) {
      lines.push(
        `<details><summary>Output (${resultStr.length} chars)</summary>`,
        '',
        '```',
        resultStr,
        '```',
        '',
        '</details>',
        '',
      );
    } else {
      lines.push(`\`${resultStr}\``, '');
    }

    this.append(lines.join('\n'));
  }

  logDecision(intent: string, agent?: string, tool?: string, reasoning?: string): void {
    const parts = [`Intent: **${intent}**`];
    if (agent) parts.push(`Agent: ${agent}`);
    if (tool) parts.push(`Tool: ${tool}`);

    const lines = [`### [${ts()}] Decision`, '', parts.join(' | ')];
    if (reasoning) {
      lines.push('', `> ${reasoning.slice(0, 300)}`);
    }
    lines.push('', '');
    this.append(lines.join('\n'));
  }

  logAgentSwitch(from: string, to: string, reason: string): void {
    this.append(`### [${ts()}] Agent Switch: ${from} → ${to}\n\n> ${reason}\n\n`);
  }

  logError(error: string, agent?: string): void {
    const agentTag = agent ? ` (${agent})` : '';
    this.append(`### [${ts()}] Error${agentTag}\n\n\`\`\`\n${truncate(error)}\n\`\`\`\n\n`);
  }

  /** Log an AgentStreamEvent (from the multi-agent WebSocket chat). */
  logAgentEvent(event: Record<string, unknown>): void {
    const type = event.type as string;
    if (!type) return;

    switch (type) {
      case 'agent_start':
        this.append(`### [${ts()}] Agent Start: ${event.agent} (${event.phase})\n\n`);
        break;

      case 'agent_thinking':
        // Skip — too noisy
        break;

      case 'agent_switch':
        this.logAgentSwitch(
          String(event.from || ''),
          String(event.to || ''),
          String(event.reason || ''),
        );
        break;

      case 'delegation':
        this.append(`### [${ts()}] Delegation: ${event.from} → ${event.to}\n\nTask: ${event.task}\n\n`);
        break;

      case 'tool_call':
        this.logToolCall(
          String(event.toolName || 'unknown'),
          (event.args || {}) as Record<string, unknown>,
          event.agent as string | undefined,
        );
        break;

      case 'tool_result':
        this.logToolResult(
          String(event.toolName || 'unknown'),
          Boolean(event.success),
          event.result,
        );
        break;

      case 'user_question': {
        const q = event.question as Record<string, unknown> | undefined;
        this.append(`### [${ts()}] User Question\n\n${q?.question || JSON.stringify(q)}\n\n`);
        break;
      }

      case 'approval_request':
        this.append(`### [${ts()}] Approval Request\n\n\`\`\`json\n${truncate(JSON.stringify(event.request, null, 2))}\n\`\`\`\n\n`);
        break;

      case 'action_pending':
        this.append(`### [${ts()}] Action Pending — ${event.toolName}\n\n${event.description || ''}\n\n`);
        break;

      case 'plan_ready':
      case 'plan_approval_request':
        this.append(`### [${ts()}] Plan Ready\n\n\`\`\`json\n${truncate(JSON.stringify(event.plan, null, 2))}\n\`\`\`\n\n`);
        break;

      case 'task_update':
        this.append(`### [${ts()}] Task Update: ${event.taskId} → ${event.status}\n\n`);
        break;

      case 'error':
        this.logError(String(event.error || JSON.stringify(event)), event.agent as string | undefined);
        break;

      case 'response': {
        const resp = event.response as Record<string, unknown> | undefined;
        if (resp?.message) {
          const msg = resp.message as Record<string, unknown>;
          if (msg.role === 'assistant') {
            this.logAssistant(String(msg.content || ''));
          }
        }
        break;
      }

      default:
        // Don't log pong, hello_ack, initial_sync etc.
        if (!['pong', 'hello_ack', 'initial_sync'].includes(type)) {
          this.append(`### [${ts()}] ${type}\n\n`);
        }
    }
  }

  finalize(status: string, iterations?: number): void {
    const iterInfo = iterations !== undefined ? ` | Iterations: ${iterations}` : '';
    this.append(`\n---\n\n**Session ended:** ${ts()} | Status: ${status}${iterInfo}\n`);
    SessionLogger.active.delete(this.sessionId);
  }

  private append(text: string): void {
    try {
      appendFileSync(this.filePath, text, 'utf-8');
    } catch (err) {
      console.error('[SessionLogger] Write failed:', err);
    }
  }

  /** Remove log files older than 7 days. Call once on startup. */
  static cleanup(): void {
    ensureLogsDir();
    const now = Date.now();
    try {
      for (const file of readdirSync(LOGS_DIR)) {
        if (!file.endsWith('.md')) continue;
        const filePath = join(LOGS_DIR, file);
        try {
          const stats = statSync(filePath);
          if (now - stats.mtimeMs > CLEANUP_AGE_MS) {
            unlinkSync(filePath);
          }
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // logs dir may not exist yet
    }
  }
}
