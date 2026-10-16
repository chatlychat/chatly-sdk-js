/**
 * The configuration an embed initialises the widget with: colours, copy, the
 * launcher, the tabs, the home screen.
 *
 * Split out of `widget-globals.ts` at the 650-line ceiling and re-exported
 * from it unchanged, so the published surface is identical. The seam is
 * "what the widget LOOKS LIKE and WHEN it acts" on this side, and "the API
 * you call plus the events it emits" on the other.
 *
 * `check-widget-wrapper-parity.mjs` member-compares every type here against
 * `packages/widget-element/src/types.ts` in both directions, and it names
 * files by path — so it reads THIS file for these five and would fail loudly
 * (null members, caught by its coverage floor) if they moved again without
 * it being told. Keep the two in step.
 */
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
  /**
   * Where the PANEL's bottom edge sits, measured up from `offsetY`.
   *
   * For a host page that draws its own launcher button. With
   * `hideLauncher: true` the panel's bottom edge lands on `offsetY`, which is
   * exactly where that button is — so the panel covers it. Set this to the
   * button's height plus whatever gap you want: `panelOffsetY: 60` with the
   * default `offsetY: 16` puts the panel 76px up from the bottom of the
   * viewport and leaves the bottom 16–76px band to you.
   *
   * It REPLACES the built-in launcher-clearing offset rather than adding to
   * it, so setting it with the launcher visible moves the panel over the
   * launcher. The built-in launcher's own placement — 56px of button plus a
   * 12px gap — needs no configuration and is unaffected when this is unset.
   *
   * `Chatly.setOffset({ panelY })` is the same number, live.
   */
  panelOffsetY?: number;

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
  /*
   * `historyScope` is DELIBERATELY not here, and this note exists so the
   * omission is not read as an oversight and filled in.
   *
   * It is a channel setting, configured in the dashboard and enforced
   * entirely server-side in `listVisitorConversations`. The widget never
   * reads it. Declaring it here would make it settable in an embed snippet,
   * where it would validate, persist nowhere and change nothing — an option
   * a developer can discover, set and never see take effect, which is worse
   * than one they cannot find.
   *
   * Everything else on this interface is a per-page option the bundle itself
   * acts on. That is the test for whether a new field belongs here.
   */

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
