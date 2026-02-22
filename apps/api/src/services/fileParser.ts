/**
 * File parser — extracts text content from uploaded documents.
 *
 * Supported:
 *  - Text files (.txt, .md, .csv): raw UTF-8
 *  - PDF: pdf-parse
 *  - DOCX: mammoth (extractRawText)
 *  - XLSX: xlsx (SheetJS) — each sheet as CSV-like text
 *
 * Metadata-only (no text extraction):
 *  - Images, legacy Office (.doc, .xls, .ppt), archives, email files
 */

const MAX_PARSED_BYTES = 200 * 1024; // 200 KB

export interface ParseResult {
  content: string | null;
  status: 'parsed' | 'metadata_only' | 'failed';
  error?: string;
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv']);

const METADATA_ONLY_EXTENSIONS = new Set([
  '.doc', '.xls', '.ppt', '.pptx',
  '.msg', '.eml', '.oft',
  '.zip',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
]);

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function truncate(text: string): string {
  if (text.length <= MAX_PARSED_BYTES) return text;
  return text.slice(0, MAX_PARSED_BYTES) + `\n[truncated, ${text.length} chars total]`;
}

function stripNullBytes(text: string): string {
  return text.replace(/\0/g, '');
}

async function parseText(buffer: Buffer): Promise<ParseResult> {
  const raw = buffer.toString('utf-8');
  return { content: truncate(stripNullBytes(raw)), status: 'parsed' };
}

async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    const text = stripNullBytes(result.text || '');
    if (!text.trim()) {
      return { content: null, status: 'metadata_only' };
    }
    return { content: truncate(text), status: 'parsed' };
  } catch (err) {
    return {
      content: null,
      status: 'failed',
      error: err instanceof Error ? err.message : 'PDF parse failed',
    };
  }
}

async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const text = stripNullBytes(result.value || '');
    if (!text.trim()) {
      return { content: null, status: 'metadata_only' };
    }
    return { content: truncate(text), status: 'parsed' };
  } catch (err) {
    return {
      content: null,
      status: 'failed',
      error: err instanceof Error ? err.message : 'DOCX parse failed',
    };
  }
}

async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  try {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const parts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) {
        parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
      }
    }

    const text = stripNullBytes(parts.join('\n\n'));
    if (!text.trim()) {
      return { content: null, status: 'metadata_only' };
    }
    return { content: truncate(text), status: 'parsed' };
  } catch (err) {
    return {
      content: null,
      status: 'failed',
      error: err instanceof Error ? err.message : 'XLSX parse failed',
    };
  }
}

export async function parseFileContent(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ParseResult> {
  const ext = getExtension(filename);

  // Metadata-only types — skip parsing entirely
  if (METADATA_ONLY_EXTENSIONS.has(ext)) {
    return { content: null, status: 'metadata_only' };
  }

  // Text-based files
  if (TEXT_EXTENSIONS.has(ext)) {
    try {
      return await parseText(buffer);
    } catch (err) {
      return {
        content: null,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Text parse failed',
      };
    }
  }

  // PDF
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    return parsePdf(buffer);
  }

  // DOCX
  if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return parseDocx(buffer);
  }

  // XLSX
  if (ext === '.xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return parseXlsx(buffer);
  }

  // Unknown — treat as metadata-only
  return { content: null, status: 'metadata_only' };
}
