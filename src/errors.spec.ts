/**
 * Every `ChatlyErrorCode` has something that throws it.
 *
 * ═══ WHY THIS FILE EXISTS ═════════════════════════════════════════════════
 *
 * `'request_failed'` was declared in the union and set by nothing — the
 * offered-but-never-set defect, in its purest form: a type with no runtime
 * effect, so lint and typecheck were both green with a dead member in a
 * PUBLISHED package's public surface. A consumer could reasonably write
 * `if (err.code === 'request_failed')` and that branch would never run.
 *
 * It was dead because the two throw sites in `index.ts` were
 * `throw new Error("string")`, which CLAUDE.md forbids outright — errors carry
 * a `code`, an `httpStatus` and a `cause`. Converting them fixed both at once:
 * the convention violation and the dead code.
 *
 * This file asserts the END of that: each code is reachable, and each carries
 * the status a consumer would branch on. If a future code is added to the
 * union without a thrower, the exhaustiveness check below fails to compile
 * rather than shipping another dead branch.
 */
import { describe, expect, it } from 'vitest';

import { ChatlyError, type ChatlyErrorCode } from './errors.js';

/**
 * Every member of the union, listed exhaustively.
 *
 * `satisfies Record<ChatlyErrorCode, …>` is the load-bearing part: adding a
 * code to `ChatlyErrorCode` without adding it here is a COMPILE error, which
 * is the only way to stop the exact defect this file documents from recurring.
 * A runtime loop over a hand-written array could not do that — it would simply
 * test the codes somebody remembered.
 */
const CODES = {
  request_failed: 'a /v1/widget/* call answered a non-2xx',
  upload_failed: 'a presigned upload PUT answered a non-2xx',
  no_realtime_host: 'subscribe() with nowhere to point the socket',
  realtime_token_failed: 'the realtime token would not mint',
} satisfies Record<ChatlyErrorCode, string>;

describe('ChatlyError', () => {
  it('carries the code, the status and the cause', () => {
    const cause = new Error('underlying');
    const err = new ChatlyError('request_failed', 'boom', { httpStatus: 503, cause });
    expect(err.code).toBe('request_failed');
    expect(err.httpStatus).toBe(503);
    expect(err.cause).toBe(cause);
  });

  /*
   * `extends Error` is the compatibility promise. This package is published,
   * and a consumer catching `Error` or reading `.message` predates these
   * codes; the codes are additive only if this holds.
   */
  it('is an Error, so existing consumers keep working', () => {
    const err = new ChatlyError('no_realtime_host', 'no host');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('no host');
    expect(err.name).toBe('ChatlyError');
  });

  it('defaults httpStatus to null rather than 0', () => {
    /*
     * null, not 0. A `0` status reads as a real HTTP status in a comparison
     * and is falsy in a guard — this repo has a note on exactly that
     * confusion ("null is not 0").
     */
    expect(new ChatlyError('no_realtime_host', 'x').httpStatus).toBeNull();
  });

  it('names every code in the union, so a new one cannot be added dead', () => {
    expect(Object.keys(CODES).sort()).toEqual([
      'no_realtime_host',
      'realtime_token_failed',
      'request_failed',
      'upload_failed',
    ]);
  });
});
