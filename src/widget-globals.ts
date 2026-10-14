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

/** The routing and pre-fill a new conversation may carry. See `ChatlyApi.startConversation`. */
export interface StartConversationRequest {
  readonly botSlug?: string;
  readonly initialMessage?: string;
}

/**
 * What `Chatly.setContext()` accepts.
 *
 * Every member is `unknown` because the widget re-checks all of them at the
 * call boundary rather than trusting the page: this is invoked from inside a
 * customer's own click handler, often in a `.then()`, and a rejected promise
 * there is an unhandled rejection on a page we do not control. The narrow
 * shapes are `audience?: string`, `contextToken?: string` (a JWT your SERVER
 * signed), `page?: { path?, url? }` and `context?: Record<string, string |
 * number | boolean>` — anything else is warned about and dropped.
 */
export interface SetContextInput {
  audience?: unknown;
  page?: unknown;
  contextToken?: unknown;
  /** Further UNSIGNED claims. Signed ones live inside `contextToken`. */
  context?: unknown;
}

/**
 * What `Chatly.reportAction()` accepts. `unknown` for the same reason as
 * `SetContextInput`.
 *
 * The shape the widget will act on is `{ messageId: string, actionId: string,
 * status: 'done' | 'failed', text?: string, blocks?: unknown, data?:
 * Record<string, unknown> }`.
 */
export interface ReportActionInput {
  messageId?: unknown;
  actionId?: unknown;
  status?: unknown;
  text?: unknown;
  blocks?: unknown;
  data?: unknown;
}

/** What `ready` and `identified` carry. `contactId` is null while anonymous. */
export interface SessionSnapshot {
  contactId: string | null;
  workspaceId: string;
}

export type ChatlyEventName =
  | 'ready'
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
  | 'error';

export type ChatlyEventHandler = (detail: unknown) => void;

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
   */
  storage?: 'allow' | 'deny';

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
    open?: () => void;
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

export interface WidgetTheme {
  /**
   * Replace any of the widget's functional icons. Each value may be an inline
   * `<svg>`, an image URL, or a literal character.
   */
  icons?: Partial<Record<'mic' | 'stop' | 'attachment' | 'check' | 'star', string>>;
  // ── Colors ──────────────────────────────────────────────────────────
  primaryColor?: string;
  primaryContrast?: string;
  background?: string;
  backgroundSubtle?: string;
  foreground?: string;
  foregroundMuted?: string;
  border?: string;
  bubbleAgentBg?: string;
  bubbleAgentFg?: string;

  // ── Typography ──────────────────────────────────────────────────────
  fontFamily?: string;
  fontSize?: number | string;

  // ── Shape ───────────────────────────────────────────────────────────
  borderRadius?: number | string;
  launcherSize?: number;
  panelWidth?: number;
  panelHeight?: number;

  // ── Position ────────────────────────────────────────────────────────
  position?: 'left' | 'right';
  offsetX?: number;
  offsetY?: number;

  // ── Header ──────────────────────────────────────────────────────────
  /** Solid color, gradient, or 'none'. */
  headerStyle?: 'gradient' | 'solid' | 'plain';
  /** Custom gradient stops (overrides headerStyle gradient default). */
  headerGradient?: [string, string];

  // ── Launcher ────────────────────────────────────────────────────────
  /** Hide launcher entirely; you call `Chatly.open()` from your own button. */
  hideLauncher?: boolean;
  /** Custom launcher svg (string of inner SVG markup). */
  launcherIcon?: string;
  /** Or use an image URL for the launcher (mascot face, brand icon, etc.). */
  launcherImage?: string;
  /** Show a notification ping dot on the launcher when there's something new. */
  launcherPing?: boolean;
  /** Make the launcher idly wiggle to draw attention. */
  launcherIdleAnimation?: 'none' | 'wiggle' | 'pulse' | 'bounce';

  // ── Color scheme ────────────────────────────────────────────────────
  /** 'light' | 'dark' | 'auto' (matches prefers-color-scheme). */
  colorScheme?: 'light' | 'dark' | 'auto';

  /**
   * State colours. Only these three, because the widget renders each one:
   * `danger` on a validation error, `success` on a receipt, `warning` on the
   * offline banner. Surfaces are derived from `background`/`foreground`
   * rather than set, not configured.
   */
  dangerColor?: string;
  successColor?: string;
  warningColor?: string;

  // ── Branding ────────────────────────────────────────────────────────
  /** Hide the "Powered by Chatly" footer (paid tiers). */
  hideBranding?: boolean;

  // ── Logo / avatar ───────────────────────────────────────────────────
  logoUrl?: string;
  /** Square avatar shown next to org name in the header. */
  agentAvatarUrl?: string;
}

export interface WidgetBehavior {
  /** Which tabs to show + their order. */
  tabs?: Array<'home' | 'messages' | 'help'>;
  /** Which tab opens first. Default: 'home'. */
  defaultTab?: 'home' | 'messages' | 'help';
  /** Open the widget automatically after N ms on the page. */
  autoOpenAfterMs?: number;
  /** Hide the widget on URL patterns (globs). */
  hideOnUrls?: string[];
  /** Tone the empty-help state down: hide search until typed in. */
  helpSearchOnly?: boolean;

  /**
   * Suggested openers on an empty conversation, rendered as chips.
   *
   * Distinct from `startConversation.initialMessage`, which pre-fills the
   * composer for a visitor who clicked one specific quick-link. These are
   * offered to every visitor who opens the panel with nothing to say yet.
   */
  starterPrompts?: string[];

  /**
   * The home screen's sections, in order.
   *
   * Absent means the historical four in the historical order, so an existing
   * embed sees no change. A list that OMITS a section hides it — that is how
   * you turn the recent-conversation card off.
   */
  home?: Array<'start' | 'recent' | 'quickLinks' | 'blocks' | 'helpSearch'>;

  /**
   * Tier 1 blocks for the home screen's `blocks` section — a `{ v, blocks }`
   * envelope, the same shape a message carries. Validated at the render
   * boundary, so a block type a newer release added does not blank the home
   * screen on an older bundle.
   */
  homeBlocks?: unknown;

  /**
   * Let visitors drag the launcher around the page. The chosen position
   * persists in localStorage per channel so they only have to set it once.
   * Default: false.
   */
  draggable?: boolean;

  /**
   * Scroll-aware floating "quip" tooltips. When the viewport's center is
   * inside an element matching `selector`, the launcher floats a small
   * speech bubble with one of `lines` (cycled every ~3s). Same idea as
   * Pip but built into the widget so every customer can use it.
   */
  quips?: WidgetQuip[];

  /**
   * Fun easter egg: hammering the launcher N times in 2s triggers a
   * confetti burst. Default: 5. Set 0 to disable.
   */
  confettiClickStreak?: number;
}

export interface WidgetQuip {
  /** CSS selector to watch. e.g. `[data-section="pricing"]` or `#hero`. */
  selector: string;
  /** Lines to cycle through while this section is in view. */
  lines: string[];
  /** How long to dwell per line, ms. Default: 3500. */
  intervalMs?: number;
  /** If true, only show the quip once per page-load, not on every revisit. */
  oncePerSession?: boolean;
}

export interface WidgetQuickLink {
  /** Button label. */
  label: string;
  /** URL to open in a new tab. */
  href?: string;
  /**
   * Or kick off a conversation. Two shapes accepted:
   *  - `string` — legacy: a free-form body that becomes the initial message
   *    (the composer pre-fills with it; the visitor can edit before sending).
   *  - `{ initialMessage }` — the recommended object form, gives us room to
   *    grow (`assignedTeamId`, `topic`, etc.) without another schema migration.
   */
  startConversation?: string | { initialMessage?: string };
  /** Optional small description below the label. */
  description?: string;
  /** Optional emoji or single character as a leading icon. */
  icon?: string;
}

export interface WidgetCopy {
  greeting?: string; // home tab hero ("How can we help?")
  greetingSubtitle?: string; // small text under greeting
  homeStartCta?: string; // "Send us a message"
  homeStartCtaSubtitle?: string; // "We usually reply in a few minutes"
  homeRecentTitle?: string; // "Recent conversations"
  homeQuickLinksTitle?: string; // "Quick links"
  homeHelpTitle?: string; // "Find an answer"
  tabHome?: string; // "Home"
  tabMessages?: string; // "Messages"
  tabHelp?: string; // "Help"
  messagesEmpty?: string; // "No conversations yet."
  messagesNewCta?: string; // "Start a new conversation"
  helpSearchPlaceholder?: string; // "Search for help..."
  helpEmpty?: string; // "Try searching for what you need."
  helpNoResults?: string; // "No articles found."
  helpStillNeedHelp?: string; // "Still need help? Talk to us."
  composerPlaceholder?: string; // "Type your message..."
  composerSend?: string; // "Send"
  poweredBy?: string; // "Powered by Chatly"
  closeAria?: string; // "Close chat"
  backAria?: string; // "Back"
  /**
   * Shown to the VISITOR when the widget could not start at all — a refused
   * origin, a dead network, a 5xx. Deliberately says nothing about the cause:
   * the cause is the integrator's business and goes to the console, and on a
   * public page "origin not allowed on this channel" also tells a stranger
   * about the channel's configuration.
   */
  unavailableMessage?: string; // "Chat is unavailable right now."
  /** The retry button, shown only when retrying could actually succeed. */
  unavailableRetry?: string; // "Try again"
  /**
   * The expected-reply note in the header, shown ONLY while somebody is
   * available to answer.
   *
   * It was a hardcoded sentence that no workspace could change and that the
   * widget showed regardless of staffing, so an unstaffed workspace told every
   * visitor it typically replies within a few minutes. The default is still a
   * claim — set this to your real figure, or to an empty string to show
   * nothing at all.
   */
  responseTimeNote?: string; // "We typically reply within a few minutes"
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

/** The object form of `open`. See `ChatlyApi.open`. */
export interface OpenRequest extends StartConversationRequest {
  /**
   * Only `'conversation'` today, and it is a required discriminator rather
   * than an optional convenience: `open({ botSlug })` with no `view` would be
   * ambiguous about whether the caller wanted a tab or a thread, and the two
   * differ in whether the visitor has to click again.
   */
  readonly view: 'conversation';
}

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
