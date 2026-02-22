import { describe, expect, it } from 'vitest';
import { isGreeting, shouldAttachPinnedContext } from './pinnedContextPolicy.js';

describe('pinnedContextPolicy', () => {
  it('recognizes greetings', () => {
    expect(isGreeting('Hi')).toBe(true);
    expect(isGreeting('moin!')).toBe(true);
    expect(isGreeting('hello')).toBe(true);
    expect(isGreeting('what is in the image?')).toBe(false);
  });

  it('does not attach pinned context for plain small talk', () => {
    expect(shouldAttachPinnedContext('Hi')).toBe(false);
    expect(shouldAttachPinnedContext('Hallo')).toBe(false);
    expect(shouldAttachPinnedContext('How are you?')).toBe(false);
  });

  it('attaches pinned context for media-related prompts', () => {
    expect(shouldAttachPinnedContext('What is in the image?')).toBe(true);
    expect(shouldAttachPinnedContext('Bitte lies den Text im Bild')).toBe(true);
    expect(shouldAttachPinnedContext('Was steht in der Datei?')).toBe(true);
    expect(shouldAttachPinnedContext('Summarize the attachment')).toBe(true);
  });
});
