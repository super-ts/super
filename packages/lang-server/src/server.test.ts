import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { positionOf, TestClient } from './test-client.ts';

/**
 * Le serveur `.super`, piloté comme Zed le fait : fichiers ouverts en `typescriptreact`, erreurs
 * poussées par le serveur (pas demandées), `.ts` envoyés aussi.
 */
const ROOT = join(import.meta.dirname, '../../..');
const PROJECT = join(import.meta.dirname, '__fixtures__/project');
const CARD = join(PROJECT, 'card.super');
const SOURCE = readFileSync(CARD, 'utf8');

/** `card.super` avec `replace` à la place de `search`. */
const variant = (search: string, replace: string) => {
  if (!SOURCE.includes(search)) throw new Error(`« ${search} » introuvable dans card.super`);
  return SOURCE.replace(search, replace);
};

const ERRORS = variant(
  '      <ul>',
  `      <Greeting nam="Ada" />
      <p>for (more info) see below</p>
      <ul>`,
).replace('<li>{item.label}</li>', '<li>{item}</li>');

let client: TestClient;
let uri: string;
let version = 1;
const show = async (text: string) => {
  client.change(uri, ++version, text);
};
const labels = (completion: any): string[] =>
  (Array.isArray(completion) ? completion : (completion?.items ?? [])).map((i: { label: string }) => i.label);

/** Le serveur piloté : ses sources, ou un serveur assemblé (`SUPER_LS_SERVER`, voir `npm run smoke`). */
const SERVER = process.env.SUPER_LS_SERVER ?? join(import.meta.dirname, 'server.ts');

beforeAll(async () => {
  client = new TestClient(SERVER, ['--stdio']);
  await client.initialize(ROOT);
  uri = client.open(CARD, 'typescriptreact');
}, 30000);

afterAll(() => client.close());

describe('serveur .super', () => {
  it('un .super valide, ouvert en typescriptreact comme le fait Zed, n’a aucune erreur', async () => {
    // Attendre la seconde publication (la première ne contient que la syntaxe) : on vérifie juste qu'elle est vide.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await client.diagnostics(uri)).toEqual([]);
  }, 30000);

  it('pousse les erreurs de TS et du parser, aux positions du .super', async () => {
    await show(ERRORS);
    const diagnostics = await client.diagnostics(uri, (d) => d.length >= 3);
    const at = (needle: string) => positionOf(ERRORS, needle).line;
    const lineOf = (message: string) => diagnostics.find((d) => d.message.includes(message))?.range.start.line;
    expect(lineOf("'nam' does not exist in type 'Props'")).toBe(at('<Greeting nam="Ada"'));
    expect(lineOf("Argument of type 'Item' is not assignable")).toBe(at('<li>{item}'));
    expect(lineOf('Texte lu comme `for`')).toBe(at('for (more info)'));
    expect(diagnostics).toHaveLength(3);
  }, 30000);

  it('propose « Entourer d’accolades » pour un texte ambigu, sur le fichier .super lui-même', async () => {
    const diagnostics = await client.diagnostics(uri, (d) => d.some((x) => x.source === 'super'));
    const ambiguous = diagnostics.find((d) => d.source === 'super');
    const actions = await client.request('textDocument/codeAction', {
      textDocument: { uri },
      range: ambiguous?.range,
      context: { diagnostics: [ambiguous] },
    });
    const fix = actions.find((a: { title: string }) => a.title === 'Entourer d’accolades');
    expect(fix.edit.changes[uri]).toEqual([{ range: ambiguous?.range, newText: "{'for (more info) see below'}" }]);
  });

  it('complète dans une clé de boucle et dans la condition d’un if, sans les noms internes', async () => {
    await show(SOURCE);
    await client.diagnostics(uri, (d) => d.length === 0);
    const key = await client.request('textDocument/completion', { textDocument: { uri }, position: positionOf(SOURCE, 'key item.', 9) });
    expect(labels(key)).toEqual(expect.arrayContaining(['id', 'label']));
    const condition = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: positionOf(SOURCE, 'if (user', 4),
    });
    expect(labels(condition)).toContain('user');
    expect(labels(condition).filter((l) => l.startsWith('__'))).toEqual([]);
  }, 30000);

  it('complète une déclaration en cours de frappe dans le template (sans `;`), et signale le `;` manquant', async () => {
    const typing = variant('      if (user) {', '      const label = this.\n      if (user) {');
    await show(typing);
    const diagnostics = await client.diagnostics(uri, (d) => d.some((x) => x.message.includes('`;` manquant')));
    expect(diagnostics.map((d) => d.message)).toEqual(['`;` manquant à la fin de la déclaration']);
    const completion = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: positionOf(typing, 'const label = this.', 19),
    });
    expect(labels(completion)).toContain('local');
  }, 30000);

  it('complète une déclaration en cours de frappe dans la méthode, sans casser le template qui suit', async () => {
    const typing = variant('const user = this.local.get().user;', 'const user = this.');
    await show(typing);
    const completion = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: positionOf(typing, 'const user = this.', 18),
    });
    expect(labels(completion)).toContain('local');
    // Le template est toujours lu comme tel : la balise <Greeting> reste un composant.
    const definition = await client.request('textDocument/definition', {
      textDocument: { uri },
      position: positionOf(typing, '<Greeting', 2),
    });
    expect(JSON.stringify(definition)).toContain('greeting.ts');
    await show(SOURCE);
  }, 30000);

  it('complète dans une condition en cours de frappe dans le template, avant même la parenthèse fermante', async () => {
    for (const typed of ['if (this.', 'if (this.)', 'if (this.) {']) {
      const typing = variant('      <ul>', `      ${typed}\n      <ul>`);
      await show(typing);
      // L'erreur de syntaxe de la ligne en cours ; tant que la condition n'a pas de bloc, pas d'erreur TS en plus.
      const diagnostics = await client.diagnostics(uri, (d) => d.some((x) => x.source === 'super'));
      if (!typed.endsWith('{'))
        expect(
          diagnostics.map((d) => `${d.source} ${d.message}`),
          typed,
        ).toEqual([expect.stringMatching(/^super /)]);
      const completion = await client.request('textDocument/completion', {
        textDocument: { uri },
        position: positionOf(typing, `${typed}\n`, 'if (this.'.length),
      });
      expect(labels(completion), typed).toContain('local');
    }
    await show(SOURCE);
  }, 60000);

  it('complète dans une boucle en cours de frappe dans le template, dans la clé comme dans l’itérable', async () => {
    const head = 'for (const c of this.local.get().items; key c.';
    // `key` n'existe que dans un élément : au niveau de la méthode, la boucle est du TS ordinaire.
    const cases: Array<[string, string, string[], boolean]> = [
      [head, head, ['id', 'label'], false],
      [`${head})`, head, ['id', 'label'], false],
      [`${head}) {`, head, ['id', 'label'], false],
      ['for (const c of this.', 'for (const c of this.', ['local'], true],
      ['for (const c of this.)', 'for (const c of this.', ['local'], true],
    ];
    for (const [typed, cursor, expected, inMethod] of cases) {
      for (const indent of inMethod ? ['        ', '    '] : ['        ']) {
        // Dans un élément (`<ul>`), puis au niveau de la méthode (avant `<section>`).
        const anchor = indent.length > 4 ? '      <ul>' : '    <section>';
        const typing = variant(anchor, `${indent}${typed}\n${anchor}`);
        await show(typing);
        await client.diagnostics(uri, (d) => d.some((x) => x.source === 'super' || x.message.includes('expected')));
        const completion = await client.request('textDocument/completion', {
          textDocument: { uri },
          position: positionOf(typing, `${indent}${cursor}`, indent.length + cursor.length),
        });
        expect(labels(completion), `${indent.length} ${typed}`).toEqual(expect.arrayContaining(expected));
      }
    }
    await show(SOURCE);
  }, 120000);

  it('complète dans un switch, un else if, une boucle imbriquée et sur une variable locale, en cours de frappe', async () => {
    const cases: Array<[string, string, string, string[]]> = [
      ['      <ul>', '      switch (this.\n      <ul>', '      switch (this.', ['local']],
      ['      }\n      <ul>', '      } else if (this.\n      <ul>', '      } else if (this.', ['local']],
      ['<li>{item.label}</li>', 'for (const c of this.local.get().items; key c.\n<li>{item.label}</li>', 'key c.', ['id', 'label']],
      [
        '      <ul>',
        '      const shown = this.local.get().items;\n      for (const c of shown; key c.\n      <ul>',
        'shown; key c.',
        ['id', 'label'],
      ],
      [
        '      <ul>',
        '      const shown = this.local.get().items;\n      for (const c of shown; key c.)\n      <ul>',
        'shown; key c.',
        ['id', 'label'],
      ],
    ];
    for (const [search, replace, cursor, expected] of cases) {
      const typing = variant(search, replace);
      await show(typing);
      await client.diagnostics(uri, (d) => d.some((x) => x.source === 'super'));
      const completion = await client.request('textDocument/completion', {
        textDocument: { uri },
        position: positionOf(typing, cursor, cursor.length),
      });
      expect(labels(completion), replace).toEqual(expect.arrayContaining(expected));
    }
    await show(SOURCE);
  }, 120000);

  it('complète dans une condition en cours de frappe au niveau de la méthode', async () => {
    const typing = variant('    const user = this.local.get().user;', '    const user = this.local.get().user;\n    if (this.');
    await show(typing);
    const completion = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: positionOf(typing, '    if (this.', 13),
    });
    expect(labels(completion)).toContain('local');
    await show(SOURCE);
  }, 30000);

  describe('complétion dans les balises', () => {
    /** Les propositions au `|` du template (inséré à la place de `search`). */
    const complete = async (search: string, typed: string) => {
      const text = variant(search, typed.replace('|', ''));
      await show(text);
      const position = positionOf(text, typed.slice(0, typed.indexOf('|')), typed.indexOf('|'));
      return (await client.request('textDocument/completion', { textDocument: { uri }, position })) as {
        items: Array<{ label: string; detail?: string; textEdit?: { newText: string } }>;
      };
    };
    const labelsOf = (list: { items: Array<{ label: string }> }) => list.items.map((i) => i.label);

    it('propose les composants en portée et les balises HTML après `<`', async () => {
      const list = await complete('      <ul>', '      <Gre|\n      <ul>');
      expect(labelsOf(list)).toEqual(expect.arrayContaining(['Greeting', 'section', 'button']));
      expect(list.items.find((i) => i.label === 'Greeting')?.detail).toBe('composant');
    }, 30000);

    it('propose les composants du projet pas encore importés, avec l’import', async () => {
      const list = (await complete('      <ul>', '      <Bad|\n      <ul>')) as {
        items: Array<{
          label: string;
          detail?: string;
          additionalTextEdits?: Array<{ range: { start: { line: number } }; newText: string }>;
        }>;
      };
      const badge = list.items.find((i) => i.label === 'Badge');
      expect(badge?.detail).toBe("composant, import depuis './badge'");
      expect(badge?.additionalTextEdits).toEqual([
        { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } }, newText: "import { Badge } from './badge';\n" },
      ]);
      // Un module déjà importé : le nom s'ajoute à son import (`RouterOutlet` vient de `@super-ts/dom`, comme `SuperElement`).
      const outlet = list.items.find((i) => i.label === 'RouterOutlet');
      expect(outlet?.detail).toBe("composant, import depuis '@super-ts/dom'");
      expect(outlet?.additionalTextEdits?.[0]?.newText).toBe(' RouterOutlet, SuperElement ');
      // Un composant déjà importé n'est pas proposé une seconde fois avec un import.
      expect(list.items.filter((i) => i.label === 'Greeting')).toHaveLength(1);
      expect(list.items.find((i) => i.label === 'Greeting')?.additionalTextEdits).toBeUndefined();
    }, 30000);

    it('propose les emplacements nommés d’un composant après `<:`, et pas `content`', async () => {
      const text = variant(
        "import { Greeting } from './greeting';",
        "import { Greeting } from './greeting';\nimport { Panel } from './panel';",
      ).replace('      <ul>', '      <Panel heading="x">\n        <:fo\n      </Panel>\n      <ul>');
      await show(text);
      const list = (await client.request('textDocument/completion', { textDocument: { uri }, position: positionOf(text, '<:fo', 4) })) as {
        items: Array<{ label: string; detail?: string; textEdit?: { newText: string } }>;
      };
      expect(list.items.map((i) => i.label)).toEqual([':footer']);
      expect(list.items[0]?.detail).toBe('emplacement (facultatif)');
      expect(list.items[0]?.textEdit?.newText).toBe('footer>$0</:footer>');
    }, 30000);

    it('ferme la balise ouverte après `</`', async () => {
      const list = await complete('          <li>{item.label}</li>', '          <li>{item.label}</|');
      expect(list.items.map((i) => i.textEdit?.newText)).toEqual(['li>']);
    }, 30000);

    it('propose les props d’un composant (obligatoires d’abord) et ses événements, sauf ceux déjà écrits', async () => {
      const empty = await complete('        <Greeting name={user.name} />', '        <Greeting |/>');
      expect(labelsOf(empty)).toEqual(['name', 'on:closed']);
      expect(empty.items[0]?.detail).toBe('string (obligatoire)');
      expect(empty.items[0]?.textEdit?.newText).toBe('name={$1}');
      const rest = await complete('        <Greeting name={user.name} />', '        <Greeting name={user.name} |/>');
      expect(labelsOf(rest)).toEqual(['on:closed']);
    }, 30000);

    it('propose les attributs d’une balise HTML, `ref` et ses événements', async () => {
      const list = await complete('      <ul>', '      <ul |>');
      expect(labelsOf(list)).toEqual(
        expect.arrayContaining(['class', 'id', 'hidden', 'aria-label', 'title', 'ref', 'on:click', 'on:input']),
      );
      expect(labelsOf(list)).not.toContain('innerhtml');
      expect(list.items.find((i) => i.label === 'class')?.textEdit?.newText).toBe('class="$1"');
      expect(list.items.find((i) => i.label === 'hidden')?.textEdit?.newText).toBe('hidden');
    }, 30000);

    it('ne double pas les propositions avec celles de TypeScript sur un nom déjà commencé', async () => {
      const list = await complete('        <Greeting name={user.name} />', '        <Greeting na|/>');
      expect(labelsOf(list).filter((l) => l === 'name')).toHaveLength(1);
    }, 30000);

    afterAll(() => show(SOURCE));
  });

  describe('déclarations du composant', () => {
    it('complète `@t` en tag et title, `@em` en emit, et ne repropose pas un @tag déjà écrit', async () => {
      const complete = async (typed: string) => {
        const text = variant('  @state local = {', `  ${typed}\n  @state local = {`);
        await show(text);
        const position = positionOf(text, `  ${typed}`, typed.length + 2);
        return (await client.request('textDocument/completion', { textDocument: { uri }, position })) as {
          items: Array<{ label: string; textEdit?: { newText: string }; documentation?: { value: string } }>;
        };
      };
      const t = await complete('@t');
      expect(t.items.map((i) => i.label)).toContain('title');
      expect(t.items.map((i) => i.label)).not.toContain('tag'); // déjà déclaré dans card.super
      expect(t.items.find((i) => i.label === 'title')?.textEdit?.newText).toBe("title = '${1:Titre}';");
      const em = await complete('@em');
      expect(em.items.find((i) => i.label === 'emit')?.documentation?.value).toContain('événement');
      await show(SOURCE);
    }, 30000);

    it("propose les déclarations de préparation, et les noms de contrats dans `@contract x = '…'` et `@on('…'`", async () => {
      const at = async (typed: string, cursor: string) => {
        const text = variant('  @state local = {', `  ${typed}\n  @state local = {`);
        await show(text);
        const position = positionOf(text, `  ${typed}`, 2 + typed.indexOf(cursor) + cursor.length);
        return labels(await client.request('textDocument/completion', { textDocument: { uri }, position }));
      };
      expect(await at('@s', '@s')).toEqual(expect.arrayContaining(['selector', 'state']));
      expect(await at("@contract shop = 'b';", "'")).toContain('basket');
      expect(await at("@on('b', 'emptied') onEmptied() {}", "@on('")).toContain('basket');
      expect(await at("@on('basket', 'e') onEmptied() {}", "'basket', '")).toContain('emptied');
      await show(SOURCE);
    }, 30000);

    it('après `@contract `, propose les contrats de l’app, sauf ceux déjà déclarés', async () => {
      const at = async (lines: string) => {
        const text = variant('  @state local = {', `${lines}\n  @state local = {`);
        await show(text);
        const position = positionOf(text, lines, lines.length);
        return (await client.request('textDocument/completion', { textDocument: { uri }, position })) as {
          items: Array<{ label: string; detail?: string; textEdit?: { newText: string } }>;
        };
      };
      const list = await at('  @contract ');
      const basket = list.items.find((i) => i.label === 'basket' && i.detail === 'contrat');
      expect(basket?.textEdit?.newText).toBe('basket;');
      const again = await at("  @contract shop = 'basket';\n  @contract b");
      expect(again.items.filter((i) => i.detail === 'contrat').map((i) => i.label)).not.toContain('basket');
      await show(SOURCE);
    }, 30000);

    it('documente @tag au survol', async () => {
      const hover = (await client.request('textDocument/hover', { textDocument: { uri }, position: positionOf(SOURCE, '@tag', 2) })) as {
        contents: { value: string };
      };
      expect(hover.contents.value).toContain('Le **tag** du composant');
    }, 30000);
  });

  it('formate le fichier (Biome pour le TS, le formateur des .super pour les templates)', async () => {
    const messy = variant('    const user = this.local.get().user;', '    const user   =   this.local.get().user')
      .replace('      if (user) {', '  if (user) {')
      .replace('<li>{item.label}</li>', '<li>\n{item.label}\n</li>');
    await show(messy);
    const edits = (await client.request('textDocument/formatting', {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    })) as Array<{ newText: string }>;
    expect(edits).toHaveLength(1);
    expect(edits[0]?.newText).toBe(SOURCE);
    await show(SOURCE);
    // Rien à changer : `null` ou une liste vide.
    const none = await client.request('textDocument/formatting', { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } });
    expect(none ?? []).toEqual([]);
  }, 30000);

  it('mène à la définition d’un composant .ts utilisé comme balise', async () => {
    const definition = await client.request('textDocument/definition', {
      textDocument: { uri },
      position: positionOf(SOURCE, '<Greeting', 2),
    });
    const target = Array.isArray(definition) ? definition[0] : definition;
    expect(target.targetUri ?? target.uri).toBe(pathToFileURL(join(PROJECT, 'greeting.ts')).href);
  });

  it('écrit le TS virtuel sur disque à chaque modification', async () => {
    await show(variant('@tag', 'marker = 42;\n  @tag'));
    const virtual = join(PROJECT, '.super/virtual/card.ts');
    await expect.poll(() => existsSync(virtual) && readFileSync(virtual, 'utf8').includes('marker = 42;'), { timeout: 10000 }).toBe(true);
    await show(SOURCE);
  });

  it('ignore les .ts que Zed lui envoie aussi (leur serveur habituel s’en charge)', async () => {
    const ts = client.open(join(PROJECT, 'greeting.ts'), 'typescript');
    const hover = await client.request('textDocument/hover', { textDocument: { uri: ts }, position: { line: 6, character: 15 } });
    const completion = await client.request('textDocument/completion', {
      textDocument: { uri: ts },
      position: { line: 10, character: 30 },
    });
    expect(hover).toBeNull();
    expect(labels(completion)).toEqual([]);
    expect(client.published.get(ts) ?? []).toEqual([]);
  });
});
