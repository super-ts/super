/**
 * Declaration (`.d.ts`) of a `.super` file, for the `.ts` files that import it, with its source map
 * (`.d.ts.map`) that maps each exported name back to the `.super` file.
 *
 * The types come from the virtual TS (imported as types only); the declaration only
 * redeclares the exports at known positions. The TypeScript server follows the source map of
 * declarations: "go to definition" on a component from a `.ts` file opens the `.super` file, with no
 * relay in front of the server (it is the mechanism that leads to the source code of a library).
 */
import { parse } from './parser.ts';
import { encodeMappings, lineStarts, positionOf, type Segment } from './source-map.ts';

const EXPORT =
  /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(class|function|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;

/**
 * `implementation`: the import path of the virtual TS from the declaration; `sourcePath`: the
 * path of the `.super` file from the declaration (for the source map); `name`: the file name of the
 * declaration (`index.d.ts`).
 */
export function declarationOf(source: string, implementation: string, sourcePath: string, name: string): { dts: string; map: string } {
  const sourceStarts = lineStarts(source);
  const lines: string[] = [`import type * as __impl from '${implementation}';`];
  const segments: Segment[][] = [[]];
  const typeOnly: string[] = [];
  const seen = new Set<string>();

  // The exports written in the code of the file (not in the text of a template).
  for (const part of parse(source).parts) {
    if (part.kind !== 'code') continue;
    const code = source.slice(part.span.start, part.span.end);
    for (const match of code.matchAll(EXPORT)) {
      const [, kind, exported] = match as unknown as [string, string, string];
      if (seen.has(exported)) continue;
      seen.add(exported);
      if (kind === 'type' || kind === 'interface') {
        typeOnly.push(exported);
        continue;
      }
      // The name in the source, and its place in the declaration (one line per declared name).
      const at = positionOf(sourceStarts, part.span.start + (match.index as number) + match[0].length - exported.length);
      const mapped = (line: string, column: number) => {
        lines.push(line);
        segments.push([[column, 0, at.line, at.column]]);
      };
      if (kind === 'class') {
        // A single declaration, value and type at once: a class that extends the one in the virtual
        // TS (statics and phantoms included). A constant and a type would give two
        // identical definitions.
        lines.push(`declare const __${exported}: typeof __impl.${exported};`);
        segments.push([]);
        const declaration = `export declare class ${exported} extends __${exported} {}`;
        mapped(declaration, declaration.indexOf(` ${exported} `) + 1);
      } else {
        const declaration = `export declare const ${exported}: typeof __impl.${exported};`;
        mapped(declaration, declaration.indexOf(` ${exported}:`) + 1);
        if (kind === 'enum') {
          const type = `export type ${exported} = __impl.${exported};`;
          lines.push(type);
          segments.push([]);
        }
      }
    }
  }
  // Types keep their parameters: re-exported as is (their definition leads to the virtual TS).
  if (typeOnly.length > 0) lines.push(`export type { ${typeOnly.join(', ')} } from '${implementation}';`);
  lines.push(`//# sourceMappingURL=${name}.map`);
  const map = { version: 3, file: name, sources: [sourcePath], names: [], mappings: encodeMappings(segments) };
  return { dts: `${lines.join('\n')}\n`, map: JSON.stringify(map) };
}
