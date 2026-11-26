/**
 * Ce que les `.super` laissent sur disque, sous `<dossier du tsconfig>/.super/` (ignoré par git), à
 * la même place relative que le `.super` :
 *
 * - `virtual/…/index.ts` : le TS virtuel, que `super-tsc` vérifie ;
 * - `types/…/index.d.ts` et `index.d.ts.map` : la déclaration de ses exports, tirée du TS virtuel,
 *   et sa source map vers le `.super`. Les tsconfig déclarent ce dossier (`rootDirs`, `paths`) : un
 *   `.ts` qui importe un `.super` en trouve les types, et « aller à la définition » ouvre le `.super`.
 *
 * Écrits par `super-tsc`, par le serveur de langage à chaque modification, et par Vite en dev.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { declarationOf } from './declarations.ts';
import { toVirtual } from './virtual.ts';

/** Le dossier du tsconfig le plus proche au-dessus de `file`. */
export function projectDirOf(file: string): string | null {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'tsconfig.json'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** Où va le TS virtuel de `file` (un `.super`), dans le projet `projectDir`. */
export const virtualPathOf = (projectDir: string, file: string) =>
  join(projectDir, '.super', 'virtual', relative(projectDir, file)).replace(/\.super$/, '.ts');

/** Où va la déclaration de `file` (un `.super`), dans le projet `projectDir`. */
export const declarationPathOf = (projectDir: string, file: string) =>
  join(projectDir, '.super', 'types', relative(projectDir, file)).replace(/\.super$/, '.d.ts');

/** Écrit `content` dans `target` s'il a changé (sinon le serveur TS de l'éditeur recalcule pour rien). */
function writeIfChanged(target: string, content: string) {
  try {
    if (readFileSync(target, 'utf8') === content) return;
  } catch {}
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** Le chemin relatif de `to` vu de `from` (un dossier), avec des `/` et un `./` de tête. */
const relativeFrom = (from: string, to: string) => {
  const path = relative(from, to).split('\\').join('/');
  return path.startsWith('.') ? path : `./${path}`;
};

/**
 * Écrit le TS virtuel et la déclaration de `file`, un `.super` dont `source` est le texte, dans le
 * projet `projectDir` (par défaut celui du tsconfig le plus proche ; `super-tsc` donne le sien).
 */
export function writeVirtualFile(file: string, source: string, projectDir = projectDirOf(file)): void {
  if (!projectDir) return;
  const ignore = join(projectDir, '.super', '.gitignore');
  if (!existsSync(ignore)) {
    mkdirSync(dirname(ignore), { recursive: true });
    writeFileSync(ignore, '*\n');
  }
  const virtual = virtualPathOf(projectDir, file);
  writeIfChanged(virtual, toVirtual(source).code);

  const declaration = declarationPathOf(projectDir, file);
  const name = basename(declaration);
  const { dts, map } = declarationOf(
    source,
    relativeFrom(dirname(declaration), virtual.replace(/\.ts$/, '')),
    relativeFrom(dirname(declaration), file),
    name,
  );
  writeIfChanged(declaration, dts);
  writeIfChanged(`${declaration}.map`, map);
}
