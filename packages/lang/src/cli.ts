#!/usr/bin/env node
/**
 * `super-tsc`: type checks a project that contains `.super` files.
 *
 * TypeScript 7 has no plugin API: the virtual TS of each `.super` file is written to
 * `<project>/.super/virtual/`, at the same relative place, along with a tsconfig that merges the two
 * trees (`rootDirs`, doubled `paths`). `tsc` is run, then each error in the virtual TS
 * is mapped back to its position in the `.super` file.
 *
 * Usage: node packages/lang/src/cli.ts <project tsconfig>
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toSource, toVirtual, type VirtualCode } from './virtual.ts';
import { virtualPathOf, writeVirtualFile } from './virtual-files.ts';

type Config = { extends?: string; compilerOptions?: { paths?: Record<string, string[]> }; include?: string[]; exclude?: string[] };

/** JSON with comments and trailing commas, like a tsconfig. */
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

/** The effective `paths` and the folder of the tsconfig that defines it (targets are relative to it). */
function effectivePaths(configPath: string): { paths: Record<string, string[]>; dir: string } {
  const config = readJsonc(configPath);
  if (config.compilerOptions?.paths) return { paths: config.compilerOptions.paths, dir: dirname(configPath) };
  if (config.extends) return effectivePaths(resolve(dirname(configPath), config.extends));
  return { paths: {}, dir: dirname(configPath) };
}

/** The effective `exclude`, as absolute paths (relative to the tsconfig that defines it). */
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

/** The `tsc` binary of the `typescript` package that the project sees. */
function tscOf(projectDir: string): string {
  try {
    return join(dirname(createRequire(join(projectDir, 'package.json')).resolve('typescript/package.json')), 'bin', 'tsc');
  } catch {
    throw new Error(`[super] typescript cannot be found from ${projectDir}: install it in the project.`);
  }
}

/** The real path of a file, or the path as is if it does not exist. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Checks the project; returns the errors, one per line, in the format of `tsc --pretty false`. */
export function check(configPath: string): string[] {
  const errors: string[] = [];
  // Everything as real paths: tsc reports files by their real path, and a project opened through
  // a symbolic link (`/tmp` → `/private/tmp` on macOS) would no longer find its virtual TS.
  const configFile = realpathSync(resolve(configPath));
  const projectDir = dirname(configFile);
  const shadowDir = join(projectDir, '.super');
  const virtualDir = join(shadowDir, 'virtual');
  const toShadow = (abs: string) => {
    const path = relative(shadowDir, abs) || '.';
    return path.startsWith('.') ? path : `./${path}`;
  };

  rmSync(shadowDir, { recursive: true, force: true });
  mkdirSync(virtualDir, { recursive: true });
  writeFileSync(join(shadowDir, '.gitignore'), '*\n');

  // The virtual TS of each `.super` file, and the parser errors.
  const virtuals = new Map<string, { source: string; sourceText: string; virtual: VirtualCode }>();
  // The `.super` files covered by the tsconfig's `include` and not by its `exclude` (plain paths,
  // not `*` patterns).
  const within = (file: string, path: string) => file === path || file.startsWith(`${path}${sep}`);
  const included = (readJsonc(configPath).include ?? ['.']).map((p) => resolve(projectDir, p));
  const excluded = effectiveExclude(configFile).filter((p) => !p.includes('*'));
  const sources = superFiles(projectDir).filter((f) => included.some((p) => within(f, p)) && !excluded.some((p) => within(f, p)));
  for (const source of sources) {
    const sourceText = readFileSync(source, 'utf8');
    const virtual = toVirtual(sourceText);
    for (const d of virtual.file.diagnostics) {
      const { line, column } = position(sourceText, d.start);
      errors.push(`${relative(process.cwd(), source)}(${line},${column}): error SUPER: ${d.message}`);
    }
    // The virtual TS (checked here) and the declaration (for the `.ts` files that import it, and the editor).
    writeVirtualFile(source, sourceText, projectDir);
    virtuals.set(virtualPathOf(projectDir, source), { source, sourceText, virtual });
  }

  // The shadow tsconfig: the project's own, with the second tree.
  const config = readJsonc(configPath);
  const { paths, dir: pathsDir } = effectivePaths(configFile);
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
        extends: toShadow(configFile),
        compilerOptions: { rootDirs: [toShadow(projectDir), './virtual'], paths: shadowPaths },
        include: [...include, './virtual'],
        // An inherited `exclude` targeting `.super` (the root tsconfig's) would hide the virtual TS.
        exclude: effectiveExclude(configFile)
          .filter((p) => !p.includes('.super'))
          .map((p) => (p.startsWith('*') ? p : toShadow(p))),
      },
      null,
      2,
    ),
  );

  // tsc writes its paths relative to its current folder, which it reads from PWD: it is run from the
  // real folder of the project, with a PWD that says so, and its paths are resolved from that same folder.
  // Not `npx tsc`: in an npm workspace, npx moves to the root of the package, not to this folder.
  const tsc = spawnSync(process.execPath, [tscOf(projectDir), '--noEmit', '--pretty', 'false', '-p', join(shadowDir, 'tsconfig.json')], {
    cwd: projectDir,
    env: { ...process.env, PWD: projectDir },
    encoding: 'utf8',
  });
  const output = `${tsc.stdout}${tsc.stderr}`.trim();
  for (const raw of output ? output.split('\n') : []) {
    const match = /^(.+?)\((\d+),(\d+)\): (.*)$/.exec(raw);
    if (!match) {
      // Continuation of a multi-line message.
      errors[errors.length - 1] += `\n${raw}`;
      continue;
    }
    const [, file, line, column, message] = match as unknown as [string, string, string, string, string];
    const reported = realPath(resolve(projectDir, file));
    const entry = virtuals.get(reported);
    if (!entry) {
      errors.push(`${relative(process.cwd(), reported)}(${line},${column}): ${message}`);
      continue;
    }
    const at = toSource(entry.virtual, offsetOf(entry.virtual.code, Number(line), Number(column)));
    const where = at ? position(entry.sourceText, at.start) : { line: 1, column: 1 };
    errors.push(`${relative(process.cwd(), entry.source)}(${where.line},${where.column}): ${message}`);
  }
  return errors;
}

// Run directly, including through the `node_modules/.bin` link, which does not have the same path.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('Usage: super-tsc <tsconfig.json>');
    process.exit(2);
  }
  const errors = check(configPath);
  for (const error of errors) console.log(error);
  process.exit(errors.length > 0 ? 1 : 0);
}
