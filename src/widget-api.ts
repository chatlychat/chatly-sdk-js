/**
 * `ChatlyApi` — the complete `window.Chatly` surface.
 *
 * Its own file because `widget-globals.ts` crossed the 650-line ceiling. The
 * interface is the natural seam: it is the published contract a snippet
 * integrator installs this package FOR, and what is left in
 * `widget-globals.ts` is the event vocabulary and the global declaration that
 * wrap it. Re-exported from there, so no importer changes.
 *
 * The import of `InitOptions`, `MountOptions` and `ChatlyEventName` from
 * `widget-globals.ts`, which imports `ChatlyApi` back from here, IS a cycle —
 * and a deliberately harmless one: every edge in it is `import type`, so both
 * are erased and no module-evaluation order exists to get wrong. That is the
 * opposite of the zod-schema cycles elsewhere in this repo, where the import
 * is a VALUE one and a cycle is a TDZ crash at first import.
 */
import type { WidgetTheme } from './widget-appearance.js';
import type { ChatlyEventName, InitOptions, MountOptions } from './widget-globals.js';
import type { WidgetIdentity } from './widget-identity.js';
import type {
  OpenRequest,
  ReportActionInput,
  SessionSnapshot,
  SetContextInput,
  StartConversationRequest,
  ChatlyEventHandler,
} from './widget-payloads.js';

/**
 * A consent decision in Chatly's three categories — what a consent banner
 * reports with `Chatly('setConsent', …)`, the `consent` init option or a
 * `chatly:consent` DOM event.
 *
 * `true` granted, `false` refused, `null` not decided yet; an omitted key is
 * left as it was. `functional` is the session: refused or undecided, it is
 * kept for THIS visit only (`sessionStorage`), because opening a chat is the
 * visitor's own request. `analytics` and `marketing` are ordinary opt-in:
 * refused denies and purges.
 */
export interface ChatlyConsent {
  functional?: boolean | null;
  analytics?: boolean | null;
  marketing?: boolean | null;
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
  /**
   * Take a thread off this visitor's list. NOT a delete.
   *
   * The agent inbox, the transcript and the reports keep it — a conversation
   * is the workspace's record as well as the visitor's — and a message newer
   * than the dismissal brings it back, so an agent's reply always reaches the
   * person who asked. Idempotent.
   *
   * It does not close an open panel; `dismiss` is about the list.
   *
   * For an actual erasure, a visitor has the GDPR contact-deletion request,
   * which is a workspace obligation with a person attached rather than a
   * method on a widget.
   */
  dismiss: (conversationId: string) => void;
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
   * stored. Granting allows writes from that moment on and replays no
   * HISTORY — but it does two things with what this page has live: the
   * session already minted is written to the device, so the visitor who
   * agrees and then chats keeps their thread across a reload; and the visit
   * telemetry held back since load goes out, so the page view carrying the
   * entry referrer is not lost to the banner. See the `storage` init option.
   *
   * It supersedes `'on-open'`: a banner that said no is not overruled by the
   * visitor later opening the chat.
   */
  setStorageConsent: (granted: boolean) => void;
  /**
   * Report a consent banner's decision, per category — the vendor-neutral
   * call for ANY consent tool, including one you wrote yourself.
   *
   * ```js
   * Chatly('setConsent', { functional: true, analytics: false, marketing: null });
   * ```
   *
   * `true` granted, `false` refused, `null` not decided, omitted unchanged.
   * The difference from `setStorageConsent` is `functional`: refused or
   * undecided, the chat still works and keeps its session for THIS visit
   * (`sessionStorage`) rather than in page memory, because opening the chat
   * is the visitor's request. A later grant moves it back to `localStorage`.
   * `analytics` and `marketing` refused deny and purge, as
   * `setStorageConsent` does.
   *
   * Callable before the bundle loads (it queues). The same decision can be
   * passed as the `consent` init option, or dispatched by a banner that does
   * not know this API at all:
   * `window.dispatchEvent(new CustomEvent('chatly:consent', { detail }))`.
   * If the consent module cannot be fetched, every category is denied.
   */
  setConsent: (consent: ChatlyConsent) => void;
  /**
   * Move the widget and its panel after boot — the live form of
   * `theme.offsetX`, `theme.offsetY` and `theme.panelOffsetY`.
   *
   * `x` and `y` move the host element in its corner; `panelY` moves the
   * panel's bottom edge up from it, which is the number a page with its own
   * launcher button needs (see `WidgetTheme.panelOffsetY`). Every key is
   * optional; anything that is not a finite number is left as it was, and a
   * call that changes nothing warns.
   *
   * It does not close an open panel and emits no `open` or `close` — a
   * positional change is not a visibility change.
   *
   * `x` is measured from whichever side `theme.position` chose. It has no
   * effect under `mountTo`/`inline`, where the widget is a block in your own
   * layout and the corner offsets never applied in the first place.
   */
  setOffset: (offset: { x?: number; y?: number; panelY?: number }) => void;
  /**
   * Re-theme the widget after boot, without tearing it down (CHT-S-09).
   *
   * For a host page with its own light/dark switch. Calling `init` again is
   * the only other way to change a theme, and it destroys the widget first:
   * the panel closes, the host element is replaced and a fresh
   * `/v1/widget/init` goes out. So a visitor who toggles your theme
   * mid-conversation either keeps the wrong colours or loses the panel they
   * were typing in. This repaints an OPEN panel in place, makes no network
   * request, and emits no `open` or `close` — an appearance change is not a
   * visibility change.
   *
   * Every `WidgetTheme` field is accepted and each call MERGES, like
   * `setOffset`: pass what changes and the rest stays as it was. It layers
   * above the embed snippet's `theme` and above the branding your workspace
   * configured, so you can change two colours without restating the rest.
   * Passing a field as `undefined` drops it from the layer, falling back to
   * the snippet's value rather than to the built-in default.
   *
   * ```js
   * matchMedia('(prefers-color-scheme: dark)'); // or your own switch
   * Chatly('setTheme', { colorScheme: 'dark', background: '#0f172a' });
   * ```
   *
   * `colorScheme: 'auto'` already follows the visitor's OS preference with no
   * code at all, and keeps following it live. Reach for this when the
   * decision is the page's rather than the operating system's.
   *
   * It is honoured if called before the widget has mounted, and it applies to
   * every mounted view, including ones added with `mount()`. `hideBranding`
   * is the one field it cannot set: that is a plan entitlement the server
   * decides.
   */
  setTheme: (theme: WidgetTheme) => void;
  /**
   * The unread count the launcher badge shows (W-06): agent and bot messages
   * this visitor has not had on screen. 0 before it is known. Subscribe to
   * `unread` to be told when it changes.
   */
  getUnreadCount: () => number;
  /**
   * Whether this browser holds a conversation for this channel (W-07) — a
   * RETURNING chatter. False until consent under `storage: 'deny'`, and under
   * the default `'on-open'` until the visitor has engaged once, because in
   * both cases nothing is kept. `loader.js` answers it before the widget has
   * loaded, by the same test, which is how lazy mode loads eagerly for these
   * visitors.
   */
  hasSession: () => boolean;
  /**
   * Add a SECOND widget view, inline in the page, beside the launcher.
   *
   * `mountTo` on `init` relocates the one widget into a container, which
   * means choosing between an embedded chat and a floating launcher. This
   * adds a view instead, so a page can carry both: a full-page assistant at
   * `/shop/assistant` and the support launcher in the corner of every page
   * including that one.
   *
   * ── Give the view its own channel ───────────────────────────────────────
   *
   * `publicId` defaults to the primary widget's, and passing a different one
   * is the point of the feature. A view on its own channel gets its own
   * session, its own thread and — this is the part that matters — its own
   * OPERATOR-CONFIGURED bot route, decided on the server where a visitor
   * cannot reach it.
   *
   * There is deliberately no `botSlug` here. That would travel as the
   * unsigned claim `context.unverified.bot`, and the context row it writes is
   * keyed per visitor per CHANNEL and replaced wholesale on every write — so
   * two views on one channel cannot each hold their own bot, and the second
   * would re-point the first's next conversation while wiping whatever
   * `audience` the page had set. A forgeable hint is also the wrong place for
   * a routing decision as soon as the two assistants differ in what they may
   * reach, which a shopping agent that can look up orders does.
   *
   * ── What a view shares ──────────────────────────────────────────────────
   *
   * Shared, being facts about the person: identity (`identify()` reaches
   * every view), the chosen locale, storage consent. Not shared: the session,
   * the conversation, the context bag, the panel state. And a view never
   * takes over the published surface — `open()`, `track()`, `on('message')`
   * and the launcher's unread badge all stay with the primary widget.
   *
   * Refused, loudly, with the reason named: before `init`, on a container
   * that does not exist, and on a container that already holds a view.
   */
  mount: (opts: MountOptions) => void;
  /** Remove a view added by `mount`. Unknown containers are ignored. */
  unmount: (el: string | Element) => void;
  /** Subscribe. `'ready'` replays immediately if it already happened. */
  on: (event: ChatlyEventName, handler: ChatlyEventHandler) => void;
  off: (event: ChatlyEventName, handler: ChatlyEventHandler) => void;
  /** Set by the loader snippet; read here only so the type stays honest. */
  q?: unknown[];
  publicId?: string;
}
