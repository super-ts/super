// Génère, à partir des pages HTML de la doc :
//   docs/assets/search-index.js  l'index de recherche, une entrée par section (h2 ou h3), texte et code compris
//   docs/llms.txt, docs/llms-full.txt, docs/llms-small.txt  la doc pour les LLM (voir docs/tools/llms.mjs)
// Usage : npm run docs:index         (régénère les fichiers)
//         npm run docs:check         (échoue si un fichier n'est plus à jour ; npm run check, lui, régénère)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLlmsFiles, readNav } from './llms.mjs';

const DOCS = new URL('../', import.meta.url).pathname;

/** Même règle que docs/assets/site.js : les ancres doivent correspondre. */
function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const decode = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

// Le code est extrait avant de retirer les balises : sinon ses génériques (`<{ … }>`) seraient pris pour du HTML.
function toText(html) {
  const code = [];
  const prose = html.replace(/<script type="text\/x-code"[^>]*>([\s\S]*?)<\/script>/g, (_, source) => {
    code.push(source);
    return ` \u0000${code.length - 1}\u0000 `;
  });
  return decode(prose.replace(/<[^>]+>/g, ' '))
    .replace(/\u0000(\d+)\u0000/g, (_, i) => code[Number(i)])
    .replace(/\s+/g, ' ')
    .trim();
}

const entries = [];
for (const file of readdirSync(DOCS).filter((name) => name.endsWith('.html')).sort()) {
  const html = readFileSync(join(DOCS, file), 'utf8');
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? '';
  const page = toText(article.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? file);

  // Découpe l'article en sections : l'intro (avant le premier h2), puis chaque h2 / h3.
  const parts = article.split(/(?=<h[23][\s>])/);
  for (const part of parts) {
    const heading = part.match(/^<h([23])([^>]*)>([\s\S]*?)<\/h\1>/);
    const title = heading ? toText(heading[3]) : page;
    const id = heading ? (heading[2].match(/id="([^"]+)"/)?.[1] ?? slugify(title)) : '';
    const body = toText(heading ? part.slice(heading[0].length) : part.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, ''));
    if (!body && !heading) continue;
    entries.push({ url: id ? `${file}#${id}` : file, page, title, text: body });
  }
}

// Chaque lien vers l'app d'exemples (data-source d'un extrait, ou href="../examples/…") doit viser un fichier qui existe.
const ROOT = join(DOCS, '..');
const broken = [];
for (const file of readdirSync(DOCS).filter((name) => name.endsWith('.html'))) {
  const html = readFileSync(join(DOCS, file), 'utf8');
  const sources = [...html.matchAll(/data-source="([^"]+)"/g), ...html.matchAll(/href="\.\.\/(examples\/[^"#]+)"/g)].map((m) => m[1]);
  for (const source of sources) {
    if (!existsSync(join(ROOT, source))) broken.push(`${file} -> ${source}`);
  }
}
if (broken.length > 0) {
  console.error(`Liens vers l'app d'exemples cassés :\n${broken.join('\n')}`);
  process.exit(1);
}

// Chaque page doit figurer au sommaire : c'est lui qui ordonne la navigation et les fichiers pour les LLM.
const listed = new Set(readNav(DOCS).flatMap((group) => group.items.map(([file]) => file)));
const unlisted = readdirSync(DOCS).filter((name) => name.endsWith('.html') && !listed.has(name));
if (unlisted.length > 0) {
  console.error(`Pages absentes du sommaire (NAV dans docs/assets/site.js) :\n${unlisted.join('\n')}`);
  process.exit(1);
}

const outputs = {
  'assets/search-index.js': `// Généré par docs/tools/build-docs-index.mjs : ne pas modifier à la main.\nwindow.SEARCH_INDEX = ${JSON.stringify(entries)};\n`,
  ...buildLlmsFiles(DOCS),
};

if (process.argv.includes('--check')) {
  const stale = Object.entries(outputs)
    .filter(([file, content]) => !existsSync(join(DOCS, file)) || readFileSync(join(DOCS, file), 'utf8') !== content)
    .map(([file]) => `docs/${file}`);
  if (stale.length > 0) {
    console.error(`Fichiers générés de la doc plus à jour : ${stale.join(', ')}. Lance \`npm run docs:index\`.`);
    process.exit(1);
  }
  console.log(`Index de recherche (${entries.length} sections) et fichiers pour les LLM à jour.`);
} else {
  for (const [file, content] of Object.entries(outputs)) writeFileSync(join(DOCS, file), content);
  console.log(`${entries.length} sections indexées dans docs/assets/search-index.js`);
  console.log('Fichiers pour les LLM écrits : docs/llms.txt, docs/llms-full.txt, docs/llms-small.txt');
}
