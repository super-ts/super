<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/logo-dark.svg" />
    <img src="../../assets/logo-light.svg" alt="Super." width="140" />
  </picture>
</p>

# Zed extension for `.super` files

Extension id: `super-lang`. Declares the "Super" language (`.super` files) and starts its language
server, [`@super-ts/language-server`](../../packages/lang-server): errors, completion, hover,
definition, formatting.

`.super` files have their own language: vtsls (Zed's TypeScript server) no longer sees them.

## How the server is found

1. A binary set in the settings (`lsp.super-language-server.binary`) takes precedence.
2. Otherwise the extension reads the version of `@super-ts/lang` in the open project
   (`node_modules/@super-ts/lang/package.json`) and installs `@super-ts/language-server` at that
   version from npm, so the editor and the compiler agree. A project without Super gets the latest
   version.
3. The server (`dist/server.js`) runs with Zed's Node.

In the Super repository, `.zed/settings.json` sets the binary to run the server from its sources
(`packages/lang-server/src/server.ts`, with the Node on the PATH), so a change to the server only
needs `editor: restart language server`.

## Installing from this folder

1. Rust, through rustup (Zed compiles the extension with it):

   ```sh
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

   Then restart Zed so it finds `cargo`.

2. In Zed: command palette, `zed: install dev extension`, then pick this folder
   (`editors/zed`). Zed compiles the extension and the grammar (the first time, allow a minute).
   If an earlier version of the extension was installed under the id `super`, uninstall it first.

3. An open `.super` file shows "Super" at the bottom right of Zed. After changing the
   extension: *Rebuild* in the extensions panel.

## Grammar

`editors/tree-sitter-super`, compiled by Zed from its public repository
([super-ts/tree-sitter-super](https://github.com/super-ts/tree-sitter-super)), at the `rev` in
`extension.toml`. After changing the grammar: push it there, update `rev`, then reinstall the
extension (`zed: install dev extension`).

"Go to definition" from a `.ts` file to a `.super` component needs nothing from the extension:
vtsls follows the source map of the component's declaration (`.super/types/`).

## Settings

The server binary can be forced, as for any Zed server:

```json
{ "lsp": { "super-language-server": { "binary": { "path": "node", "arguments": ["…/server.js", "--stdio"] } } } }
```
