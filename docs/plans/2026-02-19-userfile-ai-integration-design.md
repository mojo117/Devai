# Userfile AI Integration Design

**Date:** 2026-02-19
**Status:** Approved

## Overview

Enable the AI chat to access uploaded files by parsing content at upload time
and auto-injecting it into conversation context. Files are stored securely in
Supabase with a 30-day auto-deletion lifecycle.

## Decisions

| Decision | Choice |
|----------|--------|
| AI access mode | Auto-inject content into user message |
| Unparseable files | Metadata only (filename, type, size) |
| File scope | Global per user, accessible from any session |
| Parseable types | Text + PDF + DOCX + XLSX/CSV |
| Storage backend | Supabase Storage + Supabase DB |
| Context injection point | Prepend to user message |

---

## 1. Storage & Lifecycle

### Supabase Storage

Private bucket `userfiles`. Files uploaded via the API, which proxies them to
Supabase Storage. No public URLs. The local `/opt/Userfiles/` directory is
retired.

### Metadata Table (`user_files`)

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `filename` | text | Sanitized filename |
| `original_name` | text | Original upload name |
| `mime_type` | text | MIME type |
| `size_bytes` | integer | File size |
| `storage_path` | text | Path in Supabase bucket |
| `uploaded_at` | timestamptz | Upload timestamp |
| `expires_at` | timestamptz | uploaded_at + 30 days |
| `parsed_content` | text (nullable) | Extracted text for AI |
| `parse_status` | text | `parsed`, `metadata_only`, `failed` |

### 30-Day Cleanup

Daily job (startup + 24h interval in `server.ts`): query rows where
`expires_at < now()`, batch-delete from Storage + DB.

### Upload Flow

1. User uploads file via multipart POST
2. API validates extension + size (existing logic)
3. API uploads file to Supabase Storage bucket
4. API parses content (text/PDF/DOCX/XLSX)
5. API inserts DB row with metadata + parsed content
6. Returns file info to frontend

---

## 2. File Parsing

### Parseable Types

| Type | Library | Approach |
|------|---------|----------|
| `.txt`, `.md`, `.csv` | Built-in (`Buffer.toString`) | Direct UTF-8 read |
| `.pdf` | `pdf-parse` | Extract all text pages |
| `.docx` | `mammoth` | Convert to plain text |
| `.xlsx` | `xlsx` (SheetJS) | Convert each sheet to CSV-like text |

### Metadata-Only Types

- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`
- Email: `.msg`, `.eml`, `.oft`
- Archives: `.zip`
- Legacy Office: `.doc`, `.xls`, `.ppt`, `.pptx`

### Parsing Rules

- Max parsed content: **200KB of text** (truncate with
  `[truncated, X chars total]` marker)
- Parsing happens synchronously during upload (files are max 10MB)
- If parsing throws: catch, set `parse_status = 'failed'`, store error.
  Upload still succeeds.

### New Dependencies (3 packages)

- `pdf-parse` -- lightweight PDF text extraction, no native deps
- `mammoth` -- DOCX to plain text
- `xlsx` -- SheetJS, handles .xlsx and .csv

---

## 3. AI Context Injection

### How the AI Sees Files

When a user sends a message with pinned files, content blocks are prepended
to the user message before it reaches the LLM.

**Parsed file format:**
```
[Attached File: report.pdf | Type: application/pdf | Size: 245KB]
--- Content ---
<parsed text here>
--- End File ---
```

**Metadata-only format:**
```
[Attached File: photo.png | Type: image/png | Size: 1.2MB]
(Content not available -- binary file type)
```

### Where This Happens

In `CommandDispatcher.handleRequest()`, before calling `processRequest()`:

1. Read `pinnedFiles` array from the command (list of file IDs)
2. Query Supabase DB for those file records
3. Build context blocks from `parsed_content` (or metadata fallback)
4. Prepend to the user message

### Context Budget

- Per-file limit: 200KB of text
- Total injection limit: **50KB** across all pinned files
- If over budget, truncate the largest files first
- Files that no longer exist (expired/deleted) produce a
  `(File expired and was removed)` note

---

## 4. API & Data Flow Changes

### Endpoints

| Endpoint | Change |
|----------|--------|
| `POST /api/userfiles` | Rewrite: upload to Supabase Storage, parse, insert DB row |
| `GET /api/userfiles` | Rewrite: query DB instead of filesystem stat |
| `DELETE /api/userfiles/:id` | Rewrite: delete from Storage + DB (by ID) |
| `GET /api/userfiles/:id/content` | **New**: returns raw parsed content |

### WebSocket Command Changes

- Add `pinnedFiles?: string[]` to `UserRequestCommand` in `types.ts`
- Update `mapWsMessageToCommand` to extract `pinnedFiles`
- `CommandDispatcher.handleRequest()` resolves file IDs -> content -> prepend

### Frontend Changes

- `UserfilesPanelContent.tsx`: adapt to new API (IDs, expiry display)
- Chat input: pass selected file IDs as `pinnedFiles` in WS `request`
- File list: show "expires in X days" per file

---

## 5. Security & Error Handling

### Access Control

- Supabase Storage bucket: **private** (no public URLs)
- All userfile endpoints protected by JWT auth (existing `preHandler` hook)
- Filename sanitization kept (alphanumeric, dots, dashes, underscores)

### Upload Validation

- Extension whitelist (unchanged)
- Max 10MB per file
- Sanitized filenames

### Parsing Safety

- Each parser runs in try/catch -- corrupt files don't crash uploads
- Parsed content sanitized: strip null bytes, limit to 200KB
- Failed parse = file still uploads with `parse_status: 'failed'`

### Context Injection Safety

- File IDs validated against DB before injection
- Total injected content capped at 50KB
- Expired/deleted files silently skipped with note to AI

### Error States

| Scenario | Behavior |
|----------|----------|
| Upload fails (Supabase down) | 500, "Upload failed, try again" |
| Parse fails (corrupt file) | Upload OK, file shows "content unavailable" |
| Pinned file expired | AI sees "(File expired and was removed)" |
| File too large to parse fully | Content truncated with marker |

---

## Allowed File Types (Summary)

### Full Content Extraction
`.txt`, `.md`, `.csv`, `.pdf`, `.docx`, `.xlsx`

### Metadata Only
`.doc`, `.xls`, `.ppt`, `.pptx`, `.msg`, `.eml`, `.oft`,
`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.zip`
