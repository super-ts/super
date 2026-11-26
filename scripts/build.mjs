// `npm run build`: builds the published packages, src/ → dist/, in dependency order.
// Each package reads the @super-ts/* packages it depends on through their dist/*.d.ts, hence the order.
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
  // The stylesheet is imported by index.js; the app's bundler loads it.
  { name: 'ui', copy: ['styles.css', 'styles.d.css.ts'] },
  // virtual.ts reads check.ts at runtime, next to itself: it is shipped as is.
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

// The language server: a single dist/server.js, which bundles the lang code (imported through relative
// paths). Its npm dependencies (TypeScript 6, Volar, vscode-uri) stay external.
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
  // lang's check.ts, read at runtime by the bundled virtual.ts code, next to server.js.
  cpSync(join(root, 'packages', 'lang', 'src', 'check.ts'), join(dir, 'dist', 'check.ts'));
  chmodSync(join(dir, 'dist', 'server.js'), 0o755);
  console.log('build: @super-ts/language-server');
}
