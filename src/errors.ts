/**
 * Errors this SDK throws and reports.
 *
 * `new Error('string')` is banned by CLAUDE.md §4, and a published package
 * cannot import `AppError` from `@livechat/shared` — an internal import
 * typechecks here, passes every test here, and breaks at `npm install`. So
 * these are the package's own, with the three fields the convention asks for:
 * a `code` to switch on, the HTTP status when there is one, and `cause`.
 *
 * Shaped deliberately like `packages/core/src/errors.ts`, which solved the
 * same problem for the same reason. It is NOT imported from there: that is a
 * different published package and this one has no runtime dependencies.
 *
 * `ChatlyError extends Error`, so every consumer who was catching an `Error`
 * or reading `.message` keeps working — the codes are additive.
 */

export type ChatlyErrorCode =
  /** A `/v1/widget/*` call answered a non-2xx. `httpStatus` carries which. */
  | 'request_failed'
  /** A presigned upload PUT answered a non-2xx. `httpStatus` carries which. */
  | 'upload_failed'
  /** `subscribe({ io })` with nowhere to point the socket. */
  | 'no_realtime_host'
  /**
   * `POST /v1/widget/realtime/token` would not mint, or answered no token.
   *
   * On a RE-mint this is the interesting one: the socket is still up on the
   * credential it already has, and the next reconnect will be refused. It is
   * reported rather than swallowed precisely because the symptom otherwise
   * arrives an hour later as a thread that quietly stops updating.
   */
  | 'realtime_token_failed';

export class ChatlyError extends Error {
  public readonly code: ChatlyErrorCode;
  public readonly httpStatus: number | null;
  public override readonly cause: unknown;

  public constructor(
    code: ChatlyErrorCode,
    message: string,
    extra: { httpStatus?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ChatlyError';
    this.code = code;
    this.httpStatus = extra.httpStatus ?? null;
    this.cause = extra.cause;
  }
}
