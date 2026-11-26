import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from './cli.ts';

const fixture = (name: string) => join(import.meta.dirname, '__fixtures__/project', name);

describe('check (TS virtuel vérifié par tsc)', () => {
  const errors = check(fixture('tsconfig.json'));
  const linesOf = (file: string) =>
    errors
      .filter((e) => e.includes(`project/${file}(`))
      .map((e) => Number(/\((\d+),\d+\)/.exec(e)?.[1]))
      .sort((a, b) => a - b);

  it('signale chaque ligne marquée ERREUR, à sa position dans le .super, et aucune autre', () => {
    const expected = readFileSync(fixture('errors.super'), 'utf8')
      .split('\n')
      .flatMap((line, index) => (line.includes('{/* ERREUR') ? [index + 1] : []));
    expect(expected).toHaveLength(16);
    expect(linesOf('errors.super')).toEqual(expected);
  });

  it('ne signale rien dans un fichier .super valide ni dans les .ts du projet', () => {
    expect(errors.filter((e) => !e.includes('project/errors.super('))).toEqual([]);
  });

  it('rapporte le message de TS tel quel', () => {
    expect(errors.find((e) => e.includes('TS2561'))).toContain("'nam' does not exist in type 'Props'. Did you mean to write 'name'?");
    expect(errors.find((e) => e.includes('TS2345') && e.includes('never'))).toContain('"busy" | "done"');
    expect(errors.find((e) => e.includes('"title"'))).toContain(
      '« title » est déjà une propriété des éléments HTML : choisis un autre nom',
    );
  });

  it('ramène les erreurs au .super quand le projet est ouvert par un lien symbolique', () => {
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

  it('ramène les erreurs au .super quand super-tsc est lancé depuis un dossier atteint par un lien', () => {
    const dir = mkdtempSync(join(tmpdir(), 'super-check-'));
    try {
      const link = join(dir, 'project');
      symlinkSync(join(import.meta.dirname, '__fixtures__/project'), link, 'dir');
      // Comme un shell : le dossier courant logique (PWD) passe par le lien.
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
