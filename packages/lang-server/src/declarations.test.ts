import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeVirtualFile } from '../../lang/src/virtual-files.ts';
import { positionOf } from './test-client.ts';

/**
 * The declarations of `.super` files (`.super/types/`), seen by the real tsserver (the one vtsls and
 * other editors wrap): "go to definition" from a `.ts` file opens the `.super` file.
 */
const PROJECT = join(import.meta.dirname, '__fixtures__/project');
const CARD = join(PROJECT, 'card.super');
const USES = join(PROJECT, 'uses-card.ts');
const TSSERVER = join(import.meta.dirname, '../node_modules/typescript/lib/tsserver.js');

type Location = { file: string; start: { line: number; offset: number } };

/** The definitions tsserver returns at this position (line and column from 1). */
function definitions(file: string, line: number, offset: number): Promise<Location[]> {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, [TSSERVER, '--disableAutomaticTypingAcquisition'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => (server.kill(), reject(new Error('tsserver does not respond'))), 20000);
    server.stdout.on('data', (chunk) => {
      output += chunk;
      for (const match of output.matchAll(/\{"seq".*\}/g)) {
        const message = JSON.parse(match[0]);
        if (message.type === 'response' && message.command === 'definitionAndBoundSpan') {
          clearTimeout(timer);
          server.kill();
          resolve(message.body?.definitions ?? []);
        }
      }
    });
    const send = (request: object) => server.stdin.write(`${JSON.stringify(request)}\n`);
    send({ seq: 1, type: 'request', command: 'open', arguments: { file } });
    send({ seq: 2, type: 'request', command: 'definitionAndBoundSpan', arguments: { file, line, offset } });
  });
}

describe('.super declarations', () => {
  beforeAll(() => writeVirtualFile(CARD, readFileSync(CARD, 'utf8')));

  it('"go to definition" from a .ts file opens the .super file, on the class name, only once', async () => {
    const uses = readFileSync(USES, 'utf8');
    const at = positionOf(uses, 'Card.tag');
    const found = await definitions(USES, at.line + 1, at.character + 1);
    const name = positionOf(readFileSync(CARD, 'utf8'), 'class Card', 6);
    expect(found).toEqual([expect.objectContaining({ file: CARD, start: { line: name.line + 1, offset: name.character + 1 } })]);
  }, 30000);
});
