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

async function callTaskForgeApi(body: Record<string, unknown>): Promise<TaskForgeResponse> {
  const apiKey = config.taskforgeApiKey;
  if (!apiKey) {
    return { success: false, error: 'DEVAI_TASKBOARD_API_KEY not configured' };
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
        body: JSON.stringify({ apiKey, ...body }),
        async: false,
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

export async function taskforgeListTasks(
  project?: string,
  status?: string,
): Promise<TaskForgeResponse> {
  const body: Record<string, unknown> = {};
  if (project) body.project = project;
  if (status) body.status = status;
  return callTaskForgeApi(body);
}

export async function taskforgeGetTask(taskId: string): Promise<TaskForgeResponse> {
  return callTaskForgeApi({ task: taskId });
}

export async function taskforgeCreateTask(
  title: string,
  description: string,
  status?: string,
): Promise<TaskForgeResponse> {
  return callTaskForgeApi({
    action: 'create',
    title,
    description,
    status: status || 'initiierung',
  });
}

export async function taskforgeMoveTask(
  taskId: string,
  newStatus: string,
): Promise<TaskForgeResponse> {
  return callTaskForgeApi({
    action: 'move',
    task: taskId,
    status: newStatus,
  });
}

export async function taskforgeAddComment(
  taskId: string,
  comment: string,
): Promise<TaskForgeResponse> {
  return callTaskForgeApi({
    action: 'comment',
    task: taskId,
    comment,
  });
}

export async function taskforgeSearch(query: string): Promise<TaskForgeResponse> {
  return callTaskForgeApi({ search: query });
}
