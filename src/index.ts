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

import { createTypingTracker, newMessagesSince, typingActorOf } from './live.js';

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

declare global {
  interface Window {
    Chatly?: { open?: () => void; close?: () => void; destroy?: () => void };
  }
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
      throw new Error(`Upload failed (${put.status})`);
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
    const seen = new Set<string>();
    let stopped = false;
    /** Set once the push socket is up; null on the polling path. */
    let live: { emit: (event: string, payload: unknown) => void } | null = null;
    let warnedAboutTyping = false;

    /*
     * Receiving typing needs the same transport as sending it, and for the
     * same reason: there is no HTTP route. A consumer who asked for
     * `onTyping` on the polling path has asked for something the transport
     * cannot carry, so say it once at subscribe time — the alternative is an
     * agent typing visibly in the dashboard and nothing happening here, with
     * nothing to search for.
     */
    if (handlers.onTyping !== undefined && options.io === undefined) {
      console.warn(
        '[Chatly] onTyping needs the push path — pass `io` to subscribe(). ' +
          'Typing is a socket event and has no HTTP route, so a polling ' +
          'subscription never receives one.',
      );
    }
    const typing = createTypingTracker({
      onChange: (signal) => handlers.onTyping?.(signal),
    });

    const setTyping = (isTyping: boolean): void => {
      if (live === null) {
        if (!warnedAboutTyping) {
          warnedAboutTyping = true;

          console.warn(
            '[Chatly] setTyping needs the push path — pass `io` to subscribe(). ' +
              'Typing is a socket event and has no HTTP route.',
          );
        }
        return;
      }
      live.emit(isTyping ? 'typing.start' : 'typing.stop', {
        conversationId,
        actorType: 'contact',
        // The gateway's payload requires a non-empty actorId. `unknown` rather
        // than an empty string, which its schema rejects outright.
        actorId: this.contactId ?? 'unknown',
      });
    };

    const deliver = (batch: readonly HeadlessMessage[]): void => {
      for (const message of newMessagesSince(seen, batch)) {
        handlers.onMessage?.(message);
      }
    };

    const poll = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      try {
        deliver(await this.listMessages(conversationId));
      } catch (err: unknown) {
        handlers.onError?.(err);
      }
    };

    // The first batch is the history, which is also how a consumer gets the
    // existing thread without a separate call.
    void poll();

    if (options.io === undefined) {
      // Floored: a one-second poll on a long conversation is a request every
      // second per open tab, and the endpoint is not a stream.
      const interval = Math.max(2_000, options.intervalMs ?? 6_000);
      const timer = setInterval(() => void poll(), interval);
      return Object.assign(
        () => {
          stopped = true;
          clearInterval(timer);
          // Nothing can have started the tracker on this path — but a
          // teardown that only cleans up the branch it remembers is how a
          // timer outlives its subscription.
          typing.dispose();
        },
        { setTyping },
      );
    }

    let socket: { disconnect: () => void } | null = null;
    // Captured before the async gap so the narrowing holds without an
    // assertion: `options` is readonly, but the checker cannot know that
    // across an await.
    const makeSocket = options.io;
    void (async () => {
      try {
        await this.ensureVisitorToken();
        const res = await this.request('/v1/widget/realtime/token', {
          publicId: this.opts.publicId,
          visitorToken: this.visitorToken,
          conversationId,
        });
        const { token } = (await res.json()) as { token?: string };
        const host = this.opts.realtimeUrl ?? this.realtimeUrl;
        if (stopped || typeof token !== 'string' || host === null || host === undefined) {
          /*
           * No host means no socket. Reported rather than silently falling
           * back, because a consumer who passed `io` asked for push and a
           * quiet downgrade to polling would look like push that is slow.
           */
          handlers.onError?.(
            new Error('chatly: no realtime host — set `realtimeUrl` in init options'),
          );
          return;
        }
        const made = makeSocket(host, {
          path: '/socket.io',
          transports: ['websocket'],
          auth: { token, kind: 'visitor' },
        });
        socket = made;
        live = made;
        made.on('event', (raw: unknown) => {
          const envelope = raw as { type?: string; payload?: unknown } | null;
          if (envelope?.type === 'message.created' && envelope.payload !== undefined) {
            deliver([envelope.payload as HeadlessMessage]);
            /*
             * A reply has arrived, so whoever was typing has stopped — the
             * dashboard sends `typing.stop` on send, but the message and the
             * stop are two envelopes and the message usually wins the race.
             * Without this the indicator sits under the message that was
             * being typed, for the length of the timeout.
             */
            typing.stop();
            return;
          }
          if (envelope?.type === 'typing.start' || envelope?.type === 'typing.stop') {
            const actor = typingActorOf(envelope.payload);
            if (actor === null) {
              return;
            }
            if (envelope.type === 'typing.start') {
              typing.start(actor);
            } else {
              typing.stop(actor);
            }
          }
        });
      } catch (err: unknown) {
        /*
         * Push could not be set up. Fall back to polling rather than leaving
         * the consumer with a subscription that silently never fires — the
         * same choice the widget makes when its realtime chunk cannot load.
         */
        handlers.onError?.(err);
        if (!stopped) {
          const timer = setInterval(() => void poll(), 6_000);
          socket = { disconnect: () => clearInterval(timer) };
        }
      }
    })();

    return Object.assign(
      () => {
        stopped = true;
        live = null;
        typing.dispose();
        socket?.disconnect();
      },
      { setTyping },
    );
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

  private async ensureVisitorToken(): Promise<void> {
    if (this.visitorToken !== null) {
      return;
    }
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
        const replayed = { ...(body as Record<string, unknown>) };
        if (replayed['visitorToken'] !== undefined) {
          replayed['visitorToken'] = this.visitorToken;
        }
        return this.request(path, replayed, true);
      }
      throw new Error(`Chatly SDK request failed: ${res.status}`);
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
