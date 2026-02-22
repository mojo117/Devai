import { afterEach, describe, expect, it } from 'vitest';
import { clearAllStates } from '../state-manager/core.js';
import { getState } from '../stateManager.js';
import {
  setChapoPlan,
} from './chapoControlTools.js';

describe('chapoControlTools', () => {
  const sessionId = 'chapo-control-tools-test';

  afterEach(() => {
    clearAllStates();
  });

  it('stores a validated lightweight chapo plan', () => {
    const result = setChapoPlan(sessionId, {
      title: 'Short execution plan',
      steps: [
        { id: 's1', text: 'Inspect logs', owner: 'chapo', status: 'todo' },
        { id: 's2', text: 'Delegate fix to DEVO', owner: 'devo', status: 'doing' },
      ],
    });

    expect(result.success).toBe(true);
    const plan = getState(sessionId)?.taskContext.gatheredInfo.chapoPlan as {
      title?: string;
      steps?: Array<{ id: string; owner: string; status: string }>;
      version?: number;
    };
    expect(plan?.title).toBe('Short execution plan');
    expect(plan?.steps).toHaveLength(2);
    expect(plan?.steps?.[1].owner).toBe('devo');
    expect(plan?.version).toBe(1);
  });
});
