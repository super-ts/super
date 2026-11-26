import { type ChildNode, type ElementNode, parse } from './parser.ts';

/** Les enfants du premier élément de `render`. */
function childrenOf(template: string) {
  const file = parse(`class A { render() { ${template} } }`);
  const element = file.parts.find((p): p is ElementNode => p.kind === 'element');
  return { file, children: element?.children ?? [], text: (n: ChildNode) => file.source.slice(n.span.start, n.span.end) };
}

describe('parse : où commence un élément', () => {
  it('repère un élément en position d’instruction, pas un `<` de TS', () => {
    const file = parse(
      'const m = new Map<string, number>(); const f = <T,>(x: T) => x < 2;\nclass A { render() { if (a < b) { <p /> } } }',
    );
    expect(file.diagnostics).toEqual([]);
    expect(file.parts.filter((p) => p.kind === 'element').map((p) => (p as ElementNode).name)).toEqual(['p']);
  });

  it('ouvre un élément en début de ligne, même après une expression inachevée (pendant la frappe)', () => {
    const file = parse('class A {\n  render() {\n    const user = this.\n    <section />\n  }\n}\n');
    expect(file.parts.filter((p) => p.kind === 'element').map((p) => (p as ElementNode).name)).toEqual(['section']);
  });

  it('ignore un `<` dans une chaîne, un gabarit, un commentaire ou une expression régulière', () => {
    const file = parse("class A { render() { const s = '<p>'; const t = `${'{'}<b>`; // <i>\n const r = /<u>/; <em /> } }");
    expect(file.diagnostics).toEqual([]);
    expect(file.parts.filter((p) => p.kind === 'element').map((p) => (p as ElementNode).name)).toEqual(['em']);
  });
});

describe('parse : texte brut et instructions', () => {
  it('lit le texte brut, même quand il commence par un mot-clé sans la forme réservée', () => {
    for (const text of ['Total : ', 'if you need help', 'Formule pour (presque) tout', 'Constance', "let's go", 'let me know']) {
      const { file, children } = childrenOf(`<p>${text}</p>`);
      expect(file.diagnostics, text).toEqual([]);
      expect(
        children.map((c) => c.kind),
        text,
      ).toEqual(['text']);
    }
  });

  it('lit les formes réservées comme des instructions', () => {
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

  it('sépare la clé de la tête d’une boucle', () => {
    const { file, children } = childrenOf('<ul>for (const x of xs; key x.id) { <li /> }</ul>');
    const loop = children[0];
    expect(loop?.kind === 'for' && file.source.slice(loop.head.start, loop.head.end)).toBe('const x of xs');
    expect(loop?.kind === 'for' && loop.key && file.source.slice(loop.key.start, loop.key.end)).toBe('x.id');
  });

  it('garde une déclaration en cours de frappe (sans `;`), avec l’erreur', () => {
    const { file, children } = childrenOf('<ul>\n const user = this.\n if (user) { <li /> }\n</ul>');
    expect(children.filter((c) => c.kind !== 'text').map((c) => c.kind)).toEqual(['declaration', 'if']);
    expect(file.diagnostics.map((d) => d.message)).toEqual(['`;` manquant à la fin de la déclaration']);
  });

  it('laisse une déclaration courir sur plusieurs lignes quand l’expression continue', () => {
    const { file, children } = childrenOf('<ul>\n const total = items\n   .map((x) => x.n)\n   .reduce((a, b) => a + b, 0);\n</ul>');
    expect(file.diagnostics).toEqual([]);
    expect(children.filter((c) => c.kind === 'declaration')).toHaveLength(1);
  });

  it('signale un texte ambigu et propose de l’entourer d’accolades', () => {
    const { file } = childrenOf('<p>for (more info) see below</p>');
    expect(file.diagnostics).toHaveLength(1);
    expect(file.diagnostics[0]?.message).toContain("entoure-le d’accolades : {'for (more info) see below'}");
    expect(file.diagnostics[0]?.fix?.text).toBe("{'for (more info) see below'}");
  });

  it('garde l’expression d’une instruction incomplète, pour la complétion', () => {
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

  it('sépare la clé d’une boucle incomplète, pour compléter dans l’une comme dans l’autre', () => {
    for (const typed of ['for (const c of shown; key c.', 'for (const c of shown; key c.)']) {
      const { file, children } = childrenOf(`<ul>\n ${typed}\n <li />\n</ul>`);
      const partial = children.find((c) => c.kind === 'partial');
      const slice = (span: { start: number; end: number } | null | undefined) => span && file.source.slice(span.start, span.end);
      expect(partial?.kind === 'partial' && [slice(partial.expr), slice(partial.key)], typed).toEqual(['const c of shown', 'c.']);
    }
  });

  it('garde les branches lues quand un `else if` est en cours de frappe', () => {
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
      ).toEqual([expect.stringMatching(/^`else( if)?` incomplet/)]);
    }
  });

  it('termine un bloc pas encore fermé avant la balise fermante du parent', () => {
    const { file, children } = childrenOf('<ul>\n if (this.) {\n <li />\n</ul>');
    const branch = children.find((c) => c.kind === 'if');
    expect(branch?.kind === 'if' && file.source.slice(branch.branches[0]?.test?.start, branch.branches[0]?.test?.end)).toBe('this.');
    expect(branch?.kind === 'if' && branch.branches[0]?.body.some((c) => c.kind === 'element')).toBe(true);
    expect(file.diagnostics.map((d) => d.message)).toEqual(['`}` manquant : le bloc se termine avant cette balise fermante']);
  });

  it('ne prend pas une erreur dans le corps d’une instruction pour un texte ambigu', () => {
    const { file } = childrenOf('<ul>if (a) { <li> }</ul>');
    expect(file.diagnostics[0]?.message).not.toContain('Texte lu comme');
  });

  it('refuse `<` et `}` dans le texte, avec la correction', () => {
    const { file } = childrenOf('<p>a < b }</p>');
    expect(file.diagnostics.map((d) => d.fix?.text)).toEqual(["{'<'}", "{'}'}"]);
  });
});

describe('parse : méthodes', () => {
  it('reconnaît une méthode avec un type de retour, `override`, ou privée', () => {
    const file = parse(
      'class A extends B<{ a: 1; b: 2 }> {\n  x = 1;\n  override renderError(error: Error): unknown {\n    <p />\n  }\n  #row(i: number): void {\n    <li />\n  }\n  f = () => { return 1; };\n}\n',
    );
    expect(file.diagnostics).toEqual([]);
    expect(file.methods.map((m) => file.source.slice(m.start, m.start + 12).trim())).toEqual(['{\n    <p />', '{\n    <li />']);
  });
});

describe('parse : return dans une méthode qui émet des éléments', () => {
  const diagnosticsOf = (body: string) => parse(`class A {\n  render() {\n${body}\n  }\n}\n`).diagnostics.map((d) => d.message);

  it('refuse `return x;` au niveau de la méthode', () => {
    expect(diagnosticsOf('    if (a) return 1;\n    <p />')).toEqual([
      'Une méthode qui émet des éléments renvoie ce qu’elle émet : ici, `return` s’écrit sans valeur',
    ]);
  });

  it('accepte `return;`, et `return x;` dans une fonction imbriquée ou une méthode sans élément', () => {
    expect(
      diagnosticsOf(
        '    if (a) return;\n    const n = xs.map((x) => { return x * 2; });\n    const f = function () { return 1; };\n    const o = { m() { return 2; } };\n    if (b) {\n      return\n    }\n    <p>{n}</p>',
      ),
    ).toEqual([]);
    expect(parse('class A {\n  total() {\n    return 1;\n  }\n}\n').diagnostics).toEqual([]);
  });
});

describe('parse : balises et attributs', () => {
  it('lit attributs, écouteurs, propriétés, directives et éléments vides', () => {
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

  it('refuse la syntaxe de lit en indiquant la bonne forme', () => {
    const { file } = childrenOf('<button @click={h} ?disabled={b} .value={v}></button>');
    expect(file.diagnostics.map((d) => d.message)).toEqual([
      'Syntaxe de lit : écris `on:click={…}`',
      'Syntaxe de lit : écris `disabled={…}`',
      'Syntaxe de lit : écris `prop:value={…}`',
    ]);
  });

  it('signale une balise fermante qui ne correspond pas', () => {
    expect(childrenOf('<p><b></i></p>').file.diagnostics[0]?.message).toBe('</i> ferme <b>');
  });

  it('accepte des enfants et des emplacements nommés dans un composant, et refuse une directive', () => {
    const { file, children } = childrenOf('<div><Card title="x">\n  <p>hi</p>\n  <:footer><b>pied</b></:footer>\n</Card></div>');
    expect(file.diagnostics).toEqual([]);
    const card = children[0] as ElementNode;
    const slot = card.children?.find((c) => c.kind === 'element' && c.slot !== undefined) as ElementNode;
    expect(slot.slot).toBe('footer');
    expect(slot.children?.map((c) => c.kind)).toEqual(['element']);
    expect(childrenOf('<div><Card {f.bind()} /></div>').file.diagnostics.map((d) => d.message)).toEqual([
      'Un composant ne prend pas encore de directive : {…} se place sur un élément HTML',
    ]);
  });

  it('refuse un emplacement mal placé, avec des attributs, en double, ou nommé content', () => {
    const messages = (template: string) => childrenOf(template).file.diagnostics.map((d) => d.message);
    expect(messages('<div><:footer>x</:footer></div>')).toEqual([
      'L’emplacement <:footer> se place directement dans un composant, pas dans <div>',
    ]);
    expect(messages('<div><Card><:footer class="x">x</:footer></Card></div>')).toEqual([
      'Un emplacement <:footer> ne prend pas d’attribut',
    ]);
    expect(messages('<div><Card><:a>x</:a><:a>y</:a></Card></div>')).toEqual(['L’emplacement <:a> est déjà rempli']);
    expect(messages('<div><Card><:content>x</:content></Card></div>')).toEqual([
      'Pas de <:content> : les enfants écrits directement dans le composant remplissent déjà `content`',
    ]);
  });

  it('distingue un composant (majuscule) d’une balise HTML', () => {
    const { children } = childrenOf('<div><Greeting name="Ada" /><my-widget /></div>');
    expect(children.map((c) => (c as ElementNode).component)).toEqual([true, false]);
  });
});

describe('parse : déclarations d’un composant', () => {
  const messages = (body: string, header = 'export class A extends SuperElement') =>
    parse(`import { SuperElement } from '@super-ts/dom';\n${header} {\n${body}\n  render() {}\n}\n`).diagnostics.map((d) => d.message);

  it('lit @tag, @title, @prop et @emit, sur une ou plusieurs lignes, avec ou sans `;`', () => {
    const file = parse(
      [
        'class A extends SuperElement {',
        "  @tag = 'a-a';",
        '  @title = () => `Compteur ${this.n}`',
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
      ['title', '() => `Compteur ${this.n}`'],
      ['prop', 'onPick', '(x: number) => void', null],
      ['prop', 'tone', "| 'neutral'\n    | 'danger'", "'neutral'"],
      ['prop', 'size', 'Record<string, { a: number }>', null],
      ['emit', 'picked', '{ label: string; at: Date }', null],
    ]);
  });

  it('un composant déclare son tag par @tag, et ses types dans la classe', () => {
    expect(messages('')).toEqual(["Un composant déclare son tag : `@tag = 'mon-composant';`"]);
    expect(messages("  static tag = 'a-a';")).toEqual(["Dans un `.super`, le tag se déclare par `@tag = '…';`"]);
    expect(messages("  @tag = 'a-a';", 'export class A extends SuperElement<{ props: P }>')).toEqual([
      'Dans un `.super`, les props et les événements se déclarent dans la classe : `@prop nom: Type;` et `@emit nom: Type;`',
    ]);
    expect(messages("  @tag = 'sanstiret';")[0]).toMatch(/^Le tag est une chaîne écrite telle quelle/);
    expect(messages("  @tag = 'a-a';\n  @tag = 'b-b';")).toEqual(['`@tag` déclaré deux fois']);
    expect(messages('', 'export abstract class A extends SuperElement')).toEqual([]);
  });

  it('signale une prop ou un événement mal écrit', () => {
    const tag = "  @tag = 'a-a';\n";
    expect(messages(`${tag}  @prop label;`)).toEqual(['Une prop déclare son type : `@prop nom: Type;`']);
    expect(messages(`${tag}  @prop size?: number = 2;`)).toEqual([
      'Une prop qui a une valeur par défaut est déjà facultative : retire le `?`',
    ]);
    expect(messages(`${tag}  @emit done: void = 1;`)).toEqual(['Un événement n’a pas de valeur par défaut']);
    expect(messages(`${tag}  @prop a: string;\n  @prop a: number;`)).toEqual(['`@prop a` déclaré deux fois']);
    expect(messages(`${tag}  @tag2 = 1;`)).toEqual([]); // un autre décorateur : du TS ordinaire
  });

  it('les déclarations ne s’écrivent que dans un composant', () => {
    expect(messages('  @prop a: string;', 'class Store')).toEqual(['`@prop` ne s’écrit que dans un composant (`extends SuperElement`)']);
  });
});

describe('parse : déclarations de préparation et écouteurs', () => {
  const component = (body: string) => parse(`class A extends SuperElement {\n  @tag = 'a-a';\n${body}\n  render() {}\n}\n`);
  const messages = (body: string) => component(body).diagnostics.map((d) => d.message);

  it('lit @contract (court ou nommé), @selector, @state, @form, @ref et @on', () => {
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

  it('un contrat ne se déclare qu’une fois, jamais le router, et par une chaîne', () => {
    expect(messages("  @contract cart;\n  @contract basket = 'cart';")).toEqual([
      'Le contrat `cart` est déjà déclaré par `@contract cart`',
    ]);
    expect(messages('  @contract router;')).toEqual(['Le router se lit par `this.router`, sans `@contract`']);
    expect(messages('  @contract cart = name;')).toEqual(["Le contrat est une chaîne écrite telle quelle : `@contract basket = 'cart';`"]);
    expect(messages('  @selector count: number = 1;')).toEqual(['Pas de type sur `@selector` : il vient de la valeur']);
    expect(messages('  @ref input;')).toEqual(['Une référence déclare le type de son élément : `@ref input: HTMLInputElement;`']);
    expect(messages("  @on('cart') onX() {}")).toEqual(["`@on` s’écrit `@on('contrat', 'événement')`, au-dessus d’une méthode"]);
  });

  it('refuse l’ancienne forme, avec sa réécriture', () => {
    const fixes = (body: string) => component(body).diagnostics.map((d) => d.fix?.text);
    expect(fixes("  cart = this.contract('cart');")).toEqual(['@contract cart;']);
    expect(fixes("  shop = this.contract('catalog');")).toEqual(["@contract shop = 'catalog';"]);
    expect(fixes('  lines = this.selector(this.cart.selectors.lines);')).toEqual(['@selector lines = this.cart.selectors.lines;']);
    expect(fixes('  local = this.state({ open: false });')).toEqual(['@state local = { open: false };']);
    expect(fixes('  input = this.ref<HTMLInputElement>();')).toEqual(['@ref input: HTMLInputElement;']);
    expect(component('  local = this.state({ open: false });').diagnostics[0]?.message).toBe(
      'Dans un `.super`, `this.state(…)` se déclare par `@state` : `@state local = …;`',
    );
    // Hors composant, du TS ordinaire.
    expect(parse("class S { cart = this.contract('cart'); }").diagnostics).toEqual([]);
  });

  it('refuse un écouteur posé dans le constructeur', () => {
    expect(messages("  constructor() {\n    super();\n    this.cart.on('emptied', () => {});\n  }")).toEqual([
      "Dans un `.super`, un écouteur se déclare sur une méthode : `@on('cart', 'événement') onEvent(payload) { … }`",
    ]);
  });
});
