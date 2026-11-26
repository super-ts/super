import { html, SuperElement } from '@super-ts/dom';
import { expectTypeOf, test } from 'vitest';
import './__fixtures__/cmp-contracts.ts';

class Switcher extends SuperElement<{ props: { label: string }; emits: { previous: void; picked: { id: string } } }> {
  static tag = 'cmp-switcher';
  render() {
    expectTypeOf(this.props).toEqualTypeOf<Readonly<{ label: string }>>();
    this.emit('previous');
    this.emit('picked', { id: 'a' });
    // @ts-expect-error no payload expected
    this.emit('previous', 42);
    return html``;
  }
}

test('a child in a template: typed props and listeners', () => {
  class Host extends SuperElement {
    static tag = 'cmp-host';
    render() {
      return html`
        ${Switcher.create({ label: 'x' }, { on: { previous: () => {}, picked: ({ id }) => expectTypeOf(id).toBeString() } })}
        ${
          // @ts-expect-error required props
          Switcher.create()
        }
      `;
    }
  }
  void Host;
});

test('send: body checked, nothing to await', () => {
  class Host extends SuperElement {
    static tag = 'cmp-send-host';
    counter = this.contract('cmp-counter');
    n = this.selector(this.counter.selectors.n);
    render() {
      expectTypeOf(this.n.value).toBeNumber();
      // @ts-expect-error body required
      this.counter.send('inc');
      // On the component side, a command goes out and is let go: nothing to await.
      expectTypeOf(this.counter.send('inc', 1)).toBeVoid();
      return html``;
    }
  }
  void Host;
});

test('render is required; create without props needs no argument', () => {
  // @ts-expect-error render is required
  class NoRender extends SuperElement {
    static tag = 'cmp-no-render';
  }
  void NoRender;

  class Plain extends SuperElement {
    static tag = 'cmp-plain';
    render() {
      return null;
    }
  }
  Plain.create();
});

test('contract with selectors: the component does not see the raw state', () => {
  class ShelfView extends SuperElement {
    static tag = 'cmp-shelf-view';
    shelf = this.contract('cmp-shelf');
    line = this.selector(() => this.shelf.selectors.quantity('a'));
    // @ts-expect-error the raw state is not accessible: only the selectors
    note = this.selector(() => this.shelf.selectors.note());
    // @ts-expect-error selector parameter required
    missing = this.selector(() => this.shelf.selectors.quantity());

    render() {
      expectTypeOf(this.line.value).toBeNumber();
      this.shelf.send('add', 'a');
      return html``;
    }
  }
  void ShelfView;
});
