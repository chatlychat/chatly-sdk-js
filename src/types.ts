/**
 * Public types for the headless SDK.
 *
 * Declared here rather than imported from `@livechat/shared`: this bundle
 * ships to a customer's website and importing from the shared package drags
 * zod in with it — measured at ~11KB gzipped when it happened to the widget.
 * The shapes are the API's response bodies, which are a published contract.
 */

/**
 * One message as the visitor endpoints return it.
 *
 * ── TWO sources, and a field is optional when only one of them carries it ──
 *
 * `listMessages()` casts `POST /v1/widget/messages/list` straight to this
 * type, and `subscribe()` casts the socket's `message.created` payload to it
 * as well. Those two are NOT the same projection, and this type used to
 * declare the seven fields they have in common — so ten fields that are on
 * the wire on at least one of the paths were unreachable from TypeScript. A
 * published type narrower than the response reads as "Chatly does not send
 * that" rather than as a mistake; `unreadContactCount` on
 * {@link HeadlessConversation} below was found the same way.
 *
 * The two authoritative declarations, in the API:
 *
 *   - list — `widgetVisitorMessageSchema` in
 *     `apps/api/src/modules/widget/widget-conversation-response-schemas.ts`
 *   - push — `MessageEventPayload` in
 *     `apps/api/src/modules/conversations/message-event-payload.ts`
 *
 * `headless-message-parity.spec.ts` holds this interface against both of
 * them, which is also the only way to notice that they differ.
 */
export interface HeadlessMessage {
  readonly id: string;
  readonly body: string;
  readonly authorType: 'contact' | 'agent' | 'bot' | 'system';
  readonly createdAt: string;
  /**
   * What shape the body is, and the field whose absence cost the most: a
   * consumer could not tell a product grid from a sentence.
   *
   * FOUR kinds, not the five in the database enum. The gateway forwards a
   * visitor only `text`, `rich`, `attachment_only` and `system_event`
   * (`VISITOR_VISIBLE_MESSAGE_KINDS`, `apps/realtime/src/visitor-allowlist.ts`), and
   * `note` — an agent's internal comment — is deliberately not one of them.
   *
   * Optional because the socket payload defaults an absent `kind` to `text`
   * and a row written before the column existed has none.
   */
  readonly kind?: 'text' | 'rich' | 'attachment_only' | 'system_event';
  /**
   * The formatted half of a `rich` reply — HTML, already sanitised server-side.
   *
   * **PUSH ONLY, and that is a server-side asymmetry rather than a choice
   * here.** `message.created` carries it; the list projection in
   * `widget-conversations.service.ts` does not select the column at all. So a
   * formatted reply arrives formatted and comes back plain after a reload.
   * Render `body` when this is absent or null.
   */
  readonly bodyHtml?: string | null;
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
  /**
   * Which thread this belongs to. PUSH ONLY — on the list path you asked for
   * one conversation by id, so the server does not repeat it.
   *
   * The wrapper packages learned this one the hard way: `ChatlyMessageEvent`
   * omitted it and `id` alone gives a host page nothing to correlate against.
   */
  readonly conversationId?: string;
  /** The agent or bot that wrote it; null for a system turn. PUSH ONLY. */
  readonly authorId?: string | null;
  /**
   * `'streaming'` while a reply is still being written, `'complete'` once it
   * is done, null on a message that was never streamed. PUSH ONLY.
   *
   * A consumer that ignores it draws a finished bubble for a reply that is
   * still arriving, and then the `message.delta` frames look like edits to a
   * message the renderer already considers done.
   */
  readonly streamState?: 'streaming' | 'complete' | null;
  /**
   * True on a turn the CONTACT is not meant to read back — a silent postback,
   * a host-reported action result (migration 0604). PUSH ONLY, and it is on
   * the wire because the same envelope goes to the agent inbox, which IS
   * meant to render the row.
   *
   * Declared, not filtered: `subscribe()` hands you every `message.created`
   * the gateway forwards, so a consumer that wants parity with the list path
   * — which filters `hidden_from_contact = false` in SQL — has to skip these
   * itself. Without this field that was not expressible.
   */
  readonly hiddenFromContact?: boolean;
  /** The message this one answers, when the author picked one. PUSH ONLY. */
  readonly replyToMessageId?: string | null;
  /** Arbitrary author-set metadata, passed through unchanged. PUSH ONLY. */
  readonly metadata?: Record<string, unknown>;
  /**
   * Set on a message an agent deleted. LIST ONLY — a delete is its own
   * envelope (`message.deleted`) on the push path.
   *
   * `body`, `blocks`, `canvas` and `attachments` are all emptied when this is
   * set, so a consumer that ignores it renders a blank bubble. Draw a
   * tombstone: the visitor was there when the message arrived.
   */
  readonly deletedAt?: string | null;
  /**
   * Emoji reactions on this message, with the counts. LIST ONLY.
   *
   * `reacted` is viewer-relative — true when the CALLER is one of the
   * reactors — which is why it cannot be on a broadcast envelope.
   */
  readonly reactions?: ReadonlyArray<{
    readonly emoji: string;
    readonly count: number;
    readonly reacted: boolean;
  }>;
}

/** One thread in the visitor's own list. */
export interface HeadlessConversation {
  readonly id: string;
  /**
   * `'open' | 'pending' | 'snoozed' | 'closed' | 'merged'`.
   *
   * A bare `string` on purpose: this is a read-only field on a response, the
   * set has grown before, and a consumer who switches on it can narrow
   * themselves. Widening a value a consumer only ever receives costs nothing;
   * narrowing it is what breaks them.
   */
  readonly status?: string;
  readonly lastMessageAt?: string;
  readonly subject?: string | null;
  /**
   * The first line of the most recent message, plain text.
   *
   * It was missing from this type while `POST /v1/widget/conversations/list`
   * had been returning it all along — and it is the one field a custom
   * inbox list cannot do without, because the alternative is one
   * `listMessages()` call per thread to render a row of previews.
   *
   * Null when the thread has no message with a renderable body yet.
   */
  readonly lastMessagePreview?: string | null;
  /** When the thread was opened. Also on the wire, also undeclared until now. */
  readonly createdAt?: string;
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
