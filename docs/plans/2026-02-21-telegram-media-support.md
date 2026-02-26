# Telegram Media Support (Voice, Documents, Photos)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the Telegram bot webhook to handle voice messages (transcribe via Whisper), document uploads, and photo uploads — reusing existing Web-UI infrastructure.

**Architecture:** Extract transcription and userfile upload logic into shared services, then wire them into the Telegram webhook handler. No new endpoints, no DB changes, no frontend changes.

**Tech Stack:** OpenAI Whisper API, Supabase Storage, Telegram Bot API (getFile)

---

### Task 1: Extract transcription service

**Files:**
- Create: `apps/api/src/services/transcriptionService.ts`
- Modify: `apps/api/src/routes/transcribe.ts`

**Step 1: Create transcriptionService.ts**

Extract the core Whisper logic from `routes/transcribe.ts` into a reusable function:

```typescript
import OpenAI from 'openai';
import { Readable } from 'stream';

const WHISPER_MAX_SIZE = 25 * 1024 * 1024; // 25MB

export async function transcribeBuffer(
  buffer: Buffer,
  filename: string,
): Promise<string> {
  if (buffer.length === 0) throw new Error('Audio file is empty');
  if (buffer.length > WHISPER_MAX_SIZE) throw new Error('Audio file exceeds 25MB Whisper limit');

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const file = new File([buffer], filename, { type: 'audio/ogg' });

  const result = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
  });

  return result.text || '';
}
```

**Step 2: Refactor routes/transcribe.ts to use the service**

Replace inline Whisper logic with a call to `transcribeBuffer(buffer, filename)`. The route stays as a thin wrapper: parse multipart → call service → return JSON.

**Step 3: Verify existing Web-UI dictation still works**

Run: `curl -X POST http://10.0.0.5:3009/api/transcribe -F "file=@test.webm"` (with auth)

**Step 4: Commit**

```bash
git add apps/api/src/services/transcriptionService.ts apps/api/src/routes/transcribe.ts
git commit -m "refactor: extract transcription service from route handler"
```

---

### Task 2: Extract userfile upload service

**Files:**
- Create: `apps/api/src/services/userfileService.ts`
- Modify: `apps/api/src/routes/userfiles.ts`

**Step 1: Create userfileService.ts**

Extract from `routes/userfiles.ts` the core upload logic into:

```typescript
export interface UploadResult {
  success: boolean;
  file: {
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    parseStatus: string;
  };
}

export async function uploadUserfileFromBuffer(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
): Promise<UploadResult>
```

This function handles:
- Extension whitelist validation
- Filename sanitization
- Supabase Storage upload
- File content parsing (via existing fileParser)
- DB insert into user_files table
- Returns file info with parse_status

**Step 2: Refactor routes/userfiles.ts to use the service**

The POST handler becomes: parse multipart → extract Buffer → call `uploadUserfileFromBuffer()` → return result.

**Step 3: Verify existing Web-UI upload still works**

Test by uploading a file through the Web-UI at devai.klyde.tech.

**Step 4: Commit**

```bash
git add apps/api/src/services/userfileService.ts apps/api/src/routes/userfiles.ts
git commit -m "refactor: extract userfile upload service from route handler"
```

---

### Task 3: Extend Telegram types and add file download

**Files:**
- Modify: `apps/api/src/external/telegram.ts`

**Step 1: Extend TelegramUpdate interface**

Add the missing Telegram message fields:

```typescript
interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

// Add to existing TelegramUpdate.message:
voice?: TelegramVoice;
document?: TelegramDocument;
photo?: TelegramPhotoSize[];
caption?: string;
```

**Step 2: Add downloadTelegramFile function**

```typescript
export async function downloadTelegramFile(fileId: string): Promise<{
  buffer: Buffer;
  filePath: string;
}> {
  const token = config.telegramBotToken;

  // Step 1: Get file path from Telegram
  const fileInfo = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
  ).then(r => r.json());

  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error('Failed to get file from Telegram');
  }

  // Step 2: Download the file
  const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error('Failed to download Telegram file');

  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, filePath: fileInfo.result.file_path };
}
```

**Step 3: Extend extractTelegramMessage**

Return additional fields: `voice`, `document`, `photo`, `caption`.

**Step 4: Commit**

```bash
git add apps/api/src/external/telegram.ts
git commit -m "feat: add Telegram voice, document, photo types and file download"
```

---

### Task 4: Wire voice messages into webhook handler

**Files:**
- Modify: `apps/api/src/routes/external.ts`

**Step 1: Add voice handling branch**

In the webhook handler, after extracting the message, check for `voice` before text:

```typescript
if (msg.voice) {
  // 1. Download voice file from Telegram
  const { buffer } = await downloadTelegramFile(msg.voice.file_id);

  // 2. Transcribe via Whisper
  const text = await transcribeBuffer(buffer, 'voice.ogg');

  if (!text.trim()) {
    await sendTelegramMessage(chatId, 'Konnte keine Sprache erkennen.');
    return;
  }

  // 3. Echo transcription back to user
  await sendTelegramMessage(chatId, `🎤 ${text}`);

  // 4. Process as normal text request
  // ... dispatch as user_request with transcribed text
}
```

**Step 2: Verify voice messages work**

Send a voice message to the Telegram bot and verify:
- Transcription echoed back
- CHAPO processes and responds

**Step 3: Commit**

```bash
git add apps/api/src/routes/external.ts
git commit -m "feat: handle Telegram voice messages via Whisper transcription"
```

---

### Task 5: Wire document and photo uploads into webhook handler

**Files:**
- Modify: `apps/api/src/routes/external.ts`

**Step 1: Add document handling branch**

```typescript
if (msg.document) {
  const { buffer } = await downloadTelegramFile(msg.document.file_id);
  const filename = msg.document.file_name || `document_${Date.now()}`;
  const mimeType = msg.document.mime_type || 'application/octet-stream';

  try {
    const result = await uploadUserfileFromBuffer(buffer, filename, mimeType);
    // Auto-pin to session
    // ... add result.file.id to session's pinned userfiles

    if (msg.caption) {
      // Caption present → process as request with file in context
      // ... dispatch as user_request with caption text + pinned file
    } else {
      await sendTelegramMessage(chatId, `📎 ${filename} hochgeladen und gepinnt`);
    }
  } catch (err) {
    await sendTelegramMessage(chatId, `Upload fehlgeschlagen: ${err.message}`);
  }
}
```

**Step 2: Add photo handling branch**

```typescript
if (msg.photo && msg.photo.length > 0) {
  // Take largest photo version
  const largest = msg.photo[msg.photo.length - 1];
  const { buffer } = await downloadTelegramFile(largest.file_id);
  const filename = `photo_${Date.now()}.jpg`;

  try {
    const result = await uploadUserfileFromBuffer(buffer, filename, 'image/jpeg');
    // Auto-pin to session
    // ... add result.file.id to session's pinned userfiles

    if (msg.caption) {
      // ... dispatch as user_request with caption text + pinned file
    } else {
      await sendTelegramMessage(chatId, `📷 Foto hochgeladen und gepinnt`);
    }
  } catch (err) {
    await sendTelegramMessage(chatId, `Upload fehlgeschlagen: ${err.message}`);
  }
}
```

**Step 3: Implement auto-pin mechanism**

Store pinned file IDs on the external session (either in-memory or in DB). When dispatching the next command, pass `pinnedUserfileIds` to the dispatcher so `buildUserfileContext()` includes the file content.

Options for storage:
- Add `pinned_userfile_ids TEXT[]` column to `external_sessions` table
- Or store in-memory Map keyed by session ID (simpler, but lost on restart)

Preferred: DB column for persistence across restarts.

**Step 4: Verify document and photo uploads work**

- Send a PDF to the bot → confirm upload + pin confirmation
- Send a photo with caption → confirm upload + CHAPO processes caption with photo context

**Step 5: Commit**

```bash
git add apps/api/src/routes/external.ts
git commit -m "feat: handle Telegram document and photo uploads with auto-pin"
```

---

### Task 6: Add pinned_userfile_ids to external_sessions

**Files:**
- Modify: `apps/api/src/db/queries.ts` or create migration

**Step 1: Add column via Supabase Management API**

```sql
ALTER TABLE external_sessions
ADD COLUMN pinned_userfile_ids TEXT[] DEFAULT '{}';
```

**Step 2: Add DB helper functions**

```typescript
export async function addPinnedUserfile(sessionId: string, fileId: string): Promise<void>
export async function getPinnedUserfileIds(sessionId: string): Promise<string[]>
export async function clearPinnedUserfiles(sessionId: string): Promise<void>
```

**Step 3: Wire into external.ts webhook handler**

- After upload: `addPinnedUserfile(session.session_id, fileId)`
- Before dispatch: `getPinnedUserfileIds(session.session_id)` → pass to dispatcher

**Step 4: Commit**

```bash
git add apps/api/src/db/queries.ts apps/api/src/routes/external.ts
git commit -m "feat: persist pinned userfile IDs on external sessions"
```

---

### Task 7: Error handling and edge cases

**Files:**
- Modify: `apps/api/src/routes/external.ts`

**Edge cases to handle:**

1. **Unsupported file type** → Bot replies: "Dateityp .exe nicht unterstützt. Erlaubt: PDF, DOCX, XLSX, TXT, MD, CSV, PNG, JPG"
2. **File too large (>10MB userfile / >20MB Telegram bot limit)** → Bot replies with size error
3. **Whisper API failure** → Bot replies: "Transkription fehlgeschlagen, bitte erneut versuchen"
4. **Telegram file download failure** → Bot replies with download error
5. **Empty voice (no speech detected)** → Bot replies: "Konnte keine Sprache erkennen"
6. **Multiple media in one message** → Process first media type found (voice > document > photo > text)

**Step 1: Add error handling wrappers**

**Step 2: Test all edge cases**

**Step 3: Commit**

```bash
git add apps/api/src/routes/external.ts
git commit -m "feat: add error handling for Telegram media edge cases"
```
