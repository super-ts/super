// `npm run smoke` : installe les paquets comme un vrai utilisateur, sans registre ni alias.
//
// 1. build, puis `npm pack` de chaque paquet ;
// 2. une app Vite vierge dans un dossier temporaire, qui installe les tarballs ;
// 3. l'exemple de docs/demarrer.html : contrat, store, composant .super, test ;
// 4. vite build, super-tsc, vitest, super-fmt, biome avec @super-ts/lint.
//
// `--keep` garde le dossier temporaire (il est gardé aussi en cas d'échec).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const keep = process.argv.includes('--keep');
const PACKAGES = ['core', 'dom', 'ui', 'testing', 'lang', 'vite', 'lint'];

// Rien du dépôt ne doit fuir dans l'app : ni la condition `@super-ts/source` (le `.npmrc` du dépôt
// la passe par NODE_OPTIONS aux scripts npm), ni la config npm du `npm run` parent.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_OPTIONS' && !/^npm_/i.test(key)));

const work = mkdtempSync(join(tmpdir(), 'super-smoke-'));
const app = join(work, 'app');
const tarballs = join(work, 'tarballs');

function run(label, command, args, cwd) {
  console.log(`\nsmoke: ${label}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\nsmoke: FAILED at "${label}". App kept in ${app}`);
    process.exit(1);
  }
}

function fail(message) {
  console.error(`\nsmoke: FAILED: ${message}. App kept in ${app}`);
  process.exit(1);
}

function write(path, content) {
  const file = join(app, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${content.replace(/^\n/, '')}`);
}

// 1. build et tarballs
run('build', 'npm', ['run', 'build'], root);
mkdirSync(tarballs);
for (const name of PACKAGES) run(`pack @super-ts/${name}`, 'npm', ['pack', '--pack-destination', tarballs, '--silent'], join(root, 'packages', name));
const tarball = (name) => {
  const { version } = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  return `file:${join(tarballs, `super-ts-${name}-${version}.tgz`)}`;
};

// 2. l'app : les outils aux versions du dépôt, Super par ses tarballs
const devVersions = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies;
const tools = ['vite', 'vitest', 'typescript', 'happy-dom', '@testing-library/dom', '@testing-library/user-event', '@biomejs/biome'];
write(
  'package.json',
  JSON.stringify(
    {
      name: 'super-smoke-app',
      private: true,
      type: 'module',
      dependencies: { '@super-ts/core': tarball('core'), '@super-ts/dom': tarball('dom'), '@super-ts/ui': tarball('ui') },
      devDependencies: {
        '@super-ts/testing': tarball('testing'),
        '@super-ts/lang': tarball('lang'),
        '@super-ts/vite': tarball('vite'),
        '@super-ts/lint': tarball('lint'),
        ...Object.fromEntries(tools.map((tool) => [tool, devVersions[tool]])),
      },
    },
    null,
    2,
  ),
);

write(
  'tsconfig.json',
  `
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"],
    "rootDirs": [".", "./.super/types", "./.super/virtual"],
    "paths": {
      "@core/*": ["./src/@core/*", "./.super/types/src/@core/*"],
      "@components/*": ["./src/@components/*", "./.super/types/src/@components/*"]
    }
  },
  "include": ["src", "vite.config.ts"]
}
`,
);

write(
  'vite.config.ts',
  `
import { superPlugin } from '@super-ts/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [superPlugin({ src: 'src' })],
  test: {
    environment: 'happy-dom',
    // Node >= 25 expose un localStorage natif qui masque celui de happy-dom.
    execArgv: ['--no-experimental-webstorage'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
`,
);

write(
  'biome.json',
  `
{
  "extends": ["@super-ts/lint/config.json"],
  "files": { "includes": ["src/**", "!**/.super"] },
  "formatter": { "indentStyle": "space", "lineWidth": 120 },
  "javascript": { "formatter": { "quoteStyle": "single" } },
  "linter": { "enabled": false }
}
`,
);

write(
  'index.html',
  `
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <title>Super smoke</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
);

// 3. l'exemple de docs/demarrer.html
write(
  'src/@core/theme/contract.ts',
  `
import { SuperContract } from '@super-ts/core';

export type ThemeMode = 'light' | 'dark';
export type ThemeState = { mode: ThemeMode };

export type ThemeTypes = {
  state: ThemeState;
  commands: { toggle(): void };
  events: { changed: { mode: ThemeMode } };
};

export class ThemeContract extends SuperContract<ThemeTypes> {
  constructor() {
    super({ name: 'theme' });
  }

  isDark(s: ThemeState) {
    return s.mode === 'dark';
  }
}
`,
);

write(
  'src/@core/theme/store.ts',
  `
import { type Commands, SuperStore } from '@super-ts/core';
import type { ThemeContract } from './contract';

export class ThemeStore extends SuperStore<ThemeContract> implements Commands<ThemeStore> {
  constructor() {
    super({ contract: 'theme', initialState: { mode: 'light' } });
  }

  toggle() {
    const mode = this.selectors.isDark() ? 'light' : 'dark';
    this.set({ mode });
    this.emit('changed', { mode });
  }
}
`,
);

write(
  'src/@components/shared/theme-toggle.super',
  `
import { SuperElement } from '@super-ts/dom';

export class ThemeToggle extends SuperElement {
  @tag = 'theme-toggle';

  @contract theme;
  @selector isDark = this.theme.selectors.isDark;

  render() {
    <button type="button" on:click={() => this.theme.send('toggle')}>
      {this.isDark.value ? 'Passer en mode clair' : 'Passer en mode sombre'}
    </button>
  }
}
`,
);

// Un composant du kit : l'importer charge la feuille de style de @super-ts/ui.
write(
  'src/@components/shared/theme-panel.super',
  `
import { SuperElement } from '@super-ts/dom';
import { Button } from '@super-ts/ui';
import { ThemeToggle } from './theme-toggle';

export class ThemePanel extends SuperElement {
  @tag = 'theme-panel';

  @contract theme;

  render() {
    <section>
      <ThemeToggle />
      <Button variant="secondary" on:press={() => this.theme.send('toggle')}>
        Basculer
      </Button>
    </section>
  }
}
`,
);

write(
  'src/main.ts',
  `
import { createApp } from '@super-ts/dom';
import { ThemePanel } from '@components/shared/theme-panel';
import { ThemeStore } from '@core/theme/store';

const theme = ThemeStore.create();

createApp({ root: document.querySelector<HTMLElement>('#app')!, stores: [theme] }).mount(ThemePanel.create());
`,
);

write(
  'src/test-setup.ts',
  `
import { cleanup } from '@super-ts/testing';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
`,
);

write(
  'src/@components/shared/theme-toggle.test.ts',
  `
import { flush, mount } from '@super-ts/testing';
import { ThemeStore } from '@core/theme/store';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { ThemeToggle } from './theme-toggle';

test('le bouton bascule le thème', async () => {
  const theme = ThemeStore.create();
  const { container } = await mount(ThemeToggle, { stores: [theme] });

  await userEvent.click(within(container).getByRole('button'));
  await flush();

  expect(theme.selectors.isDark()).toBe(true);
  expect(container.textContent).toContain('Passer en mode clair');
});
`,
);

// 4. ce que fait un utilisateur
run('npm install (tarballs)', 'npm', ['install', '--no-audit', '--no-fund', '--prefer-offline'], app);
for (const name of PACKAGES) {
  if (existsSync(join(app, 'node_modules', '@super-ts', name, 'src'))) {
    fail(`@super-ts/${name} ships its src/ folder`);
  }
}
run('vite build', 'npx', ['vite', 'build'], app);
if (!existsSync(join(app, 'src/@core/contracts.d.ts'))) {
  fail('the Vite plugin did not write src/@core/contracts.d.ts');
}
const css = spawnSync('sh', ['-c', 'cat dist/assets/*.css'], { cwd: app, encoding: 'utf8' }).stdout;
if (!css.includes('.super-button')) fail("the @super-ts/ui stylesheet is missing from the build's CSS");
run('super-tsc', 'npx', ['super-tsc', 'tsconfig.json'], app);

// super-tsc doit aussi échouer : une commande mal nommée dans le .super, signalée sur le .super.
const toggle = join(app, 'src/@components/shared/theme-toggle.super');
const valid = readFileSync(toggle, 'utf8');
writeFileSync(toggle, valid.replace("send('toggle')", "send('toggel')"));
console.log('\nsmoke: super-tsc on a broken .super');
const broken = spawnSync('npx', ['super-tsc', 'tsconfig.json'], { cwd: app, env, encoding: 'utf8' });
writeFileSync(toggle, valid);
if (broken.status !== 1 || !/theme-toggle\.super\(\d+,\d+\): error TS2345/.test(broken.stdout)) {
  fail(`super-tsc did not report the broken command on the .super file:\n${broken.stdout}${broken.stderr}`);
}
run('vitest run', 'npx', ['vitest', 'run'], app);
run('biome format --write', 'npx', ['biome', 'format', '--write'], app);
run('super-fmt --write', 'npx', ['super-fmt', '--write', 'src'], app);
run('super-fmt --check', 'npx', ['super-fmt', '--check', 'src'], app);
run('biome check (@super-ts/lint)', 'npx', ['biome', 'check'], app);

if (keep) console.log(`\nsmoke: OK. App kept in ${app}`);
else {
  rmSync(work, { recursive: true, force: true });
  console.log('\nsmoke: OK');
}
