import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaApiError, sendTextMessage } from './meta-api';

// throwMetaError isn't exported — exercised indirectly through any
// send helper that hits a non-OK response. sendTextMessage is the
// simplest one.
function errorFetch(body: unknown) {
  return vi.fn(async () => ({
    ok: false,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const BASE = {
  phoneNumberId: 'test-phone',
  accessToken: 'test-token',
  to: '1234567890',
  text: 'hi',
} as const;

describe('throwMetaError / MetaApiError', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', errorFetch({}));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws a MetaApiError carrying Meta's code/type/error_data, not just message", async () => {
    vi.stubGlobal(
      'fetch',
      errorFetch({
        error: {
          message: 'Template name does not exist',
          code: 132001,
          type: 'OAuthException',
          error_data: { details: 'Template order_update does not exist' },
        },
      })
    );

    const err = await sendTextMessage(BASE).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Template name does not exist');
    expect(err.code).toBe(132001);
    expect(err.type).toBe('OAuthException');
    expect(err.errorData).toEqual({
      details: 'Template order_update does not exist',
    });
  });

  it("falls back to the caller-supplied message when the body isn't Meta's error envelope", async () => {
    vi.stubGlobal('fetch', errorFetch({ unexpected: 'shape' }));

    const err = await sendTextMessage(BASE).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.code).toBeUndefined();
    // The fallback text is whatever sendTextMessage's call site passes —
    // just assert it's still a usable, non-empty message.
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("falls back gracefully when the response body isn't JSON at all", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => {
          throw new Error('not json');
        },
      })) as unknown as typeof fetch
    );

    const err = await sendTextMessage(BASE).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.code).toBeUndefined();
    expect(typeof err.message).toBe('string');
  });
});
