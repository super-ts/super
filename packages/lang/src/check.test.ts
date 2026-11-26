import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from './cli.ts';

const fixture = (name: string) => join(import.meta.dirname, '__fixtures__/project', name);

describe('check (virtual TS checked by tsc)', () => {
  const errors = check(fixture('tsconfig.json'));
  const linesOf = (file: string) =>
    errors
      .filter((e) => e.includes(`project/${file}(`))
      .map((e) => Number(/\((\d+),\d+\)/.exec(e)?.[1]))
      .sort((a, b) => a - b);

  it('reports each line marked ERROR, at its position in the .super file, and no other', () => {
    const expected = readFileSync(fixture('errors.super'), 'utf8')
      .split('\n')
      .flatMap((line, index) => (line.includes('{/* ERROR') ? [index + 1] : []));
    expect(expected).toHaveLength(16);
    expect(linesOf('errors.super')).toEqual(expected);
  });

  it('reports nothing in a valid .super file nor in the .ts files of the project', () => {
    expect(errors.filter((e) => !e.includes('project/errors.super('))).toEqual([]);
  });

  it('reports the TS message as is', () => {
    expect(errors.find((e) => e.includes('TS2561'))).toContain("'nam' does not exist in type 'Props'. Did you mean to write 'name'?");
    expect(errors.find((e) => e.includes('TS2345') && e.includes('never'))).toContain('"busy" | "done"');
    expect(errors.find((e) => e.includes('"title"'))).toContain("'title' is already a property of HTML elements: choose another name");
  });

  it('maps errors back to the .super file when the project is opened through a symbolic link', () => {
    const dir = mkdtempSync(join(tmpdir(), 'super-check-'));
    try {
      const link = join(dir, 'project');
      symlinkSync(join(import.meta.dirname, '__fixtures__/project'), link, 'dir');
      const linked = check(join(link, 'tsconfig.json'));
      expect(linked.filter((e) => e.includes('project/errors.super('))).toHaveLength(
        errors.filter((e) => e.includes('project/errors.super(')).length,
      );
      expect(linked.filter((e) => !e.includes('project/errors.super('))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps errors back to the .super file when super-tsc is run from a folder reached through a link', () => {
    const dir = mkdtempSync(join(tmpdir(), 'super-check-'));
    try {
      const link = join(dir, 'project');
      symlinkSync(join(import.meta.dirname, '__fixtures__/project'), link, 'dir');
      // Like a shell: the logical current folder (PWD) goes through the link.
      const cli = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'tsconfig.json'], {
        cwd: link,
        env: { ...process.env, PWD: link },
        encoding: 'utf8',
      });
      const lines = cli.stdout.split('\n').filter((line) => /^\S.*\(\d+,\d+\): /.test(line));
      expect(cli.status).toBe(1);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.filter((line) => !line.includes('errors.super('))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
