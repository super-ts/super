/**
 * Source maps des `.super` compilés : codage VLQ, et composition « JS final → TS compilé → `.super` ».
 *
 * Le compilateur note des segments recopiés (`Copied` : telle plage du TS compilé est le texte de
 * telle position de la source) ; oxc fournit la map JS → TS compilé ; on compose les deux.
 */

export type Copied = { generated: number; source: number; length: number };

export type SourceMap = { version: 3; sources: string[]; sourcesContent: string[]; names: string[]; mappings: string };

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value: number): string {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    out += BASE64[digit];
  } while (vlq > 0);
  return out;
}

/** Segments `[colonne générée, source, ligne source, colonne source]` par ligne générée. */
export type Segment = [number, number, number, number];

export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  for (const line of mappings.split(';')) {
    const segments: Segment[] = [];
    let column = 0;
    for (const text of line.split(',')) {
      if (text === '') continue;
      const values: number[] = [];
      let shift = 0;
      let value = 0;
      for (const char of text) {
        const digit = BASE64.indexOf(char);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      column += values[0] ?? 0;
      if (values.length < 4) continue;
      source += values[1] as number;
      sourceLine += values[2] as number;
      sourceColumn += values[3] as number;
      segments.push([column, source, sourceLine, sourceColumn]);
    }
    lines.push(segments);
  }
  return lines;
}

export function encodeMappings(lines: Segment[][]): string {
  let previousSource = 0;
  let previousLine = 0;
  let previousColumn = 0;
  return lines
    .map((segments) => {
      let previousGenerated = 0;
      return segments
        .map(([column, source, line, sourceColumn]) => {
          const text =
            encodeVlq(column - previousGenerated) +
            encodeVlq(source - previousSource) +
            encodeVlq(line - previousLine) +
            encodeVlq(sourceColumn - previousColumn);
          previousGenerated = column;
          previousSource = source;
          previousLine = line;
          previousColumn = sourceColumn;
          return text;
        })
        .join(',');
    })
    .join(';');
}

/** Débuts de ligne d'un texte, pour passer d'une position (offset) à ligne/colonne et inversement. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

export function positionOf(starts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] as number) <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low, column: offset - (starts[low] as number) };
}

/** La position dans la source d'une position du TS compilé, si elle tombe dans un segment recopié. */
export function sourceOffsetOf(copied: Copied[], generated: number): number | null {
  let low = 0;
  let high = copied.length - 1;
  let found: Copied | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = copied[middle] as Copied;
    if (segment.generated <= generated) {
      found = segment;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (!found || generated > found.generated + found.length) return null;
  return found.source + (generated - found.generated);
}

/**
 * Compose la map d'oxc (JS → TS compilé) avec les segments recopiés (TS compilé → `.super`) :
 * la map du JS final vers le `.super`. Une position du JS qui vient de code produit par le
 * compilateur (pas recopié) n'est pas associée.
 */
export function composeMap(file: string, source: string, compiled: string, copied: Copied[], oxcMappings: string): SourceMap {
  const compiledStarts = lineStarts(compiled);
  const sourceStarts = lineStarts(source);
  const lines = decodeMappings(oxcMappings).map((segments) =>
    segments.flatMap(([column, , line, sourceColumn]): Segment[] => {
      const offset = sourceOffsetOf(copied, (compiledStarts[line] ?? 0) + sourceColumn);
      if (offset === null) return [];
      const position = positionOf(sourceStarts, offset);
      return [[column, 0, position.line, position.column]];
    }),
  );
  return { version: 3, sources: [file], sourcesContent: [source], names: [], mappings: encodeMappings(lines) };
}

/** Pour les tests : la position dans la source d'une position (ligne et colonne à partir de 0) du JS. */
export function originalPositionFor(map: SourceMap, line: number, column: number): { line: number; column: number } | null {
  const segments = decodeMappings(map.mappings)[line] ?? [];
  let best: Segment | null = null;
  for (const segment of segments) if (segment[0] <= column) best = segment;
  return best ? { line: best[2], column: best[3] + (column - best[0]) } : null;
}
