/**
 * The shapes you pass to a `Chatly` method, and the one an event hands back.
 *
 * Split out of `widget-globals.ts` at the 650-line ceiling and re-exported
 * from it unchanged, so nothing about the published surface moved. The seam
 * is "arguments and payloads" on this side, "the configuration you
 * initialise with and the API you call" on the other.
 */

/** The routing and pre-fill a new conversation may carry. See `ChatlyApi.startConversation`. */
export interface StartConversationRequest {
  readonly botSlug?: string;
  readonly initialMessage?: string;
}

/**
 * What `Chatly.setContext()` accepts.
 *
 * Every member is `unknown` because the widget re-checks all of them at the
 * call boundary rather than trusting the page: this is invoked from inside a
 * customer's own click handler, often in a `.then()`, and a rejected promise
 * there is an unhandled rejection on a page we do not control. The narrow
 * shapes are `audience?: string`, `contextToken?: string` (a JWT your SERVER
 * signed), `page?: { path?, url? }` and `context?: Record<string, string |
 * number | boolean>` — anything else is warned about and dropped.
 */
export interface SetContextInput {
  audience?: unknown;
  page?: unknown;
  contextToken?: unknown;
  /** Further UNSIGNED claims. Signed ones live inside `contextToken`. */
  context?: unknown;
  /**
   * What KIND of place this is and what it can do — a 3D world, a game, a
   * headset: `{ id?, kind: 'world', capabilities?: [{ name, label, equivalent,
   * unprompted?, args? }], state?: { room, zone, near, lookingAt, holding } }`.
   *
   * UNSIGNED, always: the bot receives it as `context.surface` with `trust:
   * 'unverified'`, never in `context.verified`. Send INTENT — names of rooms,
   * zones and things — never positions; there is no field for a position.
   * Every capability needs an `equivalent` (a sentence or a link) so a visitor
   * who cannot see the scene still has a way to the same result. The server
   * validates entry by entry and an entry it drops is warned about, not fatal.
   * Each `id` is its own slot, so a world and a web page open at once do not
   * overwrite each other.
   */
  surface?: unknown;
}

/**
 * What `Chatly.reportAction()` accepts. `unknown` for the same reason as
 * `SetContextInput`.
 *
 * The shape the widget will act on is `{ messageId: string, actionId: string,
 * status: 'done' | 'failed', text?: string, blocks?: unknown, data?:
 * Record<string, unknown> }`.
 */
export interface ReportActionInput {
  messageId?: unknown;
  actionId?: unknown;
  status?: unknown;
  text?: unknown;
  blocks?: unknown;
  data?: unknown;
}

/** What `ready` and `identified` carry. `contactId` is null while anonymous. */
export interface SessionSnapshot {
  contactId: string | null;
  workspaceId: string;
}

/** The object form of `open`. See `ChatlyApi.open`. */
export interface OpenRequest extends StartConversationRequest {
  /**
   * Only `'conversation'` today, and it is a required discriminator rather
   * than an optional convenience: `open({ botSlug })` with no `view` would be
   * ambiguous about whether the caller wanted a tab or a thread, and the two
   * differ in whether the visitor has to click again.
   */
  readonly view: 'conversation';
  /**
   * Open an EXISTING thread, by the id a `conversation` event handed you.
   *
   * For a page that keeps its own list of a customer's threads — "you asked
   * about this order" next to the order — and wants the chat to land on that
   * one rather than on the message list with it one tap away.
   *
   * ── Why this is on `OpenRequest` and not on `StartConversationRequest` ──
   *
   * `startConversation({ conversationId })` would be a contradiction in the
   * method's own name. The two shapes share a field list because opening a
   * thread and starting one are the same gesture from the page's side, but
   * only one of them can mean "this one, the one that already exists".
   *
   * ── It is not a capability ──────────────────────────────────────────────
   *
   * The id is on a page the visitor controls, so they can put any id here.
   * They gain nothing: every widget read of a thread goes through the visitor
   * session, which compares the conversation's `contact_id` to the session's
   * own and answers 404 when they differ. A forged id opens an empty panel
   * and reads nothing. We do NOT pre-check it client-side — a check in a
   * place the visitor can edit is theatre, and it would also make the panel
   * wait on a round trip before showing anything.
   *
   * `botSlug` is ignored alongside it (with a warning): a thread's bot route
   * was decided when it started, and re-sending the hint would change the
   * route for the visitor's NEXT conversation as a side effect of opening an
   * old one. `initialMessage` still works — it pre-fills the composer, which
   * is exactly "reply to this".
   */
  readonly conversationId?: string;
}

export type ChatlyEventHandler = (detail: unknown) => void;
