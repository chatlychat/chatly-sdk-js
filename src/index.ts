/**
 * Browser SDK. Pairs with the widget loader to give product code a way to
 * identify visitors, fire CDP events, and control the widget.
 *
 *   import { Chatly } from '@chatlychat/sdk-js';
 *   const lc = Chatly.init({ publicId: 'acme-web', apiUrl: 'https://api.acme.com' });
 *   await lc.identify({ email: 'a@b.com', name: 'Alice' });
 *   await lc.track('signup_completed', { plan: 'pro' });
 *   lc.open();
 */

import { ChatlyError } from './errors.js';
import { createSubscription } from './subscription.js';
import { sumUnread } from './unread.js';

import type {
  HeadlessConversation,
  HeadlessMessage,
  SubscribeHandlers,
  SubscribeOptions,
  Subscription,
} from './types.js';

export type {
  HeadlessConversation,
  HeadlessMessage,
  SubscribeHandlers,
  SubscribeOptions,
  SocketIoFactory,
  Subscription,
  TypingSignal,
} from './types.js';
export { TYPING_STOP_AFTER_MS } from './live.js';
/*
 * The error every failure path now carries. `ChatlyError extends Error`, so
 * nothing that caught an `Error` or read `.message` changes — the `code` is
 * additive, and it is what tells a consumer "the realtime credential could
 * not be refreshed" apart from "the list call 500'd".
 */
export { ChatlyError } from './errors.js';
export type { ChatlyErrorCode } from './errors.js';
/*
 * The snippet surface: `InitOptions`, `ChatlyApi`, `ChatlyGlobal` and the
 * shapes they name. Declared in `widget-globals.ts`, which also augments
 * `window.Chatly` — see that file's header for why a published package is the
 * only place those declarations can usefully live.
 */
export type * from './widget-globals.js';

export interface SdkOptions {
  publicId: string;
  apiUrl?: string;
  /**
   * Socket.IO host, for the push path of `subscribe()`.
   *
   * Normally unnecessary: `/v1/widget/init` reports the right one and the SDK
   * remembers it. Set this only for a deployment whose realtime host the
   * server cannot know — the same escape hatch the widget's embed has.
   */
  realtimeUrl?: string;
}

export interface IdentifyInput {
  /**
   * Your own id for this person. Optional — see `identify` — but it is the
   * only field identity verification can bind, so a channel with verification
   * enabled needs this plus `userHash` to consider the visitor proven.
   */
  externalId?: string;
  email?: string;
  phone?: string;
  name?: string;
  /**
   * `HMAC-SHA256(<your channel's IDV secret>, externalId)`, computed by YOUR
   * SERVER. Never compute it in the browser — the secret would be in your
   * page source. Required when the channel has identity verification enabled
   * and you are claiming an `externalId`; ignored when it does not.
   */
  userHash?: string;
  attributes?: Record<string, unknown>;
}

export interface TrackInput {
  name: string;
  properties?: Record<string, unknown>;
}

/**
 * An uploaded file, as returned by `uploadFile` and accepted by `send`.
 *
 * Declared locally rather than imported from `@livechat/shared`: this bundle
 * ships to a customer's website, and importing from the shared package drags
 * zod into it — measured at ~11KB gzipped when it happened to the widget.
 */
export interface VisitorAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly url: string;
}

export class Chatly {
  private readonly base: string;
  private visitorToken: string | null;
  /**
   * The realtime host `/v1/widget/init` reported, remembered for `subscribe`.
   *
   * `/v1/widget/realtime/token` returns `{ token, expiresAt }` and NO url —
   * the first version of `subscribe` read a `url` off it and silently fell
   * back to the API host, which is not where the socket server is.
   */
  private realtimeUrl: string | null = null;
  /**
   * This visitor's contact id, remembered for the typing event — the realtime
   * gateway's payload requires an `actorId` and the visitor's is their contact.
   */
  private contactId: string | null = null;
  /**
   * Who to tell when the stored visitor session is REPLACED.
   *
   * `request()` absorbs a 403 `visitor_session_*` by dropping the dead token,
   * re-initialising and replaying the call — which cures the REST surface and
   * used to leave a live socket holding a realtime token minted for a session
   * that no longer applies. Its next reconnect presented that token and was
   * refused, silently, for the rest of the page. The only subscriber is a
   * push subscription, which re-mints; see `realtime.ts`.
   */
  private readonly sessionListeners = new Set<() => void>();

  public static init(opts: SdkOptions): Chatly {
    return new Chatly(opts);
  }

  private constructor(private readonly opts: SdkOptions) {
    /*
     * Production, not a dev hostname.
     *
     * This was `https://api.livechat.local`, which resolves nowhere — so a
     * developer who followed the published docs and omitted `apiUrl` got an
     * SDK whose every call failed, and the docs page carried a warning
     * telling each reader to override it. Reported by a customer who
     * integrated from the docs alone, not caught here, because every test in
     * this package passes an explicit `apiUrl`.
     *
     * A self-hosted install still overrides it; that is the only caller that
     * ever should.
     */
    this.base = opts.apiUrl ?? 'https://api.chatlychat.com';
    // Storage key deliberately left as `livechat:` — the internal scope name.
    // Renaming it would orphan the visitor token of every browser that has
    // one, silently signing those visitors out of their own conversation.
    // Cosmetics are not worth that; the customer-visible strings are what
    // matter and those say Chatly.
    this.visitorToken = localStorage.getItem(`livechat:vt:${opts.publicId}`);
  }

  public open(): void {
    window.Chatly?.open?.();
  }
  public close(): void {
    window.Chatly?.close?.();
  }

  /**
   * Attach a known identity to this visitor.
   *
   * Re-initialises the session with an `identity` payload rather than calling
   * a dedicated endpoint. There has never been a `/v1/widget/identify` route —
   * this method has 404'd since it was written, as have the Kotlin and Swift
   * equivalents. Identity is accepted by `init`, which is also where the
   * `userHash` check for verified identity lives, so routing through it means
   * identification and verification cannot drift apart.
   *
   * `identify({ email })` with no `externalId` — the exact call this file's
   * own header comment demonstrates — used to be rejected by the server with
   * a 400, because `widgetInitSchema` required `externalId`. It no longer is;
   * an email-only identity attaches a reply address to whoever this browser
   * already is. It cannot be *verified*, though: `userHash` binds the external
   * id and there is nothing to bind without one.
   *
   * No longer mints an anonymous session first. That cost a round trip, and
   * worse, it was pointless: the token the server returns HERE is the
   * identified one, and it is stored below. Before, the SDK kept the
   * anonymous token it had just fetched, so every later `track` or `send`
   * spoke for the anonymous visitor and the identification was quietly lost.
   */
  public async identify(input: IdentifyInput): Promise<{ contactId: string }> {
    const res = await this.request('/v1/widget/init', {
      publicId: this.opts.publicId,
      ...(this.visitorToken === null ? {} : { visitorToken: this.visitorToken }),
      identity: input,
    });
    const body = (await res.json()) as {
      session?: { token?: string; contactId?: string | null };
      realtimeUrl?: string | null;
    };
    if (typeof body.realtimeUrl === 'string' && body.realtimeUrl.length > 0) {
      this.realtimeUrl = body.realtimeUrl;
    }
    // The session token is now an opaque server-issued credential rather than
    // the external id, and `init` rotates it on every call — so it has to be
    // taken from the response, not assumed to be unchanged.
    const token = body.session?.token;
    if (typeof token === 'string' && token.length > 0) {
      this.setVisitorToken(token);
    }
    const contactId = body.session?.contactId ?? '';
    if (contactId.length > 0) {
      /*
       * Remembered here as well as in `ensureVisitorToken`, because `identify`
       * can be the FIRST call a session makes and `ensureVisitorToken` returns
       * early when a token is already in localStorage. A returning browser
       * therefore never learned its own contact id, and `setTyping` sent
       * `actorId: 'unknown'` — which the realtime gateway now overwrites from
       * the JWT anyway, but a field we can fill correctly should not be a
       * placeholder.
       */
      this.contactId = contactId;
    }
    return { contactId };
  }

  /**
   * Upload a file as this visitor and return the attachment record.
   *
   * The two-step presign + direct PUT is deliberate: the file never passes
   * through the API, which would mean proxying it in memory only to write it
   * to object storage anyway.
   */
  public async uploadFile(file: File): Promise<VisitorAttachment> {
    await this.ensureVisitorToken();
    const res = await this.request('/v1/widget/uploads/presign', {
      publicId: this.opts.publicId,
      visitorToken: this.visitorToken,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    });
    const presigned = (await res.json()) as {
      uploadId: string;
      url: string;
      method: string;
      headers: Record<string, string>;
      publicUrl: string;
    };
    const put = await fetch(presigned.url, {
      method: presigned.method,
      headers: presigned.headers,
      body: file,
    });
    if (!put.ok) {
      throw new ChatlyError('upload_failed', `Upload failed (${put.status})`, {
        httpStatus: put.status,
      });
    }
    return {
      id: presigned.uploadId,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      url: presigned.publicUrl,
    };
  }

  /** Send a message, optionally with attachments from `uploadFile`. */
  public async send(
    conversationId: string,
    body: string,
    attachments: VisitorAttachment[] = [],
  ): Promise<void> {
    await this.ensureVisitorToken();
    await this.request('/v1/widget/messages', {
      publicId: this.opts.publicId,
      visitorToken: this.visitorToken,
      conversationId,
      body,
      attachments,
    });
  }

  // ── Headless: read ────────────────────────────────────────────────────
  //
  // Everything below exists so a consumer can build their OWN chat UI. Before
  // it, the SDK could `send` into a conversation but could not create one,
  // list threads, read history or learn that a reply had arrived — so it was a
  // companion to the widget, not a client you could render from.

  /**
   * This visitor's own conversations, most recent first.
   *
   * Scoped by the visitor token, so it is exactly the threads this browser is
   * entitled to and never anyone else's.
   */
  public async listConversations(limit = 20): Promise<HeadlessConversation[]> {
    await this.ensureVisitorToken();
    const res = await this.request('/v1/widget/conversations/list', {
      publicId: this.opts.publicId,
      visitorToken: this.visitorToken,
      limit,
    });
    const body = (await res.json()) as { conversations?: HeadlessConversation[] };
    return body.conversations ?? [];
  }

  /** Total unread across every thread. See `unread.ts` for why it lives here. */
  public async unreadCount(): Promise<number> {
    return sumUnread(await this.listConversations());
  }

  /** The messages of one conversation, oldest first. */
  public async listMessages(conversationId: string, limit = 50): Promise<HeadlessMessage[]> {
    await this.ensureVisitorToken();
    const res = await this.request('/v1/widget/messages/list', {
      publicId: this.opts.publicId,
      visitorToken: this.visitorToken,
      conversationId,
      limit,
    });
    const body = (await res.json()) as { messages?: HeadlessMessage[] };
    return body.messages ?? [];
  }

  // ── Headless: write ───────────────────────────────────────────────────

  /**
   * Open a NEW conversation with a first message.
   *
   * `send` replies to one that exists and requires a `conversationId`; this is
   * the other endpoint. Getting them the wrong way round is a 400 complaining
   * about a missing `conversationId`, which is how the repo's own E2E spec was
   * written and why it could never pass.
   */
  public async startConversation(
    body: string,
    attachments: VisitorAttachment[] = [],
  ): Promise<{ conversationId: string }> {
    await this.ensureVisitorToken();
    const res = await this.request('/v1/widget/conversations', {
      publicId: this.opts.publicId,
      visitorToken: this.visitorToken,
      body,
      attachments,
    });
    const parsed = (await res.json()) as { conversation?: { id?: string } };
    return { conversationId: parsed.conversation?.id ?? '' };
  }

  // ── Headless: live ────────────────────────────────────────────────────

  /**
   * Call `onMessage` for every message this subscription has not already
   * given you. Returns the unsubscribe function.
   *
   * **Polling by default**, because the alternative is making every consumer
   * ship `socket.io-client` whether they want push or not. Pass your own
   * factory for push:
   *
   *     import { io } from 'socket.io-client';
   *     const stop = chatly.subscribe(id, { onMessage }, { io });
   *
   * Errors go to `onError`, never a rejected promise: this is long-lived, and
   * a rejection nobody awaits is an unhandled rejection on the customer's own
   * page.
   */
  public subscribe(
    conversationId: string,
    handlers: SubscribeHandlers,
    options: SubscribeOptions = {},
  ): Subscription {
    /*
     * The body is `subscription.ts`, and the five capabilities below are the
     * whole of what it needs from this class. Two are FUNCTIONS because they
     * are read late: `/v1/widget/init` reports the realtime host and the
     * contact id, and for an anonymous visitor it is this subscription that
     * triggers that init — so a value read here is read before it exists.
     */
    return createSubscription(
      {
        listMessages: (id) => this.listMessages(id),
        mintRealtimeToken: (id) => this.mintRealtimeToken(id),
        realtimeHost: () => this.opts.realtimeUrl ?? this.realtimeUrl,
        contactId: () => this.contactId,
        onSessionReplaced: (fn) => this.onSessionReplaced(fn),
      },
      conversationId,
      handlers,
      options,
    );
  }

  /**
   * `POST /v1/widget/realtime/token` — ONE conversation, HS256, 1h TTL.
   *
   * Not `session.token` from `/v1/widget/init`: that is the long-lived
   * visitor credential every REST body carries and the realtime gateway does
   * not accept it at all (`docs/prompts/5/mobile-sdk-visitor-contract.md`
   * §1). Going through `request()` is what makes the stale-session recovery
   * apply to the mint as well as to everything else.
   */
  private async mintRealtimeToken(conversationId: string): Promise<string> {
    await this.ensureVisitorToken();
    const res = await this.request('/v1/widget/realtime/token', {
      publicId: this.opts.publicId,
      visitorToken: this.visitorToken,
      conversationId,
    });
    const { token } = (await res.json()) as { token?: string };
    if (typeof token !== 'string' || token.length === 0) {
      throw new ChatlyError(
        'realtime_token_failed',
        'chatly: /v1/widget/realtime/token answered no token',
      );
    }
    return token;
  }

  /**
   * Tell me when the stored visitor session is replaced. Returns the
   * unregister.
   *
   * Private because it is plumbing rather than product: the only subscriber
   * is `realtime.ts`, whose minted token belongs to the session that was just
   * thrown away. Exposing it publicly would be a surface to support for one
   * internal caller.
   */
  private onSessionReplaced(fn: () => void): () => void {
    this.sessionListeners.add(fn);
    return () => {
      this.sessionListeners.delete(fn);
    };
  }

  /** Submit a post-chat satisfaction score (1-5, or 0-10 for NPS). */
  public async rate(conversationId: string, score: number, comment?: string): Promise<void> {
    await this.ensureVisitorToken();
    await this.request('/v1/widget/csat', {
      publicId: this.opts.publicId,
      visitorToken: this.visitorToken,
      conversationId,
      score,
      ...(comment === undefined ? {} : { comment }),
    });
  }

  /** Email this visitor a transcript of their conversation. */
  public async emailTranscript(conversationId: string, email: string): Promise<void> {
    await this.ensureVisitorToken();
    await this.request('/v1/widget/transcript', {
      publicId: this.opts.publicId,
      visitorToken: this.visitorToken,
      conversationId,
      email,
    });
  }

  public async track(name: string, properties?: Record<string, unknown>): Promise<void> {
    await this.ensureVisitorToken();
    await this.request('/v1/widget/events', {
      publicId: this.opts.publicId,
      visitorToken: this.visitorToken,
      name,
      properties: properties ?? {},
    });
  }

  private setVisitorToken(token: string): void {
    this.visitorToken = token;
    localStorage.setItem(`livechat:vt:${this.opts.publicId}`, token);
  }

  /**
   * The `/v1/widget/init` in flight, if any.
   *
   * Without this, `ensureVisitorToken` is not safe to call twice before the
   * first one lands — and `subscribe()` does exactly that, firing the history
   * poll and the realtime-token mint in the same tick on a browser with no
   * stored token. Two inits is two anonymous SESSIONS: the second overwrites
   * the first, so the thread the consumer was handed and the conversation the
   * realtime token is scoped to belonged to two different contacts. Found by
   * the session-replacement test in `realtime.spec.ts`, which counts inits.
   */
  private initializing: Promise<void> | null = null;

  private async ensureVisitorToken(): Promise<void> {
    if (this.visitorToken !== null) {
      return;
    }
    if (this.initializing !== null) {
      await this.initializing;
      return;
    }
    const run = this.initVisitorSession();
    this.initializing = run;
    try {
      await run;
    } finally {
      if (this.initializing === run) {
        this.initializing = null;
      }
    }
  }

  private async initVisitorSession(): Promise<void> {
    const res = await this.request('/v1/widget/init', { publicId: this.opts.publicId });
    const body = (await res.json()) as {
      session: { token: string; contactId?: string | null };
      realtimeUrl?: string | null;
    };
    this.setVisitorToken(body.session.token);
    if (typeof body.session.contactId === 'string' && body.session.contactId.length > 0) {
      this.contactId = body.session.contactId;
    }
    /*
     * The realtime host is reported here as well as by `identify`, and this is
     * the path `subscribe` bootstraps through — an anonymous visitor never
     * calls `identify`. Captured in both, because either can be the first
     * init a session ever makes.
     */
    if (typeof body.realtimeUrl === 'string' && body.realtimeUrl.length > 0) {
      this.realtimeUrl = body.realtimeUrl;
    }
  }

  private async request(path: string, body: unknown, isRetry = false): Promise<Response> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Production API requires Idempotency-Key on every write; mint
        // a fresh UUID per call so a stray fetch-retry never duplicates.
        'idempotency-key': newIdempotencyKey(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 403 && !isRetry && (await isStaleSession(res))) {
        // The stored token predates signed visitor sessions, or expired. The
        // integrator's code did nothing wrong and should not have to handle
        // it: drop the dead token, get a fresh one, replay the call once.
        this.visitorToken = null;
        localStorage.removeItem(`livechat:vt:${this.opts.publicId}`);
        await this.ensureVisitorToken();
        /*
         * A new session exists, so every credential derived from the old one
         * is dead — including the conversation-scoped realtime token a live
         * socket is holding. Announced here, AFTER the new session is in
         * hand and BEFORE the replay, so a re-mint can overlap the replay
         * rather than queue behind it. Fired and not awaited: a subscriber's
         * failure is its own to report and must not turn one recovered call
         * into a failed one.
         */
        for (const listener of this.sessionListeners) {
          listener();
        }
        const replayed = { ...(body as Record<string, unknown>) };
        if (replayed['visitorToken'] !== undefined) {
          replayed['visitorToken'] = this.visitorToken;
        }
        return this.request(path, replayed, true);
      }
      throw new ChatlyError('request_failed', `Chatly SDK request failed: ${res.status}`, {
        httpStatus: res.status,
      });
    }
    return res;
  }
}

/**
 * Is this 403 "your session token is no good", rather than one of the other
 * things a widget call can be forbidden for (a disallowed origin, a missing
 * identity hash)? Only the session codes are cured by fetching a new token.
 */
/**
 * Does this 403 mean "your session token is no good"?
 *
 * This read `body.code` at the top level, and the API has never sent that
 * shape: `app-exception.filter.ts` wraps every error as
 * `{ error: { code, message, details } }`. So it was `undefined` for every
 * real response, this returned false every time, and **the session-recovery
 * path below never fired** — a visitor holding an expired token got failures
 * the SDK was written to absorb.
 *
 * The widget had the identical bug, fixed on 2026-10-08, and nobody checked
 * its sibling. Both shapes are read now: the nested one the API sends, and
 * the flat one in case anything ever answers that way.
 */
async function isStaleSession(res: Response): Promise<boolean> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown }; code?: unknown };
    const code = body.error?.code ?? body.code;
    return typeof code === 'string' && code.startsWith('visitor_session_');
  } catch {
    return false;
  }
}

function newIdempotencyKey(): string {
  // crypto.randomUUID is in every browser the widget supports
  // (Chrome 92+, Safari 15.4+, Firefox 95+).
  return globalThis.crypto.randomUUID();
}

export default Chatly;
