# Vision/Image Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let CHAPO/SCOUT see images directly in LLM requests using ZAI's GLM-4.6V vision models, so pinned images (from Telegram or Web UI) are understood by the AI instead of showing "(Content not available)".

**Architecture:** Extend `LLMMessage.content` to support multimodal content blocks (text + image_url). When pinned userfiles include images, fetch the binary from Supabase Storage, base64-encode it, and include it as an `image_url` content block. The ZAI provider auto-switches to a vision model when images are present.

**Tech Stack:** ZAI GLM-4.6V (OpenAI-compatible API), Supabase Storage, base64 encoding, sharp (image resizing)

---

### Task 1: Extend LLMMessage types for multimodal content

**Files:**
- Modify: `apps/api/src/llm/types.ts`

**Step 1: Add content block types**

```typescript
export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image_url';
  image_url: { url: string };
}

export type ContentBlock = TextContentBlock | ImageContentBlock;
```

**Step 2: Update LLMMessage.content**

Change `content: string` to `content: string | ContentBlock[]`.

**Step 3: Add helper function**

```typescript
export function getTextContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}
```

**Step 4: Verify no type errors**

Run: `cd /opt/Klyde/projects/Devai && npx tsc --noEmit -p apps/api/tsconfig.json`

Fix any type errors from the union type change (places that assume `content` is always a string).

**Step 5: Commit**

```bash
git add apps/api/src/llm/types.ts
git commit -m "feat: extend LLMMessage.content to support multimodal content blocks"
```

---

### Task 2: Update userfileContext to return ContentBlock[]

**Files:**
- Modify: `apps/api/src/services/userfileContext.ts`

**Step 1: Change return type**

Change `buildUserfileContext` to return `Promise<ContentBlock[]>` instead of `Promise<string>`.

**Step 2: Add image detection helper**

```typescript
const IMAGE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
]);

function isImageFile(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType);
}
```

**Step 3: Add Supabase Storage download helper**

```typescript
async function downloadFromStorage(storagePath: string): Promise<Buffer> {
  const { data, error } = await getSupabase()
    .storage
    .from('userfiles')
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download file: ${error?.message || 'no data'}`);
  }

  return Buffer.from(await data.arrayBuffer());
}
```

**Step 4: Add image resize helper**

Images > 1MB get resized to max 1024px on the longest side to keep requests reasonable:

```typescript
async function resizeImageIfNeeded(buffer: Buffer, mimeType: string): Promise<Buffer> {
  if (buffer.length <= 1024 * 1024) return buffer;

  const sharp = (await import('sharp')).default;
  return sharp(buffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .toFormat(mimeType === 'image/png' ? 'png' : 'jpeg', { quality: 85 })
    .toBuffer();
}
```

**Step 5: Rebuild buildUserfileContext**

For each file:
- If image: download from storage, resize, base64 encode, return `ImageContentBlock` + label `TextContentBlock`
- If parsed text: return `TextContentBlock` with existing file block format
- If metadata-only: return `TextContentBlock` with attachment label

Keep the 50KB budget for text blocks only. Images bypass the budget (they go directly to the vision model).

**Step 6: Commit**

```bash
git add apps/api/src/services/userfileContext.ts
git commit -m "feat: return ContentBlock[] from userfileContext with base64 image support"
```

---

### Task 3: Update dispatcher to handle multimodal content

**Files:**
- Modify: `apps/api/src/workflow/commands/dispatcher.ts`

**Step 1: Update the augmented message construction (lines 339-350)**

```typescript
const fileBlocks = await buildUserfileContext(command.pinnedUserfileIds);
let augmentedMessage: string | ContentBlock[];

if (fileBlocks.some(b => b.type === 'image_url')) {
  // Multimodal: keep as ContentBlock array
  augmentedMessage = [...fileBlocks, { type: 'text', text: message }];
} else {
  // Text-only: flatten to plain string for backwards compat
  const textContext = fileBlocks
    .filter((b): b is TextContentBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n\n');
  augmentedMessage = textContext ? textContext + '\n\n' + message : message;
}
```

**Step 2: Ensure augmentedMessage propagates through processRequest**

Check the `processRequest` function signature and the message construction in the agent loops (chapoLoop, etc.) to ensure `string | ContentBlock[]` is accepted and passed to the LLM provider.

**Step 3: Commit**

```bash
git add apps/api/src/workflow/commands/dispatcher.ts
git commit -m "feat: handle multimodal content blocks in dispatcher"
```

---

### Task 4: Update ZAI provider for vision support

**Files:**
- Modify: `apps/api/src/llm/providers/zai.ts`

**Step 1: Handle array content in convertMessage()**

For user messages with `ContentBlock[]` content, map to OpenAI multimodal format:

```typescript
if (message.role === 'user' || message.role === 'assistant') {
  if (Array.isArray(message.content)) {
    messages.push({
      role: message.role,
      content: message.content.map(block => {
        if (block.type === 'image_url') {
          return { type: 'image_url' as const, image_url: block.image_url };
        }
        return { type: 'text' as const, text: block.text };
      }),
    });
    return;
  }
  // existing string path...
}
```

**Step 2: Auto-switch to vision model**

In `generate()`, detect images and switch model:

```typescript
const hasImages = request.messages.some(m =>
  Array.isArray(m.content) && m.content.some(b => b.type === 'image_url')
);
const model = hasImages
  ? (request.model?.includes('4.6v') ? request.model : 'glm-4.6v-flash')
  : (request.model || 'glm-4.7');
```

**Step 3: Add vision models to listModels()**

Add `'glm-4.6v'`, `'glm-4.6v-flash'`, `'glm-4.6v-flashx'` to the array.

**Step 4: Commit**

```bash
git add apps/api/src/llm/providers/zai.ts
git commit -m "feat: add vision model support to ZAI provider"
```

---

### Task 5: Wire through the agent layer

**Files:**
- Modify: Whatever files sit between `dispatcher.ts` → `processRequest()` → agent loops → `provider.generate()`

**Step 1: Trace the message path**

Find where the user message string gets wrapped into an `LLMMessage` and ensure it accepts `string | ContentBlock[]`.

**Step 2: Update type signatures**

Any function that builds the user message for the LLM needs to accept multimodal content.

**Step 3: Verify end-to-end**

Test by uploading an image in the web UI, pinning it, and sending a message like "What do you see in this image?" — the AI should describe the image content.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire multimodal content through agent layer"
```

---

## Notes

- **Free tier**: `glm-4.6v-flash` (9B) is completely free and handles most image tasks well
- **Base URL**: Same as text models (`https://api.z.ai/api/coding/paas/v4`)
- **Image limits**: Up to 4K resolution, arbitrary aspect ratios
- **Base64 inflation**: ~33% overhead, mitigated by resizing images > 1MB
- **Other providers**: Anthropic/OpenAI/Gemini can be added later with the same `ContentBlock[]` pattern
