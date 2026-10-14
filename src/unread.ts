/**
 * The unread total, as a rule of its own.
 *
 * ── Why this is not three lines inside the client ─────────────────────────
 *
 * `src/index.ts` sat at 641 lines against this repo's 650-line ceiling, so a
 * method with the docblock this decision needs did not fit. Extracting the
 * summing rule was the honest answer rather than trimming the explanation:
 * the rule is a pure derivation over a list, it is testable without a
 * transport or a visitor token, and the client keeps one line.
 *
 * ── What a custom launcher actually needs ─────────────────────────────────
 *
 * A host who replaces the launcher had no way to show "3 unread". The
 * documented advice was to tally the `message` event — which counts only what
 * arrived WHILE THE PAGE WAS OPEN, and a badge exists for the reply that came
 * after the visitor navigated away. No client-side counter can know about
 * that one.
 *
 * The data was on the wire the whole time: `POST
 * /v1/widget/conversations/list` returns `unreadContactCount` per thread, and
 * the widget's own Messages tab renders it. `HeadlessConversation` simply did
 * not declare the field, so the published contract hid it.
 *
 * ── Why the count is not on `window.Chatly` ───────────────────────────────
 *
 * Because it costs a request, and the widget must not spend one per page view
 * for the visitors who never open the chat. The widget fetches the
 * conversation list when the panel OPENS, so the count genuinely is not known
 * at page load; making it known would mean a fetch for everybody, on top of
 * the 44KB `widget.js` every visitor already downloads on every page. A host
 * who has written their own launcher has chosen to write code.
 */
import type { HeadlessConversation } from './types.js';

/**
 * Total unread messages across every thread.
 *
 * An absent `unreadContactCount` reads as zero rather than propagating
 * `undefined` into the arithmetic — an older API build does not send the
 * field, and a badge showing `NaN` is worse than one showing nothing.
 */
export function sumUnread(conversations: readonly HeadlessConversation[]): number {
  return conversations.reduce((total, c) => total + (c.unreadContactCount ?? 0), 0);
}
