import { compile, composeMap, type SourceMap, writeVirtualFile } from '@super-ts/lang';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { type Plugin, transformWithOxc } from 'vite';
import { ALIASES, checkComponentImports, checkCoreImports, checkModule, isChecked } from './architecture.ts';
import {
  CONTRACTS_DECLARATION,
  CONTRACTS_MODULE,
  contractsDeclaration,
  contractsModule,
  hotModuleCode,
  needsRegistry,
  scanContracts,
  scanRouter,
  scanScreenRoutes,
} from './contracts.ts';

export { ALIASES, checkComponentImports, checkCoreImports, checkModule, RULES } from './architecture.ts';
export {
  contractsDeclaration,
  contractsIn,
  contractsModule,
  hotModuleCode,
  scanContracts,
  scanRouter,
  scanScreenRoutes,
} from './contracts.ts';

export type SuperPluginOptions = {
  /** The app's `src` folder (absolute, or relative to the current folder). */
  src: string;
};

/**
 * Enforces the Super architecture: contracts and stores under `src/@core/`, components under
 * `src/@components/`, components that import only types from `@core/`, and a `@core/`
 * that imports nothing from `@super-ts/dom`. A module
 * that breaks a rule is not loaded: Vite shows the error (overlay in dev, failure of the
 * build or the test).
 *
 * Also declares the `@core/…` and `@components/…` aliases, resolved from `src`.
 */
export function superPlugin({ src }: SuperPluginOptions): Plugin {
  const root = resolve(src);
  const resolvedModule = `\0${CONTRACTS_MODULE}`;

  /** Rewrites the types file if it has changed (comparing it avoids re-running the IDE's type check). */
  const writeDeclaration = () => {
    const path = join(root, CONTRACTS_DECLARATION);
    const router = scanRouter(root);
    const next = contractsDeclaration(scanContracts(root), router, scanScreenRoutes(root, router));
    let current: string | null = null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {}
    if (current !== next) writeFileSync(path, next);
  };

  /** In dev (`vite` serve), components are hot-replaced. */
  let serving = false;

  return {
    name: 'super:architecture',
    enforce: 'pre',
    configResolved(config) {
      serving = config.command === 'serve' && config.mode !== 'test';
    },
    buildStart() {
      writeDeclaration();
    },
    configureServer(server) {
      server.watcher.on('all', (_event, file) => {
        if (!/\.(ts|super)$/.test(file) || !file.startsWith(root)) return;
        writeDeclaration(); // a contract, the router or a screen's tag (only writes if the file changes)
        const virtual = server.moduleGraph.getModuleById(resolvedModule);
        if (virtual) server.moduleGraph.invalidateModule(virtual);
      });
    },
    resolveId(id) {
      return id === CONTRACTS_MODULE ? resolvedModule : null;
    },
    load(id) {
      return id === resolvedModule ? contractsModule(root, scanContracts(root)) : null;
    },
    config: () => ({
      resolve: {
        alias: ALIASES.map((name) => ({ find: new RegExp(`^${name}/`), replacement: `${join(root, name)}/` })),
        // `.super` on top of Vite's default extensions: `@components/shop` finds `shop/index.super`.
        extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.super'],
      },
    }),
    async transform(source, id) {
      const file = id.split('?')[0]!;
      let code = source;
      let map: SourceMap | null = null;
      // A `.super` file is compiled to TS (lit templates), then stripped of its types.
      if (file.endsWith('.super')) {
        const compiled = compile(source);
        const [first] = compiled.diagnostics;
        if (first) {
          const before = source.slice(0, first.start).split('\n');
          this.error({ message: `[super] ${first.message}`, id: file, loc: { file, line: before.length, column: before.at(-1)!.length } });
        }
        const result = await transformWithOxc(compiled.code, `${file}.ts`, { lang: 'ts', sourcemap: true });
        code = result.code;
        // JS → compiled TS (oxc), then compiled TS → `.super` (copied ranges): the map to the source.
        map = result.map ? composeMap(file, source, compiled.code, compiled.copied, result.map.mappings) : null;
        // In dev, the virtual TypeScript follows too: the `.ts` files that import this component see its types.
        if (serving) writeVirtualFile(file, source);
      }
      const path = relative(root, file);
      if (path.startsWith('..') || path.startsWith(sep)) return code === source ? null : { code, map };
      if (!isChecked(path) && !file.endsWith('.super')) return null;
      const relativePath = path.split(sep).join('/');
      const violation =
        checkModule(relativePath, code) ?? checkCoreImports(relativePath, code) ?? checkComponentImports(relativePath, code);
      if (violation) this.error(violation);
      // A store finds its contract by name: the registry must be loaded before it.
      // On the same line, so as not to shift the line numbers.
      if (needsRegistry(relativePath, code)) return { code: `import '${CONTRACTS_MODULE}';${code}`, map: null };
      const hot = serving && relativePath.startsWith('@components/') ? hotModuleCode(code) : null;
      if (hot) return { code: code + hot, map };
      return code === source ? null : { code, map };
    },
  };
}
