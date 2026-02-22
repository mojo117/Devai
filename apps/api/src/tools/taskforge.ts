/**
 * TaskForge tools — CAIO agent tools for ticket management.
 * Wraps the api-project-access Appwrite function.
 */

import { config } from '../config.js';

const APPWRITE_ENDPOINT = 'https://appwrite.klyde.tech/v1';
const APPWRITE_PROJECT_ID = '69805803000aeddb2ead';
const FUNCTION_ID = 'api-project-access';

interface TaskForgeResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

function resolveApiKey(project?: string): { apiKey: string; resolvedProject: string } | { error: string } {
  const keys = config.taskforgeApiKeys;
  const available = Object.keys(keys);

  if (available.length === 0) {
    return { error: 'Keine TaskForge API-Keys konfiguriert. Setze TASKFORGE_KEY_<PROJECT> Umgebungsvariablen.' };
  }

  const target = project?.toLowerCase().replace(/[_ ]/g, '-') || config.taskforgeDefaultProject;
  const apiKey = keys[target];

  if (!apiKey) {
    return { error: `Kein API-Key fuer Projekt "${target}". Verfuegbare Projekte: ${available.join(', ')}` };
  }

  return { apiKey, resolvedProject: target };
}

async function callTaskForgeApi(body: Record<string, unknown>, project?: string): Promise<TaskForgeResponse> {
  const resolved = resolveApiKey(project);
  if ('error' in resolved) {
    return { success: false, error: resolved.error };
  }

  const response = await fetch(
    `${APPWRITE_ENDPOINT}/functions/${FUNCTION_ID}/executions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': APPWRITE_PROJECT_ID,
      },
      body: JSON.stringify({
        body: JSON.stringify({ apiKey: resolved.apiKey, ...body }),
        async: 'false',
      }),
    },
  );

  if (!response.ok) {
    return { success: false, error: `TaskForge API error: ${response.status} ${response.statusText}` };
  }

  const execution = await response.json() as Record<string, unknown>;
  const responseBody = execution.responseBody;

  if (!responseBody) {
    return { success: false, error: 'Empty response from TaskForge API' };
  }

  try {
    const parsed = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
    return { success: true, result: parsed };
  } catch {
    return { success: false, error: `Failed to parse TaskForge response: ${String(responseBody)}` };
  }
}

/** Returns available project names for tool descriptions */
export function getAvailableTaskForgeProjects(): string[] {
  return Object.keys(config.taskforgeApiKeys);
}

export async function taskforgeListTasks(
  project?: string,
  status?: string,
): Promise<TaskForgeResponse> {
  const body: Record<string, unknown> = {};
  if (status) body.status = status;
  return callTaskForgeApi(body, project);
}

export async function taskforgeGetTask(taskId: string, project?: string): Promise<TaskForgeResponse> {
  return callTaskForgeApi({ task: taskId }, project);
}

export async function taskforgeCreateTask(
  title: string,
  description: string,
  status?: string,
  project?: string,
): Promise<TaskForgeResponse> {
  return callTaskForgeApi({
    action: 'create_task',
    data: {
      title,
      description,
      state: status || 'initiierung',
    },
  }, project);
}

export async function taskforgeMoveTask(
  taskId: string,
  newStatus: string,
  project?: string,
): Promise<TaskForgeResponse> {
  return callTaskForgeApi({
    action: 'update_task',
    data: {
      taskId,
      state: newStatus,
    },
  }, project);
}

export async function taskforgeAddComment(
  taskId: string,
  comment: string,
  project?: string,
): Promise<TaskForgeResponse> {
  return callTaskForgeApi({
    action: 'create_comment',
    data: {
      taskId,
      content: comment,
    },
  }, project);
}

export async function taskforgeSearch(query: string, project?: string): Promise<TaskForgeResponse> {
  return callTaskForgeApi({ search: query }, project);
}
