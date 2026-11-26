import { html, SuperElement } from '@super-ts/dom';
import { expectTypeOf, test } from 'vitest';
import './__fixtures__/cmp-contracts.ts';

class Switcher extends SuperElement<{ props: { label: string }; emits: { previous: void; picked: { id: string } } }> {
  static tag = 'cmp-switcher';
  render() {
    expectTypeOf(this.props).toEqualTypeOf<Readonly<{ label: string }>>();
    this.emit('previous');
    this.emit('picked', { id: 'a' });
    // @ts-expect-error pas de payload attendu
    this.emit('previous', 42);
    return html``;
  }
}

test('un enfant dans un template : props et écouteurs typés', () => {
  class Host extends SuperElement {
    static tag = 'cmp-host';
    render() {
      return html`
        ${Switcher.create({ label: 'x' }, { on: { previous: () => {}, picked: ({ id }) => expectTypeOf(id).toBeString() } })}
        ${
          // @ts-expect-error props requises
          Switcher.create()
        }
      `;
    }
  }
  void Host;
});

test('send : body vérifié, rien à attendre', () => {
  class Host extends SuperElement {
    static tag = 'cmp-send-host';
    counter = this.contract('cmp-counter');
    n = this.selector(this.counter.selectors.n);
    render() {
      expectTypeOf(this.n.value).toBeNumber();
      // @ts-expect-error body requis
      this.counter.send('inc');
      // Côté composant, une commande part et on laisse filer : rien à attendre.
      expectTypeOf(this.counter.send('inc', 1)).toBeVoid();
      return html``;
    }
  }
  void Host;
});

test('render est obligatoire ; create sans props se passe d’argument', () => {
  // @ts-expect-error render est obligatoire
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

test('contrat avec sélecteurs : le composant ne voit pas l’état brut', () => {
  class ShelfView extends SuperElement {
    static tag = 'cmp-shelf-view';
    shelf = this.contract('cmp-shelf');
    line = this.selector(() => this.shelf.selectors.quantity('a'));
    // @ts-expect-error l'état brut n'est pas accessible : seulement les sélecteurs
    note = this.selector(() => this.shelf.selectors.note());
    // @ts-expect-error paramètre du sélecteur requis
    missing = this.selector(() => this.shelf.selectors.quantity());

    render() {
      expectTypeOf(this.line.value).toBeNumber();
      this.shelf.send('add', 'a');
      return html``;
    }
  }
  void ShelfView;
});
