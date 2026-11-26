<p align="center">
  <img src="https://raw.githubusercontent.com/super-ts/tree-sitter-super/main/assets/logo-light.svg" alt="Super." width="160" />
</p>

# @super-ts/testing

Test helpers for Super apps: mount, fakeStore, record, flush, cleanup.

```sh
npm i -D @super-ts/testing
```

```ts
import { flush, mount } from '@super-ts/testing';
import { ThemeStore } from '@core/theme/store';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { ThemeToggle } from './theme-toggle';

test('the button toggles the theme', async () => {
  const theme = ThemeStore.create();
  const { container } = await mount(ThemeToggle, { stores: [theme] });

  await userEvent.click(within(container).getByRole('button'));
  await flush();

  expect(theme.selectors.isDark()).toBe(true);
});
```

Call `cleanup()` after each test (for example in a Vitest setup file) to unmount what `mount()`
mounted.

The `@super-ts/*` packages share one version: install them at the same version. In 0.x, a minor
version can break the API.

Documentation: [super-ts.github.io/super](https://super-ts.github.io/super/). Source: [github.com/super-ts/super](https://github.com/super-ts/super). Licence: MIT.
