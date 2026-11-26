<p align="center">
  <img src="https://raw.githubusercontent.com/super-ts/tree-sitter-super/main/assets/logo-light.svg" alt="Super." width="160" />
</p>

# @super-ts/core

Typed contracts, selectors and stores for Super. No DOM dependency.

```sh
npm i @super-ts/core
```

A contract declares what a store keeps, what it can be asked and what it announces; the store
implements it. Components and tests talk to the store through its contract only.

```ts
import { type Commands, SuperContract, SuperStore } from '@super-ts/core';

type ThemeState = { mode: 'light' | 'dark' };

export class ThemeContract extends SuperContract<{
  state: ThemeState;
  commands: { toggle(): void };
  events: { changed: { mode: 'light' | 'dark' } };
}> {
  constructor() {
    super({ name: 'theme' });
  }
  isDark(s: ThemeState) {
    return s.mode === 'dark';
  }
}

export class ThemeStore extends SuperStore<ThemeContract> implements Commands<ThemeStore> {
  constructor() {
    super({ contract: 'theme', initialState: { mode: 'light' } });
  }
  toggle() {
    const mode = this.selectors.isDark() ? 'light' : 'dark';
    this.set({ mode });
    this.emit('changed', { mode });
  }
}
```

The `@super-ts/*` packages share one version: install them at the same version. In 0.x, a minor
version can break the API.

Documentation: [github.com/super-ts/super](https://github.com/super-ts/super#readme). Licence: MIT.
