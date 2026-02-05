// apps/api/src/agents/deterministicRouter/router.test.ts
import { describe, expect, it } from 'vitest';
import { routeAnalysis, topologicalSort } from './index.js';
import type { CapabilityAnalysis } from '../analyzer/types.js';

describe('Deterministic Router', () => {
  it('routes web_search to scout', () => {
    const analysis: CapabilityAnalysis = {
      needs: { web_search: true, code_read: false, code_write: false, devops: false, clarification: false },
      tasks: [{ description: 'Search weather', capability: 'web_search' }],
      confidence: 'high',
    };

    const result = routeAnalysis(analysis);

    expect(result.type).toBe('execute');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks![0].agent).toBe('scout');
  });

  it('routes code_write to koda', () => {
    const analysis: CapabilityAnalysis = {
      needs: { web_search: false, code_read: true, code_write: true, devops: false, clarification: false },
      tasks: [
        { description: 'Read file', capability: 'code_read' },
        { description: 'Edit file', capability: 'code_write', depends_on: 0 },
      ],
      confidence: 'high',
    };

    const result = routeAnalysis(analysis);

    expect(result.type).toBe('execute');
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks![0].agent).toBe('koda');
    expect(result.tasks![1].agent).toBe('koda');
  });

  it('routes devops to devo', () => {
    const analysis: CapabilityAnalysis = {
      needs: { web_search: false, code_read: false, code_write: false, devops: true, clarification: false },
      tasks: [{ description: 'Git push', capability: 'devops' }],
      confidence: 'high',
    };

    const result = routeAnalysis(analysis);

    expect(result.type).toBe('execute');
    expect(result.tasks![0].agent).toBe('devo');
  });

  it('returns question when clarification needed', () => {
    const analysis: CapabilityAnalysis = {
      needs: { web_search: false, code_read: false, code_write: false, devops: false, clarification: true },
      tasks: [{ description: 'Unclear', capability: 'code_read' }],
      question: 'What file?',
      confidence: 'low',
    };

    const result = routeAnalysis(analysis);

    expect(result.type).toBe('question');
    expect(result.question).toBe('What file?');
  });

  it('sorts tasks by dependency', () => {
    const tasks = [
      { index: 0, description: 'A', capability: 'code_read' as const, agent: 'koda' as const },
      { index: 1, description: 'B', capability: 'code_write' as const, depends_on: 2, agent: 'koda' as const },
      { index: 2, description: 'C', capability: 'web_search' as const, depends_on: 0, agent: 'scout' as const },
    ];

    const sorted = topologicalSort(tasks);

    // A (0) must come before C (2), C must come before B (1)
    const indexOrder = sorted.map(t => t.index);
    expect(indexOrder.indexOf(0)).toBeLessThan(indexOrder.indexOf(2));
    expect(indexOrder.indexOf(2)).toBeLessThan(indexOrder.indexOf(1));
  });
});
