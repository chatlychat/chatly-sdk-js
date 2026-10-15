/**
 * `window.Chatly` — the snippet surface, declared once, in a package you can
 * install.
 *
 * ── Why these live in the browser SDK ──────────────────────────────────
 *
 * They were in `apps/widget/src/public-types.ts`, which is complete and
 * accurate and reachable by nobody: `apps/widget` is `private: true` and is
 * published as a BUNDLE (`widget.js` on the CDN), not as a package. So an
 * integrator who embeds the two-line loader snippet and then writes
 * `window.Chatly.identify(...)` in TypeScript had nothing to install and
 * hand-wrote their own `declare global`. One of them told us so.
 *
 * A hand-written declaration is not merely inconvenient. It is a SECOND copy
 * of our contract, living in a repository we cannot see, that goes stale
 * without a compile error anywhere — the drift this repo already pays a gate
 * to prevent between the widget and `@chatlychat/widget-element`.
 *
 * `@chatlychat/sdk-js` is where they go rather than a new
 * `@chatlychat/widget-types`, because this package is already published,
 * already mirrored, already in `check-docs-install-claims.mjs`'s `PUBLISHED`
 * list, and is already the package that controls the widget
 * (`Chatly.open()`/`close()` dispatch through this very global). A new npm
 * name is a new scope entry, a new mirror repo, a new release step and a new
 * way for an install line to 404 before the publish catches up — which is the
 * regression that gate exists for.
 *
 * ── Single-sourced, not copied ─────────────────────────────────────────
 *
 * These are THE declarations. `apps/widget/src/public-types.ts` re-exports
 * them and declares none of its own, which `check-widget-wrapper-parity.mjs`
 * now asserts; the widget's import is `import type`, and
 * `@chatlychat/sdk-js` is a devDependency of `apps/widget` for exactly that
 * reason. TypeScript erases the lot, so the widget's first-paint bundle —
 * which has about 226 bytes of headroom under a 44,000-byte ceiling — gains
 * nothing. `check-bundle-size.mjs` is the proof, not this comment.
 *
 * `packages/widget-element/src/types.ts` still re-declares the same shapes
 * under `Chatly*` names, and must: that package ships to a customer's bundler
 * with ZERO dependencies and cannot take one on this package to get a type.
 * That copy is the one `check-widget-wrapper-parity.mjs` compares, in both
 * directions, against the declarations below.
 *
 * ── Nothing here is validated ──────────────────────────────────────────
 *
 * These are compile-time only. The server validates what actually reaches it
 * (`widgetInitSchema`); a misspelled theme key is ignored by the widget, not
 * reported. See `coerceConfig` in `widget-element` for the one runtime
 * boundary that exists.
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
  attributes?: Record<string, unknown>;
}

/*
 * The method payload shapes live in `./widget-payloads.js` and are
 * re-exported here, unchanged, so the published surface is identical.
 *
 * Split at the 650-line ceiling. The seam is deliberate: everything still
 * DECLARED in this file is a shape `check-widget-wrapper-parity.mjs`
 * member-compares against `packages/widget-element` — `InitOptions`, the
 * five appearance types, `WidgetIdentity`, `ChatlyApi`, `ChatlyEventName` —
 * and that gate reads this path. What moved is the set it only checks for
 * presence: the arguments you pass to a method and the snapshot an event
 * hands back. Moving a member-compared type instead would make the gate read
 * `null` members and fail, which is the behaviour that makes naming a file
 * by path safe there — but it would still be the wrong split.
 */
// `WidgetQuip` is NOT imported here: it is re-exported below but never
// referenced in this file, and an unused import is a lint error.
import type {
  WidgetBehavior,
  WidgetCopy,
  WidgetQuickLink,
  WidgetTheme,
} from './widget-appearance.js';
import type {
  ChatlyEventHandler,
  OpenRequest,
  ReportActionInput,
  SessionSnapshot,
  SetContextInput,
  StartConversationRequest,
} from './widget-payloads.js';

// Imported for use in `ChatlyApi` below AND re-exported unchanged, so the
// published surface is identical to before the split.
export type {
  WidgetBehavior,
  WidgetCopy,
  WidgetQuickLink,
  WidgetQuip,
  WidgetTheme,
} from './widget-appearance.js';

export type {
  ChatlyEventHandler,
  OpenRequest,
  ReportActionInput,
  SessionSnapshot,
  SetContextInput,
  StartConversationRequest,
};

export type ChatlyEventName =
  | 'ready'
  /**
   * The panel opened. Detail is `{ conversationId }` — the thread it opened
   * on, or null on the home screen or an unsent new conversation. It was `{}`
   * until 2026-10-15.
   */
  | 'open'
  | 'close'
  | 'message'
  | 'conversation'
  | 'identified'
  | 'reset'
  /**
   * A visitor pressed a `host_event` action on a rich block.
   *
   * Detail is `{ event, data }` — a NAME and JSON, nothing executable. This
   * is how a site wires a card button into its own application state (its
   * cart, its router, its query cache) without us running its code.
   *
   * An event is a REQUEST, not an authorisation: a site that wires a button
   * to something destructive has chosen that.
   */
  | 'action'
  | 'error'
  /**
   * The server stored the visitor's message (W-09). Detail is
   * `{ id, localId, conversationId }`: `id` is the stored message's — the one
   * webhooks and the REST API use — and `localId` the placeholder the thread
   * showed while it was sending. Fires at the same moment as `message`, which
   * keeps its original shape for the `on.message` callback.
   */
  | 'message.ack'
  /**
   * An agent or bot message arrived while the thread was on screen (W-09).
   * Detail is `{ id, conversationId, authorType, body }`. `message` does NOT
   * fire for these — it has only ever meant "the visitor sent something".
   * A reply that lands while the panel is closed is reported by `unread`.
   */
  | 'message.received'
  /**
   * The unread count changed (W-06). Detail is `{ count }` — agent and bot
   * messages the visitor has not had on screen, across their threads.
   * Replayed to a late subscriber, like `ready`. Never fires for a visitor
   * who has never had a conversation.
   */
  | 'unread';

/**
 * Complete public API for the widget loader. Everything visible or
 * behavioral is exposed here — colors, copy, layout, behavior. Anything
 * you can't toggle from `theme` belongs in `cssOverrides`.
 */
export interface InitOptions {
  /** Channel public ID — required. */
  publicId: string;

  /** Override the API host. Defaults to the host the loader was served from. */
  apiUrl?: string;

  /**
   * Override the realtime (Socket.IO) host. Defaults to the API host with
   * `api.` → `realtime.` if a subdomain match exists, else the API host
   * itself (single-port deployments).
   */
  realtimeUrl?: string;

  /**
   * Identity known at boot. `Chatly.identify()` is the post-load equivalent
   * and travels the same server-side verification path.
   *
   * `WidgetIdentity` above states exactly what a claim is worth with and
   * without the channel's identity verification enabled.
   */
  visitor?: WidgetIdentity;

  /** Visual + copy customization. Every key is optional. */
  theme?: WidgetTheme;

  /** Behavior toggles — what tabs to show, default tab, auto-open, etc. */
  behavior?: WidgetBehavior;

  /** Quick-link buttons on the Home tab. */
  quickLinks?: WidgetQuickLink[];

  /**
   * Mount INSIDE an element of your own layout instead of floating over the
   * page — a support page, a sidebar, a full-page chat route, a panel in your
   * own drawer. A CSS selector or the element itself.
   *
   * In this mode there is no launcher and no corner offset: the conversation
   * fills the container you give it, and `theme.position` / `offsetX` /
   * `offsetY` / `hideLauncher` do not apply. `Chatly.open()` is already
   * satisfied and `Chatly.close()` cannot hide it, so `close()` warns rather
   * than appearing to work.
   *
   * The container must exist when `init` runs. If it does not, the widget
   * REFUSES to mount and says which selector failed — it does not fall back
   * to a floating bubble, because an unexpected overlay on a page built to
   * embed the chat reads as a bug and is easy to miss.
   */
  mountTo?: string | Element;

  /**
   * Whether the widget may use the visitor's browser storage. Default
   * `'allow'`.
   *
   * `'deny'` makes every read return nothing and every write a no-op, and
   * PURGES anything already written — the visitor token and its hash, the
   * external id, the launcher's dragged position, `chatly:seen`, and the
   * `chatly:utm` entry in sessionStorage.
   *
   * For a site under a consent banner: embed with `'deny'`, then call
   * `Chatly('setStorageConsent', true)` if the visitor agrees. The chat works
   * either way — a denied visitor gets an anonymous session that does not
   * survive a reload, which is the same degradation as a browser with site
   * data blocked.
   *
   * It is opt-out rather than opt-in because the alternative would change
   * behaviour for every embed that already exists.
   *
   * While storage is withheld, the marketing query family — `utm_*`,
   * `gclid`, `fbclid`, `msclkid`, `ttclid` — is also STRIPPED from every page
   * URL the widget sends (init, page views, the conversation's origin,
   * `setContext`), and the conversation's `utm_*` origin fields are not
   * sent. An embed on `'deny'` therefore records no campaign attribution for
   * a visitor who never grants consent. Granting restores it from the next
   * URL the widget reads; nothing withheld is replayed.
   *
   * `'on-open'` stores nothing until the visitor ENGAGES — opens the panel
   * from the launcher or through `Chatly.open()`, or starts a conversation —
   * and then behaves as `'allow'`. An `autoOpenAfterMs` timer is not
   * engagement. A visitor who engaged on an earlier page has storage from the
   * start, so their thread survives navigation. Until they engage, the
   * stripping above applies.
   */
  storage?: 'allow' | 'deny' | 'on-open';

  /** Free-form CSS injected into the shadow root. Last word on styling. */
  cssOverrides?: string;

  /** Localized copy. Falls back to English for any key you don't override. */
  copy?: WidgetCopy;

  /**
   * Copy per locale, keyed by language tag (`'fr'`, `'pt-BR'`).
   *
   * There is no server-side translation catalogue — the widget's strings come
   * from the embed — so this is what makes `Chatly.setLocale()` able to
   * actually change what the visitor reads. Layered over `copy`, which stays
   * the default for any key a locale bundle leaves out.
   *
   * `setLocale` warns when asked for a locale with no bundle here, rather
   * than appearing to have worked.
   */
  copyByLocale?: Record<string, WidgetCopy>;

  /** Lifecycle hooks. */
  on?: {
    /**
     * `conversationId` is the thread the panel opened on, or null for the home
     * screen or an unsent new conversation. The same object is the `open`
     * window event's detail. A `() => void` callback is still assignable.
     */
    open?: (detail: { conversationId: string | null }) => void;
    close?: () => void;
    ready?: (session: { contactId: string; workspaceId: string }) => void;
    /**
     * `id` is the MESSAGE's id; `conversationId` is the thread it landed in,
     * or null before one exists. Both are also on the `message` window event.
     */
    message?: (msg: {
      id: string;
      body: string;
      authorType: string;
      conversationId: string | null;
    }) => void;
  };
}
/**
 * The complete `window.Chatly` surface.
 *
 * Five of these — init, destroy, open, close, toggle — are the original,
 * unchanged contract. The rest exist because identity used to be readable
 * only at boot: a site that learns who its visitor is after they sign in had
 * no way to tell us at all.
 *
 * Every method here is backed by something the API can actually do. Two the
 * competitor offers are deliberately ABSENT, because ours could not honour
 * them and a method that silently does nothing is worse than its absence:
 *
 *  - `setConversationCustomAttributes` — `conversations` has a `tags` column
 *    and no attributes column. Use `setLabel` (also conversation-level, and
 *    the agent inbox renders it).
 *  - `popoutChatWindow` — there is no standalone conversation page to pop out
 *    into; the widget only exists inside the host page's shadow root.
 */
export interface ChatlyApi {
  init: (opts: InitOptions) => void;
  destroy: () => void;
  /**
   * `open()`, `open('help')`, or `open({ view: 'conversation', botSlug })`.
   *
   * The object form opens the panel ON a conversation rather than on a tab,
   * which is what a page's own "Ask the shopping agent" button needs — the
   * tab form would land the visitor on the home screen with the conversation
   * one more click away.
   *
   * It does NOT send `initialMessage`; the composer is pre-filled and the
   * visitor presses send. Same contract a quick-link's `initialMessage` has
   * always had, and the reason a page can offer the button without putting
   * words in the visitor's mouth.
   */
  open: (target?: 'home' | 'messages' | 'help' | OpenRequest) => void;
  close: () => void;
  /** No argument flips. `'open'`/`true` opens, `'close'`/`false` closes. */
  toggle: (state?: 'open' | 'close' | boolean) => void;
  /** Attach a known identity at any point after load. */
  identify: (identity: WidgetIdentity) => Promise<SessionSnapshot>;
  /** `identify` in the `setUser(id, attrs)` spelling. */
  setUser: (externalId: string, attributes?: Record<string, unknown>) => Promise<SessionSnapshot>;
  setCustomAttributes: (attributes: Record<string, unknown>) => void;
  deleteCustomAttribute: (key: string) => void;
  setLabel: (label: string) => void;
  removeLabel: (label: string) => void;
  setLocale: (locale: string) => void;
  /** Fire a visitor event into the CDP / workflow trigger stream. */
  track: (name: string, properties?: Record<string, unknown>) => void;
  /**
   * Hand over a device push token, so a reply reaches this visitor after
   * they close the app. For a native app embedding this widget — it passes
   * the token the OS gave it. The widget takes a token rather than asking for
   * notification permission itself: the host app owns that prompt.
   */
  registerPushToken: (
    platform: 'apns' | 'fcm' | 'web-push',
    token: string,
    appVersion?: string,
  ) => void;
  /**
   * Open a NEW conversation, optionally routed and optionally pre-filled.
   *
   * `Chatly('open', { view: 'conversation', … })` is the same thing said the
   * other way round, and both land on one implementation. Two spellings
   * because a page thinking "open the chat here" and a page thinking "start a
   * conversation with the shopping agent" are two different thoughts, and
   * offering only the first made the second read as a hack.
   */
  startConversation: (request?: StartConversationRequest) => void;
  /**
   * Tell us what this page claims about the visitor.
   *
   * `audience` is UNSIGNED and lands in `context.unverified.audience` — the
   * visitor can set it themselves from the console, because the widget is on
   * their page. `contextToken` is a JWT your SERVER signs with the channel's
   * identity-verification secret, and its claims land in
   * `context.verified.*`, which is the only bag a privilege decision may rest
   * on. Call it again on every SPA navigation, or let the widget do it: it
   * re-sends the page on each navigation by itself.
   */
  setContext: (input: SetContextInput) => void;
  /**
   * Report what your page did with a `host_event`, back into the thread.
   *
   * Appends a visible line under the card whose button was pressed, and
   * delivers an `action_result` to the bot that sent it. Pass back the
   * `messageId` and `actionId` the `action` event handed you. Reporting the
   * same action twice replaces the first result rather than stacking, so a
   * retry leaves one line.
   */
  reportAction: (input: ReportActionInput) => void;
  /** Forget this visitor and boot a fresh anonymous session. */
  reset: () => void;
  /**
   * Grant or withhold consent to use the visitor's browser storage.
   *
   * The call a consent banner makes. Withholding purges what is already
   * stored; granting allows writes from that moment on and replays nothing,
   * because there is nothing to recover. See the `storage` init option.
   */
  setStorageConsent: (granted: boolean) => void;
  /**
   * The unread count the launcher badge shows (W-06): agent and bot messages
   * this visitor has not had on screen. 0 before it is known. Subscribe to
   * `unread` to be told when it changes.
   */
  getUnreadCount: () => number;
  /**
   * Whether this browser holds a conversation for this channel (W-07) — a
   * RETURNING chatter. False under `storage: 'deny'` until consent, because
   * nothing is kept. `loader.js` answers it before the widget has loaded, by
   * the same test, which is how lazy mode loads eagerly for these visitors.
   */
  hasSession: () => boolean;
  /** Subscribe. `'ready'` replays immediately if it already happened. */
  on: (event: ChatlyEventName, handler: ChatlyEventHandler) => void;
  off: (event: ChatlyEventName, handler: ChatlyEventHandler) => void;
  /** Set by the loader snippet; read here only so the type stays honest. */
  q?: unknown[];
  publicId?: string;
}

/**
 * `window.Chatly` is BOTH the method object and still callable as
 * `Chatly('open')`.
 *
 * The snippet we hand every customer defines `Chatly` as a function that
 * queues `arguments`, so `Chatly('setUser', 'u_42')` is the idiom their code
 * is written in. Replacing it with a plain object at load time means every
 * such call AFTER the bundle arrives throws `Chatly is not a function` —
 * which is the competitor's documented loader defect, and was ours until the
 * loader's `replay()` was fixed this session to cope with an object export.
 * `replay()` handled the queue; it could do nothing about calls made later.
 *
 * Keeping the callable form means the snippet idiom works before load (queued)
 * and after load (dispatched), which is the only version of this that an
 * embedder can reason about.
 */
export type ChatlyGlobal = ChatlyApi & ((...args: unknown[]) => void);

/**
 * `window.Chatly`, typed — the whole point of publishing this file.
 *
 * Declared here rather than in `index.ts` so the augmentation travels with
 * the type it names: a consumer who does nothing but
 * `import type { ChatlyApi } from '@chatlychat/sdk-js'` has pulled this
 * module into their program, and `window.Chatly` is typed from that point on.
 * No `/// <reference>` and no `tsconfig` `types` entry needed.
 *
 * OPTIMISTIC, and deliberately so. Between the snippet running and the bundle
 * arriving, `window.Chatly` is only the queueing FUNCTION the snippet
 * installed — the methods are not on it yet, which is why `ChatlyGlobal` is
 * callable and why `Chatly('open')` is the spelling that works in both
 * states. Typing it as the pre-load union instead would make the honest
 * post-load call (`window.Chatly.identify(...)`) a type error for every
 * reader, which is the opposite of useful. If you call a METHOD from code
 * that can run before the bundle lands, use the callable form or wait for
 * `Chatly.on('ready', …)`.
 *
 * This replaced `{ open?, close?, destroy? }` — three of the twenty-two
 * methods, all optional. That was not a smaller contract, it was a wrong one:
 * it made `window.Chatly.identify(...)` an error in the one package whose job
 * is to drive the widget.
 */
declare global {
  interface Window {
    Chatly?: ChatlyGlobal;
  }
}
