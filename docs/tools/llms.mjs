// Génère les fichiers pour les LLM à partir des pages HTML de la doc (convention https://llmstxt.org) :
//   docs/llms.txt        l'index : une ligne par page, dans l'ordre du sommaire
//   docs/llms-full.txt   toutes les pages en markdown, code compris
//   docs/llms-small.txt  la même chose sans ce qui est marqué data-llm="skip" ni les renvois vers l'app d'exemples
// Appelé par build-docs-index.mjs : la doc HTML reste la seule source.
//
// Marquer un contenu comme secondaire (absent de llms-small.txt) :
//   <h2 data-llm="skip"> ou <h3 data-llm="skip">  retire la section jusqu'au titre suivant de même niveau ou plus haut
//   <p|div|table|ul|ol|script data-llm="skip">     retire l'élément
//   <article data-llm="skip">                       retire la page (elle reste listée dans llms.txt)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const decode = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/** Même règle que docs/assets/site.js : le code des pages est indenté avec le HTML. */
function dedent(source) {
  const lines = source.replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length));
  return lines.map((line) => line.slice(indent)).join('\n');
}

/** Le sommaire de docs/assets/site.js : l'ordre des pages et leurs groupes. */
export function readNav(docs) {
  const source = readFileSync(join(docs, 'assets/site.js'), 'utf8');
  const literal = source.match(/const NAV = (\[[\s\S]*?\n\]);/)?.[1];
  if (!literal) throw new Error('Sommaire introuvable dans docs/assets/site.js (const NAV = [...]).');
  return new Function(`return ${literal}`)();
}

const attr = (attrs, name) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const skipped = (attrs) => /\bdata-llm="skip"/.test(attrs);

/** Retire le contenu secondaire pour llms-small.txt. */
function stripForSmall(html) {
  let out = html;
  // Sections marquées : du titre jusqu'au prochain titre de niveau égal ou supérieur.
  out = out.replace(/<h2[^>]*data-llm="skip"[^>]*>[\s\S]*?(?=<h2[\s>]|$)/g, '');
  out = out.replace(/<h3[^>]*data-llm="skip"[^>]*>[\s\S]*?(?=<h[23][\s>]|$)/g, '');
  // Éléments marqués (aucun de ces éléments ne s'imbrique dans un élément de même nom dans la doc).
  out = out.replace(/<(p|div|table|ul|ol|script)\b([^>]*)>[\s\S]*?<\/\1>/g, (whole, _tag, attrs) =>
    skipped(attrs) ? '' : whole,
  );
  // Renvois vers l'app d'exemples et cartes de navigation : utiles dans le navigateur, du bruit pour un LLM.
  out = out.replace(/<p class="example-link">[\s\S]*?<\/p>/g, '');
  out = out.replace(/<div class="cards">[\s\S]*?<\/div>/g, '');
  return out;
}

/**
 * Convertit le HTML d'un article en markdown. Seules les balises connues sont acceptées :
 * une balise nouvelle dans la doc fait échouer la génération au lieu d'être perdue en silence.
 */
function toMarkdown(html, { page, headingOffset = 0 }) {
  const blocks = [];
  const block = (markdown) => `\u0001${blocks.push(markdown) - 1}\u0001`;

  // Liens : les ancres locales deviennent page#ancre, pour rester justes une fois les pages concaténées.
  const href = (url) => (url.startsWith('#') ? `${page}${url}` : url);

  function inline(fragment) {
    const codes = [];
    let text = fragment.replace(/<code>([\s\S]*?)<\/code>/g, (_, content) => {
      const code = decode(content.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
      const fence = code.includes('`') ? '``' : '`';
      const padded = code.startsWith('`') || code.endsWith('`') ? ` ${code} ` : code;
      return `\u0002${codes.push(`${fence}${padded}${fence}`) - 1}\u0002`;
    });
    text = text
      .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (_, attrs, label) => `[${label.trim()}](${href(attr(attrs, 'href'))})`)
      .replace(/<strong>([\s\S]*?)<\/strong>/g, (_, content) => `**${content.trim()}**`)
      .replace(/<em>([\s\S]*?)<\/em>/g, (_, content) => `*${content.trim()}*`)
      .replace(/<\/?(span|small)\b[^>]*>/g, '')
      .replace(/<br\s*\/?>/g, '\n');
    const unknown = text.match(/<\/?[a-z][a-z0-9]*\b[^>]*>/i);
    if (unknown) throw new Error(`${page} : balise non gérée par docs/tools/llms.mjs : ${unknown[0]}`);
    return decode(text)
      .replace(/[ \t\r\n]+/g, ' ')
      .trim()
      .replace(/\u0002(\d+)\u0002/g, (_, i) => codes[Number(i)]);
  }

  let out = html;

  // 1. Le code, avant tout : ses génériques (`<{ … }>`) et ses templates ressemblent à du HTML.
  out = out.replace(/<script type="text\/x-code"([^>]*)>([\s\S]*?)<\/script>/g, (_, attrs, source) => {
    const code = dedent(source);
    const lang = attr(attrs, 'data-lang') ?? 'ts';
    const title = attr(attrs, 'data-title');
    const fence = code.includes('```') ? '````' : '```';
    return block(`${fence}${lang}${title ? ` title="${title}"` : ''}\n${code}\n${fence}`);
  });

  // 2. Les blocs.
  out = out.replace(/<table>([\s\S]*?)<\/table>/g, (_, table) => {
    const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
      [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell]) => inline(cell).replace(/\|/g, '\\|')),
    );
    const [head, ...body] = rows;
    const line = (cells) => `| ${cells.join(' | ')} |`;
    return block([line(head), line(head.map(() => '---')), ...body.map(line)].join('\n'));
  });

  out = out.replace(/<(ul|ol)>([\s\S]*?)<\/\1>/g, (_, tag, list) =>
    block(
      [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)]
        .map(([, item], i) => `${tag === 'ol' ? `${i + 1}.` : '-'} ${inline(item)}`)
        .join('\n'),
    ),
  );

  out = out.replace(/<div class="cards">([\s\S]*?)<\/div>/g, (_, cards) =>
    block(
      [...cards.matchAll(/<a class="card" href="([^"]+)"><strong>([\s\S]*?)<\/strong><span>([\s\S]*?)<\/span><\/a>/g)]
        .map(([, url, title, text]) => `- [${inline(title)}](${href(url)}) : ${inline(text)}`)
        .join('\n'),
    ),
  );

  out = out.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/g, (_, content) => block(inline(content)));

  // Un encadré peut contenir des paragraphes et du code : il est converti après eux, en citation.
  out = out.replace(/<div class="callout[^"]*">([\s\S]*?)<\/div>/g, (_, content) => {
    const title = content.match(/^\s*<strong>([\s\S]*?)<\/strong>/);
    const rest = title ? content.slice(title[0].length) : content;
    const parts = rest
      .split(/\u0001(\d+)\u0001/)
      .map((part, i) => (i % 2 === 1 ? blocks[Number(part)] : inline(part)))
      .filter(Boolean);
    const body = [...(title ? [`**${inline(title[1])}**`] : []), ...parts].join('\n\n');
    return block(body.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n'));
  });

  out = out.replace(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/g, (_, level, content) =>
    block(`${'#'.repeat(Number(level) + headingOffset)} ${inline(content)}`),
  );

  // 3. Ce qui reste entre les blocs doit être vide : sinon c'est une structure que ce script ne connaît pas.
  const parts = out.split(/\u0001(\d+)\u0001/);
  const markdown = [];
  parts.forEach((part, i) => {
    if (i % 2 === 1) markdown.push(blocks[Number(part)]);
    else if (part.trim()) {
      const text = inline(part);
      if (text) throw new Error(`${page} : texte hors bloc, non géré par docs/tools/llms.mjs : « ${text.slice(0, 80)} »`);
    }
  });
  return markdown.join('\n\n');
}

function readPages(docs, nav) {
  return nav.flatMap((group) =>
    group.items.map(([file, label]) => {
      const html = readFileSync(join(docs, file), 'utf8');
      const match = html.match(/<article([^>]*)>([\s\S]*?)<\/article>/);
      if (!match) throw new Error(`${file} : pas d'<article>.`);
      const lead = match[2].match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1];
      return { file, label, group: group.title, skip: skipped(match[1]), article: match[2], lead };
    }),
  );
}

const kilobytes = (text) => `${Math.round(Buffer.byteLength(text) / 1024)} Ko`;

/** Renvoie le contenu des trois fichiers, indexé par nom de fichier relatif à docs/. */
export function buildLlmsFiles(docs) {
  const nav = readNav(docs);
  const pages = readPages(docs, nav);

  const document = (small) => {
    const sections = pages
      .filter((page) => !(small && page.skip))
      .map((page) => toMarkdown(small ? stripForSmall(page.article) : page.article, { page: page.file }));
    return `${sections.join('\n\n---\n\n')}\n`;
  };

  const intro = (title, note) =>
    `<!-- Généré par docs/tools/build-docs-index.mjs à partir des pages HTML de docs/ : ne pas modifier à la main. -->\n\n` +
    `> ${title}. ${note} Les liens sont relatifs au dossier docs/ du dépôt.\n\n`;

  const full =
    intro('Super, documentation complète', 'Toutes les pages, dans l\'ordre du sommaire, séparées par ---.') +
    document(false);
  const small =
    intro(
      'Super, documentation courte',
      'Les mêmes pages, sans les renvois vers l\'app d\'exemples ni les passages marqués comme secondaires.',
    ) + document(true);

  const home = pages[0];
  const summary = home.lead ? toMarkdown(`<p>${home.lead}</p>`, { page: home.file }) : '';
  const groups = nav.map(
    (group) =>
      `## ${group.title}\n\n${pages
        .filter((page) => page.group === group.title)
        .map((page) => {
          const description = page.lead ? toMarkdown(`<p>${page.lead}</p>`, { page: page.file }) : '';
          return `- [${page.label}](${page.file})${description ? ` : ${description}` : ''}`;
        })
        .join('\n')}`,
  );
  const index = [
    '# Super',
    `> ${summary}`,
    "Statut : draft exploratoire. L'API peut encore bouger et les paquets (`@super-ts/core`, `@super-ts/dom`, `@super-ts/testing`, `@super-ts/vite`) ne sont pas publiés sur npm : ils vivent dans le dépôt, sous `packages/`. Les liens sont relatifs au dossier `docs/` du dépôt.",
    '## Documentation en un fichier',
    [
      `- [Documentation complète](llms-full.txt) : toutes les pages en markdown, code compris (${kilobytes(full)}).`,
      `- [Documentation courte](llms-small.txt) : la même, sans les renvois vers l'app d'exemples ni les passages secondaires, pour les petites fenêtres de contexte (${kilobytes(small)}).`,
    ].join('\n'),
    ...groups,
  ].join('\n\n');

  return { 'llms.txt': `${index}\n`, 'llms-full.txt': full, 'llms-small.txt': small };
}
