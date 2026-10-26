/**
 * `WidgetIdentity` — who the host page says this visitor is.
 *
 * ── What this file owns, and why it is its own file ─────────────────────
 *
 * One interface, and the four credentials and claims a host can put on it:
 * the external id contacts are matched on, the HMAC `userHash` for a channel
 * with a shared secret, and the OIDC pair — a `userToken` and the `getToken`
 * provider that mints one per request.
 *
 * Split out of `widget-globals.ts` when that file crossed the repo's
 * 650-line ceiling. The seam is this: everything left there describes the
 * widget's own SURFACE — `InitOptions`, `ChatlyApi`, the event union,
 * `window.Chatly` — while this describes a person, and it is the one shape in
 * that file whose documentation is about security rather than about the
 * widget. The OIDC fields doubled its length, which is what pushed the file
 * over.
 *
 * It is re-exported from `widget-globals.ts` and from the package entry, so
 * the published surface is identical and nothing an integrator imports moved.
 * `scripts/check-widget-wrapper-parity.mjs` reads this file by path to
 * compare these members against `ChatlyIdentity` in
 * `packages/widget-element/src/types.ts`, in both directions; it was
 * repointed here in the same commit as the move, and its coverage floor fails
 * loudly rather than comparing two empty sets.
 *
 * ── Nothing here is validated ──────────────────────────────────────────
 *
 * Compile-time only, like the rest of the published types. The server
 * validates what actually reaches it (`widgetInitSchema`, then
 * `widget-guards.ts`), and the refusals it answers with are specific enough
 * to act on — which is why the fields below describe them rather than
 * pretending the browser could check.
 */

/**
 * Identity the host page already knows about this visitor.
 *
 * `externalId` is the only field identity verification can bind, and the only
 * field contacts are matched on — without it every visit creates a new
 * contact. `userHash` is `HMAC-SHA256(<channel IDV secret>, externalId)`,
 * computed by YOUR SERVER; never in the browser, where the secret would be in
 * your page source.
 */
export interface WidgetIdentity {
  externalId?: string;
  email?: string;
  name?: string;
  userHash?: string;
  /**
   * IDV v2: a short-lived HS256 JWT YOUR SERVER mints with the channel's
   * identity-verification secret, signing the identity itself — `sub` (the
   * external id), and optionally `email`, `name` and `attrs` — rather than
   * only the external id the way `userHash` does.
   *
   * Audience `chatly:<publicId>`, `exp` at most 300 seconds after `iat`. It
   * is accepted alongside `userHash` on an `hmac` channel, so a page can
   * adopt it without the others changing. Fields the token signs are the
   * ones an agent can trust, and the ones `identityVerification.lockEmail`
   * lets through. If you also pass `externalId` it must equal `sub`.
   *
   * Never minted in the browser — the secret would be in your page source.
   */
  identityToken?: string;
  /**
   * A short-lived identity token from your identity provider, for a channel
   * whose `identityVerification.mode` is `oidc`.
   *
   * The OIDC alternative to `userHash`: a JWT your IdP signed, verified by
   * Chatly against the issuer and audience configured on the channel. Its
   * `sub` IS the external id, so the ordinary call sends this on its own.
   *
   * **Prefer `getToken` below.** This field is the token itself, and a token
   * is only good for about 60 seconds — so it works for the `init` it is
   * passed to and is dead by the next page view, the next `identify()` and
   * every recovery from a refused session. The server has accepted it since
   * the OIDC door shipped and no typed client could send it, which is why it
   * is declared; `getToken` is what you should actually reach for.
   *
   * Never alongside `userHash`, and never a value computed in the browser.
   */
  userToken?: string;
  /**
   * Mint a short-lived identity token, on demand, for a channel whose
   * `identityVerification.mode` is `oidc`.
   *
   * The OIDC alternative to `userHash`: instead of an HMAC your server
   * computes, the widget presents a JWT your identity provider signed, and
   * Chatly verifies it against the issuer and audience configured on the
   * channel. The token's `sub` IS the external id.
   *
   * ```js
   * Chatly('identify', {
   *   getToken: () => atlas.session.getToken({ template: 'chatly' }),
   * });
   * ```
   *
   * ── A FUNCTION, and not a string, on purpose ───────────────────────────
   *
   * These tokens are short-lived — 60 seconds by default — and the widget
   * re-sends an identity on every `init` and on every recovery from a
   * refused session. A token captured once is expired by the next page view,
   * and the widget cannot hand you a "please refresh" hook after the fact. So
   * it holds the FUNCTION and calls it per request.
   *
   * Nothing minted here is ever stored. It is not written to
   * `localStorage` or `sessionStorage`, it is not kept in memory between
   * requests, and it is not reused on a retry — a bearer credential is the
   * one thing that must not survive the call it was minted for. What the
   * widget keeps is this function.
   *
   * ── Do not pass `userHash` as well ────────────────────────────────────
   *
   * A channel verifies one way or the other, and the server refuses either
   * credential on a channel configured for the other. Passing `externalId`
   * alongside is allowed and must EQUAL the token's `sub`: the server answers
   * 403 naming both values rather than silently preferring one, because
   * filing the contact under `sub` while your code believes it identified
   * `u_42` is a bug nobody would ever find.
   */
  getToken?: () => string | Promise<string>;
  attributes?: Record<string, unknown>;
}
