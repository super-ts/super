<p align="center">
  <img src="https://raw.githubusercontent.com/super-ts/tree-sitter-super/main/assets/logo-light.svg" alt="Super." width="160" />
</p>

# @super-ts/dom

Super components (SuperElement), rendering, createApp and the typed router.

```sh
npm i @super-ts/dom
```

Components are custom elements written in `.super` files (compiled by
[`@super-ts/vite`](https://www.npmjs.com/package/@super-ts/vite)). `createApp` provides the stores
to the components, which ask for them by contract name.

```super
// src/@components/shared/theme-toggle.super
import { SuperElement } from '@super-ts/dom';

export class ThemeToggle extends SuperElement {
  @tag = 'theme-toggle';

  @contract theme;
  @selector isDark = this.theme.selectors.isDark;

  render() {
    <button type="button" on:click={() => this.theme.send('toggle')}>
      {this.isDark.value ? 'Switch to light mode' : 'Switch to dark mode'}
    </button>
  }
}
```

```ts
// src/main.ts
import { createApp } from '@super-ts/dom';
import { ThemeToggle } from '@components/shared/theme-toggle';
import { ThemeStore } from '@core/theme/store';

createApp({ root: document.querySelector<HTMLElement>('#app')!, stores: [ThemeStore.create()] }).mount(ThemeToggle.create());
```

The `@super-ts/*` packages share one version: install them at the same version. In 0.x, a minor
version can break the API.

Documentation: [github.com/super-ts/super](https://github.com/super-ts/super#readme). Licence: MIT.
