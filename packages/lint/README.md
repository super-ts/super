<p align="center">
  <img src="https://raw.githubusercontent.com/super-ts/tree-sitter-super/main/assets/logo-light.svg" alt="Super." width="160" />
</p>

# @super-ts/lint

Shared Biome configuration for Super apps (import order).

```sh
npm i -D @super-ts/lint @biomejs/biome
```

```json
{
  "extends": ["@super-ts/lint/config.json"]
}
```

It orders imports: `@super-ts/*` first, then the app's `@components/` and `@core/` aliases, then the
other packages and relative imports.

The `@super-ts/*` packages share one version: install them at the same version. In 0.x, a minor
version can break the API.

Documentation: [github.com/super-ts/super](https://github.com/super-ts/super#readme). Licence: MIT.
