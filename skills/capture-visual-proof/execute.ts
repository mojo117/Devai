import type { SkillContext, SkillResult } from '@devai/shared';

const BLOCKED_HOSTNAMES = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
];

function isUrlAllowed(url: string): { allowed: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { allowed: false, reason: `Protocol not allowed: ${parsed.protocol}` };
    }
    
    for (const pattern of BLOCKED_HOSTNAMES) {
      if (pattern.test(parsed.hostname)) {
        return { allowed: false, reason: `Internal network addresses not allowed: ${parsed.hostname}` };
      }
    }
    
    return { allowed: true };
  } catch (e) {
    return { allowed: false, reason: `Invalid URL: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function execute(
  args: Record<string, unknown>,
  ctx: SkillContext
): Promise<SkillResult> {
  const {
    url,
    selector,
    waitFor,
    viewport,
    fullPage,
    caption
  } = args as {
    url: string;
    selector?: string;
    waitFor?: string;
    viewport?: { width?: number; height?: number };
    fullPage?: boolean;
    caption?: string;
  };

  if (!url) {
    return { success: false, error: 'URL is required' };
  }

  const urlCheck = isUrlAllowed(url);
  if (!urlCheck.allowed) {
    return { success: false, error: urlCheck.reason || 'URL not allowed' };
  }

  if (!ctx.apis.firecrawl?.available) {
    return { success: false, error: 'Firecrawl API not configured' };
  }

  const api = ctx.apis.firecrawl;

  try {
    ctx.log(`Capturing visual proof: ${url}`);

    const session = await api.post('/v2/browser', {
      ttl: 60,
      activityTtl: 30
    });

    const sessionId = session.id || (session as any).data?.id;
    if (!sessionId) {
      return { success: false, error: 'Failed to create browser session' };
    }

    const viewportWidth = viewport?.width || 1280;
    const viewportHeight = viewport?.height || 800;

    const codeLines: string[] = [
      `await page.setViewportSize({ width: ${viewportWidth}, height: ${viewportHeight} });`,
      `await page.goto('${url}', { waitUntil: 'networkidle', timeout: 30000 });`,
    ];

    if (waitFor) {
      codeLines.push(`await page.waitForSelector('${waitFor}', { timeout: 10000 });`);
    }

    if (fullPage) {
      codeLines.push(`const screenshot = await page.screenshot({ fullPage: true, type: 'png' });`);
    } else if (selector) {
      codeLines.push(`const element = await page.waitForSelector('${selector}', { timeout: 5000 });`);
      codeLines.push(`const screenshot = await element.screenshot({ type: 'png' });`);
    } else {
      codeLines.push(`const screenshot = await page.screenshot({ type: 'png' });`);
    }

    codeLines.push(`console.log(Buffer.from(screenshot).toString('base64'));`);

    const code = codeLines.join('\n');

    ctx.log(`Executing screenshot code in session ${sessionId}`);

    const result = await api.post(`/v2/browser/${sessionId}/execute`, {
      code,
      language: 'node'
    });

    await api.delete(`/v2/browser/${sessionId}`).catch(() => {});

    const rawOutput = result.result || (result as any).output || '';
    
    if (!rawOutput || typeof rawOutput !== 'string' || rawOutput.length < 100) {
      return {
        success: false,
        error: `Screenshot capture failed or returned empty result. Output length: ${rawOutput?.length || 0}`
      };
    }

    let base64Clean = rawOutput
      .replace(/\s/g, '')
      .replace(/[^A-Za-z0-9+/=]/g, '');
    
    const maxBase64Length = 800000;
    if (base64Clean.length > maxBase64Length) {
      ctx.log(`Screenshot too large (${base64Clean.length} chars), truncating`);
      base64Clean = base64Clean.slice(0, maxBase64Length);
    }

    ctx.log(`Screenshot captured: ${base64Clean.length} base64 chars (~${Math.round(base64Clean.length * 0.75 / 1024)}KB)`);

    return {
      success: true,
      result: {
        imageUrl: `data:image/png;base64,${base64Clean}`,
        width: viewportWidth,
        height: viewportHeight,
        caption: caption || `Screenshot of ${url}`,
        url,
        renderType: 'image'
      }
    };

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.log(`Error capturing visual proof: ${msg}`);
    return { success: false, error: `Failed to capture screenshot: ${msg}` };
  }
}
