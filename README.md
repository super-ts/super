<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo-light.svg" alt="Super." width="260" />
  </picture>
</p>

A minimalist front-end framework, typed end to end. It frames three things, **stores**, **components** and **routing**, and leaves everything else to your project.

With Super, the IDE knows the body of every command, the payload of every event and the parameters of every route. A link without its parameter, a screen with the wrong props, an unknown command or a typo in a template do not compile.

**Version <!-- version -->0.1.0<!-- /version -->** of the `@super-ts/*` packages, published on npm. Documentation: [super-ts.github.io/super](https://super-ts.github.io/super/).

> Status: exploratory draft. The API may still change: in 0.x, a minor version can break.

## At a glance

```ts
// src/@core/counter/contract.ts: what you read, what you ask for, what you listen to
type CounterState = { counts: Readonly<Record<string, number>> };

export class CounterContract extends SuperContract<{
  state: CounterState;
  commands: { increment(input: { id: string }): Outcome<{ count: number }, 'storage'> };
}> {
  constructor() {
    super({ name: 'counter' });
  }
  count(s: CounterState, id: string) {
    return s.counts[id] ?? 0;
  }
}

// src/@core/counter/store.ts: the implementation, and the only place where you await
export class CounterStore extends SuperStore<CounterContract> implements Commands<CounterStore> {
  #repository: CounterRepository;

  constructor({ repository }: { repository: CounterRepository }) {
    super({ contract: 'counter', initialState: { counts: {} } });
    this.#repository = repository;
  }

  async increment({ id }: { id: string }) {
    const count = this.selectors.count(id) + 1;
    await this.#repository.save(id, count).catch(() => this.fail('storage'));
    this.set((s) => ({ counts: { ...s.counts, [id]: count } }));
    return { count }; // Super publishes increment:done, or increment:failed with the reason
  }
}
```

A component is written in a `.super` file: TypeScript whose methods write their elements as statements, with `if`, `for` and `switch` in the middle of the HTML. Its class declares its tag (`@tag`), its props (`@prop`), its events (`@emit`) and, if it sets one, the page title (`@title`). What it prepares once is declared there too: stores (`@contract`), reads (`@selector`), local state (`@state`), forms (`@form`), references (`@ref`) and listeners (`@on`).

```tsx
// src/@components/shared/counter-button.super: asks for the store by name, never awaits
import { SuperElement } from '@super-ts/dom';

export class CounterButton extends SuperElement {
  @tag = 'counter-button';
  @prop counterId: string;
  @contract counter;
  @selector count = () => this.counter.selectors.count(this.counterId);

  render() {
    <button on:click={() => this.counter.send('increment', { id: this.counterId })}>{this.count.value}</button>
  }
}
```

## Why Super

- **The contract is a store's only door.** A component asks for the store by its contract's name (`@contract counter;`), reads through selectors, sends commands and listens to events, nothing else. So it can be tested with a fake store.
- **The view sends and lets go.** A command returns nothing to the caller. The store does the asynchronous work; Super tracks each command ("pending", succeeded, failed with a typed reason) and publishes its outcome.
- **Prepare, then display.** A component's declarations prepare once (stores, local state, reads, listeners), `render` displays on every render. You cannot create a subscription during render by mistake.
- **Only what is displayed re-renders.** A component re-renders only if the value it reads has changed.
- **A minimal, checked architecture.** Two required folders (`src/@core/`, `src/@components/`), and the Vite plugin rejects anything outside the frame. Everything else is up to you.
- **Typed templates.** In a `.super` file, an unknown tag, a missing or mistyped prop, an event the child does not emit or an object displayed by mistake are compile errors, reported in the editor and by `npm run typecheck`.
- **The page title follows the data.** ``@title = () => `Counter ${this.label.value}`;`` is recomputed on every render; the last mounted component that sets a title wins, and the previous one comes back when it unmounts.
- **The web standard first.** A store is an `EventTarget`, a component is a custom element. `.super` files are compiled to lit-html, without you ever importing it. The whole demo app weighs 37.4 KB of gzipped JavaScript, lit-html included.

## Installation

```bash
npm i @super-ts/core @super-ts/dom @super-ts/ui
npm i -D @super-ts/vite @super-ts/lang @super-ts/testing vite vitest happy-dom typescript
```

```ts
// vite.config.ts: the plugin compiles .super files and declares the @core/ and @components/ aliases
import { superPlugin } from '@super-ts/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [superPlugin({ src: 'src' })],
  test: { environment: 'happy-dom', setupFiles: ['./src/test-setup.ts'] },
});
```

```jsonc
// tsconfig.json: the types of .super files, written by super-tsc and the Vite plugin under .super/
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"],
    "rootDirs": [".", "./.super/types", "./.super/virtual"],
    "paths": {
      "@core/*": ["./src/@core/*", "./.super/types/src/@core/*"],
      "@components/*": ["./src/@components/*", "./.super/types/src/@components/*"]
    }
  },
  "include": ["src", "vite.config.ts"]
}
```

```ts
// src/test-setup.ts: unmounts what mount() mounted after each test
import { cleanup } from '@super-ts/testing';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
```

`npx super-tsc tsconfig.json` checks the types of `.ts` and `.super` files, `npx super-fmt --write src`
formats `.super` files. The full setup, editor included, is in [Getting started](https://super-ts.github.io/super/getting-started.html#install).

## Working on Super

```bash
npm install
npm run dev        # the demo app (examples/demo) on http://localhost:5173
npm test           # the tests (Vitest, happy-dom)
npm run typecheck  # super-tsc: the types of .ts and .super files
npm run lint       # Biome (import order, formatting) and formatting of .super files
npm run format     # formats everything (.ts by Biome, .super by the .super formatter)
npm run check      # lint, typecheck, tests, then the docs index
npm run docs       # the documentation on http://localhost:5174
```

The packages are npm workspaces (`packages/*`). In this repository, `@super-ts/…` resolves to the sources (`packages/*/src`), without a build: through the aliases in `tsconfig.json` and `vite.config.ts` in the app and the tests, and through the `@super-ts/source` export condition for Node (`.npmrc` passes it to every npm script, and Vite loads its config with `--configLoader native` to benefit from it). So run Vite and Vitest through `npm run …`.

For errors and completion in `.super` files, connect your editor to the language server in `packages/lang-server`. In Zed, install the extension in `editors/zed` as a dev extension (`zed: install dev extension`). See [Tooling](https://super-ts.github.io/super/tooling.html).

The Zed extension and the Tree-sitter grammar for `.super` files live in their own public repositories, [super-ts/super-extension-zed](https://github.com/super-ts/super-extension-zed) and [super-ts/tree-sitter-super](https://github.com/super-ts/tree-sitter-super). They are plugged in here as submodules, in `editors/zed` and `editors/tree-sitter-super`: clone with `git clone --recurse-submodules`, or run `git submodule update --init` afterwards.

## Documentation

The documentation is online at **[super-ts.github.io/super](https://super-ts.github.io/super/)**, published from [`docs/`](https://super-ts.github.io/super/) by GitHub Pages on every change. Locally, run `npm run docs`. It has built-in search (`/` key).

- [Getting started](https://super-ts.github.io/super/getting-started.html): your first feature, from contract to test.
- [Examples](https://super-ts.github.io/super/examples.html): what each file of the demo app shows.
- [Architecture](https://super-ts.github.io/super/architecture.html): what Super enforces, what is left to you.
- [Commands and events](https://super-ts.github.io/super/commands-and-events.html): the path of an action, from click to screen.
- [Components](https://super-ts.github.io/super/components.html): preparation and `render`, and where to put what.
- [Templates](https://super-ts.github.io/super/templates.html): the syntax of `.super` files; and [Tooling](https://super-ts.github.io/super/tooling.html): `super-tsc`, language server, editor, Vite.
- [Router](https://super-ts.github.io/super/router.html): typed paths, redirects, guards; and [Handling errors](https://super-ts.github.io/super/errors.html).
- [Forms](https://super-ts.github.io/super/forms.html): every field type, rules, asynchronous checks, lists, server errors.
- [Frequently asked questions](https://super-ts.github.io/super/faq.html) and [API](https://super-ts.github.io/super/api.html).
- [Limitations](https://super-ts.github.io/super/limitations.html).
- [Roadmap and open questions](https://super-ts.github.io/super/roadmap.html).

### For an LLM or a coding agent

The docs also exist in markdown, in the [llms.txt](https://llmstxt.org) format:

- [`docs/llms.txt`](https://super-ts.github.io/super/llms.txt): the index, one line per page.
- [`docs/llms-full.txt`](https://super-ts.github.io/super/llms-full.txt): all the docs in one file, code included.
- [`docs/llms-small.txt`](https://super-ts.github.io/super/llms-small.txt): the same, without the FAQ, the examples catalogue or the references to the demo app, for small context windows.

These files are generated from the HTML pages, like the search index. To remove a passage from the short version, mark it `data-llm="skip"` in the HTML (see `docs/tools/llms.mjs`).

The search index and the LLM files are regenerated on every `npm run check` (or `npm run docs:index`). `npm run docs:check` fails if they are out of date, and generation fails if a page contains an HTML tag the converter cannot translate.

## The repository

```
packages/core      SuperContract, SuperStore: contracts, selectors, stores
packages/dom       SuperElement, rendering, createApp, router
packages/testing   mount, fakeStore, record
packages/ui        the @super-ts/ui UI kit: fields bound to forms, CommandButton, RouteLink, dialogs, table…
packages/vite      the plugin: .super compilation, architecture rules, @core / @components aliases, contracts.d.ts
packages/lang      the .super language: parser, compilation to lit, virtual TypeScript, super-tsc (SPEC.md)
packages/lang-server  the .super language server (Volar on TypeScript 6)
packages/lint      the Biome configuration (import order)
examples/demo      the demo app: counters, form, shop, errors, widget, composition, kit
editors/zed        the Zed extension for .super files (submodule, super-ts/super-extension-zed repository)
editors/tree-sitter-super  the Tree-sitter grammar for .super files (submodule, super-ts/tree-sitter-super repository)
docs/              the documentation site and the llms*.txt files (docs/tools: generation of the index and llms*.txt)
```
