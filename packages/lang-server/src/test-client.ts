/**
 * Minimal LSP client for tests: starts a server on stdio, sends requests and notifications,
 * and keeps the published errors (`textDocument/publishDiagnostics`) per file.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export type Diagnostic = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  message: string;
  source?: string;
};

export class TestClient {
  readonly process: ChildProcess;
  readonly published = new Map<string, Diagnostic[]>();
  #pending = new Map<number, (result: any) => void>();
  #listeners: Array<() => void> = [];
  #nextId = 1;
  #buffer = Buffer.alloc(0);

  /** Runs `node <script> ...args`. */
  constructor(script: string, args: string[] = []) {
    this.process = spawn(process.execPath, [script, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.process.stdout?.on('data', (chunk: Buffer) => this.#read(chunk));
  }

  #read(chunk: Buffer) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const headerEnd = this.#buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const length = Number(/Content-Length: *(\d+)/i.exec(this.#buffer.subarray(0, headerEnd).toString())?.[1]);
      if (this.#buffer.length < headerEnd + 4 + length) return;
      const message = JSON.parse(this.#buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
      this.#buffer = this.#buffer.subarray(headerEnd + 4 + length);
      if (message.id !== undefined && message.method)
        this.#send({ id: message.id, result: null }); // Request from the server.
      else if (message.id !== undefined) this.#pending.get(message.id)?.(message.result ?? null);
      else if (message.method === 'textDocument/publishDiagnostics') {
        this.published.set(message.params.uri, message.params.diagnostics);
        for (const listener of this.#listeners) listener();
      }
    }
  }

  #send(message: object) {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message });
    this.process.stdin?.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  request<T = any>(method: string, params: object): Promise<T> {
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#send({ id, method, params });
    });
  }

  notify(method: string, params: object) {
    this.#send({ method, params });
  }

  /** `initialize` then `initialized`, at the `root` root. Without `diagnostic`, the server pushes its errors. */
  async initialize(root: string, capabilities: object = {}) {
    const uri = pathToFileURL(root).href;
    await this.request('initialize', { processId: process.pid, rootUri: uri, workspaceFolders: [{ uri, name: 'test' }], capabilities });
    this.notify('initialized', {});
  }

  /** Opens a file, with its text on disk or `text`. */
  open(file: string, languageId: string, text = readFileSync(file, 'utf8')) {
    const uri = pathToFileURL(file).href;
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
    return uri;
  }

  change(uri: string, version: number, text: string) {
    this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
  }

  /** Waits for errors published for `uri` that satisfy `accept` (the server often publishes twice). */
  diagnostics(uri: string, accept: (diagnostics: Diagnostic[]) => boolean = () => true, timeout = 20000): Promise<Diagnostic[]> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const current = this.published.get(uri);
        if (!current || !accept(current)) return false;
        this.#listeners = this.#listeners.filter((l) => l !== listener);
        clearTimeout(timer);
        resolve(current);
        return true;
      };
      const listener = () => void check();
      const timer = setTimeout(() => reject(new Error(`no errors published for ${uri}`)), timeout);
      if (!check()) this.#listeners.push(listener);
    });
  }

  close() {
    this.process.kill();
  }
}

/** The position (line, column from 0) of the `occurrence`-th occurrence of `needle`, shifted by `offset`. */
export function positionOf(text: string, needle: string, offset = 0, occurrence = 1) {
  let index = -1;
  for (let n = 0; n < occurrence; n++) index = text.indexOf(needle, index + 1);
  if (index === -1) throw new Error(`"${needle}" not found`);
  const before = text.slice(0, index + offset).split('\n');
  return { line: before.length - 1, character: (before.at(-1) as string).length };
}
