/**
 * The live half of the headless SDK.
 *
 * A consumer building their own chat UI needs messages as they arrive. Two
 * ways, and the SDK does not require the heavier one:
 *
 *  - **Polling**, the default. Zero dependencies, works everywhere, a few
 *    seconds of latency.
 *  - **Push**, by handing `subscribe()` your own socket.io-client factory.
 *    The widget does the same thing with a deferred chunk; the SDK will not
 *    take the dependency on a consumer's behalf, because a React Native app
 *    or a worker may have no use for it and every byte would still ship.
 *
 * This file holds the part worth testing on its own: deciding what is new.
 */
import type { HeadlessMessage, TypingSignal } from './types.js';

/**
 * How many message ids a subscription remembers.
 *
 * Unbounded, a long-lived tab on a busy conversation keeps every id it has
 * ever seen. The cap is far above any realistic poll window, and the oldest
 * are dropped first — a message older than the last thousand cannot appear as
 * "new" in a later poll of the most recent page.
 */
const MAX_REMEMBERED = 1_000;

/**
 * The messages in `batch` that `seen` has not yet been told about, oldest
 * first, with `seen` updated.
 *
 * Ordered by `createdAt` rather than by the order the server returned: a list
 * endpoint is free to answer newest-first, and a consumer appending in
 * receive order would render the conversation upside down.
 *
 * Deliberately NOT the widget's `mergePolled`. That one reconciles optimistic
 * `local-*` rows against their server copies, which only matters to a UI that
 * renders a message before the server has one. A headless consumer owns that
 * decision themselves; all they need from us is "what is new".
 */
export function newMessagesSince(
  seen: Set<string>,
  batch: readonly HeadlessMessage[],
): HeadlessMessage[] {
  const fresh: HeadlessMessage[] = [];
  for (const message of batch) {
    const id = message?.id;
    if (typeof id !== 'string' || id.length === 0) {
      // A row we cannot key is a row we would emit again on every poll.
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    fresh.push(message);
  }
  fresh.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (seen.size > MAX_REMEMBERED) {
    // Insertion-ordered, so the first entries are the oldest.
    const excess = seen.size - MAX_REMEMBERED;
    let dropped = 0;
    for (const id of seen) {
      if (dropped >= excess) {
        break;
      }
      seen.delete(id);
      dropped += 1;
    }
  }
  return fresh;
}

/**
 * How long a "typing" indicator survives without another `typing.start`.
 *
 * ── Why the SDK owns this timeout and not the consumer ──────────────────
 *
 * `typing.stop` is best-effort. The dashboard emits one after 5s of idle
 * keystrokes and on send, and its hook emits one on unmount — but an agent
 * who closes the laptop mid-sentence, loses their network, or whose tab is
 * killed sends nothing at all. A consumer rendering the raw start/stop pair
 * gets an indicator that says "Sarah is typing…" forever, which is the exact
 * shape of bug this codebase keeps finding: it appears to work.
 *
 * Leaving it to the consumer means every consumer writes this same timer, and
 * the ones who do not ship the stuck indicator. 3,500ms is the widget's own
 * window (`use-conversation-realtime.tsx`), so a custom UI built on the SDK
 * behaves like the widget rather than subtly differently.
 */
export const TYPING_STOP_AFTER_MS = 3_500;

/** What the tracker needs from a `typing.*` payload. */
interface TypingActor {
  readonly actorType: 'agent' | 'bot';
  readonly actorId: string;
  readonly displayName?: string;
}

/**
 * Turn a stream of `typing.start` / `typing.stop` events into the single
 * boolean a UI actually renders.
 *
 * Edge-triggered: `onChange` fires only when the answer changes, so a
 * keystroke every 300ms does not re-render the consumer's component ten times
 * a second. Exported for its own test — the timer behaviour is the part worth
 * pinning, and it is invisible from the outside.
 */
export function createTypingTracker(opts: {
  readonly onChange: (signal: TypingSignal) => void;
  readonly stopAfterMs?: number;
}): {
  start: (actor: TypingActor) => void;
  /**
   * `actor` is optional: the caller does not always have one. A message
   * arriving means "whoever was typing has stopped", and the envelope that
   * carries it says nothing about typing at all.
   */
  stop: (actor?: TypingActor) => void;
  dispose: () => void;
} {
  const stopAfterMs = opts.stopAfterMs ?? TYPING_STOP_AFTER_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active: TypingActor | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const settle = (actor: TypingActor, isTyping: boolean): void => {
    if (isTyping === (active !== null)) {
      return;
    }
    active = isTyping ? actor : null;
    opts.onChange({ ...actor, isTyping });
  };

  return {
    start(actor): void {
      settle(actor, true);
      clear();
      timer = setTimeout(() => {
        timer = null;
        settle(actor, false);
      }, stopAfterMs);
    },
    stop(actor): void {
      clear();
      // The ACTIVE actor is preferred over the one passed in, so the
      // `isTyping: false` signal names whoever the consumer was told about —
      // not an empty placeholder from a `message.created` envelope.
      const subject = active ?? actor;
      if (subject === undefined || subject === null) {
        return;
      }
      settle(subject, false);
    },
    dispose(): void {
      // No `onChange` on dispose: the subscription is going away and the
      // consumer is tearing their UI down with it. Firing a last event into a
      // component that has unmounted is how a wrapper earns a React warning.
      clear();
      active = null;
    },
  };
}

/**
 * The actor a `typing.*` envelope is about, or null if it is not one we show.
 *
 * Two exclusions, both load-bearing:
 *
 *  - `kind: 'viewing'`. The agent dashboard publishes room presence and
 *    collaborative-cursor frames AS `typing.start` (see `viewing.cursor` in
 *    `apps/realtime/src/gateway.ts`), ~10 per second while an agent moves
 *    their mouse. Rendering those as typing would make the indicator flicker
 *    whenever an agent so much as looked at the conversation.
 *  - anything that is not an agent or a bot. The gateway's visitor allowlist
 *    already forwards only agent typing, so this is the second of two checks
 *    rather than the only one — but a visitor must never be shown their OWN
 *    typing as the agent's, and the day the allowlist widens is not the day
 *    to discover that.
 */
export function typingActorOf(
  payload: unknown,
): { actorType: 'agent' | 'bot'; actorId: string; displayName?: string } | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const p = payload as {
    actorType?: unknown;
    actorId?: unknown;
    displayName?: unknown;
    kind?: unknown;
  };
  if (p.kind === 'viewing') {
    return null;
  }
  if (p.actorType !== 'agent' && p.actorType !== 'bot') {
    return null;
  }
  return {
    actorType: p.actorType,
    actorId: typeof p.actorId === 'string' ? p.actorId : '',
    ...(typeof p.displayName === 'string' ? { displayName: p.displayName } : {}),
  };
}
