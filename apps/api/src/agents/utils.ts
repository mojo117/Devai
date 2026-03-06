const MAX_TOOL_RESULT_CHARS = 12_000;
const HEAD_RATIO = 0.8;

function truncateToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  const headLen = Math.floor(MAX_TOOL_RESULT_CHARS * HEAD_RATIO);
  const tailLen = MAX_TOOL_RESULT_CHARS - headLen - 120;
  const dropped = content.length - headLen - tailLen;
  return (
    content.slice(0, headLen) +
    `\n\n...[TRUNCATED: ${dropped.toLocaleString()} characters omitted — use offset/limit to read specific sections]...\n\n` +
    content.slice(-tailLen)
  );
}

export function buildToolResultContent(result: { success: boolean; result?: unknown; error?: string }): { content: string; isError: boolean } {
  if (result.success) {
    const value = result.result === undefined ? '' : JSON.stringify(result.result);
    return { content: truncateToolResult(value || 'OK'), isError: false };
  }
  const content = result.error ? `Error: ${result.error}` : 'Error: Tool failed without a message.';
  return { content, isError: true };
}
