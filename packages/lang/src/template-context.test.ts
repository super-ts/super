import { openTagsBefore, templateContext } from './template-context.ts';

/** The context at the `|` of `text`. */
function at(text: string) {
  const offset = text.indexOf('|');
  const source = text.replace('|', '');
  const context = templateContext(source, offset);
  return context && { ...context, prefix: source.slice(context.prefix.start, context.prefix.end) };
}

describe('templateContext', () => {
  it('recognises a tag name, even empty or incomplete', () => {
    expect(at('render() {\n  <|')).toMatchObject({ kind: 'tag', closing: false, prefix: '' });
    expect(at('render() {\n  <main>\n    <Gre|')).toMatchObject({ kind: 'tag', closing: false, prefix: 'Gre' });
    expect(at('<ul><li>a</li><l|')).toMatchObject({ kind: 'tag', prefix: 'l' });
  });

  it('recognises a closing tag, and the tag to close', () => {
    expect(at('<main>\n  <ul>\n    <li>a</li>\n  </|')).toMatchObject({ kind: 'tag', closing: true, open: 'ul', prefix: '' });
    expect(at('<main><br><input type="x" /><p>a</p></m|')).toMatchObject({ kind: 'tag', closing: true, open: 'main', prefix: 'm' });
  });

  it('recognises a named slot, and the component around it', () => {
    expect(at('<Card title="x">\n  <p>a</p>\n  <:fo|')).toMatchObject({ kind: 'slot', parent: 'Card', prefix: 'fo' });
  });

  it('recognises an attribute name, with the tag and the attributes already written', () => {
    expect(at('<a href="x" |')).toMatchObject({ kind: 'attribute', tag: 'a', prefix: '', present: ['href'] });
    expect(at('<Card title={t > 1 ? "a" : "b"} on:cl|')).toMatchObject({
      kind: 'attribute',
      tag: 'Card',
      prefix: 'on:cl',
      present: ['title'],
    });
    expect(at('<CounterControls\n  count={count}\n  |\n/>')).toMatchObject({
      kind: 'attribute',
      tag: 'CounterControls',
      present: ['count'],
    });
  });

  it('does not trigger inside a value, after the tag, or on a TS `<`', () => {
    expect(at('<a href="x|')).toBeNull();
    expect(at('<a on:click={() => this.|')).toBeNull();
    expect(at('<a href="x">text |')).toBeNull();
    expect(at('const m = new Map<str|')).toBeNull();
    expect(at('if (a < b|')).toBeNull();
  });
});

describe('openTagsBefore', () => {
  it('follows openings, closings, void elements and self-closing tags', () => {
    const source = '<main><h1>a</h1><br><Card on:x={() => a > b} /><ul><li>';
    expect(openTagsBefore(source, source.length)).toEqual(['main', 'ul', 'li']);
  });
});
