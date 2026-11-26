import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  contractsDeclaration,
  contractsIn,
  contractsModule,
  hotModuleCode,
  scanContracts,
  scanRouter,
  scanScreenRoutes,
} from './contracts';

const CART = `export class CartContract extends SuperContract<CartTypes> {
  constructor() {
    super({ name: 'cart' });
  }
  count(s: CartState) { return 0; }
}`;

function app(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'super-contracts-'));
  for (const [path, code] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), code);
  }
  return root;
}

describe('contracts read by the plugin', () => {
  test('a class that extends SuperContract, named by super({ name })', () => {
    expect(contractsIn('@core/cart.contract.ts', CART)).toEqual([
      { file: '@core/cart.contract.ts', className: 'CartContract', name: 'cart' },
    ]);
  });

  test('a contract without a name is reported', () => {
    expect(() => contractsIn('@core/x.contract.ts', 'export class X extends SuperContract<T> {}')).toThrow("super({ name: '…' })");
  });

  test('scans src/@core, subfolders included, and rejects duplicate names', () => {
    const root = app({
      '@core/cart/contract.ts': CART,
      '@core/cart/store.ts': 'export class CartStore extends SuperStore<CartContract> {}',
      '@core/shop/order.contract.ts': CART.replace(/Cart/g, 'Order').replace("'cart'", "'order'"),
    });
    expect(scanContracts(root).map((e) => [e.name, e.file])).toEqual([
      ['cart', '@core/cart/contract.ts'],
      ['order', '@core/shop/order.contract.ts'],
    ]);

    const twice = app({ '@core/a.contract.ts': CART, '@core/b.contract.ts': CART });
    expect(() => scanContracts(twice)).toThrow('two contracts named "cart"');
  });

  test('virtual module and types file', () => {
    const entries = [{ file: '@core/cart/contract.ts', className: 'CartContract', name: 'cart' }];
    expect(contractsModule('/app/src', entries)).toContain('registerContract("cart", () => m0.CartContract);');
    const declaration = contractsDeclaration(entries);
    expect(declaration).toContain("import type { CartContract } from './cart/contract';");
    expect(declaration).toContain('    cart: CartContract;');
    expect(contractsDeclaration([{ ...entries[0]!, name: 'my-cart' }])).toContain("'my-cart': CartContract;");
  });

  test('the app router is registered under the name router', () => {
    const root = app({
      'routes.ts': "export const Router = defineRouter({ home: '/' }).screens(() => ({}));",
      'x.test.ts': 'export const Other = defineRouter({})',
    });
    const router = scanRouter(root);
    expect(router).toEqual({ file: 'routes.ts', exportName: 'Router' });
    const declaration = contractsDeclaration([], router);
    expect(declaration).toContain("import type { Router } from '../routes';");
    expect(declaration).toContain('    router: AppRouterContractOf<typeof Router>;');
    expect(() => contractsDeclaration([{ file: '@core/r.contract.ts', className: 'R', name: 'router' }], router)).toThrow('reserved');
  });

  test('each screen is linked to its route, through its import and its tag', () => {
    const root = app({
      'routes.ts': `import { defineRouter, redirect } from '@super-ts/dom';
import { CounterScreen } from '@components/counter';
import { ListScreen as Screens } from './screens/list';
import { NotFound } from '@components/not-found';

export const Router = defineRouter({ a: '/a', b: '/b', c: '/c', d: '/d' }).screens(() => ({
  a: CounterScreen,
  'b': Screens,
  c: redirect({ to: 'a' }), // a redirect has no screen
  d: CounterScreen,
  '*': NotFound,
}));`,
      '@components/counter/index.super':
        "export class CounterScreen extends SuperElement<{ props: P }> {\n  static tag = 'counter-screen';\n}",
      'screens/list.ts':
        'class Other extends SuperElement {\n  static tag = \'other\';\n}\nexport class ListScreen extends SuperElement {\n  static tag = "list-screen";\n}',
      '@components/not-found.super': "export class NotFound extends SuperElement {\n  static tag = 'not-found';\n}",
    });
    const screens = scanScreenRoutes(root, scanRouter(root));
    expect(screens).toEqual({ 'counter-screen': ['a', 'd'], 'list-screen': ['b'] });
    const declaration = contractsDeclaration([], scanRouter(root), screens);
    expect(declaration).toContain(
      "declare module '@super-ts/dom' {\n  interface ScreenRoutes {\n    'counter-screen': 'a' | 'd';\n    'list-screen': 'b';\n  }\n}",
    );
    expect(contractsDeclaration([], scanRouter(root))).not.toContain('ScreenRoutes');
  });

  test('hot replacement: the code appended at the end of a component module', () => {
    const plain = 'export class ShopScreen extends SuperElement {}\nclass Line extends SuperElement<{ props: P }> {}';
    expect(hotModuleCode(plain)).toContain('__superHotReplace([ShopScreen, Line], { privateFields: false });');
    expect(hotModuleCode(plain)).toContain('import.meta.hot.accept();');
    expect(hotModuleCode('export class W extends SuperElement {\n  #close = null;\n}')).toContain('privateFields: true');
    expect(hotModuleCode("export const formatPrice = (n: number) => '';")).toBeNull();
  });
});
