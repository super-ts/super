import { defineConfig } from 'vitest/config';
import { alias, plugins } from './vite.config.ts';

export default defineConfig({
  resolve: { alias },
  plugins,
  test: {
    environment: 'happy-dom',
    // Node >= 25 expose un localStorage natif qui masque celui de happy-dom.
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Les exemples de thème du kit affichent leur propre CSS (`?raw`) : Vitest doit le lire.
    css: { include: [/kit-theme\.css/, /kit\/theme-[a-z]+\.css/] },
    include: ['packages/**/*.test.ts', 'examples/**/*.test.ts'],
  },
});
