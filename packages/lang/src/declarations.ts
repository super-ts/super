/**
 * Déclaration (`.d.ts`) d'un fichier `.super`, pour les `.ts` qui l'importent, avec sa source map
 * (`.d.ts.map`) qui renvoie chaque nom exporté au `.super`.
 *
 * Les types viennent du TS virtuel (importé en type seulement) ; la déclaration ne fait que
 * redéclarer les exports à des positions connues. Le serveur TypeScript suit la source map des
 * déclarations : « aller à la définition » sur un composant depuis un `.ts` ouvre le `.super`, sans
 * relais devant le serveur (c'est le mécanisme qui mène au code source d'une bibliothèque).
 */
import { parse } from './parser.ts';
import { encodeMappings, lineStarts, positionOf, type Segment } from './source-map.ts';

const EXPORT =
  /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(class|function|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;

/**
 * `implementation` : le chemin d'import du TS virtuel depuis la déclaration ; `sourcePath` : le
 * chemin du `.super` depuis la déclaration (pour la source map) ; `name` : le nom de fichier de la
 * déclaration (`index.d.ts`).
 */
export function declarationOf(source: string, implementation: string, sourcePath: string, name: string): { dts: string; map: string } {
  const sourceStarts = lineStarts(source);
  const lines: string[] = [`import type * as __impl from '${implementation}';`];
  const segments: Segment[][] = [[]];
  const typeOnly: string[] = [];
  const seen = new Set<string>();

  // Les exports écrits dans le code du fichier (pas dans le texte d'un template).
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
      // Le nom dans la source, et sa place dans la déclaration (une ligne par nom déclaré).
      const at = positionOf(sourceStarts, part.span.start + (match.index as number) + match[0].length - exported.length);
      const mapped = (line: string, column: number) => {
        lines.push(line);
        segments.push([[column, 0, at.line, at.column]]);
      };
      if (kind === 'class') {
        // Une seule déclaration, valeur et type à la fois : une classe qui hérite de celle du TS
        // virtuel (statiques et fantômes compris). Une constante et un type donneraient deux
        // définitions identiques.
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
  // Les types gardent leurs paramètres : réexportés tels quels (leur définition mène au TS virtuel).
  if (typeOnly.length > 0) lines.push(`export type { ${typeOnly.join(', ')} } from '${implementation}';`);
  lines.push(`//# sourceMappingURL=${name}.map`);
  const map = { version: 3, file: name, sources: [sourcePath], names: [], mappings: encodeMappings(segments) };
  return { dts: `${lines.join('\n')}\n`, map: JSON.stringify(map) };
}
