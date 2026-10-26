/**
 * `Chatly.subscribe()` — the long-lived half of the headless API.
 *
 * Split out of `index.ts` when the per-attempt realtime credential pushed
 * that file over the repo's 650-line ceiling. The seam is deliberate: nothing
 * in here touches the class's own state, it reads five injected capabilities
 * and owns a lifetime of its own, so a test can drive it without a `Chatly`.
 *
 * The POLLING path is here in full. The PUSH path — the socket, its
 * per-attempt token and the re-mints that keep that token alive — is
 * `realtime.ts`, and its header is the one to read before touching a
 * credential.
 */
import { createTypingTracker, newMessagesSince, typingActorOf } from './live.js';
import { createPushConnection } from './realtime.js';

import type {
  HeadlessMessage,
  SubscribeHandlers,
  SubscribeOptions,
  Subscription,
} from './types.js';

/**
 * What a subscription needs from the SDK, and nothing more.
 *
 * Functions rather than values for the two that are read LATE:
 * `/v1/widget/init` is what reports the realtime host and the contact id, and
 * an anonymous visitor's init is triggered BY this subscription, so a value
 * captured at subscribe time is captured before it exists. The contact id in
 * particular is the typing event's `actorId`, which the gateway's schema
 * rejects when empty.
 */
export interface SubscriptionDeps {
  readonly listMessages: (conversationId: string) => Promise<readonly HeadlessMessage[]>;
  /** `POST /v1/widget/realtime/token`. See `realtime.ts`. */
  readonly mintRealtimeToken: (conversationId: string) => Promise<string>;
  readonly realtimeHost: () => string | null;
  readonly contactId: () => string | null;
  /** "The stored visitor session was replaced." Returns its own unregister. */
  readonly onSessionReplaced: (fn: () => void) => () => void;
}

export function createSubscription(
  deps: SubscriptionDeps,
  conversationId: string,
  handlers: SubscribeHandlers,
  options: SubscribeOptions,
): Subscription {
  const seen = new Set<string>();
  let stopped = false;
  /** Set once the push socket is up; null on the polling path. */
  let live: { emit: (event: string, payload: unknown) => void } | null = null;
  let warnedAboutTyping = false;

  /*
   * Receiving typing needs the same transport as sending it, and for the
   * same reason: there is no HTTP route. A consumer who asked for
   * `onTyping` on the polling path has asked for something the transport
   * cannot carry, so say it once at subscribe time — the alternative is an
   * agent typing visibly in the dashboard and nothing happening here, with
   * nothing to search for.
   */
  if (handlers.onTyping !== undefined && options.io === undefined) {
    console.warn(
      '[Chatly] onTyping needs the push path — pass `io` to subscribe(). ' +
        'Typing is a socket event and has no HTTP route, so a polling ' +
        'subscription never receives one.',
    );
  }
  const typing = createTypingTracker({
    onChange: (signal) => handlers.onTyping?.(signal),
  });

  const setTyping = (isTyping: boolean): void => {
    if (live === null) {
      if (!warnedAboutTyping) {
        warnedAboutTyping = true;

        console.warn(
          '[Chatly] setTyping needs the push path — pass `io` to subscribe(). ' +
            'Typing is a socket event and has no HTTP route.',
        );
      }
      return;
    }
    live.emit(isTyping ? 'typing.start' : 'typing.stop', {
      conversationId,
      actorType: 'contact',
      // The gateway's payload requires a non-empty actorId. `unknown` rather
      // than an empty string, which its schema rejects outright.
      actorId: deps.contactId() ?? 'unknown',
    });
  };

  const deliver = (batch: readonly HeadlessMessage[]): void => {
    for (const message of newMessagesSince(seen, batch)) {
      handlers.onMessage?.(message);
    }
  };

  const poll = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      deliver(await deps.listMessages(conversationId));
    } catch (err: unknown) {
      handlers.onError?.(err);
    }
  };

  // The first batch is the history, which is also how a consumer gets the
  // existing thread without a separate call.
  void poll();

  if (options.io === undefined) {
    // Floored: a one-second poll on a long conversation is a request every
    // second per open tab, and the endpoint is not a stream.
    const interval = Math.max(2_000, options.intervalMs ?? 6_000);
    const timer = setInterval(() => void poll(), interval);
    return Object.assign(
      () => {
        stopped = true;
        clearInterval(timer);
        // Nothing can have started the tracker on this path — but a
        // teardown that only cleans up the branch it remembers is how a
        // timer outlives its subscription.
        typing.dispose();
      },
      { setTyping },
    );
  }

  /** Set on the polling FALLBACK only; the socket's own teardown is its own. */
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  const onEnvelope = (raw: unknown): void => {
    const envelope = raw as { type?: string; payload?: unknown } | null;
    if (envelope?.type === 'message.created' && envelope.payload !== undefined) {
      deliver([envelope.payload as HeadlessMessage]);
      /*
       * A reply has arrived, so whoever was typing has stopped — the
       * dashboard sends `typing.stop` on send, but the message and the
       * stop are two envelopes and the message usually wins the race.
       * Without this the indicator sits under the message that was being
       * typed, for the length of the timeout.
       */
      typing.stop();
      return;
    }
    if (envelope?.type === 'typing.start' || envelope?.type === 'typing.stop') {
      const actor = typingActorOf(envelope.payload);
      if (actor === null) {
        return;
      }
      if (envelope.type === 'typing.start') {
        typing.start(actor);
      } else {
        typing.stop(actor);
      }
    }
  };
  /*
   * The socket, its per-ATTEMPT credential and the re-mints that keep that
   * credential alive all live in `realtime.ts`. Read its header before
   * changing anything here: a frozen `auth` object and a session refresh
   * that did not re-mint were two separate ways this subscription died
   * silently an hour in.
   */
  const push = createPushConnection({
    io: options.io,
    conversationId,
    mintToken: (id) => deps.mintRealtimeToken(id),
    realtimeHost: deps.realtimeHost,
    onSessionReplaced: deps.onSessionReplaced,
    onEnvelope,
    ...(handlers.onError === undefined ? {} : { onError: handlers.onError }),
  });
  void (async () => {
    try {
      const emitter = await push.start();
      if (emitter !== null && !stopped) {
        live = emitter;
      }
    } catch (err: unknown) {
      /*
       * Push could not be set up. Fall back to polling rather than leaving
       * the consumer with a subscription that silently never fires — the
       * same choice the widget makes when its realtime chunk cannot load.
       */
      handlers.onError?.(err);
      if (!stopped) {
        fallbackTimer = setInterval(() => void poll(), 6_000);
      }
    }
  })();

  return Object.assign(
    () => {
      stopped = true;
      live = null;
      typing.dispose();
      push.stop();
      if (fallbackTimer !== null) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    },
    { setTyping },
  );
}
