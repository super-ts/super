/**
 * `super-tsc` : vérifie les types d'un projet qui contient des fichiers `.super`.
 *
 * TypeScript 7 n'a pas d'API de plugin : on écrit le TS virtuel de chaque `.super` dans
 * `<projet>/.super/virtual/`, à la même place relative, et un tsconfig qui fusionne les deux
 * arborescences (`rootDirs`, `paths` doublés). On lance `tsc`, puis on ramène chaque erreur
 * du TS virtuel à sa position dans le `.super`.
 *
 * Usage : node packages/lang/src/cli.ts <tsconfig du projet>
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toSource, toVirtual, type VirtualCode } from './virtual.ts';
import { virtualPathOf, writeVirtualFile } from './virtual-files.ts';

type Config = { extends?: string; compilerOptions?: { paths?: Record<string, string[]> }; include?: string[]; exclude?: string[] };

/** JSON avec commentaires et virgules finales, comme un tsconfig. */
function readJsonc(path: string): Config {
  const text = readFileSync(path, 'utf8');
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Le `paths` effectif et le dossier du tsconfig qui le définit (les cibles sont relatives à lui). */
function effectivePaths(configPath: string): { paths: Record<string, string[]>; dir: string } {
  const config = readJsonc(configPath);
  if (config.compilerOptions?.paths) return { paths: config.compilerOptions.paths, dir: dirname(configPath) };
  if (config.extends) return effectivePaths(resolve(dirname(configPath), config.extends));
  return { paths: {}, dir: dirname(configPath) };
}

/** Le `exclude` effectif, en chemins absolus (relatifs au tsconfig qui le définit). */
function effectiveExclude(configPath: string): string[] {
  const config = readJsonc(configPath);
  if (config.exclude) return config.exclude.map((p) => (p.startsWith('*') ? p : resolve(dirname(configPath), p)));
  if (config.extends) return effectiveExclude(resolve(dirname(configPath), config.extends));
  return [];
}

function superFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.super') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...superFiles(path));
    else if (entry.name.endsWith('.super')) found.push(path);
  }
  return found;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function position(text: string, offset: number): { line: number; column: number } {
  const starts = lineStarts(text);
  let line = 0;
  while (line + 1 < starts.length && (starts[line + 1] as number) <= offset) line++;
  return { line: line + 1, column: offset - (starts[line] as number) + 1 };
}

function offsetOf(text: string, line: number, column: number): number {
  return (lineStarts(text)[line - 1] ?? 0) + column - 1;
}

/** Vérifie le projet ; renvoie les erreurs, une par ligne, au format de `tsc --pretty false`. */
export function check(configPath: string): string[] {
  const errors: string[] = [];
  const projectDir = dirname(resolve(configPath));
  const shadowDir = join(projectDir, '.super');
  const virtualDir = join(shadowDir, 'virtual');
  const toShadow = (abs: string) => {
    const path = relative(shadowDir, abs) || '.';
    return path.startsWith('.') ? path : `./${path}`;
  };

  rmSync(shadowDir, { recursive: true, force: true });
  mkdirSync(virtualDir, { recursive: true });
  writeFileSync(join(shadowDir, '.gitignore'), '*\n');

  // Le TS virtuel de chaque `.super`, et les erreurs du parser.
  const virtuals = new Map<string, { source: string; sourceText: string; virtual: VirtualCode }>();
  // Les `.super` couverts par l'`include` du tsconfig et pas par son `exclude` (chemins simples,
  // pas les motifs `*`).
  const within = (file: string, path: string) => file === path || file.startsWith(`${path}${sep}`);
  const included = (readJsonc(configPath).include ?? ['.']).map((p) => resolve(projectDir, p));
  const excluded = effectiveExclude(resolve(configPath)).filter((p) => !p.includes('*'));
  const sources = superFiles(projectDir).filter((f) => included.some((p) => within(f, p)) && !excluded.some((p) => within(f, p)));
  for (const source of sources) {
    const sourceText = readFileSync(source, 'utf8');
    const virtual = toVirtual(sourceText);
    for (const d of virtual.file.diagnostics) {
      const { line, column } = position(sourceText, d.start);
      errors.push(`${relative(process.cwd(), source)}(${line},${column}): error SUPER: ${d.message}`);
    }
    // Le TS virtuel (vérifié ici) et la déclaration (pour les `.ts` qui l'importent, et l'éditeur).
    writeVirtualFile(source, sourceText, projectDir);
    virtuals.set(virtualPathOf(projectDir, source), { source, sourceText, virtual });
  }

  // Le tsconfig de l'ombre : celui du projet, avec la seconde arborescence.
  const config = readJsonc(configPath);
  const { paths, dir: pathsDir } = effectivePaths(resolve(configPath));
  const shadowPaths: Record<string, string[]> = {};
  for (const [pattern, targets] of Object.entries(paths)) {
    shadowPaths[pattern] = targets.flatMap((t) => {
      const abs = resolve(pathsDir, t);
      const inProject = !relative(projectDir, abs).startsWith('..');
      return inProject ? [toShadow(abs), toShadow(join(virtualDir, relative(projectDir, abs)))] : [toShadow(abs)];
    });
  }
  const include = (config.include ?? ['.']).map((p) => toShadow(resolve(projectDir, p)));
  writeFileSync(
    join(shadowDir, 'tsconfig.json'),
    JSON.stringify(
      {
        extends: toShadow(resolve(configPath)),
        compilerOptions: { rootDirs: [toShadow(projectDir), './virtual'], paths: shadowPaths },
        include: [...include, './virtual'],
        // Un `exclude` hérité qui viserait `.super` (celui du tsconfig racine) cacherait le TS virtuel.
        exclude: effectiveExclude(resolve(configPath))
          .filter((p) => !p.includes('.super'))
          .map((p) => (p.startsWith('*') ? p : toShadow(p))),
      },
      null,
      2,
    ),
  );

  const tsc = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false', '-p', join(shadowDir, 'tsconfig.json')], { encoding: 'utf8' });
  const output = `${tsc.stdout}${tsc.stderr}`.trim();
  for (const raw of output ? output.split('\n') : []) {
    const match = /^(.+?)\((\d+),(\d+)\): (.*)$/.exec(raw);
    if (!match) {
      // Suite d'un message sur plusieurs lignes.
      errors[errors.length - 1] += `\n${raw}`;
      continue;
    }
    const [, file, line, column, message] = match as unknown as [string, string, string, string, string];
    const entry = virtuals.get(resolve(shadowDir, file)) ?? virtuals.get(resolve(file));
    if (!entry) {
      errors.push(`${relative(process.cwd(), resolve(file))}(${line},${column}): ${message}`);
      continue;
    }
    const at = toSource(entry.virtual, offsetOf(entry.virtual.code, Number(line), Number(column)));
    const where = at ? position(entry.sourceText, at.start) : { line: 1, column: 1 };
    errors.push(`${relative(process.cwd(), entry.source)}(${where.line},${where.column}): ${message}`);
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('Usage : super-tsc <tsconfig.json>');
    process.exit(2);
  }
  const errors = check(configPath);
  for (const error of errors) console.log(error);
  process.exit(errors.length > 0 ? 1 : 0);
}
