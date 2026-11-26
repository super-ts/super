// `npm run build` : construit les paquets publiés, src/ → dist/, dans l'ordre des dépendances.
// Chaque paquet lit les @super-ts/* dont il dépend par leurs dist/*.d.ts, d'où l'ordre.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

const PACKAGES = [
  { name: 'core' },
  { name: 'dom' },
  { name: 'testing' },
  // La feuille de style est importée par index.js ; c'est le bundler de l'app qui la charge.
  { name: 'ui', copy: ['styles.css', 'styles.d.css.ts'] },
  // virtual.ts lit check.ts à l'exécution, à côté de lui : on le livre tel quel.
  { name: 'lang', copy: ['check.ts'], bin: ['cli.js', 'format-cli.js'] },
  { name: 'vite' },
];

const tsc = join(root, 'node_modules', '.bin', 'tsc');

for (const pkg of PACKAGES) {
  const dir = join(root, 'packages', pkg.name);
  rmSync(join(dir, 'dist'), { recursive: true, force: true });
  const result = spawnSync(tsc, ['-p', 'tsconfig.build.json'], { cwd: dir, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`build: @super-ts/${pkg.name} failed`);
    process.exit(result.status ?? 1);
  }
  for (const file of pkg.copy ?? []) cpSync(join(dir, 'src', file), join(dir, 'dist', file));
  for (const file of pkg.bin ?? []) chmodSync(join(dir, 'dist', file), 0o755);
  console.log(`build: @super-ts/${pkg.name}`);
}
