import { afterEach, describe, expect, it } from 'vitest';
import {
  devoExecSessionPoll,
  devoExecSessionStart,
  devoExecSessionWrite,
  resetExecSessionsForTests,
} from './execSession.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('execSession tools', () => {
  afterEach(() => {
    resetExecSessionsForTests();
  });

  it('starts and polls a short-lived command', async () => {
    const started = await devoExecSessionStart('printf "hello-session"', {
      timeoutMs: 5000,
    });

    const polled = await devoExecSessionPoll(started.sessionId, { maxBytes: 4096 });
    const combined = `${started.initialOutput}${polled.output}`;

    expect(started.sessionId.length).toBeGreaterThan(0);
    expect(combined).toContain('hello-session');
  });

  it('blocks arbitrary input by default and allows control input', async () => {
    const started = await devoExecSessionStart('cat', { timeoutMs: 2000 });

    await expect(
      devoExecSessionWrite(started.sessionId, 'hello\n'),
    ).rejects.toThrow('allowArbitraryInput=true');

    const writeControl = await devoExecSessionWrite(started.sessionId, '\n');
    expect(writeControl.success).toBe(true);
  });

  it('allows arbitrary input when session is started with allowArbitraryInput=true', async () => {
    const started = await devoExecSessionStart('cat', {
      timeoutMs: 2000,
      allowArbitraryInput: true,
    });

    await devoExecSessionWrite(started.sessionId, 'abc123\n');
    await sleep(30);
    const polled = await devoExecSessionPoll(started.sessionId, { maxBytes: 4096 });

    const combined = `${started.initialOutput}${polled.output}`;
    expect(combined).toContain('abc123');
  });

  it('rejects interactive shell startup commands', async () => {
    await expect(
      devoExecSessionStart('bash', { timeoutMs: 2000 }),
    ).rejects.toThrow('Interactive shell startup is not allowed');
  });
});
