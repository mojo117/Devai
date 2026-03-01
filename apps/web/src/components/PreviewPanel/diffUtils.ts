/**
 * Compute a simple unified diff between two texts.
 * Produces output in standard unified diff format for LLM consumption.
 * Not a full LCS — uses a simple line-by-line comparison with context.
 */
export function computeUnifiedDiff(
  oldText: string,
  newText: string,
  filename: string,
): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const hunks: string[] = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    // Skip matching lines
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
      continue;
    }

    // Found a difference — collect the hunk
    const hunkStartOld = i;
    const hunkStartNew = j;
    const removedLines: string[] = [];
    const addedLines: string[] = [];

    // Collect consecutive removed lines
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      // Check if this old line appears soon in new lines (within 3 lines)
      let foundAhead = false;
      for (let k = j; k < Math.min(j + 3, newLines.length); k++) {
        if (oldLines[i] === newLines[k]) {
          // Collect added lines before the match
          while (j < k) {
            addedLines.push(newLines[j]);
            j++;
          }
          foundAhead = true;
          break;
        }
      }
      if (foundAhead) break;
      removedLines.push(oldLines[i]);
      i++;
    }

    // Collect consecutive added lines
    while (j < newLines.length && (i >= oldLines.length || newLines[j] !== oldLines[i])) {
      addedLines.push(newLines[j]);
      j++;
    }

    if (removedLines.length === 0 && addedLines.length === 0) continue;

    // Build hunk header
    const oldCount = removedLines.length;
    const newCount = addedLines.length;
    hunks.push(
      `@@ -${hunkStartOld + 1},${oldCount} +${hunkStartNew + 1},${newCount} @@`,
    );
    for (const line of removedLines) {
      hunks.push(`-${line}`);
    }
    for (const line of addedLines) {
      hunks.push(`+${line}`);
    }
  }

  if (hunks.length === 0) return '';

  return [
    `--- ${filename} (before)`,
    `+++ ${filename} (after)`,
    ...hunks,
  ].join('\n');
}
