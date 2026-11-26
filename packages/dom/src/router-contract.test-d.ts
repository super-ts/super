/**
 * Le router vu d'un composant : `this.router`, typé par les routes de l'app. La route
 * (`{ route: RouteOfTag<tag> }`) est celle que le compilateur `.super` pose sur chaque composant.
 */
import { html, type RouteOfTag, SuperElement, type Unselected } from '@super-ts/dom';
import { expectTypeOf, test } from 'vitest';
import './__fixtures__/app-router.ts';

test('ailleurs qu’un écran : toutes les routes réunies', () => {
  class Nav extends SuperElement<{ route: RouteOfTag<'t-nav'> }> {
    static tag = 't-nav';
    route = this.selector(this.router.current.name);
    itemId = this.selector(this.router.current.params.id);
    sort = this.selector(this.router.current.query.sort);

    render() {
      expectTypeOf(this.route.value).toEqualTypeOf<'home' | 'item' | 'list' | 'page' | null>();
      // `id` n'existe que sur `item` : ailleurs, il vaut undefined.
      expectTypeOf(this.itemId.value).toEqualTypeOf<number | undefined>();
      if (this.itemId.isValid()) expectTypeOf(this.itemId.value).toEqualTypeOf<number>();
      expectTypeOf(this.sort.value).toEqualTypeOf<'label' | 'value' | undefined>();
      const { slug } = this.router.current.params;
      expectTypeOf(slug()).toEqualTypeOf<string | undefined>();
      expectTypeOf(this.router.current.path()).toExtend<string>();
      // @ts-expect-error aucune route n'a ce paramètre
      this.router.current.params.nope;

      this.router.send('navigate', { to: 'home' });
      this.router.send('navigate', { to: 'item', params: { id: 1 } });
      this.router.send('navigate', { to: 'list', query: { sort: 'value', tag: ['a'] } });
      // @ts-expect-error params requis
      this.router.send('navigate', { to: 'item' });
      // @ts-expect-error route inconnue
      this.router.send('navigate', { to: 'nope' });
      this.router.send('back');
      this.router.on('navigated', ({ from, to }) => expectTypeOf(from).toEqualTypeOf<string>() && expectTypeOf(to).toEqualTypeOf<string>());
      expectTypeOf(this.router.href('item', { params: { id: 1 } })).toEqualTypeOf<string>();
      this.router.href('home');
      // @ts-expect-error paramètre `id` manquant
      this.router.href('item');
      // @ts-expect-error route inconnue
      this.router.href('nope');
      // @ts-expect-error les sélecteurs du router sont devenus `current`
      this.router.selectors;
      return html``;
    }
  }
  void Nav;
});

test('dans un écran : sa route seule, liée par le plugin Vite', () => {
  class ItemScreen extends SuperElement<{ route: RouteOfTag<'t-item-screen'> }> {
    static tag = 't-item-screen';
    itemId = this.selector(this.router.current.params.id);

    render() {
      expectTypeOf(this.itemId.value).toEqualTypeOf<number | undefined>();
      if (!this.itemId.isValid()) return html`<p>Introuvable</p>`;
      expectTypeOf(this.itemId.value).toEqualTypeOf<number>();
      expectTypeOf<Unselected<ReturnType<typeof this.router.current.name>>>().toEqualTypeOf<'item' | null>();
      // @ts-expect-error `sort` est la query d'une autre route
      this.router.current.query.sort;
      return html``;
    }
  }
  class TwiceScreen extends SuperElement<{ route: RouteOfTag<'t-twice-screen'> }> {
    static tag = 't-twice-screen';
    render() {
      expectTypeOf(this.router.current.params.id()).toEqualTypeOf<number | undefined>();
      expectTypeOf(this.router.current.params.slug()).toEqualTypeOf<string | undefined>();
      return html``;
    }
  }
  void ItemScreen;
  void TwiceScreen;
});

test('at : une route précise, depuis n’importe quel composant', () => {
  class Breadcrumb extends SuperElement {
    static tag = 't-breadcrumb';
    item = this.router.at('item');
    itemId = this.selector(this.item.params.id);
    tag = this.selector(this.router.at('list').query.tag);

    render() {
      expectTypeOf(this.itemId.value).toEqualTypeOf<number | undefined>();
      expectTypeOf(this.tag.value).toEqualTypeOf<string[]>();
      // @ts-expect-error route inconnue
      this.router.at('nope');
      return html``;
    }
  }
  void Breadcrumb;
});

test('le router se lit par this.router, pas par this.contract', () => {
  class Nav extends SuperElement {
    static tag = 't-nav-contract';
    // @ts-expect-error le router n'est pas un contrat comme les autres : `this.router`
    nav = this.contract('router');
    render() {
      return html``;
    }
  }
  void Nav;
});
