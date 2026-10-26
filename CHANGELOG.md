# @chatlychat/sdk-js — changelog

## 0.20.0 — 2026-10-26

New event `navigate`: `Chatly('on', 'navigate', fn)` receives `{ path, label, conversationId, messageId, actionId }` when a visitor presses a `navigate` card action, and `path` is a validated site-relative path (`/pricing?plan=pro`) you can pass to your router. Registering a handler is what stops the widget navigating itself; with none it opens `location.origin + path` in the current tab. `chatly:navigate` mirrors it on `window` but does not count as a handler.

## 0.19.0 — 2026-10-26

**Behaviour change: visit telemetry is now opt-in.** The widget's own `visitor.page_view`, `visitor.returned`, `visitor.exit_intent`, `visitor.scroll_depth` and `visitor.idle_threshold` events are held and not sent until analytics consent is affirmatively granted. Opening the chat no longer grants it. New option `analytics: 'grant'` for sites outside any consent regime. `tracking: false` and the granular form are unchanged.

## 0.18.2 — 2026-10-25

`setConsent({ functional, analytics, marketing })`: tell the widget a consent decision from any consent banner, including your own. `consent: 'auto'` now reads the major CMPs (IAB TCF v2.2, Google Consent Mode v2, Cookiebot, OneTrust, Cookie Munch and others), not one vendor.

## 0.18.1 — 2026-10-25

- **`WidgetTheme.anchor`** — a CSS selector for your own launcher button, which
  the panel positions itself 12px above and then follows (a `ResizeObserver` on
  the element and on the document, not a scroll listener). It beats
  `panelOffsetY` while the element is on the page, and falls back to the
  widget's corner geometry when the selector matches nothing, when the element
  is removed or hidden, or when the selector is malformed. With
  `hideLauncher: true` and no `panelOffsetY` the widget does this for you
  against whichever element called `open()`, so most integrators need not set
  it: that is the fix for the panel landing on top of the button that opened
  it.

Types only; this package ships no runtime for the theme.

## 0.17.1 — 2026-10-25

A **patch** bump for a documentation fix, and a real one rather than
tidiness: a docblock in `types.ts` pointed at a file that no longer holds the
declaration it named. Comments in `types.ts` SHIP — they are in the published
source and in the generated `.d.ts` — so a stale path is something a consumer
reads and then follows to nothing.

### Fixed

- **The pointer to the authoritative message schema.**
  `widgetVisitorMessageSchema` moved from `widget-response-schemas.ts` to
  `widget-conversation-response-schemas.ts` when that file was split at this
  repo's 650-line ceiling. No type, no method and no request shape changed.

### A note on 0.17.0, which has no entry

It does not appear below, and that is not an oversight here: the commit that
set it (`af59eff5`) changed **only** `package.json` — a bare version bump,
released to ship work from earlier commits that had not been published. So
there is nothing this file could describe for it beyond the release itself.

Worth knowing because **nothing enforces this**: no gate checks that a
version has a changelog entry. `check-unreleased-package-changes` catches the
opposite case — source that has moved past its released version — and is
silent about a version with no story.

## 0.16.0 — 2026-10-24

Two ways a visitor's realtime connection died **silently**, both pre-existing,
both in `subscribe()`'s push path.

### Fixed

- **The handshake carried a FROZEN `auth` object.** The realtime token is
  scoped to one conversation and lives one hour
  (`VISITOR_REALTIME_TOKEN_TTL_SECONDS`), and socket.io captures a static
  `auth` once and replays it verbatim on every reconnect. So a visitor whose
  socket dropped after that hour reconnected with an expired credential and
  was refused for the rest of the page — silently: the gateway answers a bare
  `Unauthorized`, nothing here handled it, and the thread simply stopped
  updating. A visitor reads that as being ignored, not as a bug.

  `auth` is a callback now, so an attempt re-reads the current token, and the
  socket re-mints on `disconnect`/`connect_error` so a fresh token EXISTS to
  be read. Both halves are needed: a callback over a token nothing refreshes
  re-reads the same expired string.

- **A recovered visitor session left the socket on a dead credential.** A 403
  `visitor_session_*` is absorbed by dropping the stored token, re-initialising
  and replaying the call — which cured every REST path and left realtime
  behind, holding a token minted for the session that had just been thrown
  away. The socket is told now, and re-mints; when the re-mint is refused
  (the recovered session is a different contact, which does not own the old
  thread) that arrives at `onError` as `realtime_token_failed` instead of
  surfacing an hour later as a reconnect nobody can explain.

- **`subscribe()` initialised the visitor session TWICE** on a browser with no
  stored token, because the history poll and the realtime-token mint both ran
  `/v1/widget/init` in the same tick with no coalescing. Two inits is two
  anonymous sessions: the second overwrote the first, so the thread the
  consumer was handed and the conversation the realtime token was scoped to
  could belong to different contacts.

### Added

- **`ChatlyError`** and the `ChatlyErrorCode` union are exported. Every
  failure path now reports one, with a `code` to switch on
  (`request_failed`, `no_realtime_host`, `realtime_token_failed`) and the HTTP
  status where there is one. It extends `Error`, so code that caught an
  `Error` or read `.message` is unaffected.

## 0.8.1 — 2026-10-20

A **patch**: a typed surface that was narrower than the runtime one.

### Fixed

- **`theme.icons` accepts six names, and this type listed five.** `emoji` was
  missing, so a TypeScript consumer could not set that icon at all while an
  untyped `Chatly('init', { theme: { icons: { emoji: '🙂' } } })` worked. A
  typed surface narrower than the runtime one is the worst direction for that
  gap — it reads as "unsupported" rather than as a mistake. The full set is
  `attachment`, `emoji`, `mic`, `stop`, `check`, `star`.

  The authority is `WIDGET_ICON_NAMES` in the server's shared package, which
  this one cannot import (it ships with zero dependencies, which is the point
  of it), so the union is restated here and a parity spec reads that file as
  text and fails if the two disagree. Nothing had been checking; its own
  comment claimed "two validate the same set" while there were three lists.

### Also worth knowing, though it is not a change in this package

- `theme.icons` used to be accepted by the embed snippet and **refused** by
  `PATCH /v1/channels/{id}` as an unknown key. Both paths accept it now.
- A **quick link's** `icon` is not one of those six names. It is an inline
  `<svg…>` or any literal text drawn as-is (in practice an emoji), so `"star"`
  is accepted and renders the word "star". That is now documented.

## 0.8.0 — 2026-10-19

A **minor** bump, and it exists because 0.7.0's notes were incomplete rather
than because the code changed again. `setTheme` and the token identity surface
below were added to the tree AFTER the commit that set 0.7.0, so the published
0.7.0 tarball carries them while its changelog and npm page do not mention
them — which is a version number that understates what it contains.
`check-unreleased-package-changes` caught it. A developer reading 0.7.0's
notes would not have known either feature existed.

### Added

- **`Chatly('setTheme', partialTheme)`** — repaint an open panel with no
  network request and no teardown. It merges over the snippet's `theme` the
  way `setOffset` merges, reaches every `Chatly('mount')` view, and is honoured
  if called before mount. Calling `init` again was the only previous way to
  change the theme, and that closes the panel and re-issues
  `/v1/widget/init`. Note `theme.colorScheme: 'auto'` already followed the OS
  preference through CSS with no JavaScript — `setTheme` is for a _page-level_
  switch, which the cascade cannot see.
- **`userToken` and `getToken` on `WidgetIdentity`** — verify a visitor from an
  Atlas JWT-template token instead of a shared HMAC `userHash`, against a
  channel configured `identityVerification.mode: 'oidc'`.

  `getToken` is a **provider, not a token**, and that is the important part:
  an Atlas template token lives 60 seconds by default, so a stored one is
  expired by the next page view. Pass
  `identify({ getToken: () => atlas.session.getToken({ template: 'chatly' }) })`
  and the SDK calls it per `init` and never persists the result. Do not pass
  `externalId` beside a token — the server takes it from the token's `sub` and
  answers 403 on a mismatch rather than silently preferring one.

  New failure surface: a 403 carries `details.reason` naming which check
  refused the token, and an unreachable identity provider is a **502
  `dependency_failure`** rather than a 403, so a network fault does not send
  you to debug your template. Do not retry-loop on the 502.

## 0.7.0 — 2026-10-19

A **minor** bump. The types moved because the widget's behaviour did.

### Added

- `identityFallback?: 'anonymous'` on `InitOptions`, and the `error` codes
  `identity_rejected` / `identity_missing_hash`. A rejected `userHash` used to
  answer 403 with no `error` event and no `ready`, so one rotated secret
  removed support chat for every signed-in user with nothing to catch.

### Changed

- **`storage` defaults to `'on-open'`** (it was `'allow'`). An embed passing no
  `storage` option now writes nothing to the device and sends no visit
  telemetry until the visitor opens the panel; the widget's own feeds are
  buffered and released on engagement or `setStorageConsent(true)`. Your own
  `track()` calls are never gated. Pass `storage: 'allow'` for the old
  behaviour.
- The `visitor` field at `init` is documented as the canonical way to start
  verified: `init` followed by `identify(B)` on a browser that last chatted as
  someone else used to send A's token on the first request.

## 0.6.0 — 2026-10-16

### Added

- `'conversation.changed'` on `ChatlyEventName` — the thread on screen moved,
  which is `conversation` minus the report that accompanies the panel opening.
  Listen to it if you mirror the visitor's current thread and want to re-sync
  on a move; `conversation` still fires once at startup, which this one
  deliberately does not.
- `theme.panelOffsetY` and `ChatlyApi.setOffset({ x, y, panelY })`, for a page
  that draws its own launcher button.

## 0.5.0 — 2026-10-16

### Added

- `WidgetTheme.panelOffsetY` — how far above the bottom of the viewport the
  panel's bottom edge sits, measured from `offsetY`. It **replaces** the
  launcher-relative default rather than adding to it, and it is not gated on
  `hideLauncher`: a field that silently needs a second field set is a control
  that appears to work.
- `ChatlyApi.setOffset({ x?, y?, panelY? })` — move the widget after `ready`,
  live. `x` writes only the side `theme.position` chose, because writing both
  `left` and `right` on a fixed element lets width pick the winner. It emits
  no `open` or `close`: it sets inline properties on elements the mount
  already holds, and never re-initialises.

Both exist for one reported case (Numera NCH-22): with `theme.hideLauncher`
the panel sat on `offsetY`, so a host's own launcher button at that spot was
covered by it, and there was no way to move either.

## 0.4.0 — 2026-10-16

- **`mount` and `unmount` are on `ChatlyApi`, and `MountOptions` is
  exported.** `Chatly('mount', { el, publicId })` adds a SECOND widget view,
  inline in the page, beside the launcher — a full-page assistant on one route
  and the support launcher in the corner of every page including that one.
  `Chatly('unmount', el)` removes it. The widget has shipped both since
  2026-10-16; until now a TypeScript host calling them got an error for
  methods that were on the global, which is the whole reason this package
  declares it.

  These are declarations of the WIDGET's global, not methods on the `Chatly`
  class this package exports. There is no `chatly.mount()`: a view is rendered
  by the widget bundle, so it needs the bundle on the page.

- `MountOptions` is a subset of `InitOptions` and the omissions are typed
  rather than documented: `mountTo` is replaced by `el` (a view is always
  inline), `publicId` is optional and defaults to the primary widget's,
  `storage` and `on` are absent, and `behavior` narrows to `tabs` and
  `defaultTab` — the rest of `behavior` describes the PAGE, which a view
  inside somebody else's layout does not decide. There is deliberately no
  `botSlug`; a view binds to its own channel, whose bot route is set on the
  server. See the [web channel guide](https://chatlychat.com/guides/channel-web)
  for the call and what a view shares with the primary widget.

## 0.3.0 — 2026-10-14

- **`unreadCount()` — the number a custom launcher needs.** A host who
  replaces the launcher had no way to show "3 unread". The documented advice
  was to tally the `message` event, which counts messages seen _while the page
  was open_ — the wrong number, because the case a badge exists for is a reply
  that arrived after the visitor navigated away.
- **`HeadlessConversation.unreadContactCount`.** The data was already on the
  wire: `POST /v1/widget/conversations/list` has always returned it and the
  widget's own Messages tab renders it per thread. This type simply did not
  declare the field, so the published contract hid it.
  An absent count reads as zero, because a badge showing `NaN` is worse than
  one showing nothing.

  It lives here rather than on `window.Chatly` because it costs a request: the
  widget fetches the conversation list only when the panel opens, so the count
  is not known at page load, and making it known would mean a fetch for every
  visitor on every page view — on top of the 44KB `widget.js` they already
  download. A host who has written their own launcher asks for the number when
  they want it.

## 0.2.0 — 2026-10-13

- **`window.Chatly` is typed, from here.** `ChatlyGlobal`, `InitOptions`,
  `ChatlyApi`, `WidgetTheme`, `WidgetBehavior`, `WidgetCopy`,
  `WidgetIdentity`, `SetContextInput`, `ReportActionInput`, `SessionSnapshot`
  and the `ChatlyEventName` union are exported from the package root. They
  are the widget's OWN declarations, single-sourced here: the file used to
  live in
  `apps/widget`, where a developer using the embed snippet had nothing to
  install and typed `window.Chatly` by hand or as `any`.
- **A headless conversation API** — `subscribe`, `send`, `setTyping`,
  `messages` — for a UI that is not our widget at all.

- `subscribe` now reports INBOUND typing through `handlers.onTyping` — the
  send half (`setTyping`) shipped first and there was no way to show the
  visitor that the agent was typing. Push-only, like `setTyping`: typing is a
  socket event with no HTTP route, so a polling subscription warns once rather
  than never firing in silence.
- `onTyping` is edge-triggered and self-clearing (`TYPING_STOP_AFTER_MS`,
  3.5s — the widget's own window), because `typing.stop` is best-effort and an
  agent who closes their laptop mid-sentence never sends one.
- `identify()` now remembers the contact id it was given, so `setTyping` names
  the right contact on a returning browser instead of `'unknown'`.

## 0.1.0 — 2026-05-25

- Initial public release.
- `Chatly` class: `identify`, `track`, `open`, `close`, `toggle`, `send`, `on`,
  `destroy`.
- TypeScript types ship with the package; no `@types/*` package needed.
