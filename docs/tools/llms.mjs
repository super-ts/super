// Generates the LLM files from the HTML pages of the docs (https://llmstxt.org convention):
//   docs/llms.txt        the index: one line per page, in table of contents order
//   docs/llms-full.txt   all the pages in markdown, code included
//   docs/llms-small.txt  the same without what is marked data-llm="skip" or the references to the examples app
// Called by build-docs-index.mjs: the HTML docs remain the only source.
//
// Marking content as secondary (left out of llms-small.txt):
//   <h2 data-llm="skip"> or <h3 data-llm="skip">  removes the section up to the next heading of the same level or higher
//   <p|div|table|ul|ol|script data-llm="skip">     removes the element
//   <article data-llm="skip">                       removes the page (it stays listed in llms.txt)
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

/** Same rule as docs/assets/site.js: the page code is indented with the HTML. */
function dedent(source) {
  const lines = source.replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length));
  return lines.map((line) => line.slice(indent)).join('\n');
}

/** The table of contents of docs/assets/site.js: the page order and their groups. */
export function readNav(docs) {
  const source = readFileSync(join(docs, 'assets/site.js'), 'utf8');
  const literal = source.match(/const NAV = (\[[\s\S]*?\n\]);/)?.[1];
  if (!literal) throw new Error('Table of contents not found in docs/assets/site.js (const NAV = [...]).');
  return new Function(`return ${literal}`)();
}

const attr = (attrs, name) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const skipped = (attrs) => /\bdata-llm="skip"/.test(attrs);

/** Removes secondary content for llms-small.txt. */
function stripForSmall(html) {
  let out = html;
  // Marked sections: from the heading to the next heading of equal or higher level.
  out = out.replace(/<h2[^>]*data-llm="skip"[^>]*>[\s\S]*?(?=<h2[\s>]|$)/g, '');
  out = out.replace(/<h3[^>]*data-llm="skip"[^>]*>[\s\S]*?(?=<h[23][\s>]|$)/g, '');
  // Marked elements (none of these elements is nested in an element of the same name in the docs).
  out = out.replace(/<(p|div|table|ul|ol|script)\b([^>]*)>[\s\S]*?<\/\1>/g, (whole, _tag, attrs) =>
    skipped(attrs) ? '' : whole,
  );
  // References to the examples app and navigation cards: useful in the browser, noise for an LLM.
  out = out.replace(/<p class="example-link">[\s\S]*?<\/p>/g, '');
  out = out.replace(/<div class="cards">[\s\S]*?<\/div>/g, '');
  return out;
}

/**
 * Converts the HTML of an article to markdown. Only known tags are accepted:
 * a new tag in the docs makes the generation fail instead of being silently lost.
 */
function toMarkdown(html, { page, headingOffset = 0 }) {
  const blocks = [];
  const block = (markdown) => `\u0001${blocks.push(markdown) - 1}\u0001`;

  // Links: local anchors become page#anchor, to stay correct once the pages are concatenated.
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
    if (unknown) throw new Error(`${page}: tag not handled by docs/tools/llms.mjs: ${unknown[0]}`);
    return decode(text)
      .replace(/[ \t\r\n]+/g, ' ')
      .trim()
      .replace(/\u0002(\d+)\u0002/g, (_, i) => codes[Number(i)]);
  }

  let out = html;

  // 1. The code, first of all: its generics (`<{ … }>`) and its templates look like HTML.
  out = out.replace(/<script type="text\/x-code"([^>]*)>([\s\S]*?)<\/script>/g, (_, attrs, source) => {
    const code = dedent(source);
    const lang = attr(attrs, 'data-lang') ?? 'ts';
    const title = attr(attrs, 'data-title');
    const fence = code.includes('```') ? '````' : '```';
    return block(`${fence}${lang}${title ? ` title="${title}"` : ''}\n${code}\n${fence}`);
  });

  // 2. The blocks.
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
        .map(([, url, title, text]) => `- [${inline(title)}](${href(url)}): ${inline(text)}`)
        .join('\n'),
    ),
  );

  out = out.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/g, (_, content) => block(inline(content)));

  // A callout can contain paragraphs and code: it is converted after them, as a quote.
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

  // 3. What remains between the blocks must be empty: otherwise it is a structure this script does not know.
  const parts = out.split(/\u0001(\d+)\u0001/);
  const markdown = [];
  parts.forEach((part, i) => {
    if (i % 2 === 1) markdown.push(blocks[Number(part)]);
    else if (part.trim()) {
      const text = inline(part);
      if (text) throw new Error(`${page}: text outside a block, not handled by docs/tools/llms.mjs: "${text.slice(0, 80)}"`);
    }
  });
  return markdown.join('\n\n');
}

function readPages(docs, nav) {
  return nav.flatMap((group) =>
    group.items.map(([file, label]) => {
      const html = readFileSync(join(docs, file), 'utf8');
      const match = html.match(/<article([^>]*)>([\s\S]*?)<\/article>/);
      if (!match) throw new Error(`${file}: no <article>.`);
      const lead = match[2].match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1];
      return { file, label, group: group.title, skip: skipped(match[1]), article: match[2], lead };
    }),
  );
}

const kilobytes = (text) => `${Math.round(Buffer.byteLength(text) / 1024)} KB`;

/** Returns the content of the three files, keyed by file name relative to docs/. */
export function buildLlmsFiles(docs) {
  // The @super-ts packages share one version: the one of @super-ts/core.
  const { version } = JSON.parse(readFileSync(join(docs, '..', 'packages', 'core', 'package.json'), 'utf8'));
  const nav = readNav(docs);
  const pages = readPages(docs, nav);

  const document = (small) => {
    const sections = pages
      .filter((page) => !(small && page.skip))
      .map((page) => toMarkdown(small ? stripForSmall(page.article) : page.article, { page: page.file }));
    return `${sections.join('\n\n---\n\n')}\n`;
  };

  const intro = (title, note) =>
    `<!-- Generated by docs/tools/build-docs-index.mjs from the HTML pages of docs/: do not edit by hand. -->\n\n` +
    `> ${title}. ${note} Links are relative to the docs/ folder of the repository.\n\n`;

  const full =
    intro('Super, full documentation', 'All the pages, in table of contents order, separated by ---.') +
    document(false);
  const small =
    intro(
      'Super, short documentation',
      'The same pages, without the references to the examples app or the passages marked as secondary.',
    ) + document(true);

  const home = pages[0];
  const summary = home.lead ? toMarkdown(`<p>${home.lead}</p>`, { page: home.file }) : '';
  const groups = nav.map(
    (group) =>
      `## ${group.title}\n\n${pages
        .filter((page) => page.group === group.title)
        .map((page) => {
          const description = page.lead ? toMarkdown(`<p>${page.lead}</p>`, { page: page.file }) : '';
          return `- [${page.label}](${page.file})${description ? `: ${description}` : ''}`;
        })
        .join('\n')}`,
  );
  const index = [
    '# Super',
    `> ${summary}`,
    `Version ${version} of the \`@super-ts/*\` packages, published on npm. Status: exploratory draft, the API may still change (0.x: a minor version can break). Install: \`npm i @super-ts/core @super-ts/dom\` and \`npm i -D @super-ts/vite @super-ts/lang @super-ts/testing\`, see [Getting started](getting-started.html#install). Links are relative to the \`docs/\` folder of the repository.`,
    '## Documentation in one file',
    [
      `- [Full documentation](llms-full.txt): all the pages in markdown, code included (${kilobytes(full)}).`,
      `- [Short documentation](llms-small.txt): the same, without the references to the examples app or the secondary passages, for small context windows (${kilobytes(small)}).`,
    ].join('\n'),
    ...groups,
  ].join('\n\n');

  return { 'llms.txt': `${index}\n`, 'llms-full.txt': full, 'llms-small.txt': small };
}
