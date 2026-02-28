import { config } from '../config.js';
import { getSupabase } from '../db/index.js';

interface FunctionFile {
  name: string;
  content: string;
}

interface DeployFunctionOptions {
  functionName: string;
  files: FunctionFile[];
  entrypointPath?: string;
  importMapPath?: string;
  verifyJWT?: boolean;
}

interface SupabaseFunction {
  id: string;
  slug: string;
  name: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  verify_jwt: boolean;
  import_map: boolean;
  entrypoint_path: string;
}

interface SupabaseFunctionBody {
  name: string;
  slug: string;
  verify_jwt: boolean;
  import_map: boolean;
  entrypoint_path: string;
  body: string;
}

function getProjectRef(): string {
  const url = config.supabaseUrl;
  if (!url) {
    throw new Error('Supabase URL not configured');
  }
  const match = url.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/);
  if (!match) {
    throw new Error('Could not extract project ref from Supabase URL');
  }
  return match[1];
}

function getManagementApiHeaders(): Record<string, string> {
  const token = config.supabaseAccessToken;
  if (!token) {
    throw new Error('SUPABASE_ACCESS_TOKEN not configured. Get a token from https://supabase.com/dashboard/account/tokens');
  }
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

const MANAGEMENT_API_BASE = 'https://api.supabase.com';

export async function listFunctions(): Promise<{ success: boolean; functions?: SupabaseFunction[]; error?: string }> {
  try {
    const projectRef = getProjectRef();
    const response = await fetch(
      `${MANAGEMENT_API_BASE}/v1/projects/${projectRef}/functions`,
      {
        method: 'GET',
        headers: getManagementApiHeaders(),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        return {
          success: false,
          error: 'Invalid or expired access token. Generate a new one at https://supabase.com/dashboard/account/tokens',
        };
      }
      return { success: false, error: `API error (${response.status}): ${errorText}` };
    }

    const functions = await response.json() as SupabaseFunction[];
    return { success: true, functions };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function getFunction(
  functionName: string
): Promise<{ success: boolean; function?: SupabaseFunctionBody; error?: string }> {
  try {
    const projectRef = getProjectRef();
    const response = await fetch(
      `${MANAGEMENT_API_BASE}/v1/projects/${projectRef}/functions/${functionName}`,
      {
        method: 'GET',
        headers: getManagementApiHeaders(),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        return { success: false, error: `Function "${functionName}" not found` };
      }
      return { success: false, error: `API error (${response.status}): ${errorText}` };
    }

    const func = await response.json() as SupabaseFunctionBody;
    return { success: true, function: func };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function deployFunction(
  options: DeployFunctionOptions
): Promise<{ success: boolean; function?: SupabaseFunction; error?: string }> {
  const { functionName, files, entrypointPath, importMapPath, verifyJWT } = options;

  if (!functionName || !/^[a-z][a-z0-9-]*$/.test(functionName)) {
    return {
      success: false,
      error: 'Function name must start with lowercase letter and contain only lowercase letters, numbers, and hyphens',
    };
  }

  if (!files || files.length === 0) {
    return { success: false, error: 'At least one file is required' };
  }

  const indexFile = files.find(f => f.name === 'index.ts' || f.name === (entrypointPath || 'index.ts'));
  if (!indexFile && !entrypointPath) {
    return { success: false, error: 'index.ts file is required (or specify entrypointPath)' };
  }

  try {
    const projectRef = getProjectRef();

    const filesObj: Record<string, string> = {};
    for (const file of files) {
      filesObj[file.name] = file.content;
    }

    const payload = {
      slug: functionName,
      name: functionName,
      body: JSON.stringify(filesObj),
      entrypoint_path: entrypointPath || 'index.ts',
      import_map_path: importMapPath,
      verify_jwt: verifyJWT !== false,
    };

    const response = await fetch(
      `${MANAGEMENT_API_BASE}/v1/projects/${projectRef}/functions/${functionName}`,
      {
        method: 'PATCH',
        headers: getManagementApiHeaders(),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorJson.error || errorText;
      } catch {
        // Keep raw text
      }
      return { success: false, error: `Deploy failed (${response.status}): ${errorMessage}` };
    }

    const deployedFunction = await response.json() as SupabaseFunction;
    return { success: true, function: deployedFunction };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function deleteFunction(
  functionName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const projectRef = getProjectRef();
    const response = await fetch(
      `${MANAGEMENT_API_BASE}/v1/projects/${projectRef}/functions/${functionName}`,
      {
        method: 'DELETE',
        headers: getManagementApiHeaders(),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        return { success: false, error: `Function "${functionName}" not found` };
      }
      return { success: false, error: `Delete failed (${response.status}): ${errorText}` };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function invokeFunction(
  functionName: string,
  payload?: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<{ success: boolean; data?: unknown; status?: number; error?: string }> {
  try {
    const supabase = getSupabase();
    const url = `${config.supabaseUrl}/functions/v1/${functionName}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.supabaseServiceKey}`,
        ...headers,
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });

    const responseText = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: `Invoke failed (${response.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`,
      };
    }

    return { success: true, data, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function getFunctionLogs(
  functionName: string,
  limit?: number
): Promise<{ success: boolean; logs?: unknown[]; error?: string }> {
  try {
    const projectRef = getProjectRef();
    const params = new URLSearchParams();
    if (limit) {
      params.set('limit', String(limit));
    }

    const response = await fetch(
      `${MANAGEMENT_API_BASE}/v1/projects/${projectRef}/functions/${functionName}/logs?${params}`,
      {
        method: 'GET',
        headers: getManagementApiHeaders(),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Failed to get logs (${response.status}): ${errorText}` };
    }

    const logs = await response.json() as unknown[];
    return { success: true, logs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
