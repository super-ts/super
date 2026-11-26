// Habillage commun des pages : en-tête, navigation, table des matières, code et recherche.
// Chaque page ne contient que son <article> ; ce script construit le reste.

const NAV = [
  {
    title: 'Commencer',
    items: [
      ['index.html', 'Introduction'],
      ['getting-started.html', 'Démarrer'],
      ['examples.html', 'Exemples'],
      ['architecture.html', 'Architecture'],
    ],
  },
  {
    title: 'Les stores',
    items: [
      ['contracts.html', 'Contrats'],
      ['selectors.html', 'Sélecteurs'],
      ['stores.html', 'Stores'],
      ['commands-and-events.html', 'Commandes et événements'],
    ],
  },
  {
    title: 'Les composants',
    items: [
      ['components.html', 'Composants : setup et render'],
      ['reading-a-store.html', 'Lire un store'],
      ['local-state.html', 'État local'],
      ['parents-and-children.html', 'Parents et enfants'],
      ['templates.html', 'Templates : les fichiers .super'],
      ['forms.html', 'Formulaires'],
      ['ui.html', "Kit d'interface"],
    ],
  },
  {
    title: "L'application",
    items: [
      ['router.html', 'Router'],
      ['errors.html', 'Gérer les erreurs'],
      ['application.html', "Brancher l'application"],
      ['ports-adapters.html', 'Ports et adapters'],
    ],
  },
  {
    title: 'Qualité',
    items: [
      ['testing.html', 'Tester'],
      ['tooling.html', 'Outillage des .super'],
      ['guarantees.html', 'Ce que le compilateur vérifie'],
    ],
  },
  {
    title: 'Référence',
    items: [
      ['api.html', 'API'],
      ['faq.html', 'Questions fréquentes'],
      ['limitations.html', 'Limites'],
      ['roadmap.html', 'Chantiers et questions ouvertes'],
    ],
  },
];

// La doc en markdown, générée par docs/tools/build-docs-index.mjs (voir docs/tools/llms.mjs).
const LLMS_FILES = [
  ['llms.txt', 'llms.txt (index)'],
  ['llms-full.txt', 'llms-full.txt'],
  ['llms-small.txt', 'llms-small.txt'],
];

const KEYWORDS = new Set(
  (
    'import from export const let var function return if else async await type interface extends new true false ' +
    'null undefined void declare module as of for while try catch throw class typeof keyof in default readonly'
  ).split(' '),
);

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Même règle que docs/tools/build-docs-index.mjs : les ancres doivent correspondre. */
function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function dedent(source) {
  const lines = source.replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length));
  return lines.map((line) => line.slice(indent)).join('\n');
}

function highlight(code, lang) {
  if (lang === 'text') return escapeHtml(code);
  const comment = lang === 'bash' ? '#[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
  // Fichiers `.super` : une apostrophe collée à une lettre est du texte (« l'instant »), pas une
  // chaîne ; une balise (`<main`, `</p`, `<ConfirmDialog`) est colorée, pas un `Map<string>`.
  const pattern = new RegExp(
    `(${comment})|((?<![\\p{L}\\d])(?:'(?:\\\\.|[^'\\\\\\n])*'|"(?:\\\\.|[^"\\\\\\n])*"|\`(?:\\\\.|[^\`\\\\])*\`))|((?<![\\w$])<\\/?[A-Za-z][\\w.-]*)|\\b([A-Za-z_]+)\\b|\\b(\\d+)\\b`,
    'gu',
  );
  let html = '';
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    html += escapeHtml(code.slice(last, match.index));
    const [token, isComment, isString, tag, word, number] = match;
    if (isComment) html += `<span class="tok-comment">${escapeHtml(token)}</span>`;
    else if (isString) html += `<span class="tok-string">${escapeHtml(token)}</span>`;
    else if (tag && lang !== 'bash') html += `<span class="tok-tag">${escapeHtml(token)}</span>`;
    else if (word && lang !== 'bash' && KEYWORDS.has(word)) html += `<span class="tok-keyword">${token}</span>`;
    else if (number) html += `<span class="tok-number">${token}</span>`;
    else html += escapeHtml(token);
    last = match.index + token.length;
  }
  return html + escapeHtml(code.slice(last));
}

function renderCodeBlocks(root) {
  for (const block of root.querySelectorAll('script[type="text/x-code"]')) {
    const code = dedent(block.textContent);
    const lang = block.dataset.lang ?? 'ts';
    const figure = document.createElement('figure');
    figure.className = 'code';
    if (block.dataset.title) {
      const caption = document.createElement('figcaption');
      const title = document.createElement('span');
      title.textContent = block.dataset.title;
      caption.append(title);
      // Extrait tiré de l'app d'exemples : lien vers le fichier complet.
      if (block.dataset.source) {
        const link = document.createElement('a');
        link.href = `../${block.dataset.source}`;
        link.textContent = 'Voir le fichier';
        link.title = block.dataset.source;
        caption.append(link);
      }
      figure.append(caption);
    }
    const pre = document.createElement('pre');
    pre.innerHTML = `<code>${highlight(code, lang)}</code>`;
    const copy = document.createElement('button');
    copy.className = 'icon-button copy';
    copy.type = 'button';
    copy.textContent = 'Copier';
    copy.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(code);
      copy.textContent = 'Copié';
      setTimeout(() => (copy.textContent = 'Copier'), 1500);
    });
    figure.append(pre, copy);
    block.replaceWith(figure);
  }
}

function currentPage() {
  const file = location.pathname.split('/').pop();
  return file === '' ? 'index.html' : file;
}

function buildHeader() {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <button class="icon-button menu-button" type="button" aria-label="Menu">Menu</button>
    <a class="brand" href="index.html">Super<span>.</span></a>
    <div class="search" role="search">
      <input type="search" placeholder="Rechercher dans la doc (touche /)" aria-label="Rechercher" autocomplete="off" />
      <ul class="search-results" hidden></ul>
    </div>
    <div class="header-spacer"></div>
    <button class="icon-button theme-button" type="button" aria-label="Changer de thème">Thème</button>
  `;
  header.querySelector('.menu-button').addEventListener('click', () => document.body.classList.toggle('menu-open'));
  header.querySelector('.theme-button').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('super-docs-theme', next);
  });
  return header;
}

function buildSidebar(page) {
  const nav = document.createElement('nav');
  nav.className = 'sidebar';
  nav.setAttribute('aria-label', 'Sommaire');
  nav.innerHTML = NAV.map(
    (group) => `
      <h2>${group.title}</h2>
      <ul>${group.items
        .map(([href, label]) => `<li><a href="${href}"${href === page ? ' aria-current="page"' : ''}>${label}</a></li>`)
        .join('')}</ul>`,
  ).join('') +
    `<h2>Pour les LLM</h2>
      <ul>${LLMS_FILES.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}</ul>`;
  return nav;
}

function buildToc(article) {
  const toc = document.createElement('aside');
  toc.className = 'toc';
  const headings = [...article.querySelectorAll('h2, h3')];
  for (const heading of headings) {
    if (!heading.id) heading.id = slugify(heading.textContent);
    const anchor = document.createElement('a');
    anchor.className = 'anchor';
    anchor.href = `#${heading.id}`;
    anchor.textContent = '#';
    anchor.setAttribute('aria-hidden', 'true');
    heading.append(anchor);
  }
  if (headings.length === 0) return toc;
  toc.innerHTML = `<h2>Sur cette page</h2><ul>${headings
    .map(
      (heading) =>
        `<li><a class="depth-${heading.tagName[1]}" href="#${heading.id}">${escapeHtml(
          heading.textContent.replace(/#$/, ''),
        )}</a></li>`,
    )
    .join('')}</ul>`;

  const links = new Map([...toc.querySelectorAll('a')].map((link) => [link.getAttribute('href').slice(1), link]));
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of links.values()) link.classList.remove('active');
        links.get(entry.target.id)?.classList.add('active');
      }
    },
    { rootMargin: '0px 0px -75% 0px' },
  );
  headings.forEach((heading) => observer.observe(heading));
  return toc;
}

function buildPager(page) {
  const flat = NAV.flatMap((group) => group.items);
  const index = flat.findIndex(([href]) => href === page);
  if (index === -1) return null;
  const pager = document.createElement('nav');
  pager.className = 'pager';
  pager.setAttribute('aria-label', 'Pages voisines');
  const previous = flat[index - 1];
  const next = flat[index + 1];
  pager.innerHTML =
    (previous ? `<a class="prev" href="${previous[0]}"><small>Précédent</small>${previous[1]}</a>` : '<span></span>') +
    (next ? `<a class="next" href="${next[0]}"><small>Suivant</small>${next[1]}</a>` : '<span></span>');
  return pager;
}

/* Recherche ---------------------------------------------------------------------------------- */

function search(query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const results = [];
  for (const entry of window.SEARCH_INDEX ?? []) {
    const title = normalize(entry.title);
    const page = normalize(entry.page);
    const text = normalize(entry.text);
    if (!terms.every((term) => title.includes(term) || page.includes(term) || text.includes(term))) continue;
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 10;
      if (page.includes(term)) score += 3;
      score += Math.min(text.split(term).length - 1, 5);
    }
    results.push({ entry, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 12);
}

function snippet(text, query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const plain = normalize(text);
  const at = Math.max(0, plain.indexOf(terms[0] ?? ''));
  const start = Math.max(0, at - 60);
  let excerpt = (start > 0 ? '… ' : '') + text.slice(start, start + 170) + (start + 170 < text.length ? ' …' : '');
  excerpt = escapeHtml(excerpt);
  for (const term of terms) {
    if (term.length < 2) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    excerpt = excerpt.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
  }
  return excerpt;
}

function setupSearch(header) {
  const input = header.querySelector('.search input');
  const list = header.querySelector('.search-results');
  let selected = -1;

  const render = () => {
    const query = input.value.trim();
    if (!query) {
      list.hidden = true;
      return;
    }
    const results = search(query);
    selected = results.length ? 0 : -1;
    list.innerHTML = results.length
      ? results
          .map(
            ({ entry }, i) => `<li><a href="${entry.url}"${i === 0 ? ' aria-selected="true"' : ''}>
              <div class="result-page">${escapeHtml(entry.page)}</div>
              <div class="result-title">${escapeHtml(entry.title)}</div>
              <div class="result-snippet">${snippet(entry.text, query)}</div></a></li>`,
          )
          .join('')
      : '<li class="search-empty">Aucun résultat. Essaie un autre mot, par exemple « await », « sélecteur » ou « signal ».</li>';
    list.hidden = false;
  };

  const select = (delta) => {
    const links = [...list.querySelectorAll('a')];
    if (!links.length) return;
    selected = (selected + delta + links.length) % links.length;
    links.forEach((link, i) => link.setAttribute('aria-selected', String(i === selected)));
    links[selected].scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') (event.preventDefault(), select(1));
    else if (event.key === 'ArrowUp') (event.preventDefault(), select(-1));
    else if (event.key === 'Enter') {
      const link = list.querySelectorAll('a')[selected];
      if (link) location.href = link.href;
    } else if (event.key === 'Escape') {
      list.hidden = true;
      input.blur();
    }
  });
  document.addEventListener('click', (event) => {
    if (!header.querySelector('.search').contains(event.target)) list.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
    if (!typing && (event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key === 'k'))) {
      event.preventDefault();
      input.focus();
    }
  });
}

/* Assemblage --------------------------------------------------------------------------------- */

(function init() {
  const stored = localStorage.getItem('super-docs-theme');
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = stored ?? (prefersDark ? 'dark' : 'light');

  const page = currentPage();
  const article = document.querySelector('article');
  renderCodeBlocks(article);

  const header = buildHeader();
  const layout = document.createElement('div');
  layout.className = 'layout';
  const main = document.createElement('main');
  main.append(article);
  const pager = buildPager(page);
  if (pager) main.append(pager);
  layout.append(buildSidebar(page), main, buildToc(article));
  document.body.prepend(header, layout);
  setupSearch(header);

  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
})();
