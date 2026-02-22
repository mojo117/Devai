import { afterEach, describe, expect, it } from 'vitest';
import { clearAllStates } from '../state-manager/core.js';
import {
  addUserRequestObligations,
  getObligations,
} from '../state-manager/obligationState.js';
import { setActiveTurnId, setOriginalRequest } from '../state-manager/sessionState.js';
import { getState } from '../stateManager.js';
import {
  listOpenInboxItems,
  preflightAnswer,
  resolveInboxItem,
  setChapoPlan,
} from './chapoControlTools.js';

describe('chapoControlTools', () => {
  const sessionId = 'chapo-control-tools-test';

  afterEach(() => {
    clearAllStates();
  });

  it('lists open inbox items with current_task scoping', () => {
    addUserRequestObligations(sessionId, 'Inbox task old', {
      turnId: 'turn-old',
      origin: 'inbox',
      blocking: true,
    });
    addUserRequestObligations(sessionId, 'Inbox task new', {
      turnId: 'turn-new',
      origin: 'inbox',
      blocking: true,
    });
    setActiveTurnId(sessionId, 'turn-new');

    const result = listOpenInboxItems(sessionId, { scope: 'current_task' });

    expect(result.scope).toBe('current_task');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].text.toLowerCase()).toContain('new');
    expect(result.turnId).toBe('turn-new');
  });

  it('resolves inbox obligations using resolution mapping', () => {
    const [created] = addUserRequestObligations(sessionId, 'Inbox task to resolve', {
      turnId: 'turn-1',
      origin: 'inbox',
      blocking: true,
    });

    const result = resolveInboxItem(sessionId, {
      id: created.obligationId,
      resolution: 'done',
      note: 'covered in partial response',
    });

    const updated = getObligations(sessionId).find((item) => item.obligationId === created.obligationId);
    expect(result.success).toBe(true);
    expect(updated?.status).toBe('satisfied');
    expect(updated?.evidence.join(' ')).toContain('covered in partial response');
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

  it('flags missing coverage, contradiction, and unverifiable claims in preflight', () => {
    setOriginalRequest(sessionId, 'Please answer in English and include weather status.');
    setActiveTurnId(sessionId, 'turn-live');
    addUserRequestObligations(sessionId, 'Include weather status', {
      turnId: 'turn-live',
      origin: 'primary',
      blocking: true,
    });

    const result = preflightAnswer(sessionId, {
      draft: 'Done: email sent. It is done, but it also failed and is not done.',
      strict: true,
    });

    const issueTypes = result.issues.map((issue) => issue.type);
    expect(result.ok).toBe(false);
    expect(issueTypes).toContain('missing_answer');
    expect(issueTypes).toContain('contradiction');
    expect(issueTypes).toContain('unverified_claim');
  });
});
