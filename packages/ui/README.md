<p align="center">
  <img src="https://raw.githubusercontent.com/super-ts/tree-sitter-super/main/assets/logo-light.svg" alt="Super." width="160" />
</p>

# @super-ts/ui

The Super UI kit: form-bound fields, CommandButton, RouteLink, dialogs, menus, toasts, table.

```sh
npm i @super-ts/ui
```

Accessible components with a plain look set by `--super-*` CSS variables, in a `super-ui` CSS layer
that any rule of your app overrides. Importing a component loads the kit stylesheet.

```ts
import { Button } from '@super-ts/ui';
```

```super
<Button variant="secondary" on:press={() => this.theme.send('toggle')}>Toggle</Button>
```

The `@super-ts/*` packages share one version: install them at the same version. In 0.x, a minor
version can break the API.

Documentation: [super-ts.github.io/super](https://super-ts.github.io/super/). Source: [github.com/super-ts/super](https://github.com/super-ts/super). Licence: MIT.
