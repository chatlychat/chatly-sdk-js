import { defineConfig } from 'vitest/config';

const vitestExecution = { pool: 'threads' as const };

export default defineConfig({
  test: {
    // Worker THREADS, not forked processes. See @livechat/config/vitest.
    ...vitestExecution,
    environment: 'jsdom',
    // jsdom defaults to `about:blank`, an OPAQUE origin — and `localStorage`
    // is unavailable there, so anything touching it fails with an unhelpful
    // "cannot read properties of undefined". A real URL gives the document a
    // storage origin.
    environmentOptions: { jsdom: { url: 'https://embedder.test/' } },
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
