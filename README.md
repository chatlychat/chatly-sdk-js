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
| `apiUrl`      | `string?` | `https://api.chatlychat.com` | Another Chatly environment, or a test server in your own suite.           |
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
- `unreadCount()` → `number`. Agent and bot messages this visitor has not
  read, across their threads — the number a custom launcher's badge shows. It
  costs a request, so it is a call rather than a property.
- `listMessages(conversationId, limit = 50)`
- `subscribe(conversationId, handlers, options?)` → `Subscription`. Uses the
  push socket when it can and falls back to polling, so it keeps working
  where a WebSocket cannot be opened.
- `uploadFile(file)` → `VisitorAttachment`, to pass to `send` or
  `startConversation`
- `rate(conversationId, score, comment?)`
- `emailTranscript(conversationId, email)`

## Typing `window.Chatly` (the loader snippet's global)

If you embed the widget with the two-line loader snippet and then drive it from
your own TypeScript, this package is also the **type declaration** for the
global. Install it as a dev dependency — you need no runtime code for this —
and import any type from it. Importing augments `Window` for the whole program,
so there is no `/// <reference>` line and no `tsconfig` `types` entry to add:

```ts
import type { ChatlyGlobal, InitOptions } from '@chatlychat/sdk-js';

const options: InitOptions = { publicId: 'acme-web', theme: { primaryColor: '#4f46e5' } };
window.Chatly?.init(options);
```

Exported from `0.2.0`: `ChatlyApi`, `ChatlyGlobal`, `InitOptions`,
`WidgetTheme`, `WidgetBehavior`, `WidgetCopy`, `WidgetQuickLink`, `WidgetQuip`,
`WidgetIdentity`, `SessionSnapshot`, `ChatlyEventName`, `ChatlyEventHandler`,
`OpenRequest`, `StartConversationRequest`, `SetContextInput`,
`ReportActionInput`. And from `0.4.0`: `MountOptions`. These are the widget's
own declarations, re-exported rather than restated, so there is no copy to
drift.

### A second, inline view (`mount`)

`ChatlyApi` declares `mount(opts: MountOptions)` and `unmount(el)` — a SECOND
widget view, inline in your page, beside the launcher. It is on the widget's
global and **not** on the `Chatly` class above: a view is rendered by the
widget bundle, so it needs the bundle on the page.

```ts
import type { MountOptions } from '@chatlychat/sdk-js';

const view: MountOptions = { el: '#shop-assistant', publicId: 'ch_web_shop…' };
window.Chatly?.('mount', view);
// later, when your route unmounts
window.Chatly?.('unmount', '#shop-assistant');
```

`MountOptions` is `InitOptions` with `mountTo` replaced by `el` and
`publicId` made optional. What a view shares with the primary widget, what it
does not, and why there is no `botSlug`: see
[the web channel guide](https://chatlychat.com/guides/channel-web#an-inline-assistant-and-the-support-launcher).

`Window.Chatly` is typed as the full API, because `window.Chatly.identify(...)`
being a type error is useless to everybody. What is really on the page between
the snippet running and the bundle arriving is only the queueing **function**
the snippet installed. From code that can run that early, use the callable
form, which the snippet queues and the bundle replays —
`window.Chatly?.('identify', { externalId })` — or wait for
`Chatly.on('ready', …)`.

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

Not mirrored: src/headless-message-parity.spec.ts, src/icon-names-parity.spec.ts — specs that assert a type restated here still
matches the monorepo's original, which is only a meaningful claim inside it. They
keep running there.

Issues: https://github.com/chatlychat/chatly-sdk-js/issues · Docs: https://chatlychat.com/docs
