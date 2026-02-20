/**
 * Builds file context blocks to inject into AI conversation messages.
 *
 * When users pin uploaded files, their parsed content is prepended to the
 * user message so the AI can reference the file contents.
 *
 * Total injection budget: 50 KB. If files exceed this, the largest files
 * are truncated first.
 */

import { getUserfilesByIds } from '../db/userfileQueries.js';
import type { UserfileRow } from '../db/userfileQueries.js';

const MAX_TOTAL_BYTES = 50 * 1024; // 50 KB injection budget

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function buildFileBlock(file: UserfileRow): string {
  const header = `[Attached File: ${file.original_name} | Type: ${file.mime_type} | Size: ${formatFileSize(file.size_bytes)}]`;

  if (file.parse_status === 'parsed' && file.parsed_content) {
    return `${header}\n--- Content ---\n${file.parsed_content}\n--- End File ---`;
  }

  if (file.parse_status === 'failed') {
    return `${header}\n(Content extraction failed)`;
  }

  // metadata_only or no content
  return `${header}\n(Content not available -- binary file type)`;
}

export async function buildUserfileContext(fileIds: string[]): Promise<string> {
  if (fileIds.length === 0) return '';

  const files = await getUserfilesByIds(fileIds);

  if (files.length === 0) return '';

  // Build blocks for each file, tracking which ones have parseable content
  interface FileEntry {
    file: UserfileRow;
    block: string;
    contentLength: number;
    hasParsedContent: boolean;
  }

  const entries: FileEntry[] = files.map((file) => {
    const block = buildFileBlock(file);
    return {
      file,
      block,
      contentLength: block.length,
      hasParsedContent: file.parse_status === 'parsed' && !!file.parsed_content,
    };
  });

  // Check total size
  const totalLength = entries.reduce((sum, e) => sum + e.contentLength, 0);

  if (totalLength <= MAX_TOTAL_BYTES) {
    return entries.map((e) => e.block).join('\n\n');
  }

  // Over budget — truncate largest parsed-content files first
  // Sort by content length descending to truncate largest first
  const withContent = entries
    .filter((e) => e.hasParsedContent)
    .sort((a, b) => b.contentLength - a.contentLength);

  const withoutContent = entries.filter((e) => !e.hasParsedContent);
  const fixedSize = withoutContent.reduce((sum, e) => sum + e.contentLength, 0);

  let remainingBudget = MAX_TOTAL_BYTES - fixedSize;
  const budgetPerFile = withContent.length > 0
    ? Math.floor(remainingBudget / withContent.length)
    : 0;

  const truncatedBlocks: string[] = [];

  for (const entry of entries) {
    if (!entry.hasParsedContent) {
      truncatedBlocks.push(entry.block);
      continue;
    }

    if (entry.contentLength <= budgetPerFile) {
      truncatedBlocks.push(entry.block);
      remainingBudget -= entry.contentLength;
    } else {
      // Truncate this file's block
      const header = `[Attached File: ${entry.file.original_name} | Type: ${entry.file.mime_type} | Size: ${formatFileSize(entry.file.size_bytes)}]`;
      const prefix = `${header}\n--- Content ---\n`;
      const suffix = `\n[content truncated for context budget]\n--- End File ---`;
      const available = budgetPerFile - prefix.length - suffix.length;
      if (available > 0 && entry.file.parsed_content) {
        truncatedBlocks.push(prefix + entry.file.parsed_content.slice(0, available) + suffix);
      } else {
        truncatedBlocks.push(`${header}\n(Content truncated -- exceeds context budget)`);
      }
      remainingBudget -= budgetPerFile;
    }
  }

  return truncatedBlocks.join('\n\n');
}
