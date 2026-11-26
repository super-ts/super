import { type ChildNode, type ElementNode, parse } from './parser.ts';

/** The children of the first element of `render`. */
function childrenOf(template: string) {
  const file = parse(`class A { render() { ${template} } }`);
  const element = file.parts.find((p): p is ElementNode => p.kind === 'element');
  return { file, children: element?.children ?? [], text: (n: ChildNode) => file.source.slice(n.span.start, n.span.end) };
}

describe('parse: where an element starts', () => {
  it('finds an element in statement position, not a TS `<`', () => {
    const file = parse(
      'const m = new Map<string, number>(); const f = <T,>(x: T) => x < 2;\nclass A { render() { if (a < b) { <p /> } } }',
    );
    expect(file.diagnostics).toEqual([]);
    expect(file.parts.filter((p) => p.kind === 'element').map((p) => (p as ElementNode).name)).toEqual(['p']);
  });

  it('opens an element at the start of a line, even after an unfinished expression (while typing)', () => {
    const file = parse('class A {\n  render() {\n    const user = this.\n    <section />\n  }\n}\n');
    expect(file.parts.filter((p) => p.kind === 'element').map((p) => (p as ElementNode).name)).toEqual(['section']);
  });

  it('ignores a `<` in a string, a template literal, a comment or a regular expression', () => {
    const file = parse("class A { render() { const s = '<p>'; const t = `${'{'}<b>`; // <i>\n const r = /<u>/; <em /> } }");
    expect(file.diagnostics).toEqual([]);
    expect(file.parts.filter((p) => p.kind === 'element').map((p) => (p as ElementNode).name)).toEqual(['em']);
  });
});

describe('parse: plain text and statements', () => {
  it('reads plain text, even when it starts with a keyword without the reserved form', () => {
    for (const text of ['Total: ', 'if you need help', 'A formula for (nearly) everything', 'Constance', "let's go", 'let me know']) {
      const { file, children } = childrenOf(`<p>${text}</p>`);
      expect(file.diagnostics, text).toEqual([]);
      expect(
        children.map((c) => c.kind),
        text,
      ).toEqual(['text']);
    }
  });

  it('reads the reserved forms as statements', () => {
    const { file, children } = childrenOf(`<ul>
      if (a) { <li /> } else if (b) { <li /> } else { <li /> }
      for (const x of xs; key x.id) { <li>{x.label}</li> }
      switch (s) { case 'a': <li /> break; default: <li /> }
      const label = format(total);
      let { n } = counts;
    </ul>`);
    expect(file.diagnostics).toEqual([]);
    expect(children.filter((c) => c.kind !== 'text').map((c) => c.kind)).toEqual(['if', 'for', 'switch', 'declaration', 'declaration']);
    const ifNode = children.find((c) => c.kind === 'if');
    expect(ifNode?.kind === 'if' && ifNode.branches.map((b) => b.test !== null)).toEqual([true, true, false]);
    const switchNode = children.find((c) => c.kind === 'switch');
    expect(switchNode?.kind === 'switch' && switchNode.cases.map((c) => c.body.filter((n) => n.kind === 'element').length)).toEqual([1, 1]);
  });

  it('separates the key from the head of a loop', () => {
    const { file, children } = childrenOf('<ul>for (const x of xs; key x.id) { <li /> }</ul>');
    const loop = children[0];
    expect(loop?.kind === 'for' && file.source.slice(loop.head.start, loop.head.end)).toBe('const x of xs');
    expect(loop?.kind === 'for' && loop.key && file.source.slice(loop.key.start, loop.key.end)).toBe('x.id');
  });

  it('keeps a declaration being typed (without `;`), with the error', () => {
    const { file, children } = childrenOf('<ul>\n const user = this.\n if (user) { <li /> }\n</ul>');
    expect(children.filter((c) => c.kind !== 'text').map((c) => c.kind)).toEqual(['declaration', 'if']);
    expect(file.diagnostics.map((d) => d.message)).toEqual(['Missing `;` at the end of the declaration']);
  });

  it('lets a declaration run over several lines when the expression continues', () => {
    const { file, children } = childrenOf('<ul>\n const total = items\n   .map((x) => x.n)\n   .reduce((a, b) => a + b, 0);\n</ul>');
    expect(file.diagnostics).toEqual([]);
    expect(children.filter((c) => c.kind === 'declaration')).toHaveLength(1);
  });

  it('reports ambiguous text and offers to wrap it in braces', () => {
    const { file } = childrenOf('<p>for (more info) see below</p>');
    expect(file.diagnostics).toHaveLength(1);
    expect(file.diagnostics[0]?.message).toContain("wrap it in braces: {'for (more info) see below'}");
    expect(file.diagnostics[0]?.fix?.text).toBe("{'for (more info) see below'}");
  });

  it('keeps the expression of an incomplete statement, for completion', () => {
    for (const typed of ['if (this.', 'if (this.)']) {
      const { file, children } = childrenOf(`<ul>\n ${typed}\n <li />\n</ul>`);
      const partial = children.find((c) => c.kind === 'partial');
      expect(partial?.kind === 'partial' && file.source.slice(partial.expr.start, partial.expr.end), typed).toBe('this.');
      expect(
        children.some((c) => c.kind === 'element'),
        typed,
      ).toBe(true);
    }
  });

  it('separates the key of an incomplete loop, to complete in either one', () => {
    for (const typed of ['for (const c of shown; key c.', 'for (const c of shown; key c.)']) {
      const { file, children } = childrenOf(`<ul>\n ${typed}\n <li />\n</ul>`);
      const partial = children.find((c) => c.kind === 'partial');
      const slice = (span: { start: number; end: number } | null | undefined) => span && file.source.slice(span.start, span.end);
      expect(partial?.kind === 'partial' && [slice(partial.expr), slice(partial.key)], typed).toEqual(['const c of shown', 'c.']);
    }
  });

  it('keeps the branches read so far when an `else if` is being typed', () => {
    for (const typed of ['} else if (this.', '} else if (this.)', '} else']) {
      const { file, children } = childrenOf(`<ul>\n if (a) {\n <li />\n ${typed}\n <p />\n</ul>`);
      const node = children.find((c) => c.kind === 'if');
      expect(node?.kind === 'if' && node.branches[0]?.body.some((c) => c.kind === 'element'), typed).toBe(true);
      if (typed.includes('if (')) {
        const last = node?.kind === 'if' ? node.branches.at(-1) : undefined;
        expect(last?.partial && file.source.slice(last.test?.start, last.test?.end), typed).toBe('this.');
      }
      expect(
        children.filter((c) => c.kind === 'element'),
        typed,
      ).toHaveLength(1);
      expect(
        file.diagnostics.map((d) => d.message),
        typed,
      ).toEqual([expect.stringMatching(/^Incomplete `else( if)?`/)]);
    }
  });

  it('ends a block not closed yet before the closing tag of the parent', () => {
    const { file, children } = childrenOf('<ul>\n if (this.) {\n <li />\n</ul>');
    const branch = children.find((c) => c.kind === 'if');
    expect(branch?.kind === 'if' && file.source.slice(branch.branches[0]?.test?.start, branch.branches[0]?.test?.end)).toBe('this.');
    expect(branch?.kind === 'if' && branch.branches[0]?.body.some((c) => c.kind === 'element')).toBe(true);
    expect(file.diagnostics.map((d) => d.message)).toEqual(['Missing `}`: the block ends before this closing tag']);
  });

  it('does not mistake an error in the body of a statement for ambiguous text', () => {
    const { file } = childrenOf('<ul>if (a) { <li> }</ul>');
    expect(file.diagnostics[0]?.message).not.toContain('Text read as');
  });

  it('rejects `<` and `}` in text, with the fix', () => {
    const { file } = childrenOf('<p>a < b }</p>');
    expect(file.diagnostics.map((d) => d.fix?.text)).toEqual(["{'<'}", "{'}'}"]);
  });
});

describe('parse: methods', () => {
  it('recognises a method with a return type, `override`, or private', () => {
    const file = parse(
      'class A extends B<{ a: 1; b: 2 }> {\n  x = 1;\n  override renderError(error: Error): unknown {\n    <p />\n  }\n  #row(i: number): void {\n    <li />\n  }\n  f = () => { return 1; };\n}\n',
    );
    expect(file.diagnostics).toEqual([]);
    expect(file.methods.map((m) => file.source.slice(m.start, m.start + 12).trim())).toEqual(['{\n    <p />', '{\n    <li />']);
  });
});

describe('parse: return in a method that emits elements', () => {
  const diagnosticsOf = (body: string) => parse(`class A {\n  render() {\n${body}\n  }\n}\n`).diagnostics.map((d) => d.message);

  it('rejects `return x;` at the level of the method', () => {
    expect(diagnosticsOf('    if (a) return 1;\n    <p />')).toEqual([
      'A method that emits elements returns what it emits: here, `return` is written without a value',
    ]);
  });

  it('accepts `return;`, and `return x;` in a nested function or a method without elements', () => {
    expect(
      diagnosticsOf(
        '    if (a) return;\n    const n = xs.map((x) => { return x * 2; });\n    const f = function () { return 1; };\n    const o = { m() { return 2; } };\n    if (b) {\n      return\n    }\n    <p>{n}</p>',
      ),
    ).toEqual([]);
    expect(parse('class A {\n  total() {\n    return 1;\n  }\n}\n').diagnostics).toEqual([]);
  });
});

describe('parse: tags and attributes', () => {
  it('reads attributes, listeners, properties, directives and void elements', () => {
    const { file, children } = childrenOf(
      '<form {f.bind()}><input class="x" disabled prop:value={v} on:input={h} {f.field("a")}><br></form>',
    );
    expect(file.diagnostics).toEqual([]);
    const input = children[0] as ElementNode;
    expect(input.children).toBeNull();
    expect(input.attributes.map((a) => (a.kind === 'attr' ? `${a.name}=${a.value?.kind ?? 'true'}` : 'directive'))).toEqual([
      'class=string',
      'disabled=true',
      'prop:value=expr',
      'on:input=expr',
      'directive',
    ]);
    expect((children[1] as ElementNode).name).toBe('br');
  });

  it('rejects lit syntax and points to the right form', () => {
    const { file } = childrenOf('<button @click={h} ?disabled={b} .value={v}></button>');
    expect(file.diagnostics.map((d) => d.message)).toEqual([
      'lit syntax: write `on:click={…}`',
      'lit syntax: write `disabled={…}`',
      'lit syntax: write `prop:value={…}`',
    ]);
  });

  it('reports a closing tag that does not match', () => {
    expect(childrenOf('<p><b></i></p>').file.diagnostics[0]?.message).toBe('</i> closes <b>');
  });

  it('accepts children and named slots in a component, and rejects a directive', () => {
    const { file, children } = childrenOf('<div><Card title="x">\n  <p>hi</p>\n  <:footer><b>footer</b></:footer>\n</Card></div>');
    expect(file.diagnostics).toEqual([]);
    const card = children[0] as ElementNode;
    const slot = card.children?.find((c) => c.kind === 'element' && c.slot !== undefined) as ElementNode;
    expect(slot.slot).toBe('footer');
    expect(slot.children?.map((c) => c.kind)).toEqual(['element']);
    expect(childrenOf('<div><Card {f.bind()} /></div>').file.diagnostics.map((d) => d.message)).toEqual([
      'A component does not take directives yet: {…} goes on an HTML element',
    ]);
  });

  it('rejects a slot that is misplaced, has attributes, is duplicated, or is named content', () => {
    const messages = (template: string) => childrenOf(template).file.diagnostics.map((d) => d.message);
    expect(messages('<div><:footer>x</:footer></div>')).toEqual(['The slot <:footer> goes directly inside a component, not inside <div>']);
    expect(messages('<div><Card><:footer class="x">x</:footer></Card></div>')).toEqual(['A slot <:footer> takes no attributes']);
    expect(messages('<div><Card><:a>x</:a><:a>y</:a></Card></div>')).toEqual(['The slot <:a> is already filled']);
    expect(messages('<div><Card><:content>x</:content></Card></div>')).toEqual([
      'No <:content>: the children written directly inside the component already fill `content`',
    ]);
  });

  it('tells a component (capital letter) from an HTML tag', () => {
    const { children } = childrenOf('<div><Greeting name="Ada" /><my-widget /></div>');
    expect(children.map((c) => (c as ElementNode).component)).toEqual([true, false]);
  });
});

describe('parse: component declarations', () => {
  const messages = (body: string, header = 'export class A extends SuperElement') =>
    parse(`import { SuperElement } from '@super-ts/dom';\n${header} {\n${body}\n  render() {}\n}\n`).diagnostics.map((d) => d.message);

  it('reads @tag, @title, @prop and @emit, on one or several lines, with or without `;`', () => {
    const file = parse(
      [
        'class A extends SuperElement {',
        "  @tag = 'a-a';",
        '  @title = () => `Counter ${this.n}`',
        '  @prop onPick: (x: number) => void;',
        '  @prop tone:',
        "    | 'neutral'",
        "    | 'danger' = 'neutral';",
        '  @prop size?: Record<string, { a: number }>',
        '  @emit picked: { label: string; at: Date };',
        '  render() {}',
        '}',
      ].join('\n'),
    );
    expect(file.diagnostics).toEqual([]);
    const [info] = file.classes;
    const text = (span: { start: number; end: number } | null) => (span ? file.source.slice(span.start, span.end) : null);
    expect(
      info?.members.map((m) =>
        m.kind === 'tag' || m.kind === 'title'
          ? [m.kind, text(m.value)]
          : m.kind === 'prop' || m.kind === 'emit'
            ? [m.kind, text(m.name), text(m.type), m.kind === 'prop' ? text(m.init) : null]
            : [m.kind],
      ),
    ).toEqual([
      ['tag', "'a-a'"],
      ['title', '() => `Counter ${this.n}`'],
      ['prop', 'onPick', '(x: number) => void', null],
      ['prop', 'tone', "| 'neutral'\n    | 'danger'", "'neutral'"],
      ['prop', 'size', 'Record<string, { a: number }>', null],
      ['emit', 'picked', '{ label: string; at: Date }', null],
    ]);
  });

  it('a component declares its tag with @tag, and its types in the class', () => {
    expect(messages('')).toEqual(["A component declares its tag: `@tag = 'my-component';`"]);
    expect(messages("  static tag = 'a-a';")).toEqual(["In a `.super` file, the tag is declared with `@tag = '…';`"]);
    expect(messages("  @tag = 'a-a';", 'export class A extends SuperElement<{ props: P }>')).toEqual([
      'In a `.super` file, props and events are declared in the class: `@prop name: Type;` and `@emit name: Type;`',
    ]);
    expect(messages("  @tag = 'nohyphen';")[0]).toMatch(/^The tag is a literal string/);
    expect(messages("  @tag = 'a-a';\n  @tag = 'b-b';")).toEqual(['`@tag` declared twice']);
    expect(messages('', 'export abstract class A extends SuperElement')).toEqual([]);
  });

  it('reports a badly written prop or event', () => {
    const tag = "  @tag = 'a-a';\n";
    expect(messages(`${tag}  @prop label;`)).toEqual(['A prop declares its type: `@prop name: Type;`']);
    expect(messages(`${tag}  @prop size?: number = 2;`)).toEqual(['A prop with a default value is already optional: remove the `?`']);
    expect(messages(`${tag}  @emit done: void = 1;`)).toEqual(['An event has no default value']);
    expect(messages(`${tag}  @prop a: string;\n  @prop a: number;`)).toEqual(['`@prop a` declared twice']);
    expect(messages(`${tag}  @tag2 = 1;`)).toEqual([]); // another decorator: ordinary TS
  });

  it('declarations are only written in a component', () => {
    expect(messages('  @prop a: string;', 'class Store')).toEqual(['`@prop` is only written in a component (`extends SuperElement`)']);
  });
});

describe('parse: preparation declarations and listeners', () => {
  const component = (body: string) => parse(`class A extends SuperElement {\n  @tag = 'a-a';\n${body}\n  render() {}\n}\n`);
  const messages = (body: string) => component(body).diagnostics.map((d) => d.message);

  it('reads @contract (short or named), @selector, @state, @form, @ref and @on', () => {
    const file = component(
      [
        '  @contract cart;',
        "  @contract shop = 'catalog';",
        '  @selector count = () => this.cart.selectors.count();',
        "  @state local = { open: false, tab: 'a' as 'a' | 'b' };",
        "  @form edit = { initial: { name: '' }, submit: { to: this.cart, command: 'add' } };",
        '  @ref input: HTMLInputElement;',
        "  @on('profile', 'save:done')",
        '  async onSaved({ result }): Promise<void> {',
        '    if (result) { this.local.set({ open: true }); }',
        '  }',
      ].join('\n'),
    );
    expect(file.diagnostics).toEqual([]);
    const text = (span: { start: number; end: number } | null) => (span ? file.source.slice(span.start, span.end) : null);
    expect(
      file.classes[0]?.members.slice(1).map((m) => {
        if (m.kind === 'contract') return [m.kind, text(m.name), text(m.value)];
        if (m.kind === 'selector' || m.kind === 'state' || m.kind === 'form') return [m.kind, text(m.name), text(m.value)];
        if (m.kind === 'ref') return [m.kind, text(m.name), text(m.type)];
        if (m.kind === 'on') return [m.kind, text(m.contract), text(m.event), m.async, text(m.name), text(m.head)];
        return [m.kind];
      }),
    ).toEqual([
      ['contract', 'cart', null],
      ['contract', 'shop', "'catalog'"],
      ['selector', 'count', '() => this.cart.selectors.count()'],
      ['state', 'local', "{ open: false, tab: 'a' as 'a' | 'b' }"],
      ['form', 'edit', "{ initial: { name: '' }, submit: { to: this.cart, command: 'add' } }"],
      ['ref', 'input', 'HTMLInputElement'],
      ['on', "'profile'", "'save:done'", true, 'onSaved', '({ result }): Promise<void>'],
    ]);
  });

  it('a contract is declared only once, never the router, and with a string', () => {
    expect(messages("  @contract cart;\n  @contract basket = 'cart';")).toEqual([
      'The contract `cart` is already declared by `@contract cart`',
    ]);
    expect(messages('  @contract router;')).toEqual(['The router is read through `this.router`, without `@contract`']);
    expect(messages('  @contract cart = name;')).toEqual(["The contract is a literal string: `@contract basket = 'cart';`"]);
    expect(messages('  @selector count: number = 1;')).toEqual(['No type on `@selector`: it comes from the value']);
    expect(messages('  @ref input;')).toEqual(['A ref declares the type of its element: `@ref input: HTMLInputElement;`']);
    expect(messages("  @on('cart') onX() {}")).toEqual(["`@on` is written `@on('contract', 'event')`, above a method"]);
  });

  it('rejects the old form, with its rewrite', () => {
    const fixes = (body: string) => component(body).diagnostics.map((d) => d.fix?.text);
    expect(fixes("  cart = this.contract('cart');")).toEqual(['@contract cart;']);
    expect(fixes("  shop = this.contract('catalog');")).toEqual(["@contract shop = 'catalog';"]);
    expect(fixes('  lines = this.selector(this.cart.selectors.lines);')).toEqual(['@selector lines = this.cart.selectors.lines;']);
    expect(fixes('  local = this.state({ open: false });')).toEqual(['@state local = { open: false };']);
    expect(fixes('  input = this.ref<HTMLInputElement>();')).toEqual(['@ref input: HTMLInputElement;']);
    expect(component('  local = this.state({ open: false });').diagnostics[0]?.message).toBe(
      'In a `.super` file, `this.state(…)` is declared with `@state`: `@state local = …;`',
    );
    // Outside a component, ordinary TS.
    expect(parse("class S { cart = this.contract('cart'); }").diagnostics).toEqual([]);
  });

  it('rejects a listener set in the constructor', () => {
    expect(messages("  constructor() {\n    super();\n    this.cart.on('emptied', () => {});\n  }")).toEqual([
      "In a `.super` file, a listener is declared on a method: `@on('cart', 'event') onEvent(payload) { … }`",
    ]);
  });
});
