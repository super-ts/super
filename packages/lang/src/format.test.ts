import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatWithBiome } from './biome.ts';
import { compile } from './compile.ts';
import { formatSuper } from './format.ts';

const ROOT = join(import.meta.dirname, '../../..');
const format = (source: string, file = join(ROOT, 'examples/demo/src/@components/test.super'), lineWidth = 140) =>
  formatSuper(source, { formatTs: (code) => formatWithBiome(code, file), lineWidth });

/**
 * Le rendu d'un fichier, tel que le compilateur le produit : le texte des templates compte au
 * caractère près (un blanc en plus ou en moins change le rendu), les blancs du code autour non.
 */
function rendering(source: string): string {
  const { code, diagnostics } = compile(source);
  if (diagnostics.length > 0) throw new Error(diagnostics[0]?.message);
  let out = '';
  const modes: Array<'code' | 'template'> = ['code'];
  const depths: number[] = [0];
  for (let i = 0; i < code.length; i++) {
    const c = code[i] as string;
    const mode = modes.at(-1);
    if (mode === 'template') {
      if (c === '\\') out += c + code[++i];
      else if (c === '`') {
        modes.pop();
        out += c;
      } else if (c === '$' && code[i + 1] === '{') {
        modes.push('code');
        depths.push(0);
        out += '${';
        i++;
      } else out += c;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      // Commentaire de ligne : ne rend rien.
      const end = code.indexOf('\n', i);
      i = end === -1 ? code.length : end;
    } else if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? code.length : end + 1;
    } else if (c === '`') {
      modes.push('template');
      out += c;
    } else if (c === '"' || c === "'") {
      // Une chaîne, sur sa ligne (échappements compris) ; sinon le caractère seul.
      let end = i + 1;
      while (end < code.length && code[end] !== c && code[end] !== '\n') end += code[end] === '\\' ? 2 : 1;
      if (code[end] !== c) out += c;
      else {
        out += code.slice(i, end + 1);
        i = end;
      }
    } else if (c === '{') {
      depths[depths.length - 1] = (depths.at(-1) as number) + 1;
      out += c;
    } else if (c === '}') {
      if (depths.at(-1) === 0 && modes.length > 1) {
        modes.pop();
        depths.pop();
      } else depths[depths.length - 1] = (depths.at(-1) as number) - 1;
      out += c;
    } else if (!/\s/.test(c)) out += c;
  }
  return out;
}

const superFiles = execSync(
  `find ${ROOT}/examples ${ROOT}/packages -type f -name '*.super' -not -path '*/node_modules/*' -not -path '*/.super/*'`,
  {
    encoding: 'utf8',
  },
)
  .trim()
  .split('\n')
  .filter((f) => !f.endsWith('project/errors.super'));

describe('formatSuper sur les .super du dépôt', () => {
  it.each(superFiles.map((f) => [f.slice(ROOT.length + 1), f]))('%s : idempotent, et le rendu ne change pas', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    const once = format(source, file) as string;
    expect(once).not.toBeNull();
    expect(format(once, file)).toBe(once);
    expect(rendering(once)).toBe(rendering(source));
  });
});

describe('formatSuper', () => {
  const component = (render: string) =>
    `import { SuperElement } from '@super-ts/dom';\n\nexport class A extends SuperElement {\n  @tag = 'a-a';\n\n  render() {\n${render}\n  }\n}\n`;

  it('formate aussi le TS (Biome), et laisse un fichier valide tel quel s’il l’est déjà', () => {
    const out = format(component('    const x = {a:1};\n    <p>{x.a}</p>'));
    expect(out).toContain('const x = { a: 1 };');
    expect(out).toContain('    <p>{x.a}</p>');
    expect(format(out as string)).toBe(out);
  });

  it('passe les attributs à la ligne quand la balise ne tient pas', () => {
    const out = format(
      component('    <button type="button" aria-label="Ajouter un article au panier" on:click={() => this.add()}>Ajouter</button>'),
      undefined,
      60,
    );
    expect(out).toContain(
      [
        '    <button',
        '      type="button"',
        '      aria-label="Ajouter un article au panier"',
        '      on:click={() => this.add()}',
        '    >',
      ].join('\n'),
    );
  });

  it('ne coupe jamais entre deux éléments collés (ce serait ajouter une espace)', () => {
    const out = format(
      component('    <p><b>aaaaaaaaaaaaaaaaaaaa</b><i>bbbbbbbbbbbbbbbbbbbbbbbbb</i><b>cccccccccccccccccccccc</b></p>'),
      undefined,
      40,
    ) as string;
    expect(out).toContain('<b>aaaaaaaaaaaaaaaaaaaa</b><i>bbbbbbbbbbbbbbbbbbbbbbbbb</i><b>cccccccccccccccccccccc</b>');
  });

  it('remplit le texte suivi, éléments en ligne compris, et garde les lignes vides', () => {
    const out = format(
      component(
        '    <main>\n      <p>Un texte assez long avec <code>du code</code> au milieu, puis encore du texte pour dépasser.</p>\n\n\n      <p>b</p>\n    </main>',
      ),
      undefined,
      50,
    ) as string;
    expect(out).toContain(
      [
        '      <p>',
        '        Un texte assez long avec',
        '        <code>du code</code> au milieu, puis',
        '        encore du texte pour dépasser.',
        '      </p>',
      ].join('\n'),
    );
    expect(out).toContain('</p>\n\n      <p>b</p>');
    expect(out).not.toContain('\n\n\n');
  });

  it('indente les instructions et leurs blocs', () => {
    const out = format(
      component(
        "    <ul>\n    if (a) {\n    <li>x</li>\n    } else {\n    <li>y</li>\n    }\n    for (const x of xs; key x) { <li>{x}</li> }\n    switch (s) { case 'a': <p>a</p> default: <p>b</p> }\n    </ul>",
      ),
    );
    expect(out).toContain(
      [
        '    <ul>',
        '      if (a) {',
        '        <li>x</li>',
        '      } else {',
        '        <li>y</li>',
        '      }',
        '      for (const x of xs; key x) {',
        '        <li>{x}</li>',
        '      }',
        '      switch (s) {',
        "        case 'a': <p>a</p>",
        '        default: <p>b</p>',
        '      }',
        '    </ul>',
      ].join('\n'),
    );
  });

  it('écrit toujours sur plusieurs lignes un composant à enfants et un emplacement, même s’ils tiennent', () => {
    const out = format(component('    <Card title="x"><p>a</p><:actions><b>ok</b></:actions></Card>\n    <Card title="vide"></Card>'));
    expect(out).toContain(
      [
        '    <Card title="x">',
        '      <p>a</p>',
        '      <:actions>',
        '        <b>ok</b>',
        '      </:actions>',
        '    </Card>',
        '    <Card title="vide"></Card>',
      ].join('\n'),
    );
  });

  it('ne formate pas un fichier qui a des erreurs de syntaxe', () => {
    expect(format(component('    <p>for (x) y</p>'))).toBeNull();
  });
});
