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
  /**
   * What this conversation is ABOUT, decided by the page that opened it.
   *
   * The channel's `widget.lead.topic`, and the thing that makes a lead form
   * appear: a "Talk to sales" button passes `topic: 'sales'`, a support
   * launcher passes nothing and the visitor sees the ordinary composer. The
   * server stamps it as a conversation label at CREATION and publishes
   * `lead.captured`, so the thread can be routed, filtered and counted.
   *
   * ── Why this is not `setLabel` ──────────────────────────────────────────
   *
   * Because `setLabel` cannot do it, which is what the integrator who asked
   * for this had discovered the hard way. It takes a `conversationId` and
   * 404s when the session has no contact, so calling it before `open()` —
   * the obvious thing, and what Calendoro shipped — is a silent no-op, and
   * every sales thread reached the inbox untagged. A topic has to be decided
   * before the conversation exists, which means it travels with the request
   * that creates it.
   *
   * An unrecognised topic is warned about by the server and the conversation
   * opens untagged: a typo must not cost a visitor their chat.
   */
  readonly topic?: string;
  /**
   * What the page knows ABOUT this thread, for the agent and the bot (W-H3).
   *
   * The case it exists for: a "Get help with this order" button beside one
   * order, where the agent should see which order without the visitor
   * retyping it.
   *
   *     Chatly('open', {
   *       view: 'conversation',
   *       conversation: { attributes: { order_id: 'A-1902' }, label: 'orders' },
   *     });
   *
   * ── Why neither `setCustomAttributes` nor `setLabel` does this ──────────
   *
   * `setCustomAttributes` writes to the CONTACT, so the value outlives the
   * thread: the visitor's next conversation, about a different order, still
   * carries this one's number. `setLabel` needs a `conversationId`, which
   * does not exist until the visitor sends — the same trap `topic` above
   * documents, where calling it before `open()` is a silent no-op.
   *
   * ── What the operator has to have done first ───────────────────────────
   *
   * Both halves are checked against the workspace's own configuration,
   * because this object comes from a page we do not control:
   *
   *   - an `attributes` key must exist as a conversation custom attribute in
   *     Settings, and the value must match its type (a `number` attribute
   *     accepts `'3'` and stores `3`; a `list` attribute accepts only its own
   *     options);
   *   - a `label` must already be in the workspace's label registry. Casing
   *     does not matter and the registered spelling is what gets stored.
   *
   * Anything else is DROPPED and the conversation opens without it — a
   * renamed attribute must not cost a visitor their chat. The drop is logged
   * server-side with the workspace id.
   *
   * Values are `string | number | boolean`: a nested object has no rendering
   * in the inbox and no comparison in a workflow condition. At most eight
   * keys, because this is a hint from a page and not an import.
   *
   * Stamped at CREATION and never updated, like `topic`. Opening a second
   * conversation without it gives a thread with none of these — which is the
   * whole difference from a contact attribute.
   */
  readonly conversation?: {
    readonly attributes?: Readonly<Record<string, string | number | boolean>>;
    readonly label?: string;
  };
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
/**
 * What `Chatly.setCart()` accepts. `unknown` for the same reason as
 * `SetContextInput`: a host page is JavaScript, so every field is re-checked
 * at runtime and a wrong one is a console warning, never a throw.
 *
 * The shape the widget acts on is `{ items?: Array<{ name: string, id?:
 * string, variant?: string, quantity?: number, price?: number }>, total?:
 * number, currency?: string, url?: string, id?: string }`.
 *
 * **`price` and `total` are MINOR UNITS** — 4820 is $48.20, and also ¥4,820,
 * and also 4.820 KWD. The same contract a card's price has
 * (`widget-blocks/money.ts` has the three-decimal currencies that make a
 * divisor of 100 wrong), and the reason is the same: `48.20` is a float, and
 * 0.1 + 0.2 is why a basket total renders two different ways on two screens.
 * A `total` that is not a non-negative safe integer is dropped, not rounded.
 *
 * Each call REPLACES the cart. Fifty lines are kept and the rest dropped.
 */
export interface SetCartInput {
  items?: unknown;
  total?: unknown;
  currency?: unknown;
  url?: unknown;
  id?: unknown;
}

/**
 * What `Chatly.trackSale()` accepts.
 *
 * The shape the widget acts on is `{ kind: 'order_created' | 'cart_add' |
 * 'cart_remove', total?: number, currency?: string, orderId?: string, item?:
 * <one cart line> }`. `total` is MINOR UNITS, as on `SetCartInput`. An
 * unrecognised `kind` is a warning and nothing is sent — a sale event under a
 * name no audience rule matches is worse than none.
 */
export interface SaleEventInput {
  kind?: unknown;
  total?: unknown;
  currency?: unknown;
  orderId?: unknown;
  item?: unknown;
}

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
   * Put the panel above THIS element instead of in the corner, for this open.
   *
   * A CSS selector, the same spelling as `theme.anchor` — which is the
   * standing setting, where this is the one-off. A page with several chat
   * buttons (one per product card, say) names the one that was pressed, and
   * the panel appears above it rather than over the corner of the page.
   *
   * It takes priority over `theme.anchor` while the panel stays open and is
   * cleared on close, so it never changes where a later launcher open lands.
   * A selector that matches nothing, or a malformed one, falls back to
   * `theme.anchor` and then to the corner, exactly as a missing anchor does —
   * nothing here can throw into the host page.
   */
  readonly anchor?: string;
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
