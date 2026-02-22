import { afterEach, describe, expect, it } from 'vitest';
import { clearAllStates } from './core.js';
import { setActiveTurnId } from './sessionState.js';
import {
  addUserRequestObligations,
  getObligations,
  getUnresolvedObligations,
  waiveObligationsExceptTurn,
} from './obligationState.js';

describe('obligationState turn scoping', () => {
  const sessionId = 'obligation-turn-test';

  afterEach(() => {
    clearAllStates();
  });

  it('filters unresolved obligations by turn and blocking flag', () => {
    setActiveTurnId(sessionId, 'turn-a');
    addUserRequestObligations(sessionId, 'Primary task A', {
      turnId: 'turn-a',
      origin: 'primary',
      blocking: true,
    });
    addUserRequestObligations(sessionId, 'Inbox follow-up A', {
      turnId: 'turn-a',
      origin: 'inbox',
      blocking: false,
    });
    addUserRequestObligations(sessionId, 'Primary task B', {
      turnId: 'turn-b',
      origin: 'primary',
      blocking: true,
    });

    const unresolvedTurnABlocking = getUnresolvedObligations(sessionId, {
      turnId: 'turn-a',
      blockingOnly: true,
    });
    const unresolvedTurnAAll = getUnresolvedObligations(sessionId, {
      turnId: 'turn-a',
    });

    expect(unresolvedTurnABlocking).toHaveLength(1);
    expect(unresolvedTurnABlocking[0].description).toContain('Primary task A');
    expect(unresolvedTurnAAll).toHaveLength(2);
  });

  it('waives unresolved obligations from older turns', () => {
    addUserRequestObligations(sessionId, 'Old turn task', {
      turnId: 'turn-old',
      origin: 'primary',
      blocking: true,
    });
    addUserRequestObligations(sessionId, 'Current turn task', {
      turnId: 'turn-new',
      origin: 'primary',
      blocking: true,
    });

    const waived = waiveObligationsExceptTurn(
      sessionId,
      'turn-new',
      'Waived in test.',
    );
    const obligations = getObligations(sessionId);
    const oldTurn = obligations.find((item) => item.turnId === 'turn-old');
    const newTurn = obligations.find((item) => item.turnId === 'turn-new');

    expect(waived).toBe(1);
    expect(oldTurn?.status).toBe('waived');
    expect(newTurn?.status).toBe('open');
  });
});
