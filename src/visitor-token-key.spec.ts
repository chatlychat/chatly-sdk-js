// @vitest-environment jsdom
/**
 * The visitor-token storage key, and the migration off the legacy one.
 *
 * `chatly:vt:<publicId>` is canonical: it is what the widget writes
 * (`apps/widget/src/safe-storage.ts`) and the ONLY key the published storage
 * declaration names (`vendors[product=chatly].storage`, see the API's
 * `embed-manifest.ts`). This package wrote `livechat:vt:` until 2026-11-11.
 *
 * That cost two things neither visible from inside this package:
 *   1. this SDK and the widget on ONE page did not share a visitor, so a
 *      visitor who opened the widget and then hit a headless call was two
 *      different people;
 *   2. a consent manager fed the declared key blocked a key this package
 *      never wrote, while the key it DID write went undeclared.
 *
 * The old comment argued a rename would orphan every browser holding a
 * token. True, and answered by reading the legacy key once rather than by
 * keeping it for ever. ADR 0090.
 *
 * ── WHY THIS DRIVES THE MODULE AND NOT THE CLASS ──────────────────────────
 *
 * `Chatly`'s constructor and its `visitorToken` field are both private, so
 * the first version of this file reached through two `as unknown as` casts
 * and did not compile. Worse, its clearing test removed the keys ITSELF when
 * no private handle was exposed, which made the assertion a tautology that
 * would pass with `clearVisitorToken` deleted. Driving `visitor-token.ts`
 * directly tests the same logic through its real surface; one test at the
 * bottom still goes through `Chatly.init()` to prove the constructor is
 * wired to it, and asserts only on `localStorage`, which is public.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Chatly } from './index.js';
import { clearVisitorToken, readVisitorToken, writeVisitorToken } from './visitor-token.js';

const PUBLIC_ID = 'ch_web_9329d4aecd7b426cbc37e159';
const CANONICAL = `chatly:vt:${PUBLIC_ID}`;
const LEGACY = `livechat:vt:${PUBLIC_ID}`;

/**
 * Minimal localStorage, the same stub `index.spec.ts` installs and for the
 * same reason: this jsdom setup provides `window` but NOT
 * `window.localStorage`, because jsdom only enables storage for a document
 * with a real (non-opaque) origin, and the failure reads as "cannot read
 * properties of undefined" — which looks like a bug in the code under test
 * rather than in the environment.
 *
 * The spies below go on the INSTANCE, never on `Storage.prototype`: this
 * stub is a plain object and not an instance of jsdom's `Storage`, so a
 * prototype spy would install cleanly, intercept nothing, and leave every
 * assertion passing for the wrong reason.
 */
function installLocalStorage(): void {
  const data = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
  Object.defineProperty(globalThis.window, 'localStorage', { value: stub, configurable: true });
}

beforeEach(() => {
  vi.restoreAllMocks();
  installLocalStorage();
});

describe('which key is read', () => {
  it('reads the canonical key', () => {
    localStorage.setItem(CANONICAL, 'tok-canonical');
    expect(readVisitorToken(PUBLIC_ID)).toBe('tok-canonical');
  });

  it('adopts a legacy token, so an existing visitor is NOT signed out', () => {
    localStorage.setItem(LEGACY, 'tok-legacy');
    expect(readVisitorToken(PUBLIC_ID)).toBe('tok-legacy');
  });

  it('prefers the canonical key when a browser holds both', () => {
    localStorage.setItem(CANONICAL, 'tok-canonical');
    localStorage.setItem(LEGACY, 'tok-stale');
    expect(readVisitorToken(PUBLIC_ID)).toBe('tok-canonical');
    expect(localStorage.getItem(CANONICAL)).toBe('tok-canonical');
  });

  it('is null for a browser holding neither', () => {
    expect(readVisitorToken(PUBLIC_ID)).toBeNull();
  });
});

describe('the migration', () => {
  it('moves a legacy token forward, so the fallback is paid once', () => {
    localStorage.setItem(LEGACY, 'tok-legacy');
    readVisitorToken(PUBLIC_ID);
    expect(localStorage.getItem(CANONICAL)).toBe('tok-legacy');
    expect(localStorage.getItem(LEGACY)).toBeNull();
  });

  it('touches storage not at all when there is nothing to move', () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    const removeItem = vi.spyOn(localStorage, 'removeItem');
    expect(readVisitorToken(PUBLIC_ID)).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  /**
   * `getItem` succeeding does not mean `setItem` will: a full quota or a
   * private window refuses the write. Failing to migrate must leave the
   * visitor signed in on the old key, never throw out of the constructor.
   */
  it('keeps the visitor signed in when the migration write is refused', () => {
    localStorage.setItem(LEGACY, 'tok-legacy');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    let token: string | null = null;
    expect(() => {
      token = readVisitorToken(PUBLIC_ID);
    }).not.toThrow();
    expect(token).toBe('tok-legacy');
  });
});

describe('clearing', () => {
  /**
   * The bug a one-key clear would introduce: the canonical key is removed,
   * the next read falls back to the legacy key, and the token just killed —
   * on the stale-session path, the one the SERVER refused — is signed
   * straight back in. Deleting the legacy `removeItem` from
   * `clearVisitorToken` fails both assertions below.
   */
  it('removes BOTH keys, so nothing resurrects', () => {
    localStorage.setItem(CANONICAL, 'dead');
    localStorage.setItem(LEGACY, 'older-dead');
    clearVisitorToken(PUBLIC_ID);
    expect(localStorage.getItem(CANONICAL)).toBeNull();
    expect(localStorage.getItem(LEGACY)).toBeNull();
    expect(readVisitorToken(PUBLIC_ID)).toBeNull();
  });
});

describe('what is written', () => {
  it('writes the canonical key and never the legacy one', () => {
    writeVisitorToken(PUBLIC_ID, 'fresh');
    expect(localStorage.getItem(CANONICAL)).toBe('fresh');
    expect(localStorage.getItem(LEGACY)).toBeNull();
  });

  it('migrating writes the canonical key and never the legacy one', () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    localStorage.setItem(LEGACY, 'tok-legacy');
    setItem.mockClear();
    readVisitorToken(PUBLIC_ID);
    const keysWritten = setItem.mock.calls.map((c) => String(c[0]));
    expect(keysWritten).not.toContain(LEGACY);
    expect(keysWritten).toContain(CANONICAL);
  });
});

describe('the class is wired to it', () => {
  /**
   * Asserts on `localStorage` only — `visitorToken` is private, and the
   * point here is the wiring rather than the logic, which the module tests
   * above already cover. Replacing `readVisitorToken` in the constructor
   * with a bare canonical `getItem` leaves the legacy key in place and fails
   * this.
   */
  it('Chatly.init() migrates a legacy token on construction', () => {
    localStorage.setItem(LEGACY, 'tok-legacy');
    Chatly.init({ publicId: PUBLIC_ID, apiUrl: 'https://api.test' });
    expect(localStorage.getItem(CANONICAL)).toBe('tok-legacy');
    expect(localStorage.getItem(LEGACY)).toBeNull();
  });
});
