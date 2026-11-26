/**
 * The TS of a `.super` file formatted by the repository's Biome, with its configuration (`biome.json`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The folder that contains `biome.json`, above `file`. */
function biomeRoot(file: string): string | null {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'biome.json')) || existsSync(join(dir, 'biome.jsonc'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** Formats `code` as the TS of the file `file` (a `.super` file). Throws if Biome fails. */
export function formatWithBiome(code: string, file: string): string {
  const root = biomeRoot(file);
  if (!root) throw new Error(`[super] no biome.json above ${file}`);
  const biome = join(root, 'node_modules', '.bin', 'biome');
  const result = spawnSync(biome, ['format', `--stdin-file-path=${file}.ts`], { input: code, cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`[super] Biome could not format ${file}:\n${result.stderr || result.stdout}`);
  return result.stdout;
}
