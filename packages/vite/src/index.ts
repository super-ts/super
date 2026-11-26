import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { type Plugin, transformWithOxc } from 'vite';
import { compile } from '../../lang/src/compile.ts';
import { composeMap, type SourceMap } from '../../lang/src/source-map.ts';
import { writeVirtualFile } from '../../lang/src/virtual-files.ts';
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
  /** Dossier `src` de l'app (absolu, ou relatif au dossier courant). */
  src: string;
};

/**
 * Impose l'architecture Super : contrats et stores sous `src/@core/`, composants sous
 * `src/@components/`, des composants qui n'importent de `@core/` que des types, et un `@core/`
 * qui n'importe rien de `@super-ts/dom`. Un module
 * qui enfreint une règle n'est pas chargé : Vite affiche l'erreur (overlay en dev, échec du
 * build ou du test).
 *
 * Déclare aussi les alias `@core/…` et `@components/…`, résolus depuis `src`.
 */
export function superPlugin({ src }: SuperPluginOptions): Plugin {
  const root = resolve(src);
  const resolvedModule = `\0${CONTRACTS_MODULE}`;

  /** Réécrit le fichier de types s'il a changé (le comparer évite de relancer le typecheck de l'IDE). */
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

  /** En dev (`vite` serve), les composants se remplacent à chaud. */
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
        writeDeclaration(); // un contrat, le router ou le tag d'un écran (n'écrit que si le fichier change)
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
        // `.super` en plus des extensions par défaut de Vite : `@components/shop` trouve `shop/index.super`.
        extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.super'],
      },
    }),
    async transform(source, id) {
      const file = id.split('?')[0]!;
      let code = source;
      let map: SourceMap | null = null;
      // Un fichier `.super` est compilé en TS (gabarits lit), puis débarrassé de ses types.
      if (file.endsWith('.super')) {
        const compiled = compile(source);
        const [first] = compiled.diagnostics;
        if (first) {
          const before = source.slice(0, first.start).split('\n');
          this.error({ message: `[super] ${first.message}`, id: file, loc: { file, line: before.length, column: before.at(-1)!.length } });
        }
        const result = await transformWithOxc(compiled.code, `${file}.ts`, { lang: 'ts', sourcemap: true });
        code = result.code;
        // JS → TS compilé (oxc), puis TS compilé → `.super` (plages recopiées) : la map vers la source.
        map = result.map ? composeMap(file, source, compiled.code, compiled.copied, result.map.mappings) : null;
        // En dev, le TS virtuel suit aussi : les `.ts` qui importent ce composant en voient les types.
        if (serving) writeVirtualFile(file, source);
      }
      const path = relative(root, file);
      if (path.startsWith('..') || path.startsWith(sep)) return code === source ? null : { code, map };
      if (!isChecked(path) && !file.endsWith('.super')) return null;
      const relativePath = path.split(sep).join('/');
      const violation =
        checkModule(relativePath, code) ?? checkCoreImports(relativePath, code) ?? checkComponentImports(relativePath, code);
      if (violation) this.error(violation);
      // Un store retrouve son contrat par son nom : le registre doit être chargé avant lui.
      // Sur la même ligne, pour ne pas décaler les numéros de ligne.
      if (needsRegistry(relativePath, code)) return { code: `import '${CONTRACTS_MODULE}';${code}`, map: null };
      const hot = serving && relativePath.startsWith('@components/') ? hotModuleCode(code) : null;
      if (hot) return { code: code + hot, map };
      return code === source ? null : { code, map };
    },
  };
}
