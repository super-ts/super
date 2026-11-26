import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { superPlugin } from './packages/vite/src/index.ts';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const alias = {
  // Avant `@super-ts/core` : le premier alias qui correspond l'emporte.
  '@super-ts/core/internal': fromRoot('./packages/core/src/internal.ts'),
  '@super-ts/core': fromRoot('./packages/core/src/index.ts'),
  '@super-ts/dom/internal': fromRoot('./packages/dom/src/internal.ts'),
  '@super-ts/dom': fromRoot('./packages/dom/src/index.ts'),
  '@super-ts/testing': fromRoot('./packages/testing/src/index.ts'),
  '@super-ts/ui': fromRoot('./packages/ui/src/index.ts'),
  '@super-ts/vite': fromRoot('./packages/vite/src/index.ts'),
  '@super-ts/lang': fromRoot('./packages/lang/src/index.ts'),
};

/** Impose @core/ et @components/ dans le src de l'app d'exemples. */
export const plugins = [superPlugin({ src: fromRoot('./examples/demo/src') })];

// `npm run dev` sert l'app d'exemples (compteurs, formulaire).
export default defineConfig({
  root: fromRoot('./examples/demo'),
  resolve: { alias },
  plugins,
});
