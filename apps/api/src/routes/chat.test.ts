import { describe, expect, it, vi } from 'vitest';
import type { ToolCall } from '../llm/types.js';
import { handleToolCall } from './chat.js';

vi.mock('../actions/preview.js', () => ({
  buildActionPreview: vi.fn().mockResolvedValue(undefined),
}));

describe('chat plan gate', () => {
  it('blocks confirmation actions when plan is not approved', async () => {
    const toolCall: ToolCall = {
      id: 'tool-1',
      name: 'askForConfirmation',
      arguments: {
        toolName: 'fs_writeFile',
        toolArgs: { path: 'README.md', content: 'hi' },
        description: 'Write to file: README.md',
      },
    };

    const result = await handleToolCall(toolCall, null, undefined, false);
    expect(result).toMatch(/Plan not approved/i);
  });
});
