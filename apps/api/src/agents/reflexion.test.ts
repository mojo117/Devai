import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock llmRouter before importing
vi.mock('../llm/router.js', () => ({
  llmRouter: {
    generateWithFallback: vi.fn(),
  },
}));

import { reviewAnswer } from './reflexion.js';
import { llmRouter } from '../llm/router.js';

describe('reviewAnswer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-approves short answers (< 200 chars)', async () => {
    const result = await reviewAnswer('question', 'Short answer.', 'zai');
    expect(result.approved).toBe(true);
    expect(llmRouter.generateWithFallback).not.toHaveBeenCalled();
  });

  it('approves when LLM returns APPROVED', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'APPROVED',
      finishReason: 'stop',
    } as any);

    const result = await reviewAnswer(
      'How does auth work?',
      'A'.repeat(250),
      'zai',
      'glm-4.7-flash',
    );
    expect(result.approved).toBe(true);
    expect(result.feedback).toBeUndefined();
  });

  it('rejects when LLM returns ISSUES', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'ISSUES: The answer does not address the original question about authentication.',
      finishReason: 'stop',
    } as any);

    const result = await reviewAnswer(
      'How does auth work?',
      'A'.repeat(250),
      'zai',
      'glm-4.7-flash',
    );
    expect(result.approved).toBe(false);
    expect(result.feedback).toContain('does not address');
  });

  it('approves by default when LLM call fails', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockRejectedValueOnce(new Error('LLM down'));

    const result = await reviewAnswer(
      'question',
      'A'.repeat(250),
      'zai',
    );
    expect(result.approved).toBe(true);
  });

  it('approves on ambiguous LLM response', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'The answer seems fine overall.',
      finishReason: 'stop',
    } as any);

    const result = await reviewAnswer(
      'question',
      'A'.repeat(250),
      'zai',
    );
    expect(result.approved).toBe(true);
  });
});
