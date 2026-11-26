import { readFileSync } from 'node:fs';
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
});
