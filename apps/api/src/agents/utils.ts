export function buildToolResultContent(result: { success: boolean; result?: unknown; error?: string }): { content: string; isError: boolean } {
  if (result.success) {
    const value = result.result === undefined ? '' : JSON.stringify(result.result);
    return { content: value || 'OK', isError: false };
  }
  const content = result.error ? `Error: ${result.error}` : 'Error: Tool failed without a message.';
  return { content, isError: true };
}
