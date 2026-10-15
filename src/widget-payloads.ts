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
}

export type ChatlyEventHandler = (detail: unknown) => void;
