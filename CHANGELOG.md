# @chatlychat/sdk-js — changelog

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
