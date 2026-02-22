import { describe, expect, it, beforeEach } from 'vitest';
import { pushToInbox, drainInbox, peekInbox, clearInbox, onInboxMessage, offInboxMessage } from './inbox.js';
import type { InboxMessage } from './types.js';

function makeMsg(content: string, source: 'websocket' | 'telegram' = 'websocket'): InboxMessage {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    content,
    receivedAt: new Date(),
    acknowledged: false,
    source,
  };
}

describe('SessionInbox', () => {
  const sessionId = 'test-session';

  beforeEach(() => {
    clearInbox(sessionId);
  });

  it('pushToInbox adds a message and peekInbox returns it', () => {
    const msg = makeMsg('hello');
    pushToInbox(sessionId, msg);
    const peeked = peekInbox(sessionId);
    expect(peeked).toHaveLength(1);
    expect(peeked[0].content).toBe('hello');
  });

  it('drainInbox returns all messages and clears the queue', () => {
    pushToInbox(sessionId, makeMsg('first'));
    pushToInbox(sessionId, makeMsg('second'));
    const drained = drainInbox(sessionId);
    expect(drained).toHaveLength(2);
    expect(drained[0].content).toBe('first');
    expect(drained[1].content).toBe('second');
    expect(peekInbox(sessionId)).toHaveLength(0);
  });

  it('peekInbox does not remove messages', () => {
    pushToInbox(sessionId, makeMsg('stay'));
    peekInbox(sessionId);
    expect(peekInbox(sessionId)).toHaveLength(1);
  });

  it('different sessions are independent', () => {
    pushToInbox('a', makeMsg('for-a'));
    pushToInbox('b', makeMsg('for-b'));
    expect(peekInbox('a')).toHaveLength(1);
    expect(peekInbox('b')).toHaveLength(1);
    expect(peekInbox('a')[0].content).toBe('for-a');
  });

  it('clearInbox removes all messages for a session', () => {
    pushToInbox(sessionId, makeMsg('gone'));
    clearInbox(sessionId);
    expect(peekInbox(sessionId)).toHaveLength(0);
  });
});

describe('SessionEventBus', () => {
  const sessionId = 'bus-test';

  beforeEach(() => {
    clearInbox(sessionId);
  });

  it('onInboxMessage fires when pushToInbox is called', () => {
    const received: InboxMessage[] = [];
    const handler = (msg: InboxMessage) => received.push(msg);
    onInboxMessage(sessionId, handler);

    const msg = makeMsg('event-test');
    pushToInbox(sessionId, msg);

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe('event-test');

    offInboxMessage(sessionId, handler);
  });

  it('offInboxMessage stops notifications', () => {
    const received: InboxMessage[] = [];
    const handler = (msg: InboxMessage) => received.push(msg);
    onInboxMessage(sessionId, handler);
    offInboxMessage(sessionId, handler);

    pushToInbox(sessionId, makeMsg('should-not-fire'));
    expect(received).toHaveLength(0);
  });

  it('multiple handlers on the same session all fire', () => {
    let count1 = 0;
    let count2 = 0;
    const h1 = () => { count1++; };
    const h2 = () => { count2++; };
    onInboxMessage(sessionId, h1);
    onInboxMessage(sessionId, h2);

    pushToInbox(sessionId, makeMsg('multi'));

    expect(count1).toBe(1);
    expect(count2).toBe(1);

    offInboxMessage(sessionId, h1);
    offInboxMessage(sessionId, h2);
  });
});
