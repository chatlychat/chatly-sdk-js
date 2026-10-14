/**
 * Public types for the headless SDK.
 *
 * Declared here rather than imported from `@livechat/shared`: this bundle
 * ships to a customer's website and importing from the shared package drags
 * zod in with it — measured at ~11KB gzipped when it happened to the widget.
 * The shapes are the API's response bodies, which are a published contract.
 */

/** One message as the visitor endpoints return it. */
export interface HeadlessMessage {
  readonly id: string;
  readonly body: string;
  readonly authorType: 'contact' | 'agent' | 'bot' | 'system';
  readonly createdAt: string;
  /** Rich blocks, when the message carries them. Opaque here — render or ignore. */
  readonly blocks?: unknown;
  /** A Tier 2/3 interactive step. Mutually exclusive with `blocks`. */
  readonly canvas?: unknown;
  readonly attachments?: ReadonlyArray<{
    readonly id: string;
    readonly filename: string;
    readonly mimeType: string;
    readonly url: string;
  }>;
}

/** One thread in the visitor's own list. */
export interface HeadlessConversation {
  readonly id: string;
  readonly status?: string;
  readonly lastMessageAt?: string;
  readonly subject?: string | null;
  /**
   * Messages in this thread the visitor has not read.
   *
   * It was missing from this type while `POST /v1/widget/conversations/list`
   * had been returning it all along — the widget's own Messages tab renders it
   * as a per-thread badge. So the number was on the wire and the published
   * type hid it, which made the one thing a custom launcher needs
   * unreachable: an integrator building their own button had no way to show
   * "3 unread" and was told, in our own docs, to keep their own counter from
   * the `message` event — a counter that cannot know about replies which
   * arrived while the page was closed.
   *
   * Optional because an older API build does not send it, and absent is
   * correctly read as nothing unread.
   */
  readonly unreadContactCount?: number;
}

/**
 * "The agent is typing", as the consumer should render it.
 *
 * `isTyping` rather than two callbacks, because a UI holds one boolean and
 * the two-callback shape makes the consumer own the state machine — including
 * the part they cannot know about (see `TYPING_STOP_AFTER_MS`).
 */
export interface TypingSignal {
  /** Show the indicator, or hide it. */
  readonly isTyping: boolean;
  /**
   * Who. `'agent'` in every case the server currently forwards — a visitor
   * never receives their own typing, and agent-presence cursors are filtered
   * out on both sides.
   */
  readonly actorType: 'agent' | 'bot';
  readonly actorId: string;
  /** The agent's display name, when the dashboard sent one. */
  readonly displayName?: string;
}

/** What `subscribe()` reports. */
export interface SubscribeHandlers {
  /** A message the consumer has not been given before. */
  readonly onMessage?: (message: HeadlessMessage) => void;
  /**
   * The agent started or stopped typing.
   *
   * **PUSH ONLY.** Typing is a socket event with no HTTP route, so a polling
   * consumer never receives this — not rarely, never. There is nothing to
   * poll and nothing to warn about at subscribe time either, because a
   * consumer who passes `onTyping` without `io` has asked for something the
   * transport cannot carry: `subscribe` says so once, in the console, rather
   * than leaving them to wonder why an agent who is visibly typing in the
   * dashboard produces nothing. (A 6-second poll would be a useless indicator
   * even if a route existed — the dashboard stops sending after 5s of idle
   * keystrokes, so a poll could easily see neither edge.)
   *
   * Called with `isTyping: false` either when the agent's `typing.stop`
   * arrives OR after `TYPING_STOP_AFTER_MS` with no further start — see that
   * constant for why the timeout is not the consumer's problem to solve.
   */
  readonly onTyping?: (signal: TypingSignal) => void;
  /**
   * A poll or socket failed. Called rather than thrown: `subscribe` is
   * long-lived, and a rejected promise nobody is awaiting becomes an
   * unhandled rejection on the customer's page.
   */
  readonly onError?: (error: unknown) => void;
}

export interface SubscribeOptions {
  /** Poll interval. Ignored when `io` is supplied. Floored at 2s. */
  readonly intervalMs?: number;
  /**
   * Your own `socket.io-client` factory, for push instead of polling:
   *
   *   import { io } from 'socket.io-client';
   *   chatly.subscribe(id, handlers, { io });
   *
   * The SDK does not depend on it, so a consumer who does not want the bytes
   * does not ship them.
   */
  readonly io?: SocketIoFactory;
}

/** The shape of `socket.io-client`'s default export that the SDK uses. */
export type SocketIoFactory = (
  url: string,
  opts: Record<string, unknown>,
) => {
  on: (event: string, handler: (payload: unknown) => void) => void;
  emit: (event: string, payload: unknown) => void;
  disconnect: () => void;
};

/**
 * What `subscribe()` returns.
 *
 * Callable, so `const stop = subscribe(...); stop()` keeps working — it was
 * documented and shipped as a plain unsubscribe function, and changing that
 * shape hours later would break the first consumers for no gain. The extras
 * hang off it.
 *
 * ── Why RECEIVING typing is not here ────────────────────────────────────
 *
 * A typing indicator needs both directions, and they land in different
 * places. SENDING is an imperative call the consumer makes at a moment of
 * their choosing (a keystroke), so it has to hang off the handle — there is
 * nowhere else to put it. RECEIVING is an event, and every other event this
 * SDK reports arrives through `SubscribeHandlers` (`onMessage`, `onError`).
 *
 * The three alternatives were:
 *
 *  1. **`onTyping` in the handlers.** Chosen. Zero change to the return
 *     type, so no existing caller can break, and it is the shape a consumer
 *     already knows from `onMessage`.
 *  2. **An emitter on the handle** (`sub.onTyping(fn)`). A second
 *     subscription idiom in one SDK, with its own unsubscribe to get wrong,
 *     for one event.
 *  3. **Returning an object instead of a function.** The breaking change the
 *     note above rejects, and it buys nothing: `setTyping` already proved the
 *     callable-plus-properties shape carries whatever we need.
 */
export type Subscription = (() => void) & {
  /**
   * Tell the agent this visitor is typing.
   *
   * Only the PUSH path can carry this: typing is a socket event
   * (`apps/realtime/src/gateway.ts` listens for `typing.start`) and there is
   * no HTTP route for it. On the polling path it warns once rather than
   * silently doing nothing — a no-op that looks like it worked is how an
   * integrator spends an hour on their own code.
   */
  setTyping: (isTyping: boolean) => void;
};
