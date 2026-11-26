<p align="center">
  <img src="https://raw.githubusercontent.com/super-ts/tree-sitter-super/main/assets/logo-light.svg" alt="Super." width="160" />
</p>

# @super-ts/vite

Vite plugin for Super: compiles .super files, enforces the architecture rules, generates the contracts registry.

```sh
npm i -D @super-ts/vite @super-ts/lang
```

```ts
// vite.config.ts
import { superPlugin } from '@super-ts/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [superPlugin({ src: 'src' })],
});
```

The plugin declares the `@core/` and `@components/` aliases (resolved from `src`), compiles `.super`
files, refuses imports that break the architecture rules, and writes `src/@core/contracts.d.ts`, the
typed registry of your contracts (commit it). Vitest goes through the same plugin.

The `@super-ts/*` packages share one version: install them at the same version. In 0.x, a minor
version can break the API.

Documentation: [super-ts.github.io/super](https://super-ts.github.io/super/). Source: [github.com/super-ts/super](https://github.com/super-ts/super). Licence: MIT.
