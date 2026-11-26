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

/** The `showcase.super` component, compiled by the Vite plugin, mounted in the test DOM. */
async function setup() {
  const { container, element } = await mount(Showcase);
  const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
  const set = async (patch: Parameters<typeof element.local.set>[0]) => {
    element.local.set(patch);
    await flush();
  };
  return { container, element, $, set };
}

describe('compile: rendering a .super file', () => {
  it('renders text, interpolations and nested elements, with HTML whitespace', async () => {
    const { $ } = await setup();
    expect($('h1').textContent).toBe('Total: 2 items');
    expect($('.text').textContent).toBe('A sentence over two lines');
    expect($('.literal').textContent).toBe('for (more) see below `$` \\ end');
  });

  it('renders several consecutive elements in render', async () => {
    const { container } = await setup();
    expect(container.querySelector('lang-showcase > footer')?.textContent).toBe('after the section');
  });

  it('follows if / else', async () => {
    const { $, set } = await setup();
    expect($('.empty')).toBeNull();
    await set({ items: [] });
    expect($('.empty').textContent).toBe('Empty');
    expect($('.keyed')).toBeNull();
  });

  it('keeps the elements of a keyed loop when the order changes', async () => {
    const { container, element, set } = await setup();
    const alpha = container.querySelector('[data-id="a"]');
    await set({ items: [...element.local.get().items].reverse() });
    const rows = [...container.querySelectorAll('.keyed li')];
    expect(rows.map((li) => li.textContent)).toEqual(['Beta', 'Alpha']);
    expect(rows[1]).toBe(alpha); // the same node, moved
  });

  it('renders an unkeyed loop, with a declaration in its body', async () => {
    const { container } = await setup();
    expect([...container.querySelectorAll('.plain li')].map((li) => li.textContent)).toEqual(['ALPHA', 'BETA']);
  });

  it('picks the branch of a switch', async () => {
    const { $, set } = await setup();
    expect($('.status').textContent).toBe('at rest');
    await set({ status: 'busy' });
    expect($('.status').textContent).toBe('busy');
    await set({ status: 'done' });
    expect($('.status').textContent).toBe('finished');
  });

  it('binds listeners, boolean attributes, attributes removed by null, properties and refs', async () => {
    const { $, element, set } = await setup();
    $('.counter').click();
    await flush();
    expect($('.counter').textContent).toBe('Click 1');

    expect($('.counter').hasAttribute('disabled')).toBe(false);
    await set({ busy: true });
    expect($('.counter').hasAttribute('disabled')).toBe(true);

    expect($('section').hasAttribute('title')).toBe(false);
    await set({ title: 'Title' });
    expect($('section').getAttribute('title')).toBe('Title');

    expect(($('input') as HTMLInputElement).value).toBe('prefilled');
    expect(element.input.value).toBe($('input'));
  });

  it('mounts a .super child component with its props and listens to its events', async () => {
    const { $ } = await setup();
    expect($('.badge').textContent).toBe('New');
    $('.badge').click();
    await flush();
    expect($('.picked').textContent).toBe('New');
  });

  it('an early return in render renders nothing more', async () => {
    const { container, set } = await setup();
    await set({ hidden: true });
    expect(container.querySelector('section')).toBeNull();
  });
});

describe('compile: a component that renders nothing', () => {
  it('mounts and stays empty', async () => {
    const { element } = await mount(Empty);
    expect(element.isConnected).toBe(true);
    expect(element.textContent).toBe('');
    expect(element.children).toHaveLength(0);
  });

  it('goes from nothing to something, and back to nothing', async () => {
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

describe('compile: children of a component', () => {
  it('places children and named slots (from a method or from <:name>)', async () => {
    const { container } = await mount(Composition);
    const [first, second] = [...container.querySelectorAll('lang-panel')];
    expect(first?.querySelector('.body .child')?.textContent).toBe('Clicks: 0');
    expect(first?.querySelector('footer .by-method')?.textContent).toBe('by a method (0)');
    expect(second?.querySelector('.body .second')?.textContent).toBe('no footer from a method');
    expect(second?.querySelector('footer .by-slot')?.textContent).toBe('by a slot');
  });

  it('children remain those of the parent: its listeners and its state, updated on its render', async () => {
    const { container } = await mount(Composition);
    (container.querySelector('.add') as HTMLElement).click();
    await flush();
    expect(container.querySelector('.child')?.textContent).toBe('Clicks: 1');
    expect(container.querySelector('.by-method')?.textContent).toBe('by a method (1)');
  });

  it('the component that receives them keeps them when it re-renders on its own', async () => {
    const { container } = await mount(Composition);
    const panel = container.querySelector('lang-panel') as HTMLElement;
    (panel.querySelector('.toggle') as HTMLElement).click();
    await flush();
    expect(panel.querySelector('.body')).toBeNull();
    (panel.querySelector('.toggle') as HTMLElement).click();
    await flush();
    expect(panel.querySelector('.body .child')?.textContent).toBe('Clicks: 0');
  });
});

describe('compile: generated code', () => {
  it('keeps the line numbers of the source', () => {
    const source = `import { SuperElement } from '@super-ts/dom';\nexport class A extends SuperElement {\n  @tag = 'a-a';\n  render() {\n    <ul>\n      for (const x of [1, 2]; key x) {\n        <li>{x}</li>\n      }\n    </ul>\n    const after = 1;\n  }\n}\n`;
    const { code, diagnostics } = compile(source);
    expect(diagnostics).toEqual([]);
    expect(code.split('\n')).toHaveLength(source.split('\n').length);
    expect(code.split('\n')[9]).toContain('const after = 1;');
  });

  it('produces a source map that maps the final JS to the right line and column of the .super file', async () => {
    const file = join(import.meta.dirname, '__fixtures__/runtime/showcase.super');
    const source = readFileSync(file, 'utf8');
    const compiled = compile(source);
    const js = await transformWithOxc(compiled.code, `${file}.ts`, { lang: 'ts', sourcemap: true });
    const map = composeMap(file, source, compiled.code, compiled.copied, js.map?.mappings ?? '');
    // Expressions copied at different levels: keyed loop, loop body, listener, attribute.
    for (const token of ['item.id', 'toUpperCase', 'clicks + 1', 'this.input', 'prefilled']) {
      const generated = positionOf(lineStarts(js.code), js.code.indexOf(token, js.code.indexOf('render()')));
      const expected = positionOf(lineStarts(source), source.indexOf(token, source.indexOf('render()')));
      expect(originalPositionFor(map, generated.line, generated.column), token).toEqual(expected);
    }
  });

  it('does not render whitespace at the start and end of a block', async () => {
    const { $ } = await setup();
    expect($('.status').previousSibling?.textContent ?? '').not.toMatch(/^\s+$/);
    expect(compile('class A {\n  render() {\n    <div>switch (s) { case 1: <p /> default: <b /> }</div>\n  }\n}\n').code).not.toContain(
      '` <p',
    );
  });

  it('rejects an element outside a class method', () => {
    const { diagnostics } = compile('function f() {\n  <p />\n}\n');
    expect(diagnostics[0]?.message).toContain('in a class method');
  });

  it('treats whitespace like HTML: one space per run of whitespace, nothing at the edges', () => {
    expect(normalizeText('Total: ')).toBe('Total: ');
    expect(normalizeText('\n  A sentence\n  over two lines\n')).toBe(' A sentence over two lines ');
    const code = compile(
      'class A {\n  render() {\n    <p>\n      containing\n      <code>x</code>\n      <b>a</b>\n      <i>b</i>\n    </p>\n  }\n}\n',
    ).code;
    expect(code).toContain('<p>containing <code>x</code> <b>a</b> <i>b</i></p>');
    // At the method level too, unless code separates them.
    const top = compile('class A {\n  render() {\n    <a />\n    <b />\n    const x = 1;\n    <i />\n  }\n}\n').code;
    expect(top.match(/__out\.push\(' '\)/g)).toHaveLength(1);
  });
});

describe('compile: component declarations', () => {
  it('@prop becomes this.name, follows the props, and keeps its default value from one render to the next', async () => {
    const picked: string[] = [];
    const { container, element, setProps } = await mount(Declared, {
      props: { label: 'Tea' },
      on: { picked: ({ label }) => picked.push(label) },
    });
    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('Tea');
    expect(button.className).toBe('neutral');
    const tags = element.tags;
    expect(element.tags).toBe(tags); // the default value is computed once per instance

    await setProps({ label: 'Coffee', tone: 'danger' });
    expect(button.textContent).toBe('Coffee');
    expect(button.className).toBe('danger');
    button.click();
    expect(picked).toEqual(['Coffee']);
  });

  it('@title sets a tracked title', async () => {
    const { setProps } = await mount(Declared, { props: { label: 'Tea' } });
    expect(document.title).toBe('Label Tea');
    await setProps({ label: 'Coffee' });
    expect(document.title).toBe('Label Coffee');
  });
});
