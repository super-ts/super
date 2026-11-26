<p align="center">
  <img src="https://raw.githubusercontent.com/super-ts/tree-sitter-super/main/assets/logo-light.svg" alt="Super." width="160" />
</p>

# @super-ts/language-server

Language server for Super .super files (errors, completion, hover, definitions, formatting), built on Volar and TypeScript 6.

```sh
npm i -D @super-ts/language-server
```

```sh
super-language-server --stdio
```

Point any LSP-capable editor at this command for `.super` files. The Zed extension of Super installs
this package by itself, at the version of `@super-ts/lang` in your project.

The `@super-ts/*` packages share one version: install them at the same version. In 0.x, a minor
version can break the API.

Documentation: [github.com/super-ts/super](https://github.com/super-ts/super#readme). Licence: MIT.
