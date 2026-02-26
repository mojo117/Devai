# Visual Proof of Success — Implementation Plan

**Date:** 2026-02-24
**Status:** Planning
**Depends on:** Firecrawl Browser (already integrated)

---

## Overview

**Goal:** Enable DevAI agents to capture screenshots and visual evidence after making changes, rendering them inline in the chat as proof of work.

**Use Cases:**
1. DEVO deploys a fix → captures screenshot of working page
2. CHAPO creates a UI → shows rendered result
3. SCOUT researches a site → captures relevant page sections
4. Validation loop → model sees visual output and can verify correctness

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DEVO / CHAPO Agent                             │
│                                                                             │
│  1. Make changes (fs_writeFile, git_commit, pm2_restart...)                │
│  2. Call: capture_visual_proof({ url, selector?, waitFor? })               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Skill: capture-visual-proof                         │
│                                                                             │
│  1. Firecrawl Browser: create session                                       │
│  2. Navigate to URL                                                         │
│  3. Wait for selector (optional)                                           │
│  4. Capture screenshot (base64 or URL)                                      │
│  5. Close session                                                           │
│  6. Return: { imageUrl, width, height, caption }                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Tool Result Event                                 │
│                                                                             │
│  type: 'tool_result'                                                        │
│  name: 'capture_visual_proof'                                               │
│  result: {                                                                  │
│    success: true,                                                           │
│    imageUrl: 'data:image/png;base64,...',  // OR userfile URL              │
│    width: 1280,                                                             │
│    height: 800,                                                             │
│    caption: 'Screenshot of login page after fix',                          │
│    renderType: 'image'                    // NEW FIELD                     │
│  }                                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Frontend: MessageList                              │
│                                                                             │
│  InlineSystemEvent detects renderType: 'image'                             │
│  → Renders <img> instead of JSON preview                                   │
│  → Clickable for full-size modal                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. New Skill: `capture-visual-proof`

**Location:** `/opt/Klyde/projects/Devai/skills/capture-visual-proof/`

**skill.json:**
```json
{
  "id": "capture-visual-proof",
  "name": "Capture Visual Proof",
  "description": "Capture a screenshot as visual evidence of deployed changes. Use after making UI changes, deployments, or to verify page state. Returns an inline-renderable image.",
  "version": "1.0.0",
  "parameters": {
    "url": {
      "type": "string",
      "description": "Full URL to capture (e.g. 'https://dev-dieda.inkit.app/login')",
      "required": true
    },
    "selector": {
      "type": "string",
      "description": "Optional CSS selector to capture only a specific element (e.g. '.login-form', '#main-content')",
      "required": false
    },
    "waitFor": {
      "type": "string",
      "description": "Optional CSS selector to wait for before capturing (e.g. '.loaded', '[data-ready]')",
      "required": false
    },
    "viewport": {
      "type": "object",
      "description": "Viewport dimensions",
      "required": false,
      "properties": {
        "width": { "type": "number", "default": 1280 },
        "height": { "type": "number", "default": 800 }
      }
    },
    "fullPage": {
      "type": "boolean",
      "description": "Capture full scrollable page (default: false, viewport only)",
      "required": false,
      "default": false
    },
    "caption": {
      "type": "string",
      "description": "Human-readable caption for the screenshot",
      "required": false
    }
  },
  "createdBy": "devo",
  "tags": ["visual", "screenshot", "proof", "verification", "browser"]
}
```

**execute.ts:**
```typescript
import type { SkillContext, SkillResult } from '@devai/shared';

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

  if (!ctx.apis.firecrawl?.available) {
    return { success: false, error: 'Firecrawl API not configured' };
  }

  const api = ctx.apis.firecrawl;

  try {
    ctx.log(`Capturing visual proof: ${url}`);

    // 1. Create browser session
    const session = await api.post('/v2/browser', {
      ttl: 60,
      activityTtl: 30
    });

    const sessionId = session.id || session.data?.id;
    if (!sessionId) {
      return { success: false, error: 'Failed to create browser session' };
    }

    // 2. Build Playwright code for screenshot
    const viewportWidth = viewport?.width || 1280;
    const viewportHeight = viewport?.height || 800;

    const codeLines = [
      `await page.setViewportSize({ width: ${viewportWidth}, height: ${viewportHeight} });`,
      `await page.goto('${url}', { waitUntil: 'networkidle' });`,
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

    // 3. Execute screenshot capture
    const result = await api.post(`/v2/browser/${sessionId}/execute`, {
      code,
      language: 'node'
    });

    // 4. Close session
    await api.delete(`/v2/browser/${sessionId}`).catch(() => {});

    const base64Output = result.result || result.output || '';

    // Check if output looks like base64
    if (!base64Output || base64Output.length < 100) {
      return {
        success: false,
        error: `Screenshot capture failed or returned empty result. Output: ${base64Output?.slice(0, 100)}`
      };
    }

    // Clean base64 (remove any console noise)
    const base64Clean = base64Output.replace(/[^A-Za-z0-9+/=]/g, '').slice(0, 500000);

    ctx.log(`Screenshot captured: ${base64Clean.length} bytes`);

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
```

---

### 2. Frontend: Image Rendering in MessageList

**File:** `apps/web/src/components/ChatUI/MessageList.tsx`

**Changes:**

```typescript
// Add to InlineSystemEvent or create new VisualProofCard component

interface VisualProofPayload {
  imageUrl: string;
  width: number;
  height: number;
  caption?: string;
  url?: string;
}

function getVisualProofPayload(event: ToolEvent): VisualProofPayload | null {
  if (event.type !== 'tool_result' || event.name !== 'capture_visual_proof') return null;
  const r = event.result as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return null;
  if (typeof r.imageUrl !== 'string') return null;
  return {
    imageUrl: r.imageUrl as string,
    width: (r.width as number) || 1280,
    height: (r.height as number) || 800,
    caption: r.caption as string | undefined,
    url: r.url as string | undefined,
  };
}

// In renderToolEventsBlock, check for visual proof BEFORE regular event
function renderToolEventsBlock(events: ToolEvent[], live: boolean) {
  const merged = mergeConsecutiveThinking(events);
  return (
    <div className="space-y-1.5">
      {merged.map((event) => {
        // Check for visual proof first
        const visualProof = getVisualProofPayload(event);
        if (visualProof) {
          return (
            <VisualProofCard
              key={event.id}
              imageUrl={visualProof.imageUrl}
              caption={visualProof.caption}
              sourceUrl={visualProof.url}
            />
          );
        }

        // ... rest of existing logic
      })}
    </div>
  );
}
```

**New Component:** `VisualProofCard.tsx`

```typescript
import { useState } from 'react';

interface VisualProofCardProps {
  imageUrl: string;
  caption?: string;
  sourceUrl?: string;
}

export function VisualProofCard({ imageUrl, caption, sourceUrl }: VisualProofCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="flex justify-start">
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2 text-xs text-red-400">
          Screenshot failed to load
          {sourceUrl && <span className="ml-2 opacity-60">({sourceUrl})</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="rounded-xl border border-devai-border bg-devai-card max-w-[85%] overflow-hidden">
        {/* Thumbnail or Expanded */}
        <div
          className={`cursor-pointer ${expanded ? '' : 'max-h-[200px] overflow-hidden'}`}
          onClick={() => setExpanded(!expanded)}
        >
          <img
            src={imageUrl}
            alt={caption || 'Visual proof'}
            className="w-full object-contain"
            onError={() => setError(true)}
          />
        </div>

        {/* Caption bar */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-devai-border">
          <div className="min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-emerald-400 font-medium">Visual Proof</span>
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-devai-text-muted hover:text-devai-accent truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  {new URL(sourceUrl).hostname}
                </a>
              )}
            </div>
            {caption && (
              <p className="text-xs text-devai-text-secondary truncate mt-0.5">{caption}</p>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="text-[10px] text-devai-text-muted hover:text-devai-text shrink-0"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

### 3. Types: Extend ToolEvent

**File:** `apps/web/src/components/ChatUI/types.ts`

No changes needed — `renderType` is part of `result` object, not a top-level field.

**File:** `shared/src/skill-runtime.ts` (optional, for type safety)

```typescript
export interface SkillResult {
  success: boolean;
  result?: {
    renderType?: 'image' | 'html' | 'markdown' | 'json';
    [key: string]: unknown;
  };
  error?: string;
}
```

---

### 4. Agent Prompts: Encourage Visual Proof

**File:** `apps/api/src/prompts/devo.ts`

Add to DEVO's tools section:

```markdown
### Visual Verification
- capture_visual_proof(url, selector?, caption?) — capture screenshot as proof of work

After deploying UI changes or fixing visual bugs, use capture_visual_proof to show the user the result.
This builds trust and allows you to visually verify your changes worked.
```

**File:** `apps/api/src/prompts/chapo.ts` (if exists)

Add similar guidance for CHAPO to request visual proof from DEVO when appropriate.

---

## LLM Integration: How the Model Uses It

### Decision Flow

```
User: "Fix the login button styling on dev-dieda"

CHAPO:
  → Routes to DEVO (development task)

DEVO:
  → fs_readFile: auth/login.tsx
  → fs_edit: fix button styles
  → git_commit: "fix: login button styling"
  → pm2_restart: dieda-dev
  → capture_visual_proof({
      url: "https://dev-dieda.inkit.app/login",
      selector: ".login-button",
      caption: "Login button after styling fix"
    })
  → Returns answer with embedded screenshot

User sees:
  - Delegation card showing DEVO's work
  - Inline screenshot of the fixed button
  - CHAPO's summary: "Fixed! Here's how it looks now:"
```

### Model Self-Verification

The model can use visual proof for self-verification:

```
DEVO internal reasoning:
  "I fixed the login form. Let me capture a screenshot to verify the changes
   are visible and the button is correctly styled before reporting back."
```

If the screenshot shows the fix didn't work, DEVO can iterate immediately.

---

## Alternative: Store as Userfile

For large screenshots or to avoid token bloat in the stream:

```typescript
// In capture-visual-proof skill, after capturing:
const userfileResult = await ctx.apis.devai.post('/api/userfiles', {
  content: base64Data,
  filename: `screenshot-${Date.now()}.png`,
  mimeType: 'image/png',
  metadata: { sourceUrl: url, caption }
});

return {
  success: true,
  result: {
    fileId: userfileResult.id,
    imageUrl: `/api/userfiles/${userfileResult.id}/download`,
    // ... rest same
  }
};
```

This leverages the existing `DocumentDownloadCard` which already renders images.

---

## Implementation Steps

### Phase 1: Skill (Day 1-2)
1. Create `/skills/capture-visual-proof/skill.json`
2. Create `/skills/capture-visual-proof/execute.ts`
3. Test manually via skill invocation
4. Verify base64 encoding / image rendering

### Phase 2: Frontend (Day 2-3)
1. Add `VisualProofCard` component
2. Modify `MessageList.tsx` to detect `capture_visual_proof` results
3. Handle expand/collapse, error states
4. Test with various screenshot sizes

### Phase 3: Agent Integration (Day 3-4)
1. Add to DEVO tools list in prompt
2. Add to CHAPO routing hints
3. Test end-to-end: request → fix → screenshot → display
4. Monitor token usage / performance

### Phase 4: Polish (Day 4-5)
1. Add loading state while screenshot is captured
2. Add retry logic for failed captures
3. Consider userfile storage for large images
4. Add to agent memory: "prefer visual proof for UI changes"

---

## Cost Analysis

| Resource | Cost |
|----------|------|
| Firecrawl Browser | 2 credits/minute (free tier: 5 hours) |
| Token overhead | ~500-2000 tokens per screenshot (base64) |
| Session duration | ~5-15 seconds per capture |

**Optimization:**
- Store as userfile → URL only in stream (no token cost)
- Limit screenshot size (max 1280x800 default)
- Auto-close sessions after capture

---

## Security Considerations

1. **URL Validation:** Only allow http/https URLs
2. **No Internal Network:** Block 10.x.x.x, 192.168.x.x, localhost
3. **Session Isolation:** Each capture gets fresh Firecrawl session
4. **No Auth Leakage:** Never capture pages with sensitive tokens in URL

```typescript
// Add to execute.ts
const blockedPatterns = [
  /localhost/i,
  /127\./,
  /10\.\d+\.\d+\.\d+/,
  /192\.168\./,
  /172\.(1[6-9]|2\d|3[01])\./,
];

function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (blockedPatterns.some(p => p.test(parsed.hostname))) {
      return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
```

---

## Success Metrics

1. **Adoption Rate:** % of UI-related tasks that include visual proof
2. **User Satisfaction:** Feedback on "helpfulness of screenshots"
3. **Self-Verification:** % of screenshots that catch issues before user reports
4. **Performance:** Average capture time < 15 seconds

---

## Future Extensions

1. **Before/After Comparison:** Capture both, render side-by-side
2. **Diff Visualization:** Highlight changed regions
3. **Video Recording:** Short clips for multi-step flows
4. **Automated Regression:** Compare screenshot to baseline
5. **Live View Link:** Embed Firecrawl liveViewUrl for real-time watch
