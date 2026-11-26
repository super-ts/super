import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** Module virtuel qui inscrit les contrats de l'app dans le registre de Super. */
export const CONTRACTS_MODULE = 'virtual:super/contracts';
/** Fichier de types généré : le dictionnaire nom → classe de contrat, pour le compilateur. */
export const CONTRACTS_DECLARATION = '@core/contracts.d.ts';

export type ContractEntry = {
  /** Chemin relatif au `src`, avec des `/` : `@core/cart.contract.ts`. */
  file: string;
  className: string;
  name: string;
};

const CLASS = /export\s+class\s+(\w+)\s+extends\s+SuperContract\b/g;
const NAME = /super\(\s*\{\s*name:\s*['"]([^'"]+)['"]/;

/** Les contrats déclarés dans un module : `export class X extends SuperContract`, nommés par `super({ name })`. */
export function contractsIn(file: string, code: string): ContractEntry[] {
  const matches = [...code.matchAll(CLASS)];
  return matches.map((match, i) => {
    const body = code.slice(match.index, matches[i + 1]?.index ?? code.length);
    const name = NAME.exec(body)?.[1];
    if (!name) {
      throw new Error(`[super] src/${file} : ${match[1]} doit se nommer dans son constructeur, par super({ name: '…' })`);
    }
    return { file, className: match[1]!, name };
  });
}

/** Un fichier de contrat : `cart/contract.ts` (un dossier par contrat), ou `cart.contract.ts`. */
export const isContractFile = (path: string) => /(^|[\\/])contract\.ts$|\.contract\.ts$/.test(path);

/** Tous les contrats de `src/@core/`, triés par nom. Un nom en double est une erreur. */
export function scanContracts(root: string): ContractEntry[] {
  const dir = join(root, '@core');
  let files: string[];
  try {
    files = readdirSync(dir, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  const entries = files
    .filter(isContractFile)
    .flatMap((file) => {
      const path = relative(root, join(dir, file)).split(sep).join('/');
      return contractsIn(path, readFileSync(join(dir, file), 'utf8'));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Map<string, ContractEntry>();
  for (const entry of entries) {
    const other = seen.get(entry.name);
    if (other) {
      throw new Error(
        `[super] deux contrats nommés "${entry.name}" : ${other.className} (src/${other.file}) et ${entry.className} (src/${entry.file})`,
      );
    }
    seen.set(entry.name, entry);
  }
  return entries;
}

/** Le router de l'app : `export const Router = defineRouter(…)`, quelque part dans `src`. */
export type RouterEntry = { file: string; exportName: string };

const ROUTER = /export\s+const\s+(\w+)\s*=\s*defineRouter\b/;

/** Le router déclaré dans `src` (hors tests), s'il y en a un. Deux déclarations sont une erreur. */
export function scanRouter(root: string): RouterEntry | null {
  let files: string[];
  try {
    files = readdirSync(root, { recursive: true, encoding: 'utf8' });
  } catch {
    return null;
  }
  const found: RouterEntry[] = [];
  for (const file of files) {
    if (!/\.ts$/.test(file) || /\.(test|test-d|d)\.ts$/.test(file) || file.split(sep).includes('node_modules')) continue;
    const match = ROUTER.exec(readFileSync(join(root, file), 'utf8'));
    if (match) found.push({ file: file.split(sep).join('/'), exportName: match[1]! });
  }
  if (found.length > 1) {
    throw new Error(`[super] plusieurs routers déclarés avec defineRouter : ${found.map((r) => `src/${r.file}`).join(', ')}`);
  }
  return found[0] ?? null;
}

/** Le module virtuel : chaque contrat est inscrit sous son nom, chargé à la demande. */
export function contractsModule(root: string, entries: ContractEntry[]): string {
  const lines = ["import { registerContract } from '@super-ts/core/internal';"];
  entries.forEach((entry, i) => lines.push(`import * as m${i} from ${JSON.stringify(join(root, entry.file))};`));
  entries.forEach((entry, i) => lines.push(`registerContract(${JSON.stringify(entry.name)}, () => m${i}.${entry.className});`));
  return `${lines.join('\n')}\n`;
}

/** Le tag de chaque écran → les routes où il s'affiche : `{ 'counter-screen': ['counter'] }`. */
export type ScreenRoutes = Record<string, string[]>;

const SCREENS = /\.screens\(\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)\s*\)/;
const SCREEN_ENTRY = /(?:^|[,{\s])(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*([A-Za-z_$][\w$]*)\s*(?=,|$)/g;
const IMPORT = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** Trouve le fichier d'un import : alias `@components/…` et `@core/…`, ou chemin relatif. */
function resolveImport(root: string, from: string, specifier: string): string | null {
  const base = /^@(components|core)\//.test(specifier)
    ? join(root, specifier)
    : specifier.startsWith('.')
      ? join(dirname(from), specifier)
      : null;
  if (!base) return null;
  const candidates = [`${base}.super`, `${base}.ts`, join(base, 'index.super'), join(base, 'index.ts'), base];
  return candidates.find((file) => existsSync(file) && !file.endsWith(sep)) ?? null;
}

/** Le tag d'une classe de composant dans un module : `@tag = '…'` (`.super`) ou `static tag = '…'` (`.ts`), après `class X extends SuperElement`. */
function tagOf(code: string, className: string): string | null {
  const start = new RegExp(`\\bclass\\s+${className}\\s+extends\\s+SuperElement\\b`).exec(code);
  if (!start) return null;
  const rest = code.slice(start.index + start[0].length);
  const next = /\bclass\s+\w+/.exec(rest);
  return /(?:@|\bstatic\s+)tag\s*=\s*(['"])([^'"]+)\1/.exec(next ? rest.slice(0, next.index) : rest)?.[2] ?? null;
}

/**
 * Le lien écran → route, lu dans `.screens(() => ({ counter: CounterScreen, … }))` : chaque écran
 * est retrouvé par son import, puis par son tag (`@tag` ou `static tag`). Les redirections et les écrans `'*'` et
 * `'!'` n'en font pas partie. Un écran introuvable est simplement ignoré (il verra toutes les routes).
 */
export function scanScreenRoutes(root: string, router: RouterEntry | null): ScreenRoutes {
  if (!router) return {};
  const file = join(root, router.file);
  const code = readFileSync(file, 'utf8');
  const screens = SCREENS.exec(code)?.[1];
  if (!screens) return {};
  const imports = new Map<string, { name: string; specifier: string }>();
  for (const [, names, specifier] of code.matchAll(IMPORT)) {
    for (const entry of names!.split(',')) {
      const [name, alias] = entry.trim().split(/\s+as\s+/);
      if (name) imports.set(alias ?? name, { name, specifier: specifier! });
    }
  }
  const routes: ScreenRoutes = {};
  for (const match of screens.matchAll(SCREEN_ENTRY)) {
    const route = match[1] ?? match[2] ?? match[3]!;
    const local = match[4]!;
    if (route === '*' || route === '!') continue;
    const imported = imports.get(local);
    const module = imported ? resolveImport(root, file, imported.specifier) : file;
    if (!module) continue;
    const tag = tagOf(readFileSync(module, 'utf8'), imported?.name ?? local);
    if (!tag) continue;
    (routes[tag] ??= []).push(route);
  }
  return routes;
}

/**
 * Le fichier de types, placé dans `src/@core/` : chemins relatifs à ce dossier. Le router de l'app,
 * s'il y en a un, y est inscrit sous le nom `'router'`, et chaque écran y est relié à sa route.
 */
export function contractsDeclaration(entries: ContractEntry[], router: RouterEntry | null = null, screens: ScreenRoutes = {}): string {
  if (router && entries.some((entry) => entry.name === 'router')) {
    throw new Error('[super] le nom de contrat "router" est réservé au router de l\'app');
  }
  const imports = entries.map(
    (entry) => `import type { ${entry.className} } from './${entry.file.replace(/^@core\//, '').replace(/\.ts$/, '')}';`,
  );
  // Même style que le formateur du dépôt : clé nue si c'est un identifiant, guillemets simples sinon.
  const key = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`);
  const fields = entries.map((entry) => `    ${key(entry.name)}: ${entry.className};`);
  if (router) {
    imports.unshift("import type { AppRouterContractOf } from '@super-ts/dom';");
    // Ordre du formateur : paquets, puis dossiers parents, puis le dossier courant.
    imports.splice(1, 0, `import type { ${router.exportName} } from '../${router.file.replace(/\.ts$/, '')}';`);
    fields.push(`    router: AppRouterContractOf<typeof ${router.exportName}>;`);
  }
  const tags = Object.keys(screens).sort();
  const screenBlock = tags.length
    ? [
        '',
        "declare module '@super-ts/dom' {",
        '  interface ScreenRoutes {',
        ...tags.map((tag) => `    ${key(tag)}: ${screens[tag]!.map((route) => `'${route}'`).join(' | ')};`),
        '  }',
        '}',
      ]
    : [];
  return [
    '// Généré par le plugin Vite de Super depuis les contrats de src/@core/ et le router : ne pas modifier.',
    ...imports,
    '',
    "declare module '@super-ts/core' {",
    '  interface Contracts {',
    ...fields,
    '  }',
    '}',
    ...screenBlock,
    '',
    'export {};',
    '',
  ].join('\n');
}
/** Un module de `@core/` qui implémente un contrat a besoin du registre (hors contrats eux-mêmes). */
export const needsRegistry = (relativePath: string, code: string) =>
  relativePath.startsWith('@core/') && !isContractFile(relativePath) && /\bSuperStore\b/.test(code);

/* ------------------------------------------------------------------------------------------ */
/* Remplacement à chaud des composants (dev)                                                   */
/* ------------------------------------------------------------------------------------------ */

const ELEMENT_CLASS = /\bclass\s+(\w+)\s+extends\s+SuperElement\b/g;
const PRIVATE_MEMBER = /\bthis\.#\w|^\s+(?:static\s+)?#\w/m;

/**
 * Le code ajouté en fin de module de composant, en dev : le module accepte son propre remplacement,
 * et la nouvelle version des composants qu'il déclare remplace l'ancienne (voir `hotReplace`).
 * `null` si le module ne déclare aucun composant. En fin de module, pour ne pas décaler les lignes.
 */
export function hotModuleCode(code: string): string | null {
  const classes = [...code.matchAll(ELEMENT_CLASS)].map((match) => match[1]!);
  if (classes.length === 0) return null;
  const privateFields = PRIVATE_MEMBER.test(code);
  return [
    '',
    "import { hotReplace as __superHotReplace } from '@super-ts/dom/internal';",
    'if (import.meta.hot) {',
    '  import.meta.hot.accept();',
    `  __superHotReplace([${classes.join(', ')}], { privateFields: ${privateFields} });`,
    '}',
    '',
  ].join('\n');
}
