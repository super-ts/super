import { declarationOf } from './declarations.ts';
import { decodeMappings } from './source-map.ts';

describe('declarationOf', () => {
  const source = [
    "import { SuperElement } from '@super-ts/dom';",
    'export type Props = { id: string };',
    'export const LIMIT = 3;',
    'export function helper() {}',
    'export class Card extends SuperElement {',
    "  @tag = 'x-card';",
    '  render() {',
    '    <p>export class Fake in some text</p>',
    '  }',
    '}',
  ].join('\n');
  const { dts, map } = declarationOf(source, './impl', '../card.super', 'card.d.ts');

  it('redeclares the exports of the code (not those written in a template), types drawn from the virtual TS', () => {
    expect(dts).toBe(
      [
        "import type * as __impl from './impl';",
        'export declare const LIMIT: typeof __impl.LIMIT;',
        'export declare const helper: typeof __impl.helper;',
        'declare const __Card: typeof __impl.Card;',
        'export declare class Card extends __Card {}',
        "export type { Props } from './impl';",
        '//# sourceMappingURL=card.d.ts.map',
        '',
      ].join('\n'),
    );
  });

  it('maps each declared name to its place in the .super file', () => {
    const { sources, mappings } = JSON.parse(map);
    expect(sources).toEqual(['../card.super']);
    const lines = decodeMappings(mappings);
    const nameAt = (line: number, name: string) => [dts.split('\n')[line]?.indexOf(name)];
    expect(lines[1]?.[0]).toEqual([...nameAt(1, 'LIMIT'), 0, 2, 13]);
    expect(lines[2]?.[0]).toEqual([...nameAt(2, 'helper'), 0, 3, 16]);
    expect(lines[4]?.[0]).toEqual([...nameAt(4, 'Card'), 0, 4, 13]);
  });
});
