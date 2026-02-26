import type { SkillContext, SkillResult } from '@devai/shared';

export async function execute(
  args: Record<string, unknown>,
  ctx: SkillContext
): Promise<SkillResult> {
  const { url, formats, waitFor, onlyMainContent } = args as {
    url: string;
    formats?: string[];
    waitFor?: number;
    onlyMainContent?: boolean;
  };

  if (!url) {
    return { success: false, error: 'URL is required' };
  }

  if (!ctx.apis.firecrawl || !ctx.apis.firecrawl.available) {
    return { success: false, error: 'Firecrawl API client is not available or configured' };
  }

  try {
    const payload: any = {
      url,
      formats: formats && formats.length > 0 ? formats : ['markdown']
    };

    if (waitFor !== undefined) {
      payload.waitFor = waitFor;
    }
    
    if (onlyMainContent !== undefined) {
      payload.onlyMainContent = onlyMainContent;
    }

    const response = await ctx.apis.firecrawl.post('/v1/scrape', payload);

    return {
      success: true,
      result: response
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}