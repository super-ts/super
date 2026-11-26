/**
 * What `.super` files leave on disk, under `<tsconfig folder>/.super/` (ignored by git), at
 * the same relative place as the `.super` file:
 *
 * - `virtual/…/index.ts`: the virtual TS, which `super-tsc` checks;
 * - `types/…/index.d.ts` and `index.d.ts.map`: the declaration of its exports, drawn from the virtual TS,
 *   and its source map to the `.super` file. The tsconfigs declare this folder (`rootDirs`, `paths`): a
 *   `.ts` file that imports a `.super` file finds its types, and "go to definition" opens the `.super` file.
 *
 * Written by `super-tsc`, by the language server on each change, and by Vite in dev.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { declarationOf } from './declarations.ts';
import { toVirtual } from './virtual.ts';

/** The folder of the nearest tsconfig above `file`. */
export function projectDirOf(file: string): string | null {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'tsconfig.json'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** Where the virtual TS of `file` (a `.super` file) goes, in the project `projectDir`. */
export const virtualPathOf = (projectDir: string, file: string) =>
  join(projectDir, '.super', 'virtual', relative(projectDir, file)).replace(/\.super$/, '.ts');

/** Where the declaration of `file` (a `.super` file) goes, in the project `projectDir`. */
export const declarationPathOf = (projectDir: string, file: string) =>
  join(projectDir, '.super', 'types', relative(projectDir, file)).replace(/\.super$/, '.d.ts');

/** Writes `content` to `target` if it has changed (otherwise the editor's TS server recomputes for nothing). */
function writeIfChanged(target: string, content: string) {
  try {
    if (readFileSync(target, 'utf8') === content) return;
  } catch {}
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** The relative path of `to` seen from `from` (a folder), with `/` and a leading `./`. */
const relativeFrom = (from: string, to: string) => {
  const path = relative(from, to).split('\\').join('/');
  return path.startsWith('.') ? path : `./${path}`;
};

/**
 * Writes the virtual TS and the declaration of `file`, a `.super` file whose text is `source`, in the
 * project `projectDir` (by default that of the nearest tsconfig; `super-tsc` passes its own).
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
