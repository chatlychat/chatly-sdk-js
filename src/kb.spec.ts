/**
 * The two knowledge-base reads a HOST PAGE can perform.
 *
 * The widget has been able to search and open articles since the article
 * chunk shipped (`client-kb.ts:37`). A host page could not, and that is the
 * gap a competitive sweep on 2026-10-27 found Crisp, Help Scout's Beacon and
 * HubSpot all closing with a programmatic search.
 *
 * These assert on what the SDK SENDS, not on what the stub answers — a stub
 * that echoes whatever it was asked for agrees with a wrong request, which is
 * how four mobile SDKs shipped unable to connect at all with green suites.
 * So: the route, the credential, and that an absent option is ABSENT from the
 * body rather than present as `undefined` (the API's zod schemas treat a
 * declared-but-undefined `locale` differently from an omitted one — absent
 * means "no locale context", which is what an older widget sends and must
 * keep getting).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Chatly } from './index.js';

interface Call {
  url: string;
  body: Record<string, unknown>;
}

const calls: Call[] = [];

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

let answer: unknown = {};

beforeEach(() => {
  calls.length = 0;
  installLocalStorage();
  answer = { session: { token: 'vt_abc' } };
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    const raw = (init as RequestInit | undefined)?.body;
    calls.push({
      url: String(url),
      body: typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : {},
    });
    return { ok: true, status: 200, json: async () => answer } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

const sdk = () => Chatly.init({ publicId: 'pub_1', apiUrl: 'https://api.test' });
/** The KB call is the last one; the first is the session mint. */
const kbCall = (): Call => calls[calls.length - 1] as Call;

describe('searchArticles', () => {
  it('posts the query to the widget kb search route with the visitor token', async () => {
    answer = { session: { token: 'vt_abc' }, results: [] };
    await sdk().searchArticles('refund policy');
    expect(kbCall().url).toBe('https://api.test/v1/widget/kb/search');
    expect(kbCall().body).toEqual({
      publicId: 'pub_1',
      visitorToken: 'vt_abc',
      query: 'refund policy',
    });
  });

  it('omits limit, locale and profile entirely when not given', async () => {
    // Not `locale: undefined`. An absent locale means "no filter" server-side;
    // JSON.stringify drops an undefined value, but asserting the KEYS is what
    // stops somebody "tidying" these into unconditional properties.
    answer = { session: { token: 'vt_abc' }, results: [] };
    await sdk().searchArticles('x');
    expect(Object.keys(kbCall().body).sort()).toEqual(['publicId', 'query', 'visitorToken']);
  });

  it('passes limit, locale and profile through when given', async () => {
    answer = { session: { token: 'vt_abc' }, results: [] };
    await sdk().searchArticles('x', { limit: 3, locale: 'de-DE', profile: 'vip' });
    expect(kbCall().body).toMatchObject({ limit: 3, locale: 'de-DE', profile: 'vip' });
  });

  it('reads an absent results array as no hits rather than undefined', async () => {
    // An older API, or a 200 with an unexpected shape, must not hand the
    // integrator something they cannot `.map` over.
    answer = { session: { token: 'vt_abc' } };
    await expect(sdk().searchArticles('x')).resolves.toEqual([]);
  });

  it('returns the hits verbatim', async () => {
    const hit = { id: 'a', slug: 's', title: 'T', excerpt: 'e', sourceUrl: null };
    answer = { session: { token: 'vt_abc' }, results: [hit] };
    await expect(sdk().searchArticles('x')).resolves.toEqual([hit]);
  });
});

describe('article', () => {
  it('posts the slug to the widget kb article route', async () => {
    answer = { session: { token: 'vt_abc' }, article: { slug: 's' } };
    await sdk().article('refunds');
    expect(kbCall().url).toBe('https://api.test/v1/widget/kb/article');
    expect(kbCall().body).toEqual({
      publicId: 'pub_1',
      visitorToken: 'vt_abc',
      slug: 'refunds',
    });
  });

  it('omits profile when not given', async () => {
    answer = { session: { token: 'vt_abc' }, article: { slug: 's' } };
    await sdk().article('refunds');
    expect(Object.keys(kbCall().body).sort()).toEqual(['publicId', 'slug', 'visitorToken']);
  });

  it('unwraps the article rather than returning the envelope', async () => {
    const article = {
      id: 'a',
      slug: 's',
      title: 'T',
      body: '# T',
      bodyHtml: '<h1>T</h1>',
      updatedAt: '2026-10-27T00:00:00.000Z',
      sourceUrl: null,
    };
    answer = { session: { token: 'vt_abc' }, article };
    await expect(sdk().article('s')).resolves.toEqual(article);
  });

  it('rejects on a 404 instead of resolving to null', async () => {
    // The route answers 404 for missing, unpublished AND out-of-scope alike,
    // so there is no "exists but not for you" to represent as a null.
    installLocalStorage();
    globalThis.fetch = vi.fn(async (url: unknown) =>
      String(url).includes('kb/article')
        ? ({
            ok: false,
            status: 404,
            json: async () => ({}),
            text: async () => '',
          } as unknown as Response)
        : ({
            ok: true,
            status: 200,
            json: async () => ({ session: { token: 'vt' } }),
          } as unknown as Response),
    ) as unknown as typeof fetch;
    await expect(sdk().article('nope')).rejects.toThrow();
  });
});
