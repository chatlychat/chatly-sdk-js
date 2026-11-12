/**
 * Where the visitor token lives, and the migration off the key this package
 * used to write.
 *
 * Split out of `index.ts` on 2026-11-11 when that file crossed the repo's
 * 650-line ceiling. ADR 0090 carries the decision; the comments below carry
 * the two rules that are easy to get wrong when editing this.
 *
 * `chatly:vt:<publicId>` is CANONICAL: the one the widget writes, and the
 * only one the published storage declaration names
 * (`vendors[product=chatly].storage`). This package used to write
 * `livechat:vt:` instead, on the argument that renaming would orphan every
 * browser holding a token. The orphaning was real; the conclusion was not,
 * because a read-migration costs nothing. What the old key DID cost: this
 * SDK and the widget on one page did not share a visitor, and a consent
 * manager blocking the declared key did not block the real one.
 */
const visitorKey = (publicId: string): string => `chatly:vt:${publicId}`;
/** The pre-2026-11-11 key. Read once, migrated forward, never written. */
const legacyVisitorKey = (publicId: string): string => `livechat:vt:${publicId}`;

/**
 * Canonical first, then the legacy key, moved forward on the spot so the
 * fallback is paid at most once per browser.
 *
 * The migration write is guarded on its own: `getItem` succeeding does not
 * mean `setItem` will (a full quota or a private window refuses the write),
 * and failing to migrate must leave the visitor signed in on the old key
 * rather than throwing out of a constructor.
 */
export function readVisitorToken(publicId: string): string | null {
  const current = localStorage.getItem(visitorKey(publicId));
  if (current !== null) {
    return current;
  }
  const legacy = localStorage.getItem(legacyVisitorKey(publicId));
  if (legacy === null) {
    return null;
  }
  try {
    localStorage.setItem(visitorKey(publicId), legacy);
    localStorage.removeItem(legacyVisitorKey(publicId));
  } catch {
    // Keep the token; the next load retries the move.
  }
  return legacy;
}

/** The canonical key only. The legacy key is never written again. */
export function writeVisitorToken(publicId: string, token: string): void {
  localStorage.setItem(visitorKey(publicId), token);
}

/**
 * Both keys, always. Clearing only the canonical one would let the next
 * `readVisitorToken` fall back and RESURRECT the token just killed — on the
 * stale-session path, the very token the server refused.
 */
export function clearVisitorToken(publicId: string): void {
  localStorage.removeItem(visitorKey(publicId));
  localStorage.removeItem(legacyVisitorKey(publicId));
}
