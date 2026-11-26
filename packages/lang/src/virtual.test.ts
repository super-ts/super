import { toVirtual } from './virtual.ts';

describe('virtual TS: component types', () => {
  test('each component receives the route of its tag in its types', () => {
    const source = `import { SuperElement } from '@super-ts/dom';

export class CounterScreen extends SuperElement {
  @tag = 'counter-screen';
  render() {}
}

class Line extends SuperElement {
  @tag = "counter-line";
  render() {}
}

abstract class NoTag extends SuperElement {
  render() {}
}
`;
    const { code } = toVirtual(source);
    expect(code).toContain("class CounterScreen extends SuperElement<{ route: __s.RouteOfTag<'counter-screen'> }> {");
    expect(code).toContain("static tag = 'counter-screen';");
    expect(code).toContain("class Line extends SuperElement<{ route: __s.RouteOfTag<'counter-line'> }> {");
    expect(code).toContain('class NoTag extends SuperElement {');
  });

  test('@prop and @emit become the component types, @prop a property, @title an assignment', () => {
    const source = `import { type Children, SuperElement } from '@super-ts/dom';

export class Dialog extends SuperElement {
  @tag = 'x-dialog';
  @title = () => \`Confirm \${this.question}\`;
  @prop question: string;
  @prop tone: 'neutral' | 'danger' = 'neutral';
  @prop size?: number;
  @prop content?: Children;
  @emit answered: { confirmed: boolean };
  render() {}
}
`;
    const { code } = toVirtual(source);
    expect(code).toContain(
      "class Dialog extends SuperElement<{ route: __s.RouteOfTag<'x-dialog'> } & { props: { question: string; tone?: 'neutral' | 'danger'; size?: number; content?: Children; }; emits: { answered: { confirmed: boolean }; }; }> {",
    );
    expect(code).toContain('protected readonly __superTitle = (this.page.title = (() => `Confirm ${this.question}`));');
    expect(code).toContain('declare readonly question: string;');
    expect(code).toContain("readonly tone: 'neutral' | 'danger' = ('neutral');");
    expect(code).toContain('declare readonly size?: number;');
    expect(code).toContain('declare readonly content?: Children;');
    expect(code).toContain(
      "protected __superNames() { __s.ownName('question'); __s.ownName('tone'); __s.ownName('size'); __s.ownName('content'); }",
    );
    expect(code).not.toContain('@emit');
  });

  test('@contract, @selector, @state, @ref and @on become the fields that used to be written by hand', () => {
    const source = `import { SuperElement } from '@super-ts/dom';

export class Shop extends SuperElement {
  @tag = 'x-shop';
  @contract cart;
  @contract shop = 'catalog';
  @selector lines = this.cart.selectors.lines;
  @state local = { open: false };
  @ref input: HTMLInputElement;
  @on('profile', 'save:done')
  onSaved({ result }) {
    this.local.set({ open: !!result });
  }
  @on('router', 'navigated') onNavigated() {}
  render() {}
}
`;
    const { code } = toVirtual(source);
    expect(code).toContain("readonly cart = this.contract('cart');");
    expect(code).toContain("readonly shop = this.contract('catalog');");
    expect(code).toContain('readonly lines = this.selector(this.cart.selectors.lines);');
    expect(code).toContain('readonly local = this.state({ open: false });');
    expect(code).toContain('readonly input = this.ref<HTMLInputElement>();');
    expect(code).toContain("protected readonly onSaved = this.contract('profile').on('save:done', ({ result }) => {");
    expect(code).toContain("protected readonly onNavigated = this.router.on('navigated', () => {});");
  });
});
