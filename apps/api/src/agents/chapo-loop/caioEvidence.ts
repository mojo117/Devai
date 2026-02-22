import type { ToolEvidence } from '../types.js';

export interface ToolPreflightResult {
  ok: boolean;
  error?: string;
}

export interface NormalizedToolOutcome {
  success: boolean;
  pendingApproval: boolean;
  data?: unknown;
  error?: string;
}

export interface CaioEvidence extends ToolEvidence {
  error?: string;
  timestamp: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function extractExternalId(data: unknown): string | undefined {
  const record = asRecord(data);
  if (!record) return undefined;

  const candidateKeys = ['id', 'taskId', 'approvalId', 'actionId', 'runId', 'executionId'];
  for (const key of candidateKeys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  const nested = asRecord(record.result);
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

function summarizeEvidenceData(data: unknown, fallback: string): string {
  if (typeof data === 'string' && data.trim().length > 0) {
    return data.trim();
  }

  const record = asRecord(data);
  if (record) {
    const preferred = ['message', 'summary', 'status', 'content'];
    for (const key of preferred) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    const nested = asRecord(record.result);
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

export function preflightCaioToolCall(toolName: string, args: Record<string, unknown>): ToolPreflightResult {
  const missing: string[] = [];
  const requireString = (field: string) => {
    if (!isNonEmptyString(args[field])) {
      missing.push(field);
    }
  };

  switch (toolName) {
    case 'send_email': {
      requireString('to');
      requireString('subject');
      requireString('body');
      if (isNonEmptyString(args.to) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.to.trim())) {
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
      const hasUpdatePayload = isNonEmptyString(args.name)
        || isNonEmptyString(args.cronExpression)
        || isNonEmptyString(args.instruction)
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
      if (isNonEmptyString(args.datetime) && Number.isNaN(Date.parse(args.datetime))) {
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

export function normalizeToolOutcome(result: {
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

  const payload = asRecord(result.result);
  if (payload && typeof payload.success === 'boolean') {
    if (!payload.success) {
      return {
        success: false,
        pendingApproval: false,
        data: payload.result,
        error: isNonEmptyString(payload.error) ? payload.error : 'Tool lieferte kein erfolgreiches Ergebnis.',
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

export function buildCaioEvidence(toolName: string, outcome: NormalizedToolOutcome): CaioEvidence {
  const externalId = extractExternalId(outcome.data);
  const summary = outcome.success
    ? summarizeEvidenceData(outcome.data, `${toolName} erfolgreich ausgefuehrt.`)
    : (outcome.pendingApproval
      ? 'Aktion wartet auf Freigabe und wurde noch nicht final ausgefuehrt.'
      : summarizeEvidenceData(outcome.data, outcome.error || `${toolName} fehlgeschlagen.`));

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

export function applyCaioEvidenceSummary(finalContent: string, evidenceLog: CaioEvidence[]): string {
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
