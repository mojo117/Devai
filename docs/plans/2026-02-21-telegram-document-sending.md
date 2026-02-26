# Telegram Document Sending Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable CAIO to send documents (from filesystem, Supabase Storage, or URLs) to the user via Telegram.

**Architecture:** Add a `sendTelegramDocument()` function to the Telegram client, create a new `telegram_send_document` tool, wire it into the executor, and grant CAIO access. The chat ID is resolved automatically from the default notification channel (existing `external_sessions` table). No new dependencies.

**Tech Stack:** TypeScript, Fastify, Telegram Bot API (`sendDocument` endpoint), Supabase Storage, Node.js `fs/promises`

---

### Task 1: Add `sendTelegramDocument()` to Telegram Client

**Files:**
- Modify: `apps/api/src/external/telegram.ts:93` (after `sendTelegramMessage`)

**Step 1: Add the `sendTelegramDocument` function**

Add after `sendTelegramMessage` (line 93), before `sendTelegramChatAction` (line 95):

```typescript
const TELEGRAM_CAPTION_MAX = 1024;

export interface TelegramDocumentResult {
  messageId: number;
  filename: string;
}

/**
 * Send a document (file) to a Telegram chat via the Bot API sendDocument endpoint.
 * Uses multipart/form-data to upload the buffer as a file.
 */
export async function sendTelegramDocument(
  chatId: string | number,
  buffer: Buffer,
  filename: string,
  caption?: string,
): Promise<TelegramDocumentResult> {
  const token = config.telegramBotToken;
  if (!token) {
    throw new Error('Telegram bot token not configured');
  }

  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error('File too large for Telegram (max 50MB)');
  }

  // Send upload_document action first
  await sendTelegramChatAction(chatId, 'upload_document');

  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  formData.append('document', new Blob([buffer]), filename);
  if (caption) {
    formData.append('caption', caption.slice(0, TELEGRAM_CAPTION_MAX));
    formData.append('parse_mode', 'Markdown');
  }

  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Telegram sendDocument failed (${response.status}): ${text}`);
  }

  const result = await response.json() as {
    ok: boolean;
    result?: { message_id: number };
  };

  if (!result.ok || !result.result?.message_id) {
    throw new Error('Telegram sendDocument returned unexpected response');
  }

  return {
    messageId: result.result.message_id,
    filename,
  };
}
```

**Step 2: Verify the file compiles**

Run: `cd /opt/Klyde/projects/Devai && npx tsc --noEmit apps/api/src/external/telegram.ts 2>&1 | head -20`
Expected: No errors (or only unrelated ones from other files).

**Step 3: Commit**

```bash
git add apps/api/src/external/telegram.ts
git commit -m "feat: add sendTelegramDocument() to Telegram client"
```

---

### Task 2: Add `telegram_send_document` Tool to Registry

**Files:**
- Modify: `apps/api/src/tools/registry.ts:64` (ToolName union)
- Modify: `apps/api/src/tools/registry.ts:1089` (TOOL_REGISTRY array, after `send_email`)

**Step 1: Add tool name to the `ToolName` type union**

At `registry.ts:64`, add after `| 'send_email'`:

```typescript
  // Telegram Tools (CAIO)
  | 'telegram_send_document';
```

**Step 2: Add tool definition to `TOOL_REGISTRY` array**

At `registry.ts:1104`, add after the `send_email` definition (before the closing `]`):

```typescript
  // Telegram Document Tool (CAIO agent)
  {
    name: 'telegram_send_document',
    description: 'Sende ein Dokument/eine Datei an den Benutzer via Telegram. Quellen: Dateisystem (path), Supabase Storage (fileId), oder URL.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Dateiquelle: "filesystem" (lokaler Pfad), "supabase" (Supabase userfile ID), oder "url" (HTTP/HTTPS URL)',
          enum: ['filesystem', 'supabase', 'url'],
        },
        path: {
          type: 'string',
          description: 'Pfad, Supabase File-ID, oder URL je nach source',
        },
        caption: {
          type: 'string',
          description: 'Optionale Bildunterschrift/Beschreibung (max 1024 Zeichen)',
        },
        filename: {
          type: 'string',
          description: 'Optionaler Dateiname (default: wird aus path abgeleitet)',
        },
      },
      required: ['source', 'path'],
    },
    requiresConfirmation: false,
  },
```

**Step 3: Commit**

```bash
git add apps/api/src/tools/registry.ts
git commit -m "feat: register telegram_send_document tool definition"
```

---

### Task 3: Create Telegram Tool Module + Add Executor Case

**Files:**
- Create: `apps/api/src/tools/telegram.ts`
- Modify: `apps/api/src/tools/executor.ts:14` (add import)
- Modify: `apps/api/src/tools/executor.ts:349-355` (add case before `default`)

**Step 1: Create `apps/api/src/tools/telegram.ts`**

```typescript
/**
 * Telegram document sending tool — resolves file from source and sends via Telegram Bot API.
 */

import { readFile } from 'fs/promises';
import { basename } from 'path';
import { sendTelegramDocument } from '../external/telegram.js';
import { getDefaultNotificationChannel } from '../db/schedulerQueries.js';
import { getUserfileById } from '../db/userfileQueries.js';
import { getSupabase } from '../db/index.js';
import type { ToolExecutionResult } from './executor.js';

type DocumentSource = 'filesystem' | 'supabase' | 'url';

const STORAGE_BUCKET = 'userfiles';
const TELEGRAM_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

async function resolveChatId(): Promise<string> {
  const channel = await getDefaultNotificationChannel();
  if (channel?.external_chat_id) {
    return channel.external_chat_id;
  }
  throw new Error('No default Telegram notification channel configured. Send a message to the bot first.');
}

async function resolveFromFilesystem(path: string): Promise<{ buffer: Buffer; filename: string }> {
  const buffer = await readFile(path);
  return { buffer, filename: basename(path) };
}

async function resolveFromSupabase(fileId: string): Promise<{ buffer: Buffer; filename: string }> {
  const file = await getUserfileById(fileId);
  if (!file) {
    throw new Error(`Supabase userfile not found: ${fileId}`);
  }

  const { data, error } = await getSupabase()
    .storage
    .from(STORAGE_BUCKET)
    .download(file.storage_path);

  if (error || !data) {
    throw new Error(`Failed to download from Supabase Storage: ${error?.message || 'no data'}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  return { buffer, filename: file.original_name || file.filename };
}

async function resolveFromUrl(url: string): Promise<{ buffer: Buffer; filename: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch URL (${response.status}): ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // Extract filename from URL path or Content-Disposition
  const disposition = response.headers.get('content-disposition');
  let filename = 'document';
  if (disposition) {
    const match = disposition.match(/filename="?([^";\n]+)"?/);
    if (match) filename = match[1];
  } else {
    const urlPath = new URL(url).pathname;
    const urlFilename = basename(urlPath);
    if (urlFilename && urlFilename.includes('.')) {
      filename = urlFilename;
    }
  }
  return { buffer, filename };
}

export async function telegramSendDocument(
  source: DocumentSource,
  path: string,
  caption?: string,
  overrideFilename?: string,
): Promise<ToolExecutionResult> {
  try {
    // 1. Resolve chat ID from default notification channel
    const chatId = await resolveChatId();

    // 2. Resolve file buffer + filename based on source
    let buffer: Buffer;
    let filename: string;

    switch (source) {
      case 'filesystem':
        ({ buffer, filename } = await resolveFromFilesystem(path));
        break;
      case 'supabase':
        ({ buffer, filename } = await resolveFromSupabase(path));
        break;
      case 'url':
        ({ buffer, filename } = await resolveFromUrl(path));
        break;
      default:
        return { success: false, error: `Unknown source: ${source}. Use "filesystem", "supabase", or "url".` };
    }

    // Use override filename if provided
    if (overrideFilename) {
      filename = overrideFilename;
    }

    // 3. Size check
    if (buffer.length > TELEGRAM_MAX_FILE_SIZE) {
      return {
        success: false,
        error: `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Telegram limit is 50MB.`,
      };
    }

    // 4. Send via Telegram
    const result = await sendTelegramDocument(chatId, buffer, filename, caption);

    return {
      success: true,
      result: {
        messageId: result.messageId,
        filename: result.filename,
        sizeBytes: buffer.length,
        chatId,
        source,
      },
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to send document: ${errMsg}` };
  }
}
```

**Step 2: Add import to executor.ts**

At `executor.ts:14`, add after `import * as emailTools`:

```typescript
import * as telegramTools from './telegram.js';
```

**Step 3: Add case to executor switch**

At `executor.ts:354` (after the `send_email` case, before `default:`), add:

```typescript
        // Telegram Tools (CAIO agent)
        case 'telegram_send_document':
          return telegramTools.telegramSendDocument(
            args.source as 'filesystem' | 'supabase' | 'url',
            args.path as string,
            args.caption as string | undefined,
            args.filename as string | undefined,
          );
```

**Step 4: Verify compilation**

Run: `cd /opt/Klyde/projects/Devai && npx tsc --noEmit 2>&1 | head -30`
Expected: Clean compile or only pre-existing errors.

**Step 5: Commit**

```bash
git add apps/api/src/tools/telegram.ts apps/api/src/tools/executor.ts
git commit -m "feat: implement telegram document sending tool + executor wiring"
```

---

### Task 4: Grant CAIO Access to the New Tool

**Files:**
- Modify: `apps/api/src/agents/caio.ts:44` (tools array)
- Modify: `apps/api/src/prompts/caio.ts:60-63` (DEINE FÄHIGKEITEN section)

**Step 1: Add tool to CAIO's tool list**

At `caio.ts:44`, add after `'send_email'`:

```typescript
    // Telegram document sending
    'telegram_send_document',
```

**Step 2: Update CAIO's system prompt**

At `prompts/caio.ts`, in the `## DEINE FÄHIGKEITEN` section, after the "Benachrichtigungen & E-Mail" subsection (around line 62), add:

```typescript
### Telegram – Dokumente senden
- telegram_send_document(source, path, caption?, filename?) - Datei an den Benutzer via Telegram senden
  - source: "filesystem" (lokaler Pfad), "supabase" (Userfile-ID), oder "url" (HTTP-URL)
  - path: Je nach source der Pfad, die File-ID, oder die URL
  - caption: Optionale Beschreibung (max 1024 Zeichen)
  - filename: Optionaler Dateiname-Override
  - Chat-ID wird automatisch aus dem Default-Kanal aufgelöst
  - Max Dateigröße: 50MB (Telegram-Limit)
```

Also add a new workflow example after the existing "Fortschritt zusammenfassen" workflow section:

```typescript
**Dokument senden:**
1. Dateiquelle bestimmen (Dateisystem, Supabase, URL)
2. telegram_send_document(source, path, caption) - Dokument senden
3. Bestätigung an CHAPO mit Dateiname und Größe
```

**Step 3: Commit**

```bash
git add apps/api/src/agents/caio.ts apps/api/src/prompts/caio.ts
git commit -m "feat: grant CAIO access to telegram_send_document tool"
```

---

### Task 5: Manual Integration Test

**No files to modify — testing only.**

**Step 1: Verify the tool is registered**

After the API restarts (Mutagen sync), check the tool registry by searching the API logs or calling the health endpoint.

Alternatively, verify by reading the compiled output:

Run: `cd /opt/Klyde/projects/Devai && grep -r "telegram_send_document" apps/api/src/ --include="*.ts" | wc -l`
Expected: At least 5 matches (registry ToolName, TOOL_REGISTRY entry, executor case, caio.ts tools array, telegram.ts module).

**Step 2: Test via Telegram**

Send a message to the Devai Telegram bot asking it to send a file:
- "Schick mir die package.json von Devai als Dokument"

This should trigger CHAPO → delegate to CAIO → `telegram_send_document(source: "filesystem", path: "package.json")` → file arrives in Telegram chat.

**Step 3: Test with Supabase userfile**

If you have previously uploaded a file via Telegram, ask:
- "Schick mir das letzte hochgeladene Dokument zurück"

This tests the `supabase` source path.

**Step 4: Test with URL**

- "Schick mir die Datei von https://example.com/some-file.pdf"

This tests the `url` source path.

---

## Summary of Changes

| File | Action | What |
|------|--------|------|
| `apps/api/src/external/telegram.ts` | Modify | Add `sendTelegramDocument()` function |
| `apps/api/src/tools/registry.ts` | Modify | Add `telegram_send_document` to ToolName + TOOL_REGISTRY |
| `apps/api/src/tools/telegram.ts` | Create | File source resolution + send logic |
| `apps/api/src/tools/executor.ts` | Modify | Add import + switch case |
| `apps/api/src/agents/caio.ts` | Modify | Add tool to CAIO's whitelist |
| `apps/api/src/prompts/caio.ts` | Modify | Document new capability + workflow |

**Total: 5 modified files, 1 new file. No new dependencies.**
