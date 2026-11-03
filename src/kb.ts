/**
 * The knowledge-base request bodies, built away from `index.ts`.
 *
 * ═══ WHY THESE METHODS EXIST ═════════════════════════════════════════════
 *
 * The widget has searched and rendered help articles since the article chunk
 * shipped (`client-kb.ts:37`), and a HOST PAGE could not. A competitive sweep
 * on 2026-10-27 found Crisp, Help Scout's Beacon and HubSpot all closing that
 * with a programmatic search, so `Chatly.searchArticles` and `Chatly.article`
 * do here. Both routes already existed — `POST /v1/widget/kb/search` and
 * `POST /v1/widget/kb/article` (`widget-kb.controller.ts:33,67`) — and the
 * only missing piece was the client surface.
 *
 * ═══ WHY THIS IS A FILE AND NOT TWO INLINE OBJECT LITERALS ═══════════════
 *
 * `index.ts` reached the repo's 650-line ceiling. Splitting a file is never
 * free — `bundle-budgets-history.md` records it costing bytes twice — but
 * this one is a browser SDK consumed as an ES module by a bundler that will
 * inline both of these, and the prose above is most of what moved.
 *
 * ═══ AN ABSENT OPTION IS ABSENT, NOT `undefined` ═════════════════════════
 *
 * Each builder OMITS a key the caller did not pass rather than setting it to
 * `undefined`, and that is a contract with the server rather than tidiness.
 * `widget.schemas.ts:500` spells it out for `locale`: absent means "no locale
 * context and therefore no filter", which is what an older widget bundle on a
 * customer's page sends and what it must keep getting. `JSON.stringify` drops
 * an `undefined` value anyway, so the two spellings go down the wire
 * identically today — which is exactly why `kb.spec.ts` asserts on the KEYS.
 * The next person to "tidy" these into unconditional properties gets a red
 * test instead of a behaviour change nobody can see.
 *
 * `profile` is an AUDIENCE NAME, resolved to collection ids server-side
 * against the channel's `config.help`. Passing one can only ever narrow what
 * comes back, so a host page cannot widen its own scope by guessing.
 */

/** Options a host page may pass to `searchArticles`. */
export interface KbSearchOptions {
  /** Clamped to 20 server-side. */
  readonly limit?: number;
  /** A BCP-47 tag. Absent means no locale filter at all. */
  readonly locale?: string;
  /** An audience profile name. Can only narrow the result. */
  readonly profile?: string;
}

/** Options a host page may pass to `article`. */
export interface KbArticleOptions {
  readonly profile?: string;
}

/** The `POST /v1/widget/kb/search` body. */
export function kbSearchBody(
  publicId: string,
  visitorToken: string | null,
  query: string,
  opts: KbSearchOptions,
): Record<string, unknown> {
  return {
    publicId,
    visitorToken,
    query,
    ...(opts.limit === undefined ? {} : { limit: opts.limit }),
    ...(opts.locale === undefined ? {} : { locale: opts.locale }),
    ...(opts.profile === undefined ? {} : { profile: opts.profile }),
  };
}

/** The `POST /v1/widget/kb/article` body. */
export function kbArticleBody(
  publicId: string,
  visitorToken: string | null,
  slug: string,
  opts: KbArticleOptions,
): Record<string, unknown> {
  return {
    publicId,
    visitorToken,
    slug,
    ...(opts.profile === undefined ? {} : { profile: opts.profile }),
  };
}
