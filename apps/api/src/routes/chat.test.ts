import { describe, expect, it, vi } from 'vitest';
import type { ToolCall } from '../llm/types.js';
import { handleToolCall } from './chat.js';

vi.mock('../actions/preview.js', () => ({
  buildActionPreview: vi.fn().mockResolvedValue(undefined),
}));

describe('chat plan gate', () => {
  it('requires approval for confirmation actions', async () => {
    const toolCall: ToolCall = {
      id: 'tool-1',
      name: 'askForConfirmation',
      arguments: {
        toolName: 'fs_writeFile',
        toolArgs: { path: 'README.md', content: 'hi' },
        description: 'Write to file: README.md',
      },
    };

    const result = await handleToolCall(toolCall, null, undefined);
    expect(result).toMatch(/Action created:/i);
    expect(result).toMatch(/requires your approval/i);
    expect(result).toMatch(/Action ID:/i);
  });
});
