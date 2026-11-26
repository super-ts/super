<p align="center">
  <img src="https://raw.githubusercontent.com/super-ts/tree-sitter-super/main/assets/logo-light.svg" alt="Super." width="160" />
</p>

# @super-ts/lang

The .super template language: parser, compiler to lit-html, virtual TypeScript and the super-tsc type checker.

```sh
npm i -D @super-ts/lang typescript
```

Two commands:

```sh
npx super-tsc tsconfig.json   # type-checks .ts and .super files, errors reported on the .super source
npx super-fmt --write src     # formats .super files (the TypeScript part through your Biome)
```

`super-tsc` writes the virtual TypeScript of each `.super` file under `.super/` next to the tsconfig,
runs TypeScript 7, and maps every error back to its position in the `.super` file. The Vite plugin
([`@super-ts/vite`](https://www.npmjs.com/package/@super-ts/vite)) uses the compiler of this package.

The `@super-ts/*` packages share one version: install them at the same version. In 0.x, a minor
version can break the API.

Documentation: [super-ts.github.io/super](https://super-ts.github.io/super/). Source: [github.com/super-ts/super](https://github.com/super-ts/super). Licence: MIT.
