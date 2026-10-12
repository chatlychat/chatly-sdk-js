/**
 * The public browser SDK.
 *
 * One file, 215 lines, no `test` script at all — while being the documented
 * integration path for product code (`identify`, `track`, widget control).
 *
 * The properties worth pinning are the ones an integrator would notice only
 * in production: which endpoints it calls, that every write carries an
 * Idempotency-Key (the API rejects writes without one), and that the visitor
 * token survives a reload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Chatly } from './index.js';

interface Call {
  url: string;
  init: RequestInit;
}

const calls: Call[] = [];

/**
 * Minimal localStorage.
 *
 * This vitest/jsdom setup provides `window` but NOT `window.localStorage` —
 * jsdom only enables storage for a document with a real (non-opaque) origin,
 * and the failure reads as "cannot read properties of undefined", which looks
 * like a bug in the code under test rather than in the environment.
 */
function installLocalStorage(): void {
  const data = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
  Object.defineProperty(globalThis.window, 'localStorage', { value: stub, configurable: true });
}

beforeEach(() => {
  calls.length = 0;
  installLocalStorage();
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return {
      ok: true,
      status: 200,
      json: async () => ({ session: { token: 'vt_abc' } }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

function sdk() {
  return Chatly.init({ publicId: 'pub_1', apiUrl: 'https://api.test' });
}

describe('endpoints', () => {
  it('identify goes to the widget init route', async () => {
    await sdk().identify({ email: 'a@b.com' });
    expect(calls[0]?.url).toBe('https://api.test/v1/widget/init');
  });

  it('track posts to the widget events route', async () => {
    await sdk().track('signup_completed', { plan: 'pro' });
    expect(calls.some((c) => c.url.endsWith('/v1/widget/events'))).toBe(true);
  });
});

describe('request shape', () => {
  it('every write carries an Idempotency-Key', async () => {
    // The API requires one on writes; without it every SDK call 400s.
    await sdk().track('x', {});
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toMatch(/.+/);
  });

  it('mints a FRESH key per call', async () => {
    // A reused key would make the second event a silent no-op replay.
    const s = sdk();
    await s.track('a', {});
    await s.track('b', {});
    const k1 = (calls[0]?.init.headers as Record<string, string>)['idempotency-key'];
    const k2 = (calls[1]?.init.headers as Record<string, string>)['idempotency-key'];
    expect(k1).not.toBe(k2);
  });

  it('sends JSON', async () => {
    await sdk().track('x', {});
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(calls[0]?.init.method).toBe('POST');
  });
});

describe('identify', () => {
  /**
   * The counterpart to `widget-init-identity.spec.ts` in the API: that file
   * proves the server accepts an email-only identity, this one proves the SDK
   * sends exactly that. The pair is the contract; either alone proves nothing
   * about whether the documented call works.
   *
   * The SDK's own header comment demonstrates `identify({ email })`, and it
   * 400'd, because `widgetInitSchema` required `externalId`.
   */
  it('sends an email-only identity with no externalId', async () => {
    await sdk().identify({ email: 'a@b.com', name: 'Alice' });
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      identity: Record<string, unknown>;
      publicId: string;
    };
    expect(body.publicId).toBe('pub_1');
    expect(body.identity).toEqual({ email: 'a@b.com', name: 'Alice' });
    expect(body.identity['externalId']).toBeUndefined();
  });

  it('does not mint a throwaway anonymous session first', async () => {
    // It used to `ensureVisitorToken()` before identifying, which meant two
    // round trips AND keeping the anonymous token: every later call spoke for
    // the anonymous visitor and the identification was lost.
    await sdk().identify({ externalId: 'u_42' });
    expect(calls).toHaveLength(1);
  });

  it('stores the token the server hands back, because init rotates it', async () => {
    // The token is an opaque signed credential now, not the external id, and
    // identifying mints a NEW one. Keeping the old one would leave the SDK
    // acting as whoever it was before.
    localStorage.setItem('livechat:vt:pub_1', 'vs1.anonymous.session');
    await sdk().identify({ externalId: 'u_42', userHash: 'a'.repeat(64) });
    expect(localStorage.getItem('livechat:vt:pub_1')).toBe('vt_abc');
  });

  it('passes userHash through so a verified channel is usable at all', async () => {
    await sdk().identify({ externalId: 'u_42', userHash: 'b'.repeat(64) });
    const body = JSON.parse(String(calls[0]?.init.body)) as { identity: Record<string, unknown> };
    expect(body.identity['userHash']).toBe('b'.repeat(64));
  });
});

describe('a refused session token', () => {
  it('re-initialises and replays the call once', async () => {
    // What a mid-session visitor hits on the deploy that stops accepting a
    // raw external id as a credential. The integrator's code did nothing
    // wrong, so the SDK absorbs it rather than throwing at them.
    localStorage.setItem('livechat:vt:pub_1', 'u_42');
    const answers: Array<() => Response> = [
      () =>
        ({
          ok: false,
          status: 403,
          json: async () => ({ code: 'visitor_session_upgrade_required' }),
        }) as unknown as Response,
      () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ session: { token: 'vs1.fresh' } }),
        }) as unknown as Response,
      () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response,
    ];
    let n = 0;
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
      const answer = answers[n++];
      if (answer === undefined) {
        throw new Error(`unplanned call #${n}`);
      }
      return answer();
    }) as unknown as typeof fetch;

    await sdk().track('signup_completed', {});
    expect(calls.map((c) => c.url.replace('https://api.test', ''))).toEqual([
      '/v1/widget/events',
      '/v1/widget/init',
      '/v1/widget/events',
    ]);
    const replayed = JSON.parse(String(calls[2]?.init.body)) as { visitorToken: string };
    expect(replayed.visitorToken).toBe('vs1.fresh');
  });

  it('does not retry a 403 that is not about the session', async () => {
    localStorage.setItem('livechat:vt:pub_1', 'vs1.valid');
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
      return {
        ok: false,
        status: 403,
        json: async () => ({ code: 'forbidden', message: 'origin not allowed' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    await expect(sdk().track('x', {})).rejects.toThrow('403');
    expect(calls).toHaveLength(1);
  });
});

describe('visitor token', () => {
  it('persists across instances so a reload keeps the conversation', async () => {
    await sdk().identify({ email: 'a@b.com' });
    expect(localStorage.getItem('livechat:vt:pub_1')).toBe('vt_abc');
    // A second instance must pick it up rather than starting a new visitor.
    const again = Chatly.init({ publicId: 'pub_1', apiUrl: 'https://api.test' });
    expect(again).toBeDefined();
  });

  it('scopes the token per publicId', async () => {
    await sdk().identify({ email: 'a@b.com' });
    expect(localStorage.getItem('livechat:vt:pub_2')).toBeNull();
  });
});

describe('default apiUrl', () => {
  /*
   * Reported by Crossly, who integrated from the published docs alone: the
   * default was `https://api.livechat.local`, a hostname that resolves
   * nowhere. A developer who follows the docs and omits `apiUrl` gets an SDK
   * where every call fails, and the docs page had to carry a warning telling
   * every reader to override it.
   *
   * No test caught it because every other test in this file passes an
   * explicit `apiUrl` — the same shape as the repo's existing finding that an
   * unset env fallback reaches production unseen. So this asserts the DEFAULT
   * specifically, which is the only thing a reader of the docs exercises.
   */
  it('points at production, not a dev hostname', () => {
    const sdk = Chatly.init({ publicId: 'pub_1' });

    expect((sdk as unknown as { base: string }).base).toBe('https://api.chatlychat.com');
  });

  it('still lets a self-hosted install override it', () => {
    const sdk = Chatly.init({ publicId: 'pub_1', apiUrl: 'https://chat.example.com' });

    expect((sdk as unknown as { base: string }).base).toBe('https://chat.example.com');
  });
});
