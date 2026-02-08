// apps/api/src/agents/analyzer/analyzer.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeRequest } from './index.js';
import { llmRouter } from '../../llm/router.js';

vi.mock('../../llm/router.js', () => ({
  llmRouter: {
    generate: vi.fn(),
  },
}));

describe('Capability Analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('analyzes web search request correctly', async () => {
    vi.mocked(llmRouter.generate).mockResolvedValueOnce({
      content: JSON.stringify({
        needs: { web_search: true, code_read: false, code_write: false, devops: false, clarification: false },
        tasks: [{ description: 'Search for weather', capability: 'web_search' }],
        confidence: 'high',
      }),
      finishReason: 'stop',
    });

    const result = await analyzeRequest('What is the weather in Berlin?');

    expect(result.analysis.needs.web_search).toBe(true);
    expect(result.analysis.needs.code_read).toBe(false);
    expect(result.analysis.tasks).toHaveLength(1);
    expect(result.analysis.tasks[0].capability).toBe('web_search');
  });

  it('analyzes code change request correctly', async () => {
    vi.mocked(llmRouter.generate).mockResolvedValueOnce({
      content: JSON.stringify({
        needs: { web_search: false, code_read: true, code_write: true, devops: false, clarification: false },
        tasks: [
          { description: 'Read existing code', capability: 'code_read' },
          { description: 'Modify the file', capability: 'code_write', depends_on: 0 },
        ],
        confidence: 'high',
      }),
      finishReason: 'stop',
    });

    const result = await analyzeRequest('Add error handling to the login function');

    expect(result.analysis.needs.code_read).toBe(true);
    expect(result.analysis.needs.code_write).toBe(true);
    expect(result.analysis.tasks).toHaveLength(2);
  });

  it('handles clarification requests', async () => {
    vi.mocked(llmRouter.generate).mockResolvedValueOnce({
      content: JSON.stringify({
        needs: { web_search: false, code_read: false, code_write: false, devops: false, clarification: true },
        tasks: [{ description: 'Clarify request', capability: 'code_read' }],
        question: 'Which file should I modify?',
        confidence: 'low',
      }),
      finishReason: 'stop',
    });

    const result = await analyzeRequest('Fix it');

    expect(result.analysis.needs.clarification).toBe(true);
    expect(result.analysis.question).toBe('Which file should I modify?');
  });

  it('falls back to keyword detection on invalid JSON', async () => {
    vi.mocked(llmRouter.generate).mockResolvedValueOnce({
      content: 'Sorry, I cannot help with that.',
      finishReason: 'stop',
    });

    const result = await analyzeRequest('What is the weather in Frankfurt?');

    // Fallback should detect "weather" and set web_search
    expect(result.analysis.needs.web_search).toBe(true);
  });
});
