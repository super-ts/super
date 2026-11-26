// `node scripts/sync-version.mjs [--check]`: the version of the @super-ts packages, shown elsewhere.
//
// The packages share one version (Changesets `fixed` group). This script checks that they agree,
// internal dependencies included, then writes the version of @super-ts/core into:
//   README.md             between <!-- version --> and <!-- /version --> (inside a sentence: a line
//                         that starts with an HTML comment is raw HTML on GitHub)
//   docs/assets/site.js   const VERSION = '…'; (shown next to the brand in the docs header)
// The llms*.txt files read it themselves (docs/tools/llms.mjs).
// `--check` writes nothing and fails if something is out of date (run by `npm run check`);
// `npm run version-packages` runs it after `changeset version`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const problems = [];

const read = (path) => readFileSync(join(root, path), 'utf8');
const manifests = readdirSync(join(root, 'packages'))
  .map((dir) => JSON.parse(read(`packages/${dir}/package.json`)))
  .filter((manifest) => manifest.name?.startsWith('@super-ts/'));
const version = manifests.find((manifest) => manifest.name === '@super-ts/core').version;

for (const manifest of manifests) {
  if (manifest.version !== version) problems.push(`${manifest.name} is at ${manifest.version}, @super-ts/core at ${version}`);
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (name.startsWith('@super-ts/') && range !== version) problems.push(`${manifest.name} depends on ${name}@${range}, not ${version}`);
  }
}

/** Replaces `pattern` (one capture group around the old value) in a file with the version. */
function sync(path, pattern, render) {
  const text = read(path);
  if (!pattern.test(text)) {
    problems.push(`${path}: no version marker found`);
    return;
  }
  const next = text.replace(pattern, render(version));
  if (next === text) return;
  if (check) problems.push(`${path} does not show version ${version}: run node scripts/sync-version.mjs`);
  else writeFileSync(join(root, path), next);
}

sync('README.md', /<!-- version -->[^<]*<!-- \/version -->/, (v) => `<!-- version -->${v}<!-- /version -->`);
sync('docs/assets/site.js', /const VERSION = '[^']*';/, (v) => `const VERSION = '${v}';`);

if (problems.length > 0) {
  for (const problem of problems) console.error(`sync-version: ${problem}`);
  process.exit(1);
}
console.log(`sync-version: ${check ? 'all up to date at' : 'synced'} ${version}`);
