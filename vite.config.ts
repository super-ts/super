import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { superPlugin } from './packages/vite/src/index.ts';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const alias = {
  // Before `@super-ts/core`: the first matching alias wins.
  '@super-ts/core/internal': fromRoot('./packages/core/src/internal.ts'),
  '@super-ts/core': fromRoot('./packages/core/src/index.ts'),
  '@super-ts/dom/internal': fromRoot('./packages/dom/src/internal.ts'),
  '@super-ts/dom': fromRoot('./packages/dom/src/index.ts'),
  '@super-ts/testing': fromRoot('./packages/testing/src/index.ts'),
  '@super-ts/ui': fromRoot('./packages/ui/src/index.ts'),
  '@super-ts/vite': fromRoot('./packages/vite/src/index.ts'),
  '@super-ts/lang': fromRoot('./packages/lang/src/index.ts'),
};

/** Enforces @core/ and @components/ in the demo app's src. */
export const plugins = [superPlugin({ src: fromRoot('./examples/demo/src') })];

// `npm run dev` serves the demo app (counters, form).
export default defineConfig({
  root: fromRoot('./examples/demo'),
  resolve: { alias },
  plugins,
});
