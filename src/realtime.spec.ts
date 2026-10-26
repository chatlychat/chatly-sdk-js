// @vitest-environment jsdom
/**
 * The visitor realtime handshake, asserted on what the SDK SENT.
 *
 * ── Why every assertion here is about a request ──────────────────────────
 *
 * All four mobile SDKs shipped unable to connect to realtime at all, each
 * with a green suite, because a fake transport that answers whatever the SDK
 * asked for AGREES WITH THE BUG. `docs/prompts/5/mobile-sdk-visitor-contract.md`
 * §4 names the four tests that cannot be faked, and three of them are here:
 * the handshake carries `kind`, the token is the minted one rather than the
 * session token, and a SECOND attempt re-reads the payload.
 *
 * So the fixtures are the server's real shapes — `/v1/widget/init` answers
 * `{ session: { token, contactId }, realtimeUrl }` and
 * `/v1/widget/realtime/token` answers `{ token, expiresAt }` and NO url —
 * and nothing is asserted about a canned response.
 *
 * ── Reading `auth` means INVOKING it ─────────────────────────────────────
 *
 * The defect being pinned is a frozen `auth` OBJECT, so `auth` must be a
 * callback and the only way to read one is to call it. `authOf` fails loudly
 * when it is not a function, which is the control for defect 1 in a single
 * line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatlyError } from './errors.js';
import { Chatly } from './index.js';
import { createPushConnection } from './realtime.js';

const API = 'https://api.test.local';
const RT_HOST = 'wss://rt.test';

interface Call {
  path: string;
  body: Record<string, unknown>;
}

let calls: Call[] = [];
/** Paths primed to answer 403 `visitor_session_invalid` on their NEXT call. */
let staleOnce: Set<string>;
/** Paths primed to answer a hard 500, for the failed-re-mint case. */
let brokenPaths: Set<string>;
/**
 * Holds the mint route's RESPONSE open, so a session refresh can be made to
 * land while a mint is in flight. `null` means "answer immediately".
 */
let mintGate: { promise: Promise<void>; open: () => void } | null;
let inits = 0;
let mints = 0;

function body(path: string): unknown {
  if (path === '/v1/widget/init') {
    inits += 1;
    // The real shape. `realtimeUrl` is reported HERE and nowhere else: the
    // mint route answers no url, and reading one off it pointed an early
    // version of this socket at the API host.
    return { session: { token: `vt-${inits}`, contactId: 'c-1' }, realtimeUrl: RT_HOST };
  }
  if (path === '/v1/widget/realtime/token') {
    mints += 1;
    return { token: `rt-${mints}`, expiresAt: '2026-01-01T00:00:00.000Z' };
  }
  return { messages: [] };
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: { body: string }) => {
      const path = String(url).replace(API, '');
      calls.push({ path, body: JSON.parse(init.body) as Record<string, unknown> });
      if (brokenPaths.has(path)) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { code: 'internal', message: 'nope' } }),
        } as unknown as Response);
      }
      if (staleOnce.has(path)) {
        staleOnce.delete(path);
        // The envelope `app-exception.filter.ts` really sends.
        return Promise.resolve({
          ok: false,
          status: 403,
          json: () =>
            Promise.resolve({
              error: { code: 'visitor_session_invalid', message: 'session no longer valid' },
            }),
        } as unknown as Response);
      }
      const held = path === '/v1/widget/realtime/token' ? mintGate : null;
      return (held === null ? Promise.resolve() : held.promise).then(
        () =>
          ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(body(path)),
          }) as unknown as Response,
      );
    }),
  );
}

/** The socket.io opts of every `io()` call, in order. */
let opened: Array<Record<string, unknown>> = [];
/** Socket event handlers of the most recent socket, keyed by event name. */
let listeners: Map<string, (raw: unknown) => void>;
let disconnects = 0;

function fakeIo(
  url: string,
  opts: Record<string, unknown>,
): {
  on: (event: string, handler: (payload: unknown) => void) => void;
  emit: (event: string, payload: unknown) => void;
  disconnect: () => void;
} {
  opened.push({ ...opts, __url: url });
  return {
    on: (event, handler) => void listeners.set(event, handler),
    emit: () => undefined,
    disconnect: () => void (disconnects += 1),
  };
}

/**
 * The handshake payload of attempt `index`, read by INVOKING the callback.
 *
 * Invoking is the only way to read a per-attempt credential, and it is also
 * the assertion: a frozen object has no callback to invoke, and this throws
 * with the reason rather than reading `undefined` off an object.
 */
function authOf(index: number): Record<string, unknown> {
  const auth = opened[index]?.['auth'];
  if (typeof auth !== 'function') {
    throw new Error(
      '`auth` must be a per-attempt CALLBACK so a reconnect re-reads the token — ' +
        `a frozen object is replayed verbatim once the 1h token expires; got ${typeof auth}`,
    );
  }
  let read: Record<string, unknown> | null = null;
  (auth as (cb: (data: Record<string, unknown>) => void) => void)((data) => {
    read = data;
  });
  if (read === null) {
    throw new Error('the auth callback never invoked its own callback');
  }
  return read;
}

const mintCalls = (): Call[] => calls.filter((c) => c.path === '/v1/widget/realtime/token');

/** Let the mint round trip and any queued re-mint settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
};

async function subscribed(): Promise<{ sdk: Chatly; stop: () => void }> {
  const sdk = Chatly.init({ publicId: 'acme-web', apiUrl: API });
  const stop = sdk.subscribe('conv-1', { onError: () => undefined }, { io: fakeIo });
  await settle();
  return { sdk, stop };
}

beforeEach(() => {
  calls = [];
  opened = [];
  listeners = new Map();
  staleOnce = new Set();
  brokenPaths = new Set();
  mintGate = null;
  inits = 0;
  mints = 0;
  disconnects = 0;
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('crypto', { randomUUID: () => `idem-${calls.length}` });
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the handshake', () => {
  it("carries kind: 'visitor', without which the gateway verifies it as an agent", async () => {
    /*
     * `handshakeAuthSchema` makes `kind` OPTIONAL and it defaults to AGENT, so
     * an omitted `kind` sends a visitor's HS256 token to the RS256 verifier
     * and the gateway answers a bare `Unauthorized` naming neither
     * credential. That one omission is the whole of "mobile realtime does not
     * work" across four SDKs.
     */
    const { stop } = await subscribed();
    expect(authOf(0)['kind']).toBe('visitor');
    stop();
  });

  it('is pointed at the host init reported, not the API base', async () => {
    const { stop } = await subscribed();
    expect(opened[0]?.['__url']).toBe(RT_HOST);
    stop();
  });

  it('carries the MINTED token, never the session token from init', async () => {
    /*
     * Two visitor credentials, not interchangeable. `session.token` from
     * `/v1/widget/init` is what every REST body carries and the realtime
     * gateway does not accept it at all; only a token minted at
     * `POST /v1/widget/realtime/token` is.
     */
    const { stop } = await subscribed();
    expect(authOf(0)['token']).toBe('rt-1');
    expect(authOf(0)['token']).not.toBe('vt-1');
    stop();
  });

  it('minted with the publicId, the visitor token and the conversation', async () => {
    const { stop } = await subscribed();
    expect(mintCalls()).toHaveLength(1);
    expect(mintCalls()[0]?.body).toMatchObject({
      publicId: 'acme-web',
      visitorToken: 'vt-1',
      conversationId: 'conv-1',
    });
    stop();
  });
});

describe('the credential per ATTEMPT', () => {
  it('is a callback, so a reconnect re-reads it rather than replaying one', async () => {
    const { stop } = await subscribed();
    // `authOf` throws, naming the defect, when `auth` is a frozen object.
    expect(() => authOf(0)).not.toThrow();
    stop();
  });

  it('re-mints on a drop, so the SECOND read is a DIFFERENT token', async () => {
    /*
     * The defect this pins: the token is conversation-scoped with a 1h TTL,
     * and a socket that dropped after that hour reconnected with the expired
     * credential and was refused — silently, for the rest of the session. The
     * callback is only half the fix; something has to make a fresh token
     * EXIST for it to read.
     */
    const { stop } = await subscribed();
    expect(authOf(0)['token']).toBe('rt-1');
    listeners.get('disconnect')?.(undefined);
    await settle();
    expect(mintCalls()).toHaveLength(2);
    expect(authOf(0)['token']).toBe('rt-2');
    expect(authOf(0)['token']).not.toBe('rt-1');
    stop();
  });

  it('re-mints on a connect_error too, which is how a refusal arrives', async () => {
    const { stop } = await subscribed();
    listeners.get('connect_error')?.(undefined);
    await settle();
    expect(mintCalls()).toHaveLength(2);
    expect(authOf(0)['token']).toBe('rt-2');
    stop();
  });

  it('coalesces a burst of drops rather than minting once per event', async () => {
    const { stop } = await subscribed();
    listeners.get('disconnect')?.(undefined);
    listeners.get('disconnect')?.(undefined);
    listeners.get('disconnect')?.(undefined);
    await settle();
    // One in flight plus at most one queued behind it — never three.
    expect(mintCalls().length).toBeLessThanOrEqual(3);
    expect(mintCalls().length).toBeGreaterThanOrEqual(2);
    stop();
  });

  it('keeps the token it holds when a re-mint FAILS, and says so', async () => {
    /*
     * An old token has a chance where none has none, so the held credential
     * stays — but a failure is REPORTED, because the symptom otherwise
     * arrives as a reconnect nobody can explain.
     */
    const errors: unknown[] = [];
    const sdk = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const stop = sdk.subscribe('conv-1', { onError: (e) => errors.push(e) }, { io: fakeIo });
    await settle();
    brokenPaths.add('/v1/widget/realtime/token');
    listeners.get('disconnect')?.(undefined);
    await settle();
    expect(authOf(0)['token']).toBe('rt-1');
    const reported = errors.find((e) => e instanceof ChatlyError);
    expect(reported?.code).toBe('realtime_token_failed');
    stop();
  });

  it('stops re-minting once the subscription is torn down', async () => {
    const { stop } = await subscribed();
    stop();
    expect(disconnects).toBe(1);
    const before = mintCalls().length;
    listeners.get('disconnect')?.(undefined);
    await settle();
    expect(mintCalls()).toHaveLength(before);
  });
});

describe('a replaced visitor session', () => {
  it('re-mints, so the next attempt is not on a dead session credential', async () => {
    /*
     * `request()` absorbs a 403 `visitor_session_*` by dropping the stored
     * token, re-initialising and replaying the call. That cured the REST
     * surface and left realtime behind: the socket went on holding a token
     * minted for the session that was just thrown away, and presented it on
     * its next reconnect.
     *
     * Driven through a LIST call rather than the mint, because a mint that
     * recovers itself would pass with no session listener at all — which is
     * exactly the hole this test exists to close.
     */
    const { sdk, stop } = await subscribed();
    expect(authOf(0)['token']).toBe('rt-1');
    expect(inits).toBe(1);

    staleOnce.add('/v1/widget/messages/list');
    await sdk.listMessages('conv-1');
    await settle();

    // The session really was replaced...
    expect(inits).toBe(2);
    // ...and the realtime credential was re-minted against the NEW one.
    expect(mintCalls()).toHaveLength(2);
    expect(mintCalls()[1]?.body['visitorToken']).toBe('vt-2');
    expect(authOf(0)['token']).toBe('rt-2');
    stop();
  });

  it('re-mints AFTER a mint that was already in flight when the session died', async () => {
    /*
     * The hard case, and the reason a re-mint coalesces rather than SKIPS.
     *
     * The refresh lands while a mint is in flight — so that mint was sent
     * with the credential that has just been thrown away, and its answer is a
     * token for a session that no longer applies. A re-mint that simply
     * returns because "one is already running" adopts that token and holds it
     * for ever, which is the very defect this file exists to close, one layer
     * down. Exactly one more mint is owed, after the one in flight.
     */
    let openGate = (): void => undefined;
    mintGate = {
      promise: new Promise<void>((r) => {
        openGate = () => r();
      }),
      open: () => openGate(),
    };
    const sdk = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const stop = sdk.subscribe('conv-1', { onError: () => undefined }, { io: fakeIo });
    await settle();
    // The mint is held open and nothing has been minted yet.
    expect(mintCalls()).toHaveLength(1);
    expect(opened).toHaveLength(0);

    staleOnce.add('/v1/widget/messages/list');
    await sdk.listMessages('conv-1');
    expect(inits).toBe(2);

    mintGate.open();
    mintGate = null;
    await settle();

    const bodies = mintCalls().map((c) => c.body['visitorToken']);
    expect(bodies[0]).toBe('vt-1');
    // The owed one: sent with the session that is actually alive.
    expect(bodies[bodies.length - 1]).toBe('vt-2');
    expect(authOf(0)['token']).toBe(`rt-${mints}`);
    stop();
  });

  it('is no longer listened for after teardown', async () => {
    const { sdk, stop } = await subscribed();
    stop();
    const before = mintCalls().length;
    staleOnce.add('/v1/widget/messages/list');
    await sdk.listMessages('conv-1');
    await settle();
    expect(inits).toBe(2);
    expect(mintCalls()).toHaveLength(before);
  });

  it('still recovers when the MINT itself is the call refused', async () => {
    // The replay has to carry the new visitor token, or the mint 403s twice.
    staleOnce.add('/v1/widget/realtime/token');
    const { stop } = await subscribed();
    const bodies = mintCalls().map((c) => c.body['visitorToken']);
    expect(bodies[0]).toBe('vt-1');
    expect(bodies).toContain('vt-2');
    expect(typeof authOf(0)['token']).toBe('string');
    stop();
  });
});

/**
 * The module on its own, for the two things a subscription cannot observe.
 *
 * `createPushConnection` is given its five capabilities, so a spy on one of
 * them is the only way to assert that teardown RELEASES it — through the
 * public `subscribe()` a leaked listener is invisible, because `stopped`
 * makes it a no-op either way. A no-op listener still pins its closure to
 * the `Chatly` instance for as long as the page lives, one per thread the
 * visitor ever opened.
 */
describe('createPushConnection, directly', () => {
  function deps(over: Partial<Parameters<typeof createPushConnection>[0]> = {}) {
    return {
      io: fakeIo,
      conversationId: 'conv-1',
      mintToken: () => Promise.resolve('rt-x'),
      realtimeHost: () => RT_HOST,
      onSessionReplaced: () => () => undefined,
      onEnvelope: () => undefined,
      ...over,
    };
  }

  it('releases its session listener on stop, so a subscription does not leak one', async () => {
    const unregister = vi.fn();
    const conn = createPushConnection(deps({ onSessionReplaced: () => unregister }));
    await conn.start();
    expect(unregister).not.toHaveBeenCalled();
    conn.stop();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('reports no host rather than quietly downgrading to polling', async () => {
    /*
     * A consumer who passed `io` asked for push, and a silent fall back to
     * polling reads as push that is slow. `start` resolves null — it does NOT
     * reject — because rejecting is the caller's cue to poll.
     */
    const errors: unknown[] = [];
    const conn = createPushConnection(
      deps({ realtimeHost: () => null, onError: (e) => errors.push(e) }),
    );
    const before = opened.length;
    await expect(conn.start()).resolves.toBeNull();
    expect(opened).toHaveLength(before);
    const reported = errors[0];
    expect(reported instanceof ChatlyError && reported.code).toBe('no_realtime_host');
    conn.stop();
  });

  it('stands down rather than opening a socket nobody owns', async () => {
    // Torn down while the mint was in flight — a conversation switch.
    let release = (): void => undefined;
    const conn = createPushConnection(
      deps({
        mintToken: () =>
          new Promise<string>((r) => {
            release = () => r('rt-late');
          }),
      }),
    );
    const before = opened.length;
    const started = conn.start();
    conn.stop();
    release();
    await expect(started).resolves.toBeNull();
    expect(opened).toHaveLength(before);
  });
});

describe('the polling fallback', () => {
  it('polls when the mint fails, and the timer dies with the subscription', async () => {
    /*
     * A failed setup must leave a SLOWER thread rather than a dead one — the
     * same choice the widget makes when its realtime chunk cannot load. The
     * second half is the part a refactor breaks: the fallback timer used to
     * be hidden inside a fake `socket` object, and it is now its own handle.
     */
    brokenPaths.add('/v1/widget/realtime/token');
    const errors: unknown[] = [];
    /*
     * Fake timers go in BEFORE the subscription. Installing them afterwards
     * leaves the already-created interval on the real clock, so advancing
     * them does nothing and the test reads as "it never polled" — which is
     * how this assertion was first written wrong.
     */
    vi.useFakeTimers();
    const sdk = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const stop = sdk.subscribe('conv-1', { onError: (e) => errors.push(e) }, { io: fakeIo });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(errors).toHaveLength(1);
    const lists = (): number => calls.filter((c) => c.path === '/v1/widget/messages/list').length;
    const afterSetup = lists();

    await vi.advanceTimersByTimeAsync(13_000);
    expect(lists()).toBeGreaterThan(afterSetup);

    stop();
    const atStop = lists();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lists()).toBe(atStop);
    /*
     * And the interval is CLEARED, not merely rendered harmless.
     *
     * `stopped` makes every tick a no-op, so counting requests cannot tell a
     * cleared timer from a leaked one — a 6-second interval would go on
     * waking a customer's page for as long as it is open. This is the only
     * assertion that distinguishes them, and without it the `clearInterval`
     * on teardown can be deleted with a green suite.
     */
    expect(vi.getTimerCount()).toBe(0);
  });
});
