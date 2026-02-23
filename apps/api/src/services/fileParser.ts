/**
 * File parser — extracts text content from uploaded documents.
 *
 * Supported:
 *  - Text files (.txt, .md, .csv): raw UTF-8
 *  - PDF: pdf-parse (text-based), Tesseract OCR (scanned)
 *  - DOCX: mammoth (extractRawText)
 *  - XLSX: xlsx (SheetJS) — each sheet as CSV-like text
 *
 * Metadata-only (no text extraction):
 *  - Images, legacy Office (.doc, .xls, .ppt), archives, email files
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readdir, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

const MAX_PARSED_BYTES = 200 * 1024; // 200 KB
const OCR_TIMEOUT_MS = 60_000; // 60s max for OCR

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

async function ocrPdf(buffer: Buffer): Promise<string | null> {
  const tempDir = await mkdtemp(join(tmpdir(), 'devai-ocr-'));
  try {
    const pdfPath = join(tempDir, 'input.pdf');
    await writeFile(pdfPath, buffer);

    // Convert PDF pages to PNG images (300 DPI for good OCR quality)
    await execFileAsync('pdftoppm', ['-png', '-r', '300', pdfPath, join(tempDir, 'page')], {
      timeout: OCR_TIMEOUT_MS,
    });

    // Find generated page images
    const files = await readdir(tempDir);
    const pageImages = files.filter(f => f.startsWith('page') && f.endsWith('.png')).sort();
    if (pageImages.length === 0) return null;

    // OCR each page
    const parts: string[] = [];
    for (const img of pageImages) {
      const imgPath = join(tempDir, img);
      const { stdout } = await execFileAsync('tesseract', [imgPath, 'stdout', '-l', 'deu+eng'], {
        timeout: OCR_TIMEOUT_MS,
      });
      if (stdout.trim()) parts.push(stdout.trim());
    }

    return parts.join('\n\n') || null;
  } catch (err) {
    console.error('[fileParser] OCR failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const uint8 = new Uint8Array(buffer);
    const parser = new PDFParse(uint8);
    await parser.load();
    const result = await parser.getText();
    const text = stripNullBytes(result.text || '');
    // Strip pdf-parse page markers (e.g. "-- 1 of 3 --") to detect scanned/empty PDFs
    const meaningful = text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, '').trim();
    if (!meaningful) {
      // Scanned PDF — try OCR
      const ocrText = await ocrPdf(buffer);
      if (ocrText?.trim()) {
        return { content: truncate(stripNullBytes(ocrText)), status: 'parsed' };
      }
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
