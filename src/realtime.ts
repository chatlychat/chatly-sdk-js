/**
 * The push path of `subscribe()` — the socket, and the two things that keep
 * its credential ALIVE.
 *
 * Split out of `index.ts` when that file reached the repo's 650-line ceiling,
 * and it is the right seam: everything here exists to answer one question
 * socket.io asks over and over, "what credential should this attempt carry?"
 *
 * ── Defect 1: a frozen `auth` object ─────────────────────────────────────
 *
 * The realtime token is conversation-scoped with a **1 hour TTL**
 * (`VISITOR_REALTIME_TOKEN_TTL_SECONDS`, `packages/auth/src/visitor-token.ts`).
 * `subscribe()` used to pass `auth: { token, kind: 'visitor' }` — a plain
 * object, captured once by socket.io's Manager and replayed VERBATIM on every
 * reconnect. So a visitor whose socket dropped after the token's lifetime
 * reconnected with an expired credential and was refused for the rest of the
 * session, silently: the gateway answers a bare `Unauthorized`, the SDK has
 * no handler for it, and the thread simply stops updating. A visitor reads
 * that as being ignored, not as a bug.
 *
 * Two halves, and only together do they work. `auth` is a CALLBACK, so an
 * attempt re-reads whatever token is current (`docs/prompts/5/
 * mobile-sdk-visitor-contract.md` §1, "`auth` is evaluated per attempt"); and
 * `disconnect`/`connect_error` re-mint, so by the time socket.io's backoff
 * gets around to the next attempt a fresh token EXISTS to be read. A callback
 * over a token nothing refreshes re-reads the same expired string.
 *
 * ── Defect 2: a session refresh left the socket on a dead credential ─────
 *
 * `Chatly.request()` absorbs a 403 `visitor_session_*` by dropping the stored
 * visitor token, re-initialising, and replaying the call. That cures the REST
 * surface and used to leave realtime behind: the socket went on holding a
 * token minted for a session that no longer applies, and its next reconnect
 * presented it. `onSessionReplaced` is how this module hears about it, and a
 * re-mint is the answer — see `remint` for what a FAILED re-mint means and
 * why it is reported rather than swallowed.
 *
 * ── `kind: 'visitor'` is not optional in practice ────────────────────────
 *
 * `handshakeAuthSchema` (`apps/realtime/src/gateway.ts`) makes `kind`
 * optional and it DEFAULTS TO AGENT, which routes a visitor's HS256 token to
 * the RS256 agent verifier. It is refused with a bare `Unauthorized` naming
 * neither credential. That one omission is the whole of "mobile realtime does
 * not work" across four SDKs, so it is asserted by name here.
 */
import { ChatlyError } from './errors.js';

import type { SocketIoFactory } from './types.js';

/** The half of a socket `subscribe()` keeps, for the typing event. */
export interface PushEmitter {
  emit: (event: string, payload: unknown) => void;
}

export interface PushConnectionInput {
  /** The consumer's own `socket.io-client`. The SDK does not depend on it. */
  readonly io: SocketIoFactory;
  readonly conversationId: string;
  /**
   * `POST /v1/widget/realtime/token`. Called once per connect ATTEMPT, never
   * once per subscription — see this file's header.
   *
   * Injected rather than reached for, so this module holds no REST client and
   * a test can assert on what was minted and how often.
   */
  readonly mintToken: (conversationId: string) => Promise<string>;
  /**
   * The Socket.IO host. A FUNCTION because `/v1/widget/init` is what reports
   * it and the mint above is what triggers init — reading it eagerly reads it
   * before it exists. (`/v1/widget/realtime/token` answers
   * `{ token, expiresAt }` and no url; an early version read a `url` off it
   * and pointed the socket at the API host.)
   */
  readonly realtimeHost: () => string | null;
  /** "The visitor session was replaced." Returns its own unregister. */
  readonly onSessionReplaced: (fn: () => void) => () => void;
  /** Every `event` frame, raw. The envelope is parsed by the caller. */
  readonly onEnvelope: (raw: unknown) => void;
  readonly onError?: (error: unknown) => void;
}

export interface PushConnection {
  /**
   * Mint, then open the socket.
   *
   * Resolves to the emitter on success, or `null` when there is nothing to
   * connect to — torn down while the mint was in flight, or no realtime host,
   * which reports itself through `onError` because a consumer who passed `io`
   * asked for push and a quiet downgrade to polling looks like push that is
   * slow.
   *
   * REJECTS when the mint itself failed, which is the caller's cue to start
   * polling: a slower thread rather than a dead one.
   */
  start: () => Promise<PushEmitter | null>;
  stop: () => void;
}

export function createPushConnection(input: PushConnectionInput): PushConnection {
  let stopped = false;
  /**
   * The credential the NEXT attempt will carry. Mutable on purpose: the
   * `auth` callback below is synchronous and cannot await a mint, so what it
   * reads has to already be here.
   */
  let current: string | null = null;
  /** The mint in flight, if any, so concurrent askers can coalesce onto it. */
  let inFlight: Promise<string> | null = null;
  /** One re-mint is already waiting behind `inFlight`; a second would be a queue. */
  let remintQueued = false;
  let socket: { disconnect: () => void } | null = null;

  const mint = async (): Promise<string> => {
    const run = (async (): Promise<string> => {
      const token = await input.mintToken(input.conversationId);
      if (!stopped) {
        current = token;
      }
      return token;
    })();
    inFlight = run;
    try {
      return await run;
    } finally {
      if (inFlight === run) {
        inFlight = null;
      }
    }
  };

  /**
   * Refresh the credential for the attempt that has not happened yet.
   *
   * Deliberately does NOT tear the socket down. On a drop, socket.io is
   * already retrying on its own backoff and this is simply what it will find
   * when it does. On a replaced session the live socket is still authenticated
   * for this same conversation, so closing it would lose events to buy
   * nothing.
   *
   * A FAILURE keeps the token we hold — an old token has a chance where none
   * has none, and a mint failure is usually the same outage as the drop — but
   * it is REPORTED. After a session refresh the mint can legitimately 404:
   * `/v1/widget/realtime/token` checks `conv.contactId === session.contactId`,
   * and a re-init that could not replay an identity is a new anonymous
   * contact, which does not own the old thread. That is worth telling the
   * consumer at the moment it happens rather than leaving it to surface an
   * hour later as a reconnect nobody can explain.
   */
  const remint = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    if (inFlight !== null) {
      /*
       * Coalesce, but do not SKIP. Several drops inside one backoff window
       * must not be several mints — and the mint already in flight may have
       * been sent with the very credential that just went stale, so exactly
       * one more AFTER it is required rather than optional. Early-returning
       * here instead was the first shape of this function and it kept a dead
       * token forever in precisely the case the file exists to fix.
       */
      if (remintQueued) {
        return;
      }
      remintQueued = true;
      await inFlight.catch(() => undefined);
      remintQueued = false;
      if (stopped) {
        return;
      }
    }
    try {
      await mint();
    } catch (cause: unknown) {
      input.onError?.(
        new ChatlyError(
          'realtime_token_failed',
          'chatly: could not re-mint the realtime token — the next reconnect ' +
            'will present an expired or superseded credential',
          { cause },
        ),
      );
    }
  };

  /*
   * Registered HERE, at creation, and not inside `start()`.
   *
   * `start()` mints before it can do anything else, and that mint is a round
   * trip during which a REST call on the same `Chatly` can be refused and
   * recover the session. Registering after the socket opened left that window
   * unwatched: the refresh landed, nothing was listening, and the token the
   * socket then opened with was already superseded. A re-mint arriving before
   * there is a socket is harmless — `current` is read per attempt, so it is
   * simply what the first attempt carries.
   */
  const unregister = input.onSessionReplaced(() => void remint());

  const start = async (): Promise<PushEmitter | null> => {
    const first = await mint();
    const host = input.realtimeHost();
    if (stopped) {
      return null;
    }
    if (host === null) {
      input.onError?.(
        new ChatlyError(
          'no_realtime_host',
          'chatly: no realtime host — set `realtimeUrl` in init options',
        ),
      );
      return null;
    }
    const made = input.io(host, {
      path: '/socket.io',
      transports: ['websocket'],
      /*
       * A CALLBACK, which is the whole point of this module. See the header:
       * an object here is captured once and replayed on every reconnect.
       *
       * `current ?? first` rather than `current!`: `stop()` nulls nothing and
       * a mint that lost its race leaves `current` as it was, so the token
       * this attempt was opened with is the floor.
       */
      auth: (cb: (data: Record<string, unknown>) => void) => {
        cb({ token: current ?? first, kind: 'visitor' });
      },
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      timeout: 10_000,
    });
    socket = made;
    made.on('event', input.onEnvelope);
    // Re-mint on the way DOWN, so the token is fresh before the backoff
    // expires rather than one attempt after.
    made.on('disconnect', () => void remint());
    made.on('connect_error', () => void remint());
    return made;
  };

  const stop = (): void => {
    stopped = true;
    unregister();
    socket?.disconnect();
    socket = null;
  };

  return { start, stop };
}
