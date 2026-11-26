import { flush, mount } from '@super-ts/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformWithOxc } from 'vite';
import { Composition } from './__fixtures__/runtime/composition';
import { Declared } from './__fixtures__/runtime/declared';
import { Empty, Toggled } from './__fixtures__/runtime/empty';
import { Showcase } from './__fixtures__/runtime/showcase';
import { compile, normalizeText } from './compile.ts';
import { composeMap, lineStarts, originalPositionFor, positionOf } from './source-map.ts';

/** Le composant `showcase.super`, compilé par le plugin Vite, monté dans le DOM de test. */
async function setup() {
  const { container, element } = await mount(Showcase);
  const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
  const set = async (patch: Parameters<typeof element.local.set>[0]) => {
    element.local.set(patch);
    await flush();
  };
  return { container, element, $, set };
}

describe('compile : rendu d’un .super', () => {
  it('rend texte, interpolations et éléments imbriqués, avec les espaces du HTML', async () => {
    const { $ } = await setup();
    expect($('h1').textContent).toBe('Total : 2 éléments');
    expect($('.text').textContent).toBe('Une phrase sur deux lignes');
    expect($('.literal').textContent).toBe('for (more) see below `$` \\ fin');
  });

  it('rend plusieurs éléments à la suite dans render', async () => {
    const { container } = await setup();
    expect(container.querySelector('lang-showcase > footer')?.textContent).toBe('après la section');
  });

  it('suit if / else', async () => {
    const { $, set } = await setup();
    expect($('.empty')).toBeNull();
    await set({ items: [] });
    expect($('.empty').textContent).toBe('Vide');
    expect($('.keyed')).toBeNull();
  });

  it('garde les éléments d’une boucle à clé quand l’ordre change', async () => {
    const { container, element, set } = await setup();
    const alpha = container.querySelector('[data-id="a"]');
    await set({ items: [...element.local.get().items].reverse() });
    const rows = [...container.querySelectorAll('.keyed li')];
    expect(rows.map((li) => li.textContent)).toEqual(['Beta', 'Alpha']);
    expect(rows[1]).toBe(alpha); // le même nœud, déplacé
  });

  it('rend une boucle sans clé, avec une déclaration dans son corps', async () => {
    const { container } = await setup();
    expect([...container.querySelectorAll('.plain li')].map((li) => li.textContent)).toEqual(['ALPHA', 'BETA']);
  });

  it('choisit la branche d’un switch', async () => {
    const { $, set } = await setup();
    expect($('.status').textContent).toBe('au repos');
    await set({ status: 'busy' });
    expect($('.status').textContent).toBe('occupé');
    await set({ status: 'done' });
    expect($('.status').textContent).toBe('fini');
  });

  it('branche écouteurs, attributs booléens, attributs retirés par null, propriétés et références', async () => {
    const { $, element, set } = await setup();
    $('.counter').click();
    await flush();
    expect($('.counter').textContent).toBe('Cliquer 1');

    expect($('.counter').hasAttribute('disabled')).toBe(false);
    await set({ busy: true });
    expect($('.counter').hasAttribute('disabled')).toBe(true);

    expect($('section').hasAttribute('title')).toBe(false);
    await set({ title: 'Titre' });
    expect($('section').getAttribute('title')).toBe('Titre');

    expect(($('input') as HTMLInputElement).value).toBe('prérempli');
    expect(element.input.value).toBe($('input'));
  });

  it('monte un composant enfant .super avec ses props et écoute ses événements', async () => {
    const { $ } = await setup();
    expect($('.badge').textContent).toBe('Nouveau');
    $('.badge').click();
    await flush();
    expect($('.picked').textContent).toBe('Nouveau');
  });

  it('un return anticipé dans render ne rend rien de plus', async () => {
    const { container, set } = await setup();
    await set({ hidden: true });
    expect(container.querySelector('section')).toBeNull();
  });
});

describe('compile : un composant qui ne rend rien', () => {
  it('se monte et reste vide', async () => {
    const { element } = await mount(Empty);
    expect(element.isConnected).toBe(true);
    expect(element.textContent).toBe('');
    expect(element.children).toHaveLength(0);
  });

  it('passe de rien à quelque chose, et revient à rien', async () => {
    const { element } = await mount(Toggled);
    expect(element.children).toHaveLength(0);
    element.local.set({ shown: true });
    await flush();
    expect(element.querySelector('p')?.textContent).toBe('Visible');
    element.local.set({ shown: false });
    await flush();
    expect(element.children).toHaveLength(0);
  });
});

describe('compile : enfants d’un composant', () => {
  it('place les enfants et les emplacements nommés (par une méthode ou par <:nom>)', async () => {
    const { container } = await mount(Composition);
    const [first, second] = [...container.querySelectorAll('lang-panel')];
    expect(first?.querySelector('.body .child')?.textContent).toBe('Clics : 0');
    expect(first?.querySelector('footer .by-method')?.textContent).toBe('par une méthode (0)');
    expect(second?.querySelector('.body .second')?.textContent).toBe('sans pied par méthode');
    expect(second?.querySelector('footer .by-slot')?.textContent).toBe('par un emplacement');
  });

  it('les enfants restent ceux du parent : ses écouteurs et son état, mis à jour à son rendu', async () => {
    const { container } = await mount(Composition);
    (container.querySelector('.add') as HTMLElement).click();
    await flush();
    expect(container.querySelector('.child')?.textContent).toBe('Clics : 1');
    expect(container.querySelector('.by-method')?.textContent).toBe('par une méthode (1)');
  });

  it('le composant qui les reçoit les garde quand il se re-rend seul', async () => {
    const { container } = await mount(Composition);
    const panel = container.querySelector('lang-panel') as HTMLElement;
    (panel.querySelector('.toggle') as HTMLElement).click();
    await flush();
    expect(panel.querySelector('.body')).toBeNull();
    (panel.querySelector('.toggle') as HTMLElement).click();
    await flush();
    expect(panel.querySelector('.body .child')?.textContent).toBe('Clics : 0');
  });
});

describe('compile : code produit', () => {
  it('garde les numéros de ligne de la source', () => {
    const source = `import { SuperElement } from '@super-ts/dom';\nexport class A extends SuperElement {\n  @tag = 'a-a';\n  render() {\n    <ul>\n      for (const x of [1, 2]; key x) {\n        <li>{x}</li>\n      }\n    </ul>\n    const after = 1;\n  }\n}\n`;
    const { code, diagnostics } = compile(source);
    expect(diagnostics).toEqual([]);
    expect(code.split('\n')).toHaveLength(source.split('\n').length);
    expect(code.split('\n')[9]).toContain('const after = 1;');
  });

  it('produit une source map qui ramène le JS final à la bonne ligne et colonne du .super', async () => {
    const file = join(import.meta.dirname, '__fixtures__/runtime/showcase.super');
    const source = readFileSync(file, 'utf8');
    const compiled = compile(source);
    const js = await transformWithOxc(compiled.code, `${file}.ts`, { lang: 'ts', sourcemap: true });
    const map = composeMap(file, source, compiled.code, compiled.copied, js.map?.mappings ?? '');
    // Des expressions recopiées à différents niveaux : boucle à clé, corps de boucle, écouteur, attribut.
    for (const token of ['item.id', 'toUpperCase', 'clicks + 1', 'this.input', 'prérempli']) {
      const generated = positionOf(lineStarts(js.code), js.code.indexOf(token, js.code.indexOf('render()')));
      const expected = positionOf(lineStarts(source), source.indexOf(token, source.indexOf('render()')));
      expect(originalPositionFor(map, generated.line, generated.column), token).toEqual(expected);
    }
  });

  it('ne rend pas les blancs en début et fin de bloc', async () => {
    const { $ } = await setup();
    expect($('.status').previousSibling?.textContent ?? '').not.toMatch(/^\s+$/);
    expect(compile('class A {\n  render() {\n    <div>switch (s) { case 1: <p /> default: <b /> }</div>\n  }\n}\n').code).not.toContain(
      '` <p',
    );
  });

  it('refuse un élément hors d’une méthode de classe', () => {
    const { diagnostics } = compile('function f() {\n  <p />\n}\n');
    expect(diagnostics[0]?.message).toContain('dans une méthode de classe');
  });

  it('traite les blancs comme le HTML : une espace par suite de blancs, rien au bord', () => {
    expect(normalizeText('Total : ')).toBe('Total : ');
    expect(normalizeText('\n  Une phrase\n  sur deux lignes\n')).toBe(' Une phrase sur deux lignes ');
    const code = compile(
      'class A {\n  render() {\n    <p>\n      contenant\n      <code>x</code>\n      <b>a</b>\n      <i>b</i>\n    </p>\n  }\n}\n',
    ).code;
    expect(code).toContain('<p>contenant <code>x</code> <b>a</b> <i>b</i></p>');
    // Au niveau de la méthode aussi, sauf si du code les sépare.
    const top = compile('class A {\n  render() {\n    <a />\n    <b />\n    const x = 1;\n    <i />\n  }\n}\n').code;
    expect(top.match(/__out\.push\(' '\)/g)).toHaveLength(1);
  });
});

describe('compile : déclarations d’un composant', () => {
  it('@prop devient this.nom, suit les props, et garde sa valeur par défaut d’un rendu à l’autre', async () => {
    const picked: string[] = [];
    const { container, element, setProps } = await mount(Declared, {
      props: { label: 'Thé' },
      on: { picked: ({ label }) => picked.push(label) },
    });
    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('Thé');
    expect(button.className).toBe('neutral');
    const tags = element.tags;
    expect(element.tags).toBe(tags); // la valeur par défaut est calculée une fois par instance

    await setProps({ label: 'Café', tone: 'danger' });
    expect(button.textContent).toBe('Café');
    expect(button.className).toBe('danger');
    button.click();
    expect(picked).toEqual(['Café']);
  });

  it('@title pose un titre suivi', async () => {
    const { setProps } = await mount(Declared, { props: { label: 'Thé' } });
    expect(document.title).toBe('Étiquette Thé');
    await setProps({ label: 'Café' });
    expect(document.title).toBe('Étiquette Café');
  });
});
