import type { ActionPreview } from './types.js';
import { readFile } from '../tools/fs.js';
import { config } from '../config.js';

export async function buildActionPreview(
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<ActionPreview | undefined> {
  if (toolName !== 'fs.writeFile' && toolName !== 'fs.edit') {
    return undefined;
  }

  const path = typeof toolArgs.path === 'string' ? toolArgs.path : undefined;
  if (!path) {
    return {
      kind: 'diff',
      path: '<unknown>',
      diff: 'Preview unavailable: missing path.',
    };
  }

  if (toolName === 'fs.writeFile') {
    const content = typeof toolArgs.content === 'string' ? toolArgs.content : '';
    const oldContent = await tryRead(path);
    const diff = createUnifiedDiff(path, oldContent ?? '', content, oldContent !== null);
    return { kind: 'diff', path, diff };
  }

  if (toolName === 'fs.edit') {
    const oldString = typeof toolArgs.old_string === 'string' ? toolArgs.old_string : '';
    const newString = typeof toolArgs.new_string === 'string' ? toolArgs.new_string : '';
    const oldContent = await tryRead(path);

    if (oldContent === null) {
      return {
        kind: 'diff',
        path,
        diff: 'Preview unavailable: file could not be read.',
      };
    }

    const occurrences = oldString ? oldContent.split(oldString).length - 1 : 0;
    if (!oldString || occurrences === 0) {
      return { kind: 'diff', path, diff: 'Preview error: old_string not found.' };
    }
    if (occurrences > 1) {
      return { kind: 'diff', path, diff: `Preview error: old_string found ${occurrences} times.` };
    }

    const newContent = oldContent.replace(oldString, newString);
    const diff = createUnifiedDiff(path, oldContent, newContent, true);
    return { kind: 'diff', path, diff };
  }

  return undefined;
}

async function tryRead(path: string): Promise<string | null> {
  try {
    const result = await readFile(path);
    return result.content;
  } catch {
    return null;
  }
}

function createUnifiedDiff(path: string, oldContent: string, newContent: string, existed: boolean): string {
  if (oldContent === newContent) {
    return 'No changes.';
  }

  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  const maxCells = 200_000;
  const totalCells = oldLines.length * newLines.length;

  if (totalCells > maxCells) {
    return [
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@',
      `Diff preview too large (${oldLines.length} -> ${newLines.length} lines).`,
    ].join('\n');
  }

  const diffLines = computeLineDiff(oldLines, newLines);
  const header = [
    `--- a/${path}${existed ? '' : ' (new file)'}`,
    `+++ b/${path}`,
    '@@',
  ];

  const output: string[] = [...header];
  let currentLength = header.join('\n').length + 1;

  for (const line of diffLines) {
    const text = `${line.prefix}${line.value}`;
    currentLength += text.length + 1;
    if (currentLength > config.toolMaxDiffChars) {
      output.push('... (diff truncated)');
      break;
    }
    output.push(text);
  }

  return output.join('\n');
}

function splitLines(content: string): string[] {
  if (!content) return [''];
  const lines = content.split('\n');
  return lines;
}

function computeLineDiff(oldLines: string[], newLines: string[]): Array<{ prefix: string; value: string }> {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff: Array<{ prefix: string; value: string }> = [];
  let i = 0;
  let j = 0;

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      diff.push({ prefix: ' ', value: oldLines[i] });
      i += 1;
      j += 1;
      continue;
    }

    if (dp[i][j + 1] >= dp[i + 1][j]) {
      diff.push({ prefix: '+', value: newLines[j] });
      j += 1;
    } else {
      diff.push({ prefix: '-', value: oldLines[i] });
      i += 1;
    }
  }

  while (i < m) {
    diff.push({ prefix: '-', value: oldLines[i] });
    i += 1;
  }
  while (j < n) {
    diff.push({ prefix: '+', value: newLines[j] });
    j += 1;
  }

  return diff;
}
