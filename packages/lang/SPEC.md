# `.super` files: specification

A `.super` file is a TypeScript module whose class methods can contain
HTML elements written as statements. The rest of the file is ordinary TS.

Status: draft, version 0. Points marked "v0" are deliberate limits of this
first version.

## Example

```tsx
import { SuperElement } from '@super-ts/dom';
import { ConfirmDialog } from '../shared/confirm-dialog';

export class ShopScreen extends SuperElement {
  @tag = 'shop-screen';
  @title = 'Shop';
  @contract cart;
  @selector lines = this.cart.selectors.lines;

  render() {
    <main class="screen">
      <h1>Shop</h1>
      if (this.lines.value.length === 0) {
        <p class="empty">No items yet.</p>
      } else {
        <ul>
          for (const l of this.lines.value; key l.product.sku) {
            const { product } = l;
            <li>{product.label} <button on:click={() => this.cart.send('remove', { sku: product.sku })}>−</button></li>
          }
        </ul>
      }
    </main>
  }
}
```

## Component declarations

A class that extends `SuperElement` declares in its body its tag, its props, its events and
the page title, without a generic:

```tsx
export class ConfirmDialog extends SuperElement {
  @tag = 'confirm-dialog';
  @title = 'Confirmation';
  @prop question: string;
  @prop tone: 'neutral' | 'danger' = 'neutral';
  @prop note?: string;
  @emit answered: { confirmed: boolean };
}
```

| Declaration              | Meaning                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `@tag = 'x-y';`          | The custom element tag. Required (except for an `abstract` class), a string with a hyphen. |
| `@title = …;`            | The page title while the component is mounted: a string, or a tracked function.            |
| `@prop name: T;`         | A required prop, read through `this.name` (always the current value).                      |
| `@prop name?: T;`        | An optional prop (`T \| undefined`).                                                       |
| `@prop name: T = value;` | An optional prop with a default value, computed once per instance.                         |
| `@emit name: T;`         | An event, emitted with `this.emit('name', …)` (`void` if it carries nothing).              |

- `@prop` and `@emit` are valid TS (decorated fields); `@tag = …` and `@title = …` are
  not: the formatter and the Tree-sitter grammar know about them.
- The compiler draws the component types from them (`SuperElement<{ props; emits }>`), checked at
  the tags that use it (`<ConfirmDialog question="…" on:answered={…} />`).
- A prop cannot have the name of a property of HTML elements (`id`, `title`, `hidden`…):
  it is a type error. That is why the content written between the tags fills `content`
  (and not `children`, a native property).
- `this.props` remains available (all props, read-only).
- `@title = () => …` is recomputed after each render, with the same reads as `render`
  (`@title = () => this.label.value`). The last mounted component that sets a title wins; when
  it unmounts, the previous title comes back. Elsewhere (handler, `mounted`),
  `this.page.title = …` does the same.
- Errors: missing tag or tag written as `static tag`, hand-written `SuperElement<…>` generic,
  duplicate declaration, prop without a type, `?` with a default value, declaration outside a
  component.

### Preparation: stores, reads, state, form, refs, listeners

What the component prepares once (at construction) is also declared in the body of its class:

```tsx
export class ProfileScreen extends SuperElement {
  @tag = 'profile-screen';
  @contract profile;                                   // this.contract('profile')
  @contract shop = 'catalog';                          // another field name
  @selector saving = () => this.profile.selectors.pending('save');
  @state local = { saved: null as string | null };
  @form edit = { initial: { name: '' }, submit: { to: this.profile, command: 'save' } };
  @ref nameInput: HTMLInputElement;

  @on('profile', 'save:done')
  onSaved({ result }) {
    this.local.set({ saved: result.id });
  }
}
```

| Declaration                     | Equivalent to                              | Read through                          |
| ------------------------------- | ------------------------------------------ | ------------------------------------- |
| `@contract cart;`               | `cart = this.contract('cart')`             | `this.cart.selectors`, `.send`, `.on` |
| `@contract shop = 'catalog';`   | `shop = this.contract('catalog')`          | same                                  |
| `@selector name = …;`           | `name = this.selector(…)`                  | `this.name.value`                     |
| `@state name = { … };`          | `name = this.state({ … })`                 | `this.name.get()`, `this.name.set(…)` |
| `@form name = { … };`           | `name = this.form({ … })`                  | `this.name.bind()`, `.field('x')`…    |
| `@ref name: T;`                 | `name = this.ref<T>()`                     | `ref={this.name}`, `this.name.value`  |
| `@on('contract', 'event') m(p)` | `this.contract('contract').on('event', …)` | called on each event, while mounted   |

- `@on` does not require a `@contract`: it opens access to the contract itself. The method parameter
  is typed by the event (`save:done`: `{ input, result }`). `@on('router', 'navigated')` listens to
  the router. The event name is written literally (no template literal `` `${x}:done` ``).
- A contract is declared once per component; `@contract router` is rejected (`this.router`).
- No type on `@contract`, `@selector`, `@state`, `@form`: it comes from the value (widen with
  `as`). `@ref` declares the type of its element and has no value.
- Order matters as for fields: a `@selector` that reads `this.cart` comes after `@contract cart`.
- The old forms (`cart = this.contract('cart')`, `this.cart.on(…)` in the constructor)
  are errors in a `.super` file, with a quick fix that rewrites the line (except for
  listeners).
- In the editor, `@` offers all declarations with a snippet and their documentation on
  hover; `@contract ` offers the app's contracts not declared yet (`@contract cart;`, or
  `errorLog = 'error-log';` for a name that is not an identifier); `@contract x = '…'` and
  `@on('…', '…')` complete contract and event names.

A component written in a `.ts` file keeps `static tag`, the `SuperElement<{ props; emits }>` generic
and the methods (`this.contract(…)`, `this.selector(…)`, `this.state(…)`, `this.form(…)`,
`this.ref<T>()`, `.on(…)` in the constructor).

## Where an element can be written

An element is a statement: it is written where a statement is expected, in the body
of a method, and it is emitted at that place. `render()` returns nothing.

In TS, a `<` opens an element when it is followed by a letter and the previous token is `{`,
`}`, `;`, or the `:` of a `case` / `default`, or when it is at the start of a line (which keeps the
template readable while an unfinished line is being typed). Elsewhere (`a < b`, `Map<K, V>`, `<T>(x: T) => x`),
it is TS.

An element in an expression (`const x = <p />`, `() => <p />`) is not allowed: write
a method that emits its elements, and call it (see "Interpolation").

v0 limit: a generic call signature in a type literal (`{ <T>(x: T): T }`) is mistaken
for an element. Move it into a `type` or an `interface` in a `.ts` file.

## Children of an element

Between `<tag>` and `</tag>`, each child is one of these forms.

| Form          | Example                                     |
| ------------- | ------------------------------------------- |
| Plain text    | `Total: `                                   |
| Interpolation | `{formatPrice(total)}`                      |
| Comment       | `{/* … */}`                                 |
| Element       | `<strong>…</strong>`, `<br />`              |
| Condition     | `if (x) { … } else if (y) { … } else { … }` |
| Loop          | `for (const x of xs; key x.id) { … }`       |
| Choice        | `switch (s) { case 'a': … default: … }`     |
| Declaration   | `const { product } = line;` or `let n = 0;` |

The body of an `if`, a `for` or a `case` follows the same rules as the children of an element.

### Text and its ambiguities

Text is written plain. A child is read as a statement only if it starts with:

- `if (`, `for (`, `switch (` (spaces allowed before the parenthesis);
- `const` or `let`, followed by a name or a destructuring, then `=`;
- `else` right after the `}` of an `if`;
- `case`, `default:` or `break;` in a `switch`.

Text that starts this way (`for (more info) see below`) is read as a statement; if it
is not one, it is an error, with a suggested fix: wrap it in braces,
`{'for (more info) see below'}`. The parser never guesses.

While typing, an incomplete statement (`if (this.` without `)` or `{`, a block without `}`) is
reported, but the editor already completes inside its condition. This help only exists in the editor:
`super-tsc` checks the code as it is.

The characters `<`, `{` and `}` are not written in text: `{'<'}`, `{'{'}`, `{'}'}`.

Whitespace follows HTML rules: each run of whitespace, line breaks included, counts
as one space (`containing` then `<code>` on the next line gives "containing offline"). Whitespace
at the start and end of an element, of a block (`if`, `for`, `case`) or next to a
statement renders nothing. Two elements of the method separated only by whitespace are
separated by a space; if there is code between them, they are not.

### Rendering nothing

A method that emits no element renders nothing: `render() {}` is the equivalent of lit's
`return null`.

### Interpolation

`{expr}` displays a string, a number or a boolean; `null` and `undefined` display nothing.
An object is rejected at compile time (no more `[object Object]`). Calling a method that emits
elements (`{this.#row(line)}`) is allowed: it returns nothing, which is accepted.

### Loop

Only `for…of` is accepted. `key expr`, after a `;` inside the parentheses, identifies each
item so that the render follows moves; without `key`, the render is positional.

### Choice

Each `case` stops at the next `case` or `default`, or at the end of the `switch`: no
fall-through from one `case` to the next. `break;` is allowed but pointless. For an exhaustive choice, a
`default: {assertNever(x)}` is enough, TS checks it.

## Attributes

| Form                    | Effect                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| `class="screen"`        | Fixed attribute                                                    |
| `href={url}`            | Computed attribute; `null` or `undefined` removes it               |
| `disabled={busy}`       | Boolean attribute (known HTML list): present if true               |
| `disabled`              | Boolean attribute, always present                                  |
| `prop:value={v}`        | DOM property rather than attribute (`el.value = v`)                |
| `on:click={handler}`    | Listener; the event type comes from the tag                        |
| `ref={this.input}`      | Ref (`@ref input: T;`): rejected if `T` is not the type of the tag |
| `{order.field('name')}` | Element directive: `form.bind()`, `form.field('name')`             |

A tag without a hyphen must be a known HTML or SVG tag (a typo is an
error); a tag with a hyphen is a custom element.

An attribute value is a string, a number, a boolean, `null` or `undefined`.

`on:` on a native element only accepts the events of that tag (`HTMLElementEventMap`).
v0 limit: listening on a `<div>` to a custom event bubbling up from a child is not allowed.

lit prefixes (`@click`, `?disabled`, `.value`) are rejected, with the form to use.

## Child components

A tag that starts with a capital letter is a SuperElement class in scope:

```tsx
<ConfirmDialog question="Empty the basket?" on:answered={this.onClearAnswered} />;
```

The attributes are its props, checked against its `@prop` declarations (missing or extra prop, wrong type);
`on:x` subscribes to its `@emit` declarations. It is the equivalent of
`ConfirmDialog.create({ question }, { on: { answered } })`.

v0 limit: no directive on a component (`<Card {…} />` is an error).

### Children and named slots

A component that accepts children declares it in its props, with the `Children` type from
`@super-ts/dom`, and places them where it wants with an interpolation:

```tsx
@prop heading: string;
@prop content: Children;
@prop footer?: Children;

render() {
  <section>
    <h2>{this.heading}</h2>
    {this.content}
    if (this.footer) {
      <footer>{this.footer}</footer>
    }
  </section>
}
```

- The children written between the component tags fill `content`.
- A named slot is another prop of type `Children`, filled in one of two ways:
  by a slot `<:footer>…</:footer>` written between the component tags, or by calling
  a method that emits elements (`footer={this.#footer()}`, such a method returns
  `Children`).
- Everything is checked against the component's `@prop` declarations: children for a component that does not
  declare any, required children or slots that are missing, an unknown slot.
- A slot `<:name>` goes directly inside a component, without attributes, only once per
  name; `<:content>` does not exist (the direct children already fill `content`).
- Children and slots are rendered in the render of the parent: their listeners, their
  store reads and their state are those of the parent, and they follow its render. The component that
  receives them keeps them when it re-renders on its own.
- A list of slots (tabs) is a `Children[]` prop, filled by method
  calls: `panels={[this.#profile(), this.#security()]}`.

## Void elements

`<br>`, `<input>`, `<img>` and the other HTML void elements can be written without `/>`. Any
other element without children is written `<tag />`.

## Type check

On the command line, `node packages/lang/src/cli.ts <tsconfig>` (used by `npm run typecheck`)
checks with the repository's TypeScript 7. In the editor, `packages/lang-server` is a Volar language
server on TypeScript 6 (Volar does not support TypeScript 7 yet): errors, the "wrap in braces"
quick fix, completion, hover, go to definition.

The tooling turns each `.super` file into virtual TypeScript that the compiler checks, with a
position mapping to report errors in the `.super` file.

- Statements (`if`, `for`, `switch`, declarations) are copied verbatim.
- Each element becomes a sequence of flat typed calls (`open`, `attr`, `on`, `use`, `text`)
  in a block: no arrow function, otherwise TS would forget the narrowing of
  `this.x.value` established by an `if`.
- A component becomes `Component.create(props, { on })`, which is already typed.
- The declarations of the calls (`check.ts`) are appended in a `declare namespace __s`:
  the virtual TS imports nothing and is checked with the project's tsconfig as is.

## Compilation

The Vite plugin (`superPlugin`) compiles each `.super` file to TS, then oxc strips the types. An
import without an extension finds a `.super` file (`@components/shop` → `shop/index.super`).

- A method that contains elements (`render()`, `#row(item)`…) returns the list of what
  it emits. Its body is wrapped in an arrow function: an early `return;` keeps what
  has already been emitted. `return x;` there is rejected at compile time (the method returns what it
  emits); a nested function (`xs.map((x) => { return x * 2; })`) stays free.
- Each element becomes a lit template (`html\`…\``); children without statements stay in
  the parent's template.
- Children with statements become a computed hole: a function that pushes templates
  into a list, with the real `if` / `for` / `switch`, and the declarations as they are.
- `for (… ; key k)` becomes lit's `repeat` (the items follow moves); without `key`,
  a plain loop.
- `on:x` → `@x`, `prop:x` → `.x`, `ref={r}` and `{d}` → element directive, a known boolean
  attribute → `?x`, another computed attribute → `x=${v ?? nothing}`.
- The generated code keeps the line numbers of the source, and the plugin provides a source map
  (final JS → `.super`, line and column): error traces and the debugger point to the source.

## Types of `.super` files seen from a `.ts` file

For each `.super` file, `super-tsc`, the language server (on each keystroke) and Vite (in dev)
write under `<tsconfig folder>/.super/` (ignored by git):

- `virtual/…/index.ts`: the virtual TS;
- `types/…/index.d.ts`: the declaration of the file's exports, whose types are drawn from the virtual
  TS (a class becomes `declare class X extends <the class in the virtual TS> {}`), and
  `index.d.ts.map`, its source map to the `.super` file.

The tsconfigs declare `types` in `paths` and `rootDirs` (then `virtual` in `rootDirs`, for the
relative imports of the virtual TS): `routes.ts` imports `@components/shop` and sees its types, for
`tsc` as well as for the editor's TS server. The TS server follows the source map of the declaration:
"go to definition" from a `.ts` file opens the `.super` component.

## Formatting

`npm run format` formats `.super` files (and `npm run lint` checks it): the TS with Biome, with the
repository's configuration, the templates with `packages/lang/src/format.ts`. A tag stays on one
line if it fits within the width, otherwise one attribute per line; a component that receives
children, and a slot `<:name>`, are always written on several lines; running text fills the
lines; a list of elements without text keeps one element per line; blank lines between
children are kept (one at most). A line is only broken where there is already whitespace, or at the
edge of an element, a block or a statement: the render never changes. A file that has
syntax errors is not formatted.
