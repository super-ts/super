/**
 * The router as seen from a component: `this.router`, typed by the app's routes. The route
 * (`{ route: RouteOfTag<tag> }`) is the one the `.super` compiler sets on each component.
 */
import { html, type RouteOfTag, SuperElement, type Unselected } from '@super-ts/dom';
import { expectTypeOf, test } from 'vitest';
import './__fixtures__/app-router.ts';

test('outside a screen: all routes merged', () => {
  class Nav extends SuperElement<{ route: RouteOfTag<'t-nav'> }> {
    static tag = 't-nav';
    route = this.selector(this.router.current.name);
    itemId = this.selector(this.router.current.params.id);
    sort = this.selector(this.router.current.query.sort);

    render() {
      expectTypeOf(this.route.value).toEqualTypeOf<'home' | 'item' | 'list' | 'page' | null>();
      // `id` only exists on `item`: elsewhere, it is undefined.
      expectTypeOf(this.itemId.value).toEqualTypeOf<number | undefined>();
      if (this.itemId.isValid()) expectTypeOf(this.itemId.value).toEqualTypeOf<number>();
      expectTypeOf(this.sort.value).toEqualTypeOf<'label' | 'value' | undefined>();
      const { slug } = this.router.current.params;
      expectTypeOf(slug()).toEqualTypeOf<string | undefined>();
      expectTypeOf(this.router.current.path()).toExtend<string>();
      // @ts-expect-error no route has this parameter
      this.router.current.params.nope;

      this.router.send('navigate', { to: 'home' });
      this.router.send('navigate', { to: 'item', params: { id: 1 } });
      this.router.send('navigate', { to: 'list', query: { sort: 'value', tag: ['a'] } });
      // @ts-expect-error params required
      this.router.send('navigate', { to: 'item' });
      // @ts-expect-error unknown route
      this.router.send('navigate', { to: 'nope' });
      this.router.send('back');
      this.router.on('navigated', ({ from, to }) => expectTypeOf(from).toEqualTypeOf<string>() && expectTypeOf(to).toEqualTypeOf<string>());
      expectTypeOf(this.router.href('item', { params: { id: 1 } })).toEqualTypeOf<string>();
      this.router.href('home');
      // @ts-expect-error parameter `id` missing
      this.router.href('item');
      // @ts-expect-error unknown route
      this.router.href('nope');
      // @ts-expect-error the router's selectors have become `current`
      this.router.selectors;
      return html``;
    }
  }
  void Nav;
});

test('in a screen: its own route only, linked by the Vite plugin', () => {
  class ItemScreen extends SuperElement<{ route: RouteOfTag<'t-item-screen'> }> {
    static tag = 't-item-screen';
    itemId = this.selector(this.router.current.params.id);

    render() {
      expectTypeOf(this.itemId.value).toEqualTypeOf<number | undefined>();
      if (!this.itemId.isValid()) return html`<p>Not found</p>`;
      expectTypeOf(this.itemId.value).toEqualTypeOf<number>();
      expectTypeOf<Unselected<ReturnType<typeof this.router.current.name>>>().toEqualTypeOf<'item' | null>();
      // @ts-expect-error `sort` is the query of another route
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

test('at: a specific route, from any component', () => {
  class Breadcrumb extends SuperElement {
    static tag = 't-breadcrumb';
    item = this.router.at('item');
    itemId = this.selector(this.item.params.id);
    tag = this.selector(this.router.at('list').query.tag);

    render() {
      expectTypeOf(this.itemId.value).toEqualTypeOf<number | undefined>();
      expectTypeOf(this.tag.value).toEqualTypeOf<string[]>();
      // @ts-expect-error unknown route
      this.router.at('nope');
      return html``;
    }
  }
  void Breadcrumb;
});

test('the router is read through this.router, not through this.contract', () => {
  class Nav extends SuperElement {
    static tag = 't-nav-contract';
    // @ts-expect-error the router is not a contract like the others: `this.router`
    nav = this.contract('router');
    render() {
      return html``;
    }
  }
  void Nav;
});
