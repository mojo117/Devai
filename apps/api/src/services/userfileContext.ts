/**
 * Builds file context blocks to inject into AI conversation messages.
 * Returns ContentBlock[] to support multimodal (text + image) content.
 */

import { getSupabase } from '../db/index.js';
import { getUserfilesByIds } from '../db/userfileQueries.js';
import type { UserfileRow } from '../db/userfileQueries.js';
import type { ContentBlock } from '../llm/types.js';

const MAX_TEXT_BYTES = 50 * 1024; // 50 KB text budget
const STORAGE_BUCKET = 'userfiles';

const IMAGE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
]);

function isImageFile(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function downloadFromStorage(storagePath: string): Promise<Buffer> {
  const { data, error } = await getSupabase()
    .storage
    .from(STORAGE_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download file: ${error?.message || 'no data'}`);
  }

  return Buffer.from(await data.arrayBuffer());
}

function buildFileBlock(file: UserfileRow): string {
  const header = `[Attached File: ${file.original_name} | Type: ${file.mime_type} | Size: ${formatFileSize(file.size_bytes)}]`;

  if (file.parse_status === 'parsed' && file.parsed_content) {
    return `${header}\n--- Content ---\n${file.parsed_content}\n--- End File ---`;
  }

  if (file.parse_status === 'failed') {
    return `${header}\n(Content extraction failed)`;
  }

  return `${header}\n(Content not available -- binary file type)`;
}

export async function buildUserfileContext(fileIds: string[]): Promise<ContentBlock[]> {
  if (fileIds.length === 0) return [];

  const files = await getUserfilesByIds(fileIds);
  if (files.length === 0) return [];

  const blocks: ContentBlock[] = [];
  const textEntries: Array<{ file: UserfileRow; block: string }> = [];

  // Process each file
  for (const file of files) {
    if (isImageFile(file.mime_type)) {
      // Image file: download from storage, convert to base64, add as image_url block
      try {
        const buffer = await downloadFromStorage(file.storage_path);
        const base64 = buffer.toString('base64');
        const dataUri = `data:${file.mime_type};base64,${base64}`;

        blocks.push({
          type: 'image_url',
          image_url: { url: dataUri },
        });
        // Add a text label so the AI knows the filename
        blocks.push({
          type: 'text',
          text: `[Image: ${file.original_name} | ${formatFileSize(file.size_bytes)}]`,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Download failed';
        console.error(`[userfileContext] Failed to load image ${file.original_name}:`, errMsg);
        blocks.push({
          type: 'text',
          text: `[Attached Image: ${file.original_name} | Error: ${errMsg}]`,
        });
      }
    } else {
      // Text-based file: use existing buildFileBlock logic
      textEntries.push({ file, block: buildFileBlock(file) });
    }
  }

  // Apply 50KB budget to text entries only (images bypass the budget)
  const totalTextLength = textEntries.reduce((sum, e) => sum + e.block.length, 0);

  if (totalTextLength <= MAX_TEXT_BYTES) {
    // Under budget: add all text blocks as-is
    for (const entry of textEntries) {
      blocks.push({ type: 'text', text: entry.block });
    }
  } else {
    // Over budget: truncate largest parsed-content files first
    const withContent = textEntries
      .filter((e) => e.file.parse_status === 'parsed' && !!e.file.parsed_content)
      .sort((a, b) => b.block.length - a.block.length);

    const withoutContent = textEntries.filter(
      (e) => !(e.file.parse_status === 'parsed' && !!e.file.parsed_content)
    );
    const fixedSize = withoutContent.reduce((sum, e) => sum + e.block.length, 0);

    let remainingBudget = MAX_TEXT_BYTES - fixedSize;
    const budgetPerFile = withContent.length > 0
      ? Math.floor(remainingBudget / withContent.length)
      : 0;

    for (const entry of textEntries) {
      const hasParsed = entry.file.parse_status === 'parsed' && !!entry.file.parsed_content;

      if (!hasParsed) {
        blocks.push({ type: 'text', text: entry.block });
        continue;
      }

      if (entry.block.length <= budgetPerFile) {
        blocks.push({ type: 'text', text: entry.block });
        remainingBudget -= entry.block.length;
      } else {
        const header = `[Attached File: ${entry.file.original_name} | Type: ${entry.file.mime_type} | Size: ${formatFileSize(entry.file.size_bytes)}]`;
        const prefix = `${header}\n--- Content ---\n`;
        const suffix = `\n[content truncated for context budget]\n--- End File ---`;
        const available = budgetPerFile - prefix.length - suffix.length;
        if (available > 0 && entry.file.parsed_content) {
          blocks.push({
            type: 'text',
            text: prefix + entry.file.parsed_content.slice(0, available) + suffix,
          });
        } else {
          blocks.push({
            type: 'text',
            text: `${header}\n(Content truncated -- exceeds context budget)`,
          });
        }
        remainingBudget -= budgetPerFile;
      }
    }
  }

  return blocks;
}
