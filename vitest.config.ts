import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
