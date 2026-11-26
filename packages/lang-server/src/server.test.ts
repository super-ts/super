import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { positionOf, TestClient } from './test-client.ts';

/**
 * The `.super` server, driven the way Zed drives it: files opened as `typescriptreact`, errors
 * pushed by the server (not requested), `.ts` files sent too.
 */
const ROOT = join(import.meta.dirname, '../../..');
const PROJECT = join(import.meta.dirname, '__fixtures__/project');
const CARD = join(PROJECT, 'card.super');
const SOURCE = readFileSync(CARD, 'utf8');

/** `card.super` with `replace` instead of `search`. */
const variant = (search: string, replace: string) => {
  if (!SOURCE.includes(search)) throw new Error(`"${search}" not found in card.super`);
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

/** The driven server: its sources, or a bundled server (`SUPER_LS_SERVER`, see `npm run smoke`). */
const SERVER = process.env.SUPER_LS_SERVER ?? join(import.meta.dirname, 'server.ts');

beforeAll(async () => {
  client = new TestClient(SERVER, ['--stdio']);
  await client.initialize(ROOT);
  uri = client.open(CARD, 'typescriptreact');
}, 30000);

afterAll(() => client.close());

describe('.super server', () => {
  it('a valid .super file, opened as typescriptreact as Zed does, has no errors', async () => {
    // Wait for the second publication (the first only contains syntax): just check that it is empty.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await client.diagnostics(uri)).toEqual([]);
  }, 30000);

  it('pushes TS and parser errors, at the .super positions', async () => {
    await show(ERRORS);
    const diagnostics = await client.diagnostics(uri, (d) => d.length >= 3);
    const at = (needle: string) => positionOf(ERRORS, needle).line;
    const lineOf = (message: string) => diagnostics.find((d) => d.message.includes(message))?.range.start.line;
    expect(lineOf("'nam' does not exist in type 'Props'")).toBe(at('<Greeting nam="Ada"'));
    expect(lineOf("Argument of type 'Item' is not assignable")).toBe(at('<li>{item}'));
    expect(lineOf('Text read as `for`')).toBe(at('for (more info)'));
    expect(diagnostics).toHaveLength(3);
  }, 30000);

  it('offers the brace-wrapping quick fix for ambiguous text, on the .super file itself', async () => {
    const diagnostics = await client.diagnostics(uri, (d) => d.some((x) => x.source === 'super'));
    const ambiguous = diagnostics.find((d) => d.source === 'super');
    const actions = await client.request('textDocument/codeAction', {
      textDocument: { uri },
      range: ambiguous?.range,
      context: { diagnostics: [ambiguous] },
    });
    const fix = actions.find((a: { title: string }) => a.title === 'Wrap in braces');
    expect(fix.edit.changes[uri]).toEqual([{ range: ambiguous?.range, newText: "{'for (more info) see below'}" }]);
  });

  it('completes in a loop key and in an if condition, without internal names', async () => {
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

  it('completes a declaration being typed in the template (without `;`), and reports the missing `;`', async () => {
    const typing = variant('      if (user) {', '      const label = this.\n      if (user) {');
    await show(typing);
    const diagnostics = await client.diagnostics(uri, (d) => d.some((x) => x.message.includes('Missing `;`')));
    expect(diagnostics.map((d) => d.message)).toEqual(['Missing `;` at the end of the declaration']);
    const completion = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: positionOf(typing, 'const label = this.', 19),
    });
    expect(labels(completion)).toContain('local');
  }, 30000);

  it('completes a declaration being typed in the method, without breaking the template that follows', async () => {
    const typing = variant('const user = this.local.get().user;', 'const user = this.');
    await show(typing);
    const completion = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: positionOf(typing, 'const user = this.', 18),
    });
    expect(labels(completion)).toContain('local');
    // The template is still read as such: the <Greeting> tag stays a component.
    const definition = await client.request('textDocument/definition', {
      textDocument: { uri },
      position: positionOf(typing, '<Greeting', 2),
    });
    expect(JSON.stringify(definition)).toContain('greeting.ts');
    await show(SOURCE);
  }, 30000);

  it('completes in a condition being typed in the template, even before the closing parenthesis', async () => {
    for (const typed of ['if (this.', 'if (this.)', 'if (this.) {']) {
      const typing = variant('      <ul>', `      ${typed}\n      <ul>`);
      await show(typing);
      // The syntax error of the current line; as long as the condition has no block, no extra TS error.
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

  it('completes in a loop being typed in the template, in the key as in the iterable', async () => {
    const head = 'for (const c of this.local.get().items; key c.';
    // `key` only exists inside an element: at method level, the loop is ordinary TypeScript.
    const cases: Array<[string, string, string[], boolean]> = [
      [head, head, ['id', 'label'], false],
      [`${head})`, head, ['id', 'label'], false],
      [`${head}) {`, head, ['id', 'label'], false],
      ['for (const c of this.', 'for (const c of this.', ['local'], true],
      ['for (const c of this.)', 'for (const c of this.', ['local'], true],
    ];
    for (const [typed, cursor, expected, inMethod] of cases) {
      for (const indent of inMethod ? ['        ', '    '] : ['        ']) {
        // Inside an element (`<ul>`), then at method level (before `<section>`).
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

  it('completes in a switch, an else if, a nested loop and on a local variable, while typing', async () => {
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

  it('completes in a condition being typed at method level', async () => {
    const typing = variant('    const user = this.local.get().user;', '    const user = this.local.get().user;\n    if (this.');
    await show(typing);
    const completion = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: positionOf(typing, '    if (this.', 13),
    });
    expect(labels(completion)).toContain('local');
    await show(SOURCE);
  }, 30000);

  describe('completion inside tags', () => {
    /** The suggestions at the template's `|` (inserted instead of `search`). */
    const complete = async (search: string, typed: string) => {
      const text = variant(search, typed.replace('|', ''));
      await show(text);
      const position = positionOf(text, typed.slice(0, typed.indexOf('|')), typed.indexOf('|'));
      return (await client.request('textDocument/completion', { textDocument: { uri }, position })) as {
        items: Array<{ label: string; detail?: string; textEdit?: { newText: string } }>;
      };
    };
    const labelsOf = (list: { items: Array<{ label: string }> }) => list.items.map((i) => i.label);

    it('offers the components in scope and the HTML tags after `<`', async () => {
      const list = await complete('      <ul>', '      <Gre|\n      <ul>');
      expect(labelsOf(list)).toEqual(expect.arrayContaining(['Greeting', 'section', 'button']));
      expect(list.items.find((i) => i.label === 'Greeting')?.detail).toBe('component');
    }, 30000);

    it('offers the project components not yet imported, with the import', async () => {
      const list = (await complete('      <ul>', '      <Bad|\n      <ul>')) as {
        items: Array<{
          label: string;
          detail?: string;
          additionalTextEdits?: Array<{ range: { start: { line: number } }; newText: string }>;
        }>;
      };
      const badge = list.items.find((i) => i.label === 'Badge');
      expect(badge?.detail).toBe("component, import from './badge'");
      expect(badge?.additionalTextEdits).toEqual([
        { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } }, newText: "import { Badge } from './badge';\n" },
      ]);
      // An already imported module: the name is added to its import (`RouterOutlet` comes from `@super-ts/dom`, like `SuperElement`).
      const outlet = list.items.find((i) => i.label === 'RouterOutlet');
      expect(outlet?.detail).toBe("component, import from '@super-ts/dom'");
      expect(outlet?.additionalTextEdits?.[0]?.newText).toBe(' RouterOutlet, SuperElement ');
      // An already imported component is not offered a second time with an import.
      expect(list.items.filter((i) => i.label === 'Greeting')).toHaveLength(1);
      expect(list.items.find((i) => i.label === 'Greeting')?.additionalTextEdits).toBeUndefined();
    }, 30000);

    it('offers the named slots of a component after `<:`, and not `content`', async () => {
      const text = variant(
        "import { Greeting } from './greeting';",
        "import { Greeting } from './greeting';\nimport { Panel } from './panel';",
      ).replace('      <ul>', '      <Panel heading="x">\n        <:fo\n      </Panel>\n      <ul>');
      await show(text);
      const list = (await client.request('textDocument/completion', { textDocument: { uri }, position: positionOf(text, '<:fo', 4) })) as {
        items: Array<{ label: string; detail?: string; textEdit?: { newText: string } }>;
      };
      expect(list.items.map((i) => i.label)).toEqual([':footer']);
      expect(list.items[0]?.detail).toBe('slot (optional)');
      expect(list.items[0]?.textEdit?.newText).toBe('footer>$0</:footer>');
    }, 30000);

    it('closes the open tag after `</`', async () => {
      const list = await complete('          <li>{item.label}</li>', '          <li>{item.label}</|');
      expect(list.items.map((i) => i.textEdit?.newText)).toEqual(['li>']);
    }, 30000);

    it('offers the props of a component (required first) and its events, except those already written', async () => {
      const empty = await complete('        <Greeting name={user.name} />', '        <Greeting |/>');
      expect(labelsOf(empty)).toEqual(['name', 'on:closed']);
      expect(empty.items[0]?.detail).toBe('string (required)');
      expect(empty.items[0]?.textEdit?.newText).toBe('name={$1}');
      const rest = await complete('        <Greeting name={user.name} />', '        <Greeting name={user.name} |/>');
      expect(labelsOf(rest)).toEqual(['on:closed']);
    }, 30000);

    it('offers the attributes of an HTML tag, `ref` and its events', async () => {
      const list = await complete('      <ul>', '      <ul |>');
      expect(labelsOf(list)).toEqual(
        expect.arrayContaining(['class', 'id', 'hidden', 'aria-label', 'title', 'ref', 'on:click', 'on:input']),
      );
      expect(labelsOf(list)).not.toContain('innerhtml');
      expect(list.items.find((i) => i.label === 'class')?.textEdit?.newText).toBe('class="$1"');
      expect(list.items.find((i) => i.label === 'hidden')?.textEdit?.newText).toBe('hidden');
    }, 30000);

    it('does not duplicate suggestions with TypeScript ones on a name already started', async () => {
      const list = await complete('        <Greeting name={user.name} />', '        <Greeting na|/>');
      expect(labelsOf(list).filter((l) => l === 'name')).toHaveLength(1);
    }, 30000);

    afterAll(() => show(SOURCE));
  });

  describe('component declarations', () => {
    it('completes `@t` to tag and title, `@em` to emit, and does not offer an already written @tag again', async () => {
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
      expect(t.items.map((i) => i.label)).not.toContain('tag'); // already declared in card.super
      expect(t.items.find((i) => i.label === 'title')?.textEdit?.newText).toBe("title = '${1:Title}';");
      const em = await complete('@em');
      expect(em.items.find((i) => i.label === 'emit')?.documentation?.value).toContain('event');
      await show(SOURCE);
    }, 30000);

    it("offers the preparation declarations, and contract names in `@contract x = '…'` and `@on('…'`", async () => {
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

    it('after `@contract `, offers the app contracts, except those already declared', async () => {
      const at = async (lines: string) => {
        const text = variant('  @state local = {', `${lines}\n  @state local = {`);
        await show(text);
        const position = positionOf(text, lines, lines.length);
        return (await client.request('textDocument/completion', { textDocument: { uri }, position })) as {
          items: Array<{ label: string; detail?: string; textEdit?: { newText: string } }>;
        };
      };
      const list = await at('  @contract ');
      const basket = list.items.find((i) => i.label === 'basket' && i.detail === 'contract');
      expect(basket?.textEdit?.newText).toBe('basket;');
      const again = await at("  @contract shop = 'basket';\n  @contract b");
      expect(again.items.filter((i) => i.detail === 'contract').map((i) => i.label)).not.toContain('basket');
      await show(SOURCE);
    }, 30000);

    it('documents @tag on hover', async () => {
      const hover = (await client.request('textDocument/hover', { textDocument: { uri }, position: positionOf(SOURCE, '@tag', 2) })) as {
        contents: { value: string };
      };
      expect(hover.contents.value).toContain("The component's **tag**");
    }, 30000);
  });

  it('formats the file (Biome for TypeScript, the .super formatter for templates)', async () => {
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
    // Nothing to change: `null` or an empty list.
    const none = await client.request('textDocument/formatting', { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } });
    expect(none ?? []).toEqual([]);
  }, 30000);

  it('goes to the definition of a .ts component used as a tag', async () => {
    const definition = await client.request('textDocument/definition', {
      textDocument: { uri },
      position: positionOf(SOURCE, '<Greeting', 2),
    });
    const target = Array.isArray(definition) ? definition[0] : definition;
    expect(target.targetUri ?? target.uri).toBe(pathToFileURL(join(PROJECT, 'greeting.ts')).href);
  });

  it('writes the virtual TypeScript to disk on every change', async () => {
    await show(variant('@tag', 'marker = 42;\n  @tag'));
    const virtual = join(PROJECT, '.super/virtual/card.ts');
    await expect.poll(() => existsSync(virtual) && readFileSync(virtual, 'utf8').includes('marker = 42;'), { timeout: 10000 }).toBe(true);
    await show(SOURCE);
  });

  it('ignores the .ts files Zed also sends it (their usual server handles them)', async () => {
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
