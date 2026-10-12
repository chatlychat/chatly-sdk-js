/**
 * The pure half of `subscribe()`: deciding what is new.
 *
 * A headless consumer builds their own UI, so the SDK's job is to hand them
 * messages exactly once, in order, and never a duplicate — a chat that
 * re-renders a message the viewer has already read is worse than one that is
 * a second late.
 */
import { describe, expect, it, vi } from 'vitest';

import { createTypingTracker, newMessagesSince } from './live.js';

const m = (id: string, at: string) => ({
  id,
  body: id,
  authorType: 'agent' as const,
  createdAt: at,
});

describe('newMessagesSince', () => {
  it('returns everything on the first poll', () => {
    const seen = new Set<string>();
    const out = newMessagesSince(seen, [m('a', '1'), m('b', '2')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('records what it returned, so the next poll returns nothing', () => {
    const seen = new Set<string>();
    newMessagesSince(seen, [m('a', '1')]);
    expect(newMessagesSince(seen, [m('a', '1')])).toEqual([]);
  });

  it('returns only the new ones when the window overlaps', () => {
    const seen = new Set<string>();
    newMessagesSince(seen, [m('a', '1'), m('b', '2')]);
    const out = newMessagesSince(seen, [m('a', '1'), m('b', '2'), m('c', '3')]);
    expect(out.map((x) => x.id)).toEqual(['c']);
  });

  it('orders by createdAt, not by the order the server happened to return', () => {
    // A list endpoint may answer newest-first. A consumer appending in
    // receive order would show the conversation upside down.
    const seen = new Set<string>();
    const out = newMessagesSince(seen, [m('late', '2026-01-02'), m('early', '2026-01-01')]);
    expect(out.map((x) => x.id)).toEqual(['early', 'late']);
  });

  it('ignores a row with no id rather than emitting an unkeyable message', () => {
    const seen = new Set<string>();
    const out = newMessagesSince(seen, [{ body: 'x' } as never, m('a', '1')]);
    expect(out.map((x) => x.id)).toEqual(['a']);
  });

  it('is stable when the same id arrives twice in one batch', () => {
    const seen = new Set<string>();
    const out = newMessagesSince(seen, [m('a', '1'), m('a', '1')]);
    expect(out).toHaveLength(1);
  });

  it('does not grow without bound', () => {
    // A long-lived subscription on a busy conversation would otherwise keep
    // every id it has ever seen for as long as the tab is open.
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      newMessagesSince(seen, [m(`m${String(i)}`, String(i))]);
    }
    expect(seen.size).toBeLessThanOrEqual(1000);
    // And the most recent is still remembered, so it is not re-emitted.
    expect(newMessagesSince(seen, [m('m4999', '4999')])).toEqual([]);
  });
});

describe('createTypingTracker', () => {
  it('is edge-triggered — a keystroke stream is one signal, not ten', () => {
    vi.useFakeTimers();
    const seen: Array<{ isTyping: boolean; displayName?: string }> = [];
    const tracker = createTypingTracker({ onChange: (s) => seen.push(s), stopAfterMs: 1_000 });
    const agent = { actorType: 'agent' as const, actorId: 'u1', displayName: 'Sarah' };
    tracker.start(agent);
    tracker.start(agent);
    tracker.start(agent);
    expect(seen).toEqual([
      { isTyping: true, actorType: 'agent', actorId: 'u1', displayName: 'Sarah' },
    ]);
    vi.useRealTimers();
  });

  it('hides the indicator on its own when no stop ever arrives', () => {
    /*
     * `typing.stop` is best-effort: an agent who closes the laptop
     * mid-sentence sends nothing. Without the timeout the consumer renders
     * "Sarah is typing…" forever.
     */
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const tracker = createTypingTracker({
      onChange: (s) => seen.push(s.isTyping),
      stopAfterMs: 1_000,
    });
    tracker.start({ actorType: 'agent', actorId: 'u1' });
    vi.advanceTimersByTime(999);
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(2);
    expect(seen).toEqual([true, false]);
    vi.useRealTimers();
  });

  it('each new start extends the window rather than restarting the UI', () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const tracker = createTypingTracker({
      onChange: (s) => seen.push(s.isTyping),
      stopAfterMs: 1_000,
    });
    const agent = { actorType: 'agent' as const, actorId: 'u1' };
    tracker.start(agent);
    vi.advanceTimersByTime(800);
    tracker.start(agent);
    vi.advanceTimersByTime(800);
    expect(seen).toEqual([true]);
    vi.useRealTimers();
  });

  it('names the agent it was showing when stopped with no actor', () => {
    // A `message.created` envelope says nothing about typing, so the caller
    // has no actor to pass — the signal must still name the right person.
    const seen: Array<{ displayName?: string; isTyping: boolean }> = [];
    const tracker = createTypingTracker({ onChange: (s) => seen.push(s) });
    tracker.start({ actorType: 'agent', actorId: 'u1', displayName: 'Sarah' });
    tracker.stop();
    expect(seen.map((s) => [s.displayName, s.isTyping])).toEqual([
      ['Sarah', true],
      ['Sarah', false],
    ]);
  });

  it('says nothing at all when stopped while already idle', () => {
    const seen: unknown[] = [];
    const tracker = createTypingTracker({ onChange: (s) => seen.push(s) });
    tracker.stop();
    tracker.stop({ actorType: 'agent', actorId: 'u1' });
    expect(seen).toEqual([]);
  });

  it('does not fire into an unmounting consumer on dispose', () => {
    vi.useFakeTimers();
    const seen: unknown[] = [];
    const tracker = createTypingTracker({
      onChange: (s) => seen.push(s),
      stopAfterMs: 1_000,
    });
    tracker.start({ actorType: 'agent', actorId: 'u1' });
    tracker.dispose();
    vi.advanceTimersByTime(5_000);
    expect(seen).toHaveLength(1);
    vi.useRealTimers();
  });
});
