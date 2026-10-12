# @chatlychat/sdk-js — changelog

## Unreleased

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
