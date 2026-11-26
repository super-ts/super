<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/logo-dark.svg" />
    <img src="../../assets/logo-light.svg" alt="Super." width="140" />
  </picture>
</p>

# Zed extension for `.super` files

Declares the "Super" language (`.super` files) and starts its language server
(`packages/lang-server`): errors, completion, hover, definition, formatting.

`.super` files have their own language: vtsls (Zed's TypeScript server) no longer sees them, and
no absolute path is needed (the server is looked up in the open project, Node on its
PATH).

## Installing

1. Rust, through rustup (Zed compiles the extension with it):

   ```sh
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

   Then restart Zed so it finds `cargo`.

2. In Zed: command palette, `zed: install dev extension`, then pick this folder
   (`editors/zed`). Zed compiles the extension and the grammar (the first time, allow a minute).

3. An open `.super` file shows "Super" at the bottom right of Zed. After changing the
   extension: *Rebuild* in the extensions panel.

## What is left to do

- **Grammar**: `editors/tree-sitter-super`, compiled by Zed from its public repository
  ([super-ts/tree-sitter-super](https://github.com/super-ts/tree-sitter-super)), at the `rev` in
  `extension.toml`. After changing the grammar: push it there, update `rev`,
  then reinstall the extension (`zed: install dev extension`).
- **"Go to definition" from a `.ts` file** to a `.super` component needs nothing from the
  extension: vtsls follows the source map of the component's declaration (`.super/types/`).

## Settings

The server binary can be forced, as for any Zed server:

```json
{ "lsp": { "super-language-server": { "binary": { "path": "node", "arguments": ["…/server.ts", "--stdio"] } } } }
```
