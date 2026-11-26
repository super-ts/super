// `npm run build` : construit les paquets publiés, src/ → dist/, dans l'ordre des dépendances.
// Chaque paquet lit les @super-ts/* dont il dépend par leurs dist/*.d.ts, d'où l'ordre.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, readFileSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { build } from 'rolldown';

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

// Le serveur de langage : un seul dist/server.js, qui embarque le code de lang (importé par chemins
// relatifs). Ses dépendances npm (TypeScript 6, Volar, vscode-uri) restent externes.
{
  const dir = join(root, 'packages', 'lang-server');
  const { dependencies } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const external = [...Object.keys(dependencies), ...builtinModules, /^node:/].map((name) =>
    typeof name === 'string' ? new RegExp(`^${name.replace(/[/.]/g, '\\$&')}(/|$)`) : name,
  );
  rmSync(join(dir, 'dist'), { recursive: true, force: true });
  await build({
    input: join(dir, 'src', 'server.ts'),
    platform: 'node',
    external,
    logLevel: 'warn',
    output: { file: join(dir, 'dist', 'server.js'), format: 'esm' },
  });
  // Le check.ts de lang, lu à l'exécution par le code de virtual.ts embarqué, à côté de server.js.
  cpSync(join(root, 'packages', 'lang', 'src', 'check.ts'), join(dir, 'dist', 'check.ts'));
  chmodSync(join(dir, 'dist', 'server.js'), 0o755);
  console.log('build: @super-ts/language-server');
}
