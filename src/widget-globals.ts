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
import type { ChatlyApi, ChatlyConsent } from './widget-api.js';
import type {
  WidgetBehavior,
  WidgetCopy,
  WidgetQuickLink,
  WidgetTheme,
} from './widget-appearance.js';
// Imported for use in `InitOptions` and `ChatlyApi` below AND re-exported
// unchanged, so the published surface is identical to before the split.
import type { WidgetIdentity } from './widget-identity.js';
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

export type { WidgetIdentity };

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
  /**
   * The thread on screen CHANGED — the same moments as `conversation`, minus
   * the first one.
   *
   * Detail is `{ conversationId }`, null when the visitor is on the home
   * screen, a tab or an article. It fires when they pick a thread from the
   * Messages list, go back, or start a new conversation that then receives
   * its server id (after `message.ack`); it does NOT fire when the panel
   * first opens on a thread, because `open` already carries that id.
   *
   * Use this one if you mirror the visitor's current conversation and want to
   * re-sync on a move. Use `conversation` if you want the current answer
   * including at startup. Neither fires when nothing changed: the id is
   * deduped, so closing and reopening on the same thread is silent.
   */
  | 'conversation.changed'
  | 'identified'
  | 'reset'
  /**
   * Which per-audience PROFILE matched, or that none did.
   *
   * `{ profile, matched }` — the operator-facing name, and whether any
   * applied. BOTH, because a profile left unnamed reports `matched: true`
   * with a null name, which is not "none did". Fires when the match resolves
   * (after `init`) and again when it CHANGES; deduped; never for a
   * `Chatly('mount', …)` view.
   */
  | 'profile'

  /**
   * A visitor pressed a `host_event` action on a rich block.
   *
   * Detail is `{ event, data }` — a NAME and JSON, nothing executable. This
   * is how a site wires a card button into its own application state (its
   * cart, its router, its query cache) without us running its code.
   *
   * An event is a REQUEST, not an authorisation: a site that wires a button
   * to something destructive has chosen that.
   *
   * ── A bot can fire one too, without a press ───────────────────────────
   *
   * When your page registered a capability with `Chatly('setContext', {
   * surface: { capabilities: [{ name, unprompted: true, … }] } })`, a bot may
   * fire it unprompted. The detail is the SAME `{ event, data }` plus
   * `conversationId`, `messageId` and `actionId` (the invocation's id), and
   * additionally `source: 'bot'` and `surfaceId`. A press carries no `source`
   * key. One handler serves both; check `source` if you want to treat an
   * unprompted action differently.
   *
   * Your handler is the gate on your side. To decline, report back with
   * `Chatly('reportAction', { messageId, actionId, status: 'failed', data: {
   * refused: true } })` — two refusals of one capability within ten minutes
   * stop the bot firing it in that conversation.
   */
  | 'action'
  /**
   * A visitor pressed a `navigate` action on a rich block: go to a page of
   * YOUR site.
   *
   * Detail is `{ path, label, conversationId, messageId, actionId }`. `path`
   * is a validated site-relative path (`/pricing?plan=pro`) that starts with a
   * single `/` and holds no host, `//`, backslash, control character or `..`
   * segment, so it is safe to hand to your router's `push`. Subscribing is how
   * you take over the navigation (a single-page app should not reload).
   * With NO `navigate` handler the widget opens `location.origin + path` in
   * the current tab itself. The window event `chatly:navigate` mirrors the
   * callback but does not count as a handler: only `on('navigate', …)` (or
   * `onNavigate` on the wrappers) suppresses the fallback.
   */
  | 'navigate'
  /**
   * A bot sent an ephemeral notice (`kind: 'notice'`) answering a silent
   * postback. Detail is `{ conversationId, replyTo, body }`: `replyTo` is the
   * id of the visitor message it answers, `body` one line of plain text.
   *
   * The widget draws its own five-second toast in the typing slot as well;
   * this is the page's copy, for a host that wants its own toast. Nothing is
   * stored, so it fires only for a visitor connected at that moment, and
   * never for the thread you are not looking at. Does not suppress the
   * widget's toast. The window event is `chatly:notice`.
   */
  | 'notice'
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
  | 'unread'
  | 'appearance';

/**
 * Complete public API for the widget loader. Everything visible or
 * behavioral is exposed here — colors, copy, layout, behavior. Anything
 * you can't toggle from `theme` belongs in `cssOverrides`.
 */
/**
 * What `Chatly('mount', …)` takes — a second, inline view (W-10).
 *
 * A subset of `InitOptions`, and the omissions are the design. `mountTo` is
 * replaced by `el`, since a view is always inline. `storage` is absent
 * because there is one answer per visitor to "may this browser be written
 * to", set by `init`; a second, conflicting one is not a thing to offer.
 * `tracking` is absent for the same reason and one more: the feeds it governs
 * describe the PAGE, and a secondary view does not report them at all
 * (`pageLevel` in `useVisitorTelemetry`), so a `tracking` here would be a
 * control that appears to work. `on`
 * is absent because the lifecycle callbacks belong to the primary widget, and
 * a view that installed its own would make `on('message')` ambiguous. Most of
 * `behavior` is absent because the rest of it describes the PAGE —
 * `hideOnUrls`, `autoOpenAfterMs`, `draggable` — which a view sitting inside
 * somebody else's layout has no business deciding.
 */
export interface MountOptions
  extends Omit<InitOptions, 'publicId' | 'mountTo' | 'storage' | 'tracking' | 'on' | 'behavior'> {
  /** Where to render. A selector or an element; it must already exist. */
  el: string | Element;
  /** The channel this view talks to. Defaults to the primary widget's. */
  publicId?: string;
  /** The part of `behavior` that describes a view rather than the page. */
  behavior?: Pick<WidgetBehavior, 'tabs' | 'defaultTab'>;
}

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
   * **`'on-open'`** since 2026-10-19 — it was `'allow'`.
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
   * `'allow'` is the eager mode, and it is now the one you opt IN to. It
   * used to be the default, which meant an embed that said nothing about
   * storage wrote `chatly:seen` and the visitor's session token on page load
   * and sent a `POST /v1/widget/events` per page view — for visitors who
   * never opened the chat and, under a consent banner, had agreed to
   * nothing. If you want that (a session that survives a reload for every
   * passer-by, and the live-visitor list populated by everyone rather than
   * by the people who engaged), say `'allow'`.
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
   *
   * It also holds back the widget's OWN telemetry — the `visitor.page_view`,
   * `returned`, exit-intent and scroll-depth events — until the same moment,
   * under `'on-open'` and `'deny'` alike. They are buffered rather than
   * dropped, so a visitor who browses three pages and then opens the chat
   * still arrives with the page view carrying the entry referrer.
   * `Chatly('track', ...)` is never held back: that is your call about your
   * own user.
   *
   * ── Per category ────────────────────────────────────────────────────
   *
   * The object form sets the three categories separately:
   * `storage: { functional: 'on-open', analytics: 'deny', marketing: 'deny' }`.
   * A category the object OMITS gets the same `'on-open'` an absent `storage`
   * gets, rather than inheriting a sibling — a partial object is a partial
   * statement, and reading `{ analytics: 'deny' }` as "allow everything
   * else" would make the strictest-looking declaration the most permissive.
   *
   * Which key holds which: `functional` is the session (the visitor token,
   * its hash, the external id, the launcher's dragged position),
   * `analytics` is `chatly:seen` AND the widget's own `visitor.*` telemetry,
   * `marketing` is the `chatly:utm` attribution entry. These three are
   * Chatly's own names and the only ones it knows: if your consent manager
   * calls them something else, map its answer onto them yourself —
   * `Chatly('setStorageConsent', { analytics: cmp.hasConsent(<their id>) })`.
   */
  storage?:
    | 'allow'
    | 'deny'
    | 'on-open'
    | {
        functional?: 'allow' | 'deny' | 'on-open';
        analytics?: 'allow' | 'deny' | 'on-open';
        marketing?: 'allow' | 'deny' | 'on-open';
      };

  /**
   * Who decides where the widget may store things: the page's consent
   * manager, or a decision you already have. Read by the LOADER from the
   * queued `init` — write `Chatly('init', { consent })` beside the snippet —
   * so the widget's first write already goes to the right place.
   *
   * `'auto'` reads the manager on the page: Cookie Munch, Cookiebot,
   * OneTrust, Osano, Complianz, CookieYes, any IAB TCF v2.2 CMP, or Google
   * Consent Mode, first found wins. Until it answers, storage is held to this
   * visit (`sessionStorage`); with no manager found it stands down after 8s.
   *
   * An object is a decision your server already knows — the same shape as
   * `Chatly('setConsent', …)`, applied as the widget starts.
   *
   * See /guides/consent.
   */
  consent?: 'auto' | ChatlyConsent;
  /**
   * Under `consent: 'auto'` with Cookie Munch, the category that governs
   * storage. Default `'support_chat'`; any other category is ordinary opt-in,
   * so refusing it denies storage.
   */
  consentCategory?: string;

  /**
   * `'grant'` is the site's own statement that visit analytics may be sent
   * with no consent manager in the way — for a site outside any consent
   * regime. Without it, and without a consent decision that grants
   * `analytics`, the widget's `visitor.*` telemetry is held and never sent.
   * An explicit `storage: { analytics: 'deny' }` or a later withdrawal still
   * wins. See /guides/consent.
   */
  analytics?: 'grant';

  /**
   * Whether the widget may produce its OWN behavioural telemetry — the
   * `visitor.page_view`, `visitor.returned`, `visitor.exit_intent`,
   * `visitor.scroll_depth` and `visitor.idle_threshold` events, and the
   * `chatly:seen` key behind `returned`.
   *
   * `tracking: false` turns all five off: no listener is attached to your
   * page, `chatly:seen` is never written, and nothing named `visitor.*`
   * reaches `POST /v1/widget/events`. The chat itself is untouched.
   *
   * `tracking: { visits: false }` / `{ exitIntent: false }` /
   * `{ scrollDepth: false }` turn one feed off and leave the others at their
   * default. `visits` covers the three visit-level events —
   * `visitor.page_view`, `visitor.returned`, `visitor.idle_threshold`; the
   * other two keys each name one gesture. A key the object omits keeps its
   * default; a value that is neither `true` nor absent reads as OFF, because
   * a privacy switch must not be rescued by a typo.
   *
   * ── The DEFAULT is your visitor's analytics consent, not this option ──
   *
   * Leaving `tracking` unset does not mean "on". Visit telemetry is OPT-IN
   * (since 0.19.0): every event above is held, and not sent, until ANALYTICS
   * consent is affirmatively granted — by `consent: 'auto'` reading a consent
   * manager, `Chatly('setConsent', { analytics: true })`,
   * `Chatly('setStorageConsent', …)`, `storage: { analytics: 'allow' }` or
   * `analytics: 'grant'`. Opening the chat grants the storage the chat needs
   * and NOT analytics. `storage: { analytics: 'deny' }` reports nothing at
   * all. This option is
   * how an operator says no on their visitors' behalf — it can only ever
   * subtract from what consent already permits, and `tracking: true` is just
   * the explicit spelling of the default rather than an override of consent.
   *
   * `Chatly('track', …)` is never affected: that is your own call about your
   * own user.
   */
  tracking?:
    | boolean
    | {
        visits?: boolean;
        exitIntent?: boolean;
        scrollDepth?: boolean;
      };

  /**
   * What to do when the channel REFUSES the identity in `visitor` (or in a
   * later `identify()`): `'anonymous'` continues as an unverified, anonymous
   * visitor. The default is to show the visitor a failed widget, which is
   * what happened before this option existed and is still right for an app
   * where an unverified chat is worse than no chat.
   *
   * It exists because a single rotated or misdeployed `userHash` secret
   * removes chat for every signed-in visitor at once: `POST
   * /v1/widget/init` answers 403, there is no session, and the panel cannot
   * open. With this set, the widget drops the claim and the session this
   * browser was holding, re-boots with no identity at all, and the visitor
   * gets a working chat that the agent sees as anonymous.
   *
   * It NEVER continues as the claimed identity — an unverifiable claim is
   * exactly what the channel's identity verification exists to refuse, and
   * honouring it on the client would make the setting a bypass. So the
   * conversation is not attached to `externalId`, `session.identityVerified`
   * is false, and anything keyed on `contact.identityVerified` behaves as it
   * does for a visitor who never signed in.
   *
   * Either way an `error` event fires first, with
   * `{ code: 'identity_rejected' | 'identity_missing_hash', status }` —
   * subscribe before `init` and you will catch it, which is how you find out
   * your secret is wrong without reading a visitor's console.
   */
  identityFallback?: 'anonymous';

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
export type { ChatlyApi, ChatlyConsent } from './widget-api.js';

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
