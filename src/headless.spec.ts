// @vitest-environment jsdom
/**
 * The headless surface: enough to build your own chat UI.
 *
 * Before this the SDK could `send` into a conversation but could not create
 * one, list threads, read history, or learn that a reply had arrived. It was a
 * companion to the widget — you could control the widget's panel and fire CDP
 * events, but you could not render a conversation yourself. That is the gap
 * between "a themeable overlay" and "chat that is part of your app".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Chatly } from './index.js';

const API = 'https://api.test.local';

interface Call {
  path: string;
  body: Record<string, unknown>;
}

let calls: Call[] = [];

function stub(responder: (call: Call) => unknown): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: { body: string }) => {
      const call: Call = {
        path: String(url).replace(API, ''),
        body: JSON.parse(init.body) as Record<string, unknown>,
      };
      calls.push(call);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responder(call)),
      } as unknown as Response);
    }),
  );
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('crypto', { randomUUID: () => 'id-1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const SESSION = { session: { token: 'vt-1', contactId: 'c-1' } };

describe('reading', () => {
  it('lists this visitor own conversations, scoped by their token', async () => {
    stub((c) =>
      c.path === '/v1/widget/init'
        ? SESSION
        : { conversations: [{ id: 'conv-1', status: 'open' }] },
    );
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    expect((await lc.listConversations()).map((x) => x.id)).toEqual(['conv-1']);
    // Scoped by the visitor token, so it can only ever be their own threads.
    expect(
      calls.find((c) => c.path === '/v1/widget/conversations/list')?.body['visitorToken'],
    ).toBe('vt-1');
  });

  it('lists the messages of one conversation', async () => {
    stub((c) =>
      c.path === '/v1/widget/init'
        ? SESSION
        : { messages: [{ id: 'm1', body: 'hi', authorType: 'agent', createdAt: '1' }] },
    );
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    expect((await lc.listMessages('conv-1')).map((m) => m.body)).toEqual(['hi']);
  });

  it('returns an empty array rather than undefined on an older API', async () => {
    // A consumer calling `.map` on the result should not have to null-check it.
    stub((c) => (c.path === '/v1/widget/init' ? SESSION : {}));
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    expect(await lc.listConversations()).toEqual([]);
    expect(await lc.listMessages('conv-1')).toEqual([]);
  });
});

describe('writing', () => {
  it('starts a NEW conversation on the conversations endpoint', async () => {
    // `/v1/widget/messages` replies to one that exists and requires a
    // conversationId. Using it to start one is a 400 — exactly the mistake
    // this repo's own E2E spec shipped with for weeks.
    stub((c) => (c.path === '/v1/widget/init' ? SESSION : { conversation: { id: 'conv-new' } }));
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    expect((await lc.startConversation('hello')).conversationId).toBe('conv-new');
    expect(calls.map((c) => c.path)).toContain('/v1/widget/conversations');
    expect(calls.map((c) => c.path)).not.toContain('/v1/widget/messages');
  });

  it('replies into an existing conversation', async () => {
    stub((c) => (c.path === '/v1/widget/init' ? SESSION : {}));
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    await lc.send('conv-1', 'and another thing');
    expect(calls.find((c) => c.path === '/v1/widget/messages')?.body['conversationId']).toBe(
      'conv-1',
    );
  });
});

describe('subscribing', () => {
  it('delivers the history immediately and never the same message twice', async () => {
    const batch = [{ id: 'm1', body: 'first', authorType: 'agent', createdAt: '1' }];
    stub((c) => (c.path === '/v1/widget/init' ? SESSION : { messages: batch }));
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const seen: string[] = [];
    const stop = lc.subscribe('conv-1', { onMessage: (m) => seen.push(m.id) });
    await new Promise((r) => setTimeout(r, 60));
    stop();
    expect(seen).toEqual(['m1']);
  });

  it('reports a failure instead of rejecting into nobody hands', async () => {
    // `subscribe` is long-lived. A rejected promise with no awaiter is an
    // unhandled rejection on the customer's own page.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const errors: unknown[] = [];
    const stop = lc.subscribe('conv-1', { onError: (e) => errors.push(e) });
    await new Promise((r) => setTimeout(r, 60));
    stop();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('stops polling when unsubscribed', async () => {
    vi.useFakeTimers();
    stub((c) => (c.path === '/v1/widget/init' ? SESSION : { messages: [] }));
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const stop = lc.subscribe('conv-1', {});
    await vi.advanceTimersByTimeAsync(100);
    const before = calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.length).toBe(before);
  });

  it('uses a supplied socket factory instead of polling, and disconnects it', async () => {
    // `init` is what reports the realtime host; the token endpoint returns
    // `{ token, expiresAt }` and no url. Reading a `url` off it was the first
    // version's bug — the socket would have been pointed at the API host.
    stub((c) =>
      c.path === '/v1/widget/init'
        ? { ...SESSION, realtimeUrl: 'wss://rt.test' }
        : c.path === '/v1/widget/realtime/token'
          ? { token: 'rt-1', expiresAt: '2026-01-01T00:00:00Z' }
          : { messages: [] },
    );
    // Typed explicitly: inferred from the assignment inside `on`, TypeScript
    // narrows `handler` to `null` and the call below is "not callable".
    const captured: { handler: ((raw: unknown) => void) | undefined } = { handler: undefined };
    const made = {
      on: (_e: string, h: (raw: unknown) => void) => {
        captured.handler = h;
      },
      // The factory's contract now includes `emit`, for the typing event.
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    // The real factory takes (url, opts); `vi.fn(() => made)` infers a
    // zero-arg mock, so `calls[0][0]` does not typecheck.
    const io = vi.fn((_url: string, _opts: Record<string, unknown>) => made);
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const seen: string[] = [];
    const stop = lc.subscribe('conv-1', { onMessage: (m) => seen.push(m.id) }, { io });
    await new Promise((r) => setTimeout(r, 80));
    // Pointed at the host `init` reported, not the API base.
    expect(io).toHaveBeenCalled();
    expect(io.mock.calls[0]?.[0]).toBe('wss://rt.test');
    captured.handler?.({
      type: 'message.created',
      payload: { id: 'pushed', body: 'x', authorType: 'agent', createdAt: '9' },
    });
    expect(seen).toContain('pushed');
    stop();
    expect(made.disconnect).toHaveBeenCalled();
  });
});

describe('the error envelope', () => {
  it('recovers a stale session from the shape the API really sends', async () => {
    /*
     * `isStaleSession` read `body.code` at the top level. The API wraps every
     * error as `{ error: { code, ... } }`, so it was `undefined` for every
     * real response and the recovery path below it never fired — a visitor
     * with an expired token got failures this SDK was written to absorb.
     *
     * The widget had the identical bug, fixed the day before, and nobody
     * checked its sibling.
     */
    let first = true;
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: { body: string }) => {
        const path = String(url).replace(API, '');
        paths.push(path);
        void init;
        if (path === '/v1/widget/init') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(SESSION),
          } as unknown as Response);
        }
        if (first) {
          first = false;
          return Promise.resolve({
            ok: false,
            status: 403,
            json: () =>
              Promise.resolve({
                error: { code: 'visitor_session_upgrade_required', message: 'stale' },
              }),
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ messages: [] }),
        } as unknown as Response);
      }),
    );
    localStorage.setItem('livechat:vt:acme-web', 'old-token');
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    await lc.listMessages('conv-1');
    // Refused once, re-initialised, replayed — three calls to the list path's
    // story rather than one failure handed to the integrator.
    expect(paths.filter((p) => p === '/v1/widget/messages/list')).toHaveLength(2);
    expect(paths).toContain('/v1/widget/init');
  });
});

describe('typing', () => {
  it('emits over the socket when push is in use', async () => {
    stub((c) =>
      c.path === '/v1/widget/init'
        ? { session: { token: 'vt-1', contactId: 'c-9' }, realtimeUrl: 'wss://rt.test' }
        : c.path === '/v1/widget/realtime/token'
          ? { token: 'rt-1', expiresAt: '2026-01-01T00:00:00Z' }
          : { messages: [] },
    );
    const made = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() };
    const io = vi.fn((_url: string, _opts: Record<string, unknown>) => made);
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const sub = lc.subscribe('conv-1', {}, { io });
    await new Promise((r) => setTimeout(r, 80));
    sub.setTyping(true);
    // The gateway's schema requires actorType and a non-empty actorId.
    expect(made.emit).toHaveBeenCalledWith('typing.start', {
      conversationId: 'conv-1',
      actorType: 'contact',
      actorId: 'c-9',
    });
    sub.setTyping(false);
    expect(made.emit).toHaveBeenCalledWith('typing.stop', expect.anything());
    sub();
  });

  it('warns ONCE on the polling path rather than silently doing nothing', async () => {
    stub((c) => (c.path === '/v1/widget/init' ? SESSION : { messages: [] }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const sub = lc.subscribe('conv-1', {});
    sub.setTyping(true);
    sub.setTyping(true);
    sub();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/setTyping needs the push path/);
    expect(warn.mock.calls).toHaveLength(1);
    warn.mockRestore();
  });

  it('is still callable as a plain unsubscribe function', async () => {
    // It shipped and was documented as `const stop = subscribe(...)`. The
    // extras hang off it rather than replacing it.
    stub((c) => (c.path === '/v1/widget/init' ? SESSION : { messages: [] }));
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const stop = lc.subscribe('conv-1', {});
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });
});

/**
 * Receiving typing.
 *
 * The send half shipped first and the receive half did not exist, so a
 * headless consumer could tell the agent they were typing but could not show
 * the visitor that the agent was. Same transport, same constraint: there is no
 * HTTP route for typing, so this is push-only and says so.
 */
describe('typing, inbound', () => {
  /** Boot a pushed subscription and hand back the socket's event handler. */
  async function pushed(handlers: Parameters<Chatly['subscribe']>[1]): Promise<{
    fire: (envelope: unknown) => void;
    made: { emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
    stop: () => void;
  }> {
    stub((c) =>
      c.path === '/v1/widget/init'
        ? { session: { token: 'vt-1', contactId: 'c-9' }, realtimeUrl: 'wss://rt.test' }
        : c.path === '/v1/widget/realtime/token'
          ? { token: 'rt-1', expiresAt: '2026-01-01T00:00:00Z' }
          : { messages: [] },
    );
    const captured: { handler: ((raw: unknown) => void) | undefined } = { handler: undefined };
    const made = {
      on: (_e: string, h: (raw: unknown) => void) => {
        captured.handler = h;
      },
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    const io = vi.fn((_url: string, _opts: Record<string, unknown>) => made);
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const sub = lc.subscribe('conv-1', handlers, { io });
    await new Promise((r) => setTimeout(r, 80));
    return {
      fire: (envelope) => captured.handler?.(envelope),
      made,
      stop: () => sub(),
    };
  }

  it('reports the agent typing, with their name', async () => {
    const seen: Array<[boolean, string | undefined]> = [];
    const { fire, stop } = await pushed({
      onTyping: (s) => seen.push([s.isTyping, s.displayName]),
    });
    fire({
      type: 'typing.start',
      payload: {
        conversationId: 'conv-1',
        actorType: 'agent',
        actorId: 'u1',
        displayName: 'Sarah',
      },
    });
    fire({
      type: 'typing.stop',
      payload: { conversationId: 'conv-1', actorType: 'agent', actorId: 'u1' },
    });
    expect(seen).toEqual([
      [true, 'Sarah'],
      [false, 'Sarah'],
    ]);
    stop();
  });

  it('ignores a collaborative-cursor frame, which is published AS typing.start', async () => {
    /*
     * `viewing.cursor` from the agent dashboard is republished as
     * `typing.start` with `kind: 'viewing'`, about ten per second while an
     * agent moves their mouse over the thread. Rendering those as typing
     * would make the indicator flicker whenever an agent merely LOOKED at the
     * conversation.
     */
    const seen: unknown[] = [];
    const { fire, stop } = await pushed({ onTyping: (s) => seen.push(s) });
    fire({
      type: 'typing.start',
      payload: { conversationId: 'conv-1', actorType: 'viewer', actorId: 'u1', kind: 'viewing' },
    });
    fire({
      type: 'typing.start',
      payload: { conversationId: 'conv-1', actorType: 'agent', actorId: 'u1', kind: 'viewing' },
    });
    expect(seen).toEqual([]);
    stop();
  });

  it('never shows the visitor their own typing as the agent', async () => {
    const seen: unknown[] = [];
    const { fire, stop } = await pushed({ onTyping: (s) => seen.push(s) });
    fire({
      type: 'typing.start',
      payload: { conversationId: 'conv-1', actorType: 'contact', actorId: 'c-9' },
    });
    expect(seen).toEqual([]);
    stop();
  });

  it('clears the indicator when the reply itself arrives', async () => {
    // The dashboard sends `typing.stop` on send, but the message and the stop
    // are two envelopes and the message usually wins. Without this the
    // indicator sits under the message that was being typed.
    const seen: boolean[] = [];
    const { fire, stop } = await pushed({ onTyping: (s) => seen.push(s.isTyping) });
    fire({
      type: 'typing.start',
      payload: { conversationId: 'conv-1', actorType: 'agent', actorId: 'u1' },
    });
    fire({
      type: 'message.created',
      payload: { id: 'm-new', body: 'here you go', authorType: 'agent', createdAt: '9' },
    });
    expect(seen).toEqual([true, false]);
    stop();
  });

  it('warns once that a polling subscription cannot receive typing', async () => {
    stub((c) => (c.path === '/v1/widget/init' ? SESSION : { messages: [] }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    const sub = lc.subscribe('conv-1', { onTyping: () => undefined });
    expect(warn.mock.calls.flat().join(' ')).toMatch(/onTyping needs the push path/);
    expect(warn.mock.calls).toHaveLength(1);
    sub();
    warn.mockRestore();
  });

  it('says nothing when a polling consumer never asked for typing', async () => {
    stub((c) => (c.path === '/v1/widget/init' ? SESSION : { messages: [] }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lc = Chatly.init({ publicId: 'acme-web', apiUrl: API });
    lc.subscribe('conv-1', { onMessage: () => undefined })();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
