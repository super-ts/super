import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkComponentImports, checkCoreImports, checkModule } from './architecture';
import { superPlugin } from './index';

describe('checkModule', () => {
  const store = `import { SuperStore } from '@super-ts/core';\nexport class S extends SuperStore<C> {}`;
  const contractModule = `import { SuperContract } from '@super-ts/core';`;
  const componentModule = `import { html, SuperElement } from '@super-ts/dom';`;

  test('accepte contrats et stores sous @core/, à toute profondeur', () => {
    expect(checkModule('@core/counter/store.ts', store)).toBeNull();
    expect(checkModule('@core/billing/invoice/contract.ts', contractModule)).toBeNull();
  });

  test('accepte les composants sous @components/', () => {
    expect(checkModule('@components/screens/home.ts', componentModule)).toBeNull();
  });

  test('refuse un store ou un contrat hors de @core/', () => {
    expect(checkModule('adapters/counter.store.ts', store)).toMatch(
      /src\/adapters\/counter\.store\.ts importe SuperStore .* sous src\/@core\/ : ce module n'est pas chargé/,
    );
    expect(checkModule('ports/x.ts', contractModule)).toMatch(/SuperContract/);
  });

  test('les dossiers sans préfixe ne sont pas des dossiers Super', () => {
    expect(checkModule('core/counter.store.ts', store)).toMatch(/sous src\/@core\//);
    expect(checkModule('components/home.ts', componentModule)).toMatch(/sous src\/@components\//);
  });

  test('refuse un composant hors de @components/', () => {
    expect(checkModule('@core/widget.ts', componentModule)).toMatch(/sous src\/@components\//);
  });

  test('détecte les imports renommés', () => {
    expect(checkModule('main.ts', `import { SuperElement as E } from '@super-ts/dom';`)).toMatch(/SuperElement/);
  });

  test('ignore les imports de type et les autres symboles', () => {
    expect(checkModule('ports/repo.ts', `import type { StoreOfContract } from '@super-ts/core';`)).toBeNull();
    expect(checkModule('main.ts', `import { createApp, createRouter, type ElementClass } from '@super-ts/dom';`)).toBeNull();
    expect(checkModule('routes.ts', `import { defineRouter } from '@super-ts/dom';`)).toBeNull();
  });
});

describe('superPlugin', () => {
  const plugin = superPlugin({ src: '/app/src' });
  // `transform` est asynchrone (un `.super` passe par le compilateur, puis par oxc).
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
      /* l'erreur est capturée ci-dessus */
    }
    return errors;
  };

  test('bloque un module hors règle du src de l’app', async () => {
    expect(await transform(`import { SuperElement } from '@super-ts/dom';`, '/app/src/shared/button.ts')).toHaveLength(1);
  });

  test('laisse passer les tests, les fichiers hors src et les fichiers non JS/TS', async () => {
    expect(await transform(`import { SuperElement } from '@super-ts/dom';`, '/app/src/shared/button.test.ts')).toEqual([]);
    expect(await transform(`import { SuperElement } from '@super-ts/dom';`, '/elsewhere/button.ts')).toEqual([]);
    expect(await transform(`import { SuperElement } from '@super-ts/dom';`, '/app/src/styles.css')).toEqual([]);
  });

  test('compile un .super, et applique les règles au code compilé', async () => {
    const component =
      "import { SuperElement } from '@super-ts/dom';\nexport class A extends SuperElement {\n  @tag = 'a-a';\n  render() {\n    <p>a</p>\n  }\n}\n";
    expect(await transform(component, '/app/src/@components/a/index.super')).toEqual([]);
    expect(await transform(component, '/app/src/shared/a.super')).toHaveLength(1);
  });

  test('signale une erreur de syntaxe d’un .super', async () => {
    const errors = await transform('export class A {\n  render() {\n    <p>for (x) y</p>\n  }\n}\n', '/app/src/@components/a/index.super');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Text read as `for`');
  });
});

describe('checkComponentImports', () => {
  const check = (path: string, code: string) => checkComponentImports(path, code);

  test('un composant n’importe de @core/ que des types', () => {
    expect(check('@components/shop/index.ts', "import type { CartState } from '../../@core/cart/contract';")).toBeNull();
    expect(check('@components/shop/index.ts', "import { type CartState } from '@core/cart/contract';")).toBeNull();
  });

  test('refuse toute valeur de @core/ : contrat, store, constante', () => {
    expect(check('@components/shop/index.ts', "import { CartContract } from '../../@core/cart/contract';")).toMatch(
      /src\/@components\/shop\/index\.ts importe CartContract depuis \.\.\/\.\.\/@core\/cart\/contract\. Un composant n'importe de src\/@core\/ que des types/,
    );
    expect(check('@components/shop/index.ts', "import { CartStore } from '@core/cart/store';")).toMatch(/importe CartStore/);
    expect(check('@components/x.ts', "import { MIN as M, type T } from '@core/counter/contract';")).toMatch(/importe MIN depuis/);
  });

  test('refuse les imports par défaut et `* as`', () => {
    expect(check('@components/x.ts', "import * as core from '@core/cart/contract';")).toMatch(/importe \* as core/);
  });

  test('ne regarde que les composants, et que les imports vers @core/', () => {
    expect(check('adapters/x.ts', "import { CartStore } from '../@core/cart/store';")).toBeNull();
    expect(check('@components/x.ts', "import { formatPrice } from '../format';")).toBeNull();
  });
});

describe('alias', () => {
  test('le plugin déclare @core/ et @components/, résolus depuis src', () => {
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
  test('refuse tout import de valeur depuis @super-ts/dom dans @core/', () => {
    expect(checkCoreImports('@core/counter.store.ts', "import { html } from '@super-ts/dom';")).toMatch(
      /src\/@core\/counter\.store\.ts importe html depuis @super-ts\/dom\. Les contrats et les stores ne dépendent pas du DOM/,
    );
    expect(checkCoreImports('@core/x.ts', "import * as dom from '@super-ts/dom';")).toMatch(/importe \* as dom/);
    expect(checkCoreImports('@core/x.ts', "import { type ElementClass, SuperElement } from '@super-ts/dom';")).toMatch(
      /importe SuperElement depuis/,
    );
  });

  test('laisse passer les types, les autres paquets, et le reste du src', () => {
    expect(checkCoreImports('@core/x.ts', "import type { ElementClass } from '@super-ts/dom';")).toBeNull();
    expect(checkCoreImports('@core/x.ts', "import { type ElementClass } from '@super-ts/dom';")).toBeNull();
    expect(checkCoreImports('@core/x.ts', "import { SuperStore } from '@super-ts/core';")).toBeNull();
    expect(checkCoreImports('@components/x.ts', "import { html } from '@super-ts/dom';")).toBeNull();
  });
});
