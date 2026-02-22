import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalOutputProjection } from './externalOutputProjection.js';
import { createEvent } from '../events/envelope.js';
import type { EventContext } from '../events/envelope.js';
import { WF_COMPLETED } from '../events/catalog.js';

vi.mock('../../db/schedulerQueries.js', () => ({
  getExternalSessionBySessionId: vi.fn(),
}));

vi.mock('../../external/telegram.js', () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue(undefined),
  sendTelegramChatAction: vi.fn().mockResolvedValue(undefined),
  sendTelegramDocument: vi.fn().mockResolvedValue({ messageId: 1, filename: 'image.png' }),
}));

import { getExternalSessionBySessionId } from '../../db/schedulerQueries.js';
import {
  sendTelegramMessage,
  sendTelegramDocument,
} from '../../external/telegram.js';

function makeCtx(overrides?: Partial<EventContext>): EventContext {
  return {
    sessionId: 'sess-1',
    requestId: 'req-1',
    turnId: 'turn-1',
    ...overrides,
  };
}

function createImageResponse(body = 'img', headers?: Record<string, string>): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-length': String(body.length),
      ...headers,
    },
  });
}

describe('ExternalOutputProjection', () => {
  let projection: ExternalOutputProjection;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    projection = new ExternalOutputProjection();
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();

    vi.mocked(getExternalSessionBySessionId).mockResolvedValue({
      platform: 'telegram',
      external_chat_id: 'chat-123',
    } as Awaited<ReturnType<typeof getExternalSessionBySessionId>>);

    globalThis.fetch = vi.fn(async () => createImageResponse()) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends Telegram message and forwards allowed image URL as document', async () => {
    const answer = [
      'Hier ist dein Bild:',
      'https://oaidalleapiprodscus.blob.core.windows.net/private/img-abc.png?rsct=image/png',
    ].join('\n');

    const event = createEvent(makeCtx(), WF_COMPLETED, { answer });

    await projection.handle(event);

    expect(sendTelegramMessage).toHaveBeenCalledWith('chat-123', answer);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('oaidalleapiprodscus.blob.core.windows.net'),
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(sendTelegramDocument).toHaveBeenCalledTimes(1);
    expect(sendTelegramDocument).toHaveBeenCalledWith(
      'chat-123',
      expect.any(Buffer),
      expect.stringContaining('.png'),
    );
  });

  it('does not fetch or forward image URLs from non-allowlisted hosts', async () => {
    const answer = 'Bild: https://example.com/img-abc.png';
    const event = createEvent(makeCtx(), WF_COMPLETED, { answer });

    await projection.handle(event);

    expect(sendTelegramMessage).toHaveBeenCalledWith('chat-123', answer);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(sendTelegramDocument).not.toHaveBeenCalled();
  });

  it('does not fetch non-https URLs even if host looks valid', async () => {
    const answer = 'Bild: http://oaidalleapiprodscus.blob.core.windows.net/private/img-abc.png';
    const event = createEvent(makeCtx(), WF_COMPLETED, { answer });

    await projection.handle(event);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(sendTelegramDocument).not.toHaveBeenCalled();
  });

  it('skips forwarding when fetched content-type is not an image', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html>no image</html>', {
        status: 200,
        headers: {
          'content-type': 'text/html',
          'content-length': '21',
        },
      }),
    ) as unknown as typeof fetch;

    const answer = 'Bild: https://oaidalleapiprodscus.blob.core.windows.net/private/img-abc.png';
    const event = createEvent(makeCtx(), WF_COMPLETED, { answer });

    await projection.handle(event);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(sendTelegramDocument).not.toHaveBeenCalled();
  });

  it('skips forwarding when content-length exceeds Telegram limit', async () => {
    const arrayBufferSpy = vi.fn().mockResolvedValue(new ArrayBuffer(1));
    const oversized = {
      ok: true,
      headers: new Headers({
        'content-type': 'image/png',
        'content-length': String(51 * 1024 * 1024),
      }),
      arrayBuffer: arrayBufferSpy,
    } as unknown as Response;

    globalThis.fetch = vi.fn().mockResolvedValue(oversized) as unknown as typeof fetch;

    const answer = 'Bild: https://oaidalleapiprodscus.blob.core.windows.net/private/img-abc.png';
    const event = createEvent(makeCtx(), WF_COMPLETED, { answer });

    await projection.handle(event);

    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(sendTelegramDocument).not.toHaveBeenCalled();
  });

  it('processes at most three unique image URLs per answer', async () => {
    const urls = [
      'https://oaidalleapiprodscus.blob.core.windows.net/private/img-1.png',
      'https://oaidalleapiprodscus.blob.core.windows.net/private/img-2.png',
      'https://oaidalleapiprodscus.blob.core.windows.net/private/img-3.png',
      'https://oaidalleapiprodscus.blob.core.windows.net/private/img-4.png',
      'https://oaidalleapiprodscus.blob.core.windows.net/private/img-1.png',
    ];
    const answer = urls.join('\n');
    const event = createEvent(makeCtx(), WF_COMPLETED, { answer });

    await projection.handle(event);

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(sendTelegramDocument).toHaveBeenCalledTimes(3);
  });

  it('continues processing when one image fetch fails', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(createImageResponse('img2'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const answer = [
      'https://oaidalleapiprodscus.blob.core.windows.net/private/img-1.png',
      'https://oaidalleapiprodscus.blob.core.windows.net/private/img-2.png',
    ].join('\n');
    const event = createEvent(makeCtx(), WF_COMPLETED, { answer });

    await projection.handle(event);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendTelegramDocument).toHaveBeenCalledTimes(1);
  });
});
