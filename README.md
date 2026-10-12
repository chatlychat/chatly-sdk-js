# @chatlychat/sdk-js

Browser SDK for the Chatly platform: control the in-page widget, identify
visitors, fire CDP events, and — headlessly — list conversations, send
messages and subscribe to replies without rendering our UI at all.

> **Two halves, and only one is on the widget global.** The widget-control
> methods (`open`, `close`, `identify`, `track`) are also available with no
> package at all — load the widget snippet and call them on `window.Chatly`.
> The headless half (`listConversations`, `listMessages`, `send`,
> `uploadFile`, `subscribe`, `rate`, `emailTranscript`) has **no** global and
> needs this package or a direct call to the documented REST endpoints.

```bash
npm install @chatlychat/sdk-js
# or
pnpm add @chatlychat/sdk-js
```

## Quick start

```ts
import { Chatly } from '@chatlychat/sdk-js';

// The constructor is PRIVATE. `init` is the only way in.
const chatly = Chatly.init({ publicId: 'ch_web_0192…' });

await chatly.identify({ externalId: 'user_42', name: 'Ada', userHash: '…' });
const { conversationId } = await chatly.startConversation('Hello');
await chatly.send(conversationId, 'and one more thing');
```

## `Chatly.init(options)`

| Option        | Type      | Default                      | Notes                                                                     |
| ------------- | --------- | ---------------------------- | ------------------------------------------------------------------------- |
| `publicId`    | `string`  | —                            | The web channel's public id, from Dashboard → Channels.                   |
| `apiUrl`      | `string?` | `https://api.chatlychat.com` | Set only if you self-host.                                                |
| `realtimeUrl` | `string?` | reported by the server       | Socket.IO host for `subscribe()`. Only for a host the server cannot know. |

## Methods

Widget control — these mirror `window.Chatly` and need the widget on the page:

- `open()` / `close()`

Visitor identity and analytics:

- `identify(input)` → `{ contactId }`. Pass `userHash` to make the identity
  **verified**; without it the visitor is unverified and tools that require a
  proven identity will refuse.
- `track(name, properties?)`

Headless conversation surface — no widget required:

- `startConversation(body, attachments?)` → `{ conversationId }`
- `send(conversationId, body, attachments?)`
- `listConversations(limit = 20)`
- `listMessages(conversationId, limit = 50)`
- `subscribe(conversationId, handlers, options?)` → `Subscription`. Uses the
  push socket when it can and falls back to polling, so it keeps working
  where a WebSocket cannot be opened.
- `uploadFile(file)` → `VisitorAttachment`, to pass to `send` or
  `startConversation`
- `rate(conversationId, score, comment?)`
- `emailTranscript(conversationId, email)`

## Signed page context

`setContext` is **not** on this SDK — it is on the widget's own global. See
the [web channel guide](https://chatlychat.com/guides/channel-web) for the
call and [identity verification](https://chatlychat.com/docs/identity-verification)
for how to mint the signed `contextToken`.

## This README used to document an API that did not exist

For the record, because it may have been copied: it described
`new Chatly({ channelPublicId, baseUrl, widgetSelector, locale })`, plus
`toggle()`, `on()`, `destroy()` and `send(body)`. **None of those exist.** The
constructor is private, the option names are `publicId` / `apiUrl` /
`realtimeUrl`, and `send` takes a conversation id first. Corrected
2026-10-12 against `src/index.ts`.

---

## About this repository

This is a **mirror**. `@chatlychat/sdk-js` is built from a private monorepo where the rest
of the platform, its migrations and its contract checks live, so a pull request here
cannot be merged directly — but a patch is still the fastest way to get something
fixed and we will port it with attribution.

What you can do here: read the source, run the tests, open an issue, or open a PR
and we will treat the diff as the proposal.

Issues: https://github.com/chatlychat/chatly-sdk-js/issues · Docs: https://chatlychat.com/docs
