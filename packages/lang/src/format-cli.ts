#!/usr/bin/env node
/**
 * `super-fmt` : formate les fichiers `.super` (le TS par Biome, les templates par `format.ts`).
 *
 * Usage : node packages/lang/src/format-cli.ts --write|--check [dossiers…]   (par défaut : examples packages)
 * `--check` sort en erreur si un fichier n'est pas formaté. Un fichier qui a des erreurs de syntaxe
 * est laissé tel quel (`npm run typecheck` les signale).
 */
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatWithBiome } from './biome.ts';
import { formatSuper } from './format.ts';

function superFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.super' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...superFiles(path));
    else if (entry.name.endsWith('.super')) found.push(path);
  }
  return found;
}

/** Les fichiers pas encore formatés (et formatés si `write`), et ceux laissés de côté. */
export function formatFiles(dirs: string[], write: boolean): { changed: string[]; skipped: string[] } {
  const changed: string[] = [];
  const skipped: string[] = [];
  for (const file of dirs.flatMap((d) => superFiles(resolve(d)))) {
    const source = readFileSync(file, 'utf8');
    const formatted = formatSuper(source, { formatTs: (code) => formatWithBiome(code, file) });
    if (formatted === null) skipped.push(file);
    else if (formatted !== source) {
      changed.push(file);
      if (write) writeFileSync(file, formatted);
    }
  }
  return { changed, skipped };
}

// Lancé directement, y compris par le lien de `node_modules/.bin`, qui n'a pas le même chemin.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  if (write === check) {
    console.error('Usage : super-fmt --write|--check [dossiers…]');
    process.exit(2);
  }
  const dirs = args.filter((a) => !a.startsWith('--'));
  const { changed, skipped } = formatFiles(dirs.length > 0 ? dirs : ['examples', 'packages'], write);
  const shown = (f: string) => relative(process.cwd(), f);
  if (write) for (const f of skipped) console.log(`${shown(f)} : erreurs de syntaxe, non formaté`);
  if (check && changed.length > 0) {
    for (const f of changed) console.log(`${shown(f)} : pas formaté (npm run format)`);
    process.exit(1);
  }
  if (write) for (const f of changed) console.log(`${shown(f)} : formaté`);
}
