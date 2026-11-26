import { defineConfig } from 'vitest/config';
import { alias, plugins } from './vite.config.ts';

export default defineConfig({
  resolve: { alias },
  plugins,
  test: {
    environment: 'happy-dom',
    // Node >= 25 exposes a native localStorage that hides happy-dom's.
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // The kit's theme examples display their own CSS (`?raw`): Vitest must read it.
    css: { include: [/kit-theme\.css/, /kit\/theme-[a-z]+\.css/] },
    include: ['packages/**/*.test.ts', 'examples/**/*.test.ts'],
  },
});
