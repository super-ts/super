import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkComponentImports, checkCoreImports, checkModule } from './architecture';
import { superPlugin } from './index';

describe('checkModule', () => {
  const store = `import { SuperStore } from '@super-ts/core';\nexport class S extends SuperStore<C> {}`;
  const contractModule = `import { SuperContract } from '@super-ts/core';`;
  const componentModule = `import { html, SuperElement } from '@super-ts/dom';`;

  test('accepts contracts and stores under @core/, at any depth', () => {
    expect(checkModule('@core/counter/store.ts', store)).toBeNull();
    expect(checkModule('@core/billing/invoice/contract.ts', contractModule)).toBeNull();
  });

  test('accepts components under @components/', () => {
    expect(checkModule('@components/screens/home.ts', componentModule)).toBeNull();
  });

  test('rejects a store or a contract outside @core/', () => {
    expect(checkModule('adapters/counter.store.ts', store)).toMatch(
      /src\/adapters\/counter\.store\.ts imports SuperStore .* under src\/@core\/: this module is not loaded/,
    );
    expect(checkModule('ports/x.ts', contractModule)).toMatch(/SuperContract/);
  });

  test('folders without the prefix are not Super folders', () => {
    expect(checkModule('core/counter.store.ts', store)).toMatch(/under src\/@core\//);
    expect(checkModule('components/home.ts', componentModule)).toMatch(/under src\/@components\//);
  });

  test('rejects a component outside @components/', () => {
    expect(checkModule('@core/widget.ts', componentModule)).toMatch(/under src\/@components\//);
  });

  test('detects renamed imports', () => {
    expect(checkModule('main.ts', `import { SuperElement as E } from '@super-ts/dom';`)).toMatch(/SuperElement/);
  });

  test('ignores type imports and other symbols', () => {
    expect(checkModule('ports/repo.ts', `import type { StoreOfContract } from '@super-ts/core';`)).toBeNull();
    expect(checkModule('main.ts', `import { createApp, createRouter, type ElementClass } from '@super-ts/dom';`)).toBeNull();
    expect(checkModule('routes.ts', `import { defineRouter } from '@super-ts/dom';`)).toBeNull();
  });
});

describe('superPlugin', () => {
  const plugin = superPlugin({ src: '/app/src' });
  // `transform` is asynchronous (a `.super` goes through the compiler, then through oxc).
  const transform = async (code: string, id: string) => {
    const errors: string[] = [];
    const context = {
      error: (message: string | { message: string }) => {
        const text = typeof message === 'string' ? message : message.message;
        errors.push(text);
        throw new Error(text);
      },
    };
    try {
      await (plugin.transform as Function).call(context, code, id);
    } catch {
      /* the error is captured above */
    }
    return errors;
  };

  test('blocks a module of the app src that breaks a rule', async () => {
    expect(await transform(`import { SuperElement } from '@super-ts/dom';`, '/app/src/shared/button.ts')).toHaveLength(1);
  });

  test('lets through tests, files outside src and non JS/TS files', async () => {
    expect(await transform(`import { SuperElement } from '@super-ts/dom';`, '/app/src/shared/button.test.ts')).toEqual([]);
    expect(await transform(`import { SuperElement } from '@super-ts/dom';`, '/elsewhere/button.ts')).toEqual([]);
    expect(await transform(`import { SuperElement } from '@super-ts/dom';`, '/app/src/styles.css')).toEqual([]);
  });

  test('compiles a .super, and applies the rules to the compiled code', async () => {
    const component =
      "import { SuperElement } from '@super-ts/dom';\nexport class A extends SuperElement {\n  @tag = 'a-a';\n  render() {\n    <p>a</p>\n  }\n}\n";
    expect(await transform(component, '/app/src/@components/a/index.super')).toEqual([]);
    expect(await transform(component, '/app/src/shared/a.super')).toHaveLength(1);
  });

  test('reports a syntax error in a .super', async () => {
    const errors = await transform('export class A {\n  render() {\n    <p>for (x) y</p>\n  }\n}\n', '/app/src/@components/a/index.super');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Text read as `for`');
  });
});

describe('checkComponentImports', () => {
  const check = (path: string, code: string) => checkComponentImports(path, code);

  test('a component imports only types from @core/', () => {
    expect(check('@components/shop/index.ts', "import type { CartState } from '../../@core/cart/contract';")).toBeNull();
    expect(check('@components/shop/index.ts', "import { type CartState } from '@core/cart/contract';")).toBeNull();
  });

  test('rejects any value from @core/: contract, store, constant', () => {
    expect(check('@components/shop/index.ts', "import { CartContract } from '../../@core/cart/contract';")).toMatch(
      /src\/@components\/shop\/index\.ts imports CartContract from \.\.\/\.\.\/@core\/cart\/contract\. A component imports only types from src\/@core\//,
    );
    expect(check('@components/shop/index.ts', "import { CartStore } from '@core/cart/store';")).toMatch(/imports CartStore/);
    expect(check('@components/x.ts', "import { MIN as M, type T } from '@core/counter/contract';")).toMatch(/imports MIN from/);
  });

  test('rejects default and `* as` imports', () => {
    expect(check('@components/x.ts', "import * as core from '@core/cart/contract';")).toMatch(/imports \* as core/);
  });

  test('only looks at components, and only at imports into @core/', () => {
    expect(check('adapters/x.ts', "import { CartStore } from '../@core/cart/store';")).toBeNull();
    expect(check('@components/x.ts', "import { formatPrice } from '../format';")).toBeNull();
  });
});

describe('alias', () => {
  test('the plugin declares @core/ and @components/, resolved from src', () => {
    const plugin = superPlugin({ src: '/app/src' }) as unknown as {
      config: () => { resolve: { alias: { find: RegExp; replacement: string }[] } };
    };
    const alias = plugin.config().resolve.alias;
    const resolveWith = (id: string) => {
      const rule = alias.find((entry) => entry.find.test(id));
      return rule ? id.replace(rule.find, rule.replacement) : id;
    };

    expect(resolveWith('@core/counter.contract')).toBe(resolve('/app/src/@core') + '/counter.contract');
    expect(resolveWith('@components/app-shell')).toBe(resolve('/app/src/@components') + '/app-shell');
    expect(resolveWith('@super-ts/core')).toBe('@super-ts/core');
    expect(resolveWith('@corepack/x')).toBe('@corepack/x');
  });
});

describe('checkCoreImports', () => {
  test('rejects any value import from @super-ts/dom in @core/', () => {
    expect(checkCoreImports('@core/counter.store.ts', "import { html } from '@super-ts/dom';")).toMatch(
      /src\/@core\/counter\.store\.ts imports html from @super-ts\/dom\. Contracts and stores do not depend on the DOM/,
    );
    expect(checkCoreImports('@core/x.ts', "import * as dom from '@super-ts/dom';")).toMatch(/imports \* as dom/);
    expect(checkCoreImports('@core/x.ts', "import { type ElementClass, SuperElement } from '@super-ts/dom';")).toMatch(
      /imports SuperElement from/,
    );
  });

  test('lets through types, other packages, and the rest of src', () => {
    expect(checkCoreImports('@core/x.ts', "import type { ElementClass } from '@super-ts/dom';")).toBeNull();
    expect(checkCoreImports('@core/x.ts', "import { type ElementClass } from '@super-ts/dom';")).toBeNull();
    expect(checkCoreImports('@core/x.ts', "import { SuperStore } from '@super-ts/core';")).toBeNull();
    expect(checkCoreImports('@components/x.ts', "import { html } from '@super-ts/dom';")).toBeNull();
  });
});
