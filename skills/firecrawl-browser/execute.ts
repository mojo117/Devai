import type { SkillContext, SkillResult } from '@devai/shared';

export async function execute(
  args: Record<string, unknown>,
  ctx: SkillContext
): Promise<SkillResult> {
  const { 
    action, 
    sessionId, 
    code, 
    language, 
    ttl, 
    activityTtl 
  } = args as {
    action: 'create' | 'execute' | 'list' | 'close' | 'shorthand';
    sessionId?: string;
    code?: string;
    language?: 'bash' | 'node' | 'python';
    ttl?: number;
    activityTtl?: number;
  };

  if (!action) {
    return { success: false, error: 'Action is required. Use: create, execute, list, close, or shorthand' };
  }

  if (!ctx.apis.firecrawl || !ctx.apis.firecrawl.available) {
    return { success: false, error: 'Firecrawl API client is not available or configured' };
  }

  try {
    const api = ctx.apis.firecrawl;

    switch (action) {
      case 'create': {
        const payload: any = {};
        if (ttl !== undefined) payload.ttl = ttl;
        if (activityTtl !== undefined) payload.activityTtl = activityTtl;
        
        const response = await api.post('/v2/browser', payload);
        return {
          success: true,
          result: {
            sessionId: response.id || response.data?.id,
            cdpUrl: response.cdpUrl || response.data?.cdpUrl,
            liveViewUrl: response.liveViewUrl || response.data?.liveViewUrl
          }
        };
      }

      case 'execute': {
        if (!sessionId) {
          return { success: false, error: 'sessionId is required for execute action' };
        }
        if (!code) {
          return { success: false, error: 'code is required for execute action' };
        }
        
        const payload: any = {
          code,
          language: language || 'bash'
        };
        
        const response = await api.post(`/v2/browser/${sessionId}/execute`, payload);
        return {
          success: true,
          result: response
        };
      }

      case 'list': {
        const response = await api.get('/v2/browser');
        return {
          success: true,
          result: response.sessions || response.data?.sessions || response
        };
      }

      case 'close': {
        if (!sessionId) {
          return { success: false, error: 'sessionId is required for close action' };
        }
        
        await api.delete(`/v2/browser/${sessionId}`);
        return {
          success: true,
          result: { message: `Session ${sessionId} closed` }
        };
      }

      case 'shorthand': {
        // Shorthand: auto-creates session, executes command, returns result
        if (!code) {
          return { success: false, error: 'code is required for shorthand action. E.g. "open https://example.com"' };
        }
        
        // Create session
        const session = await api.post('/v2/browser', {});
        const newSessionId = session.id || session.data?.id;
        
        if (!newSessionId) {
          return { success: false, error: 'Failed to create browser session' };
        }
        
        // Execute the command
        const execPayload: any = {
          code: code.startsWith('agent-browser') ? code : `agent-browser ${code}`,
          language: 'bash'
        };
        
        const result = await api.post(`/v2/browser/${newSessionId}/execute`, execPayload);
        
        return {
          success: true,
          result: {
            sessionId: newSessionId,
            liveViewUrl: session.liveViewUrl || session.data?.liveViewUrl,
            output: result.result || result.data || result
          }
        };
      }

      default:
        return { 
          success: false, 
          error: `Unknown action: ${action}. Use: create, execute, list, close, or shorthand` 
        };
    }
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    const errorData = error.response?.data;
    
    return {
      success: false,
      error: errorData ? `${errorMsg}: ${JSON.stringify(errorData)}` : errorMsg
    };
  }
}