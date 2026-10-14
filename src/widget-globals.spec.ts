/**
 * The snippet surface is types, and ONLY types.
 *
 * Two different claims are pinned here, and they fail in different ways.
 *
 * 1. **It emits no runtime code.** `apps/widget` imports these declarations
 *    with `import type` and carries `@chatlychat/sdk-js` as a devDependency so
 *    that nothing can quietly turn one into a value import — the widget's
 *    first-paint bundle has ~226 bytes of headroom under a 44,000-byte
 *    ceiling, and a value import would resolve a second browser SDK into it.
 *    A `const`, a `class` or an `enum` added to `widget-globals.ts` is exactly
 *    the change that would do it, and it is invisible to a type checker: the
 *    widget would still compile, the bundle would just grow.
 *    `check-bundle-size.mjs` catches it on a built `dist/`; this catches it
 *    here, where the mistake is made.
 *
 * 2. **Every name the snippet needs is still declared.** The bodies below are
 *    type positions, so this file does not compile if a name is removed or
 *    renamed — which is what makes `pnpm --filter @chatlychat/sdk-js
 *    typecheck` a regression test for the published surface. The widget's
 *    `public-types.ts` re-exports the same list, and
 *    `check-widget-wrapper-parity.mjs` fails if it ever declares one itself
 *    instead.
 */
import { describe, expect, it } from 'vitest';

import * as widgetGlobals from './widget-globals.js';

import type {
  ChatlyApi,
  ChatlyEventHandler,
  ChatlyEventName,
  ChatlyGlobal,
  InitOptions,
  OpenRequest,
  ReportActionInput,
  SessionSnapshot,
  SetContextInput,
  StartConversationRequest,
  WidgetBehavior,
  WidgetCopy,
  WidgetIdentity,
  WidgetQuickLink,
  WidgetQuip,
  WidgetTheme,
} from './widget-globals.js';

describe('widget-globals', () => {
  it('exports no runtime value at all', () => {
    /*
     * Not `toEqual({})` — a module namespace object is not a plain object and
     * the key list is the thing being asserted. An empty list is what "this
     * file costs the widget nothing" means mechanically.
     */
    expect(Object.keys(widgetGlobals)).toEqual([]);
  });

  it('declares the whole snippet surface', () => {
    const theme: WidgetTheme = { primaryColor: '#4f46e5', colorScheme: 'auto' };
    const behavior: WidgetBehavior = { tabs: ['home', 'messages'], defaultTab: 'home' };
    const copy: WidgetCopy = { greeting: 'Hi' };
    const quickLink: WidgetQuickLink = { label: 'Pricing', href: 'https://example.com/pricing' };
    const quip: WidgetQuip = { selector: '#hero', lines: ['Hello'] };
    const visitor: WidgetIdentity = { externalId: 'u_42', userHash: 'a'.repeat(64) };
    const options: InitOptions = {
      publicId: 'acme-web',
      theme,
      behavior,
      copy,
      copyByLocale: { fr: copy },
      quickLinks: [quickLink],
      visitor,
      mountTo: '#chat',
      cssOverrides: ':host { z-index: 1 }',
    };
    const start: StartConversationRequest = { botSlug: 'shopping', initialMessage: 'hi' };
    const open: OpenRequest = { view: 'conversation', ...start };
    const context: SetContextInput = { audience: 'seller', contextToken: 'jwt' };
    const action: ReportActionInput = { messageId: 'm_1', actionId: 'a_1', status: 'done' };
    const session: SessionSnapshot = { contactId: null, workspaceId: 'w_1' };
    const event: ChatlyEventName = 'identified';
    const handler: ChatlyEventHandler = (detail) => void detail;

    expect([
      options.publicId,
      behavior.quips?.length ?? 0,
      quip.selector,
      open.view,
      typeof context.audience,
      typeof action.status,
      session.workspaceId,
      event,
      typeof handler,
    ]).toEqual([
      'acme-web',
      0,
      '#hero',
      'conversation',
      'string',
      'string',
      'w_1',
      'identified',
      'function',
    ]);
  });

  it('types `window.Chatly` as the callable global, not a partial object', () => {
    /*
     * The augmentation is the deliverable: an integrator who imports a type
     * from this package gets `window.Chatly` typed with no `declare global` of
     * their own. Asserted in a type position rather than at run time, because
     * there is no widget on the page in a unit test — and because the bug this
     * replaced was a TYPE bug: the old declaration was
     * `{ open?, close?, destroy? }`, so `window.Chatly.identify(...)` was an
     * error in the one package whose job is to drive the widget.
     */
    const asGlobal: ChatlyGlobal | undefined = globalThis.window?.Chatly;
    const asApi: ChatlyApi | undefined = asGlobal;
    expect(asApi).toBeUndefined();
    // Callable as well as an object of methods — the snippet idiom.
    const callable: ((...args: unknown[]) => void) | undefined = asGlobal;
    expect(callable).toBeUndefined();
  });
});
