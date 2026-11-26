/**
 * Le TS d'un `.super` formaté par le Biome du dépôt, avec sa configuration (`biome.json`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Le dossier qui contient `biome.json`, au-dessus de `file`. */
function biomeRoot(file: string): string | null {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'biome.json')) || existsSync(join(dir, 'biome.jsonc'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** Formate `code` comme le TS du fichier `file` (un `.super`). Lève si Biome échoue. */
export function formatWithBiome(code: string, file: string): string {
  const root = biomeRoot(file);
  if (!root) throw new Error(`[super] pas de biome.json au-dessus de ${file}`);
  const biome = join(root, 'node_modules', '.bin', 'biome');
  const result = spawnSync(biome, ['format', `--stdin-file-path=${file}.ts`], { input: code, cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`[super] Biome n'a pas pu formater ${file} :\n${result.stderr || result.stdout}`);
  return result.stdout;
}
