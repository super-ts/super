/**
 * Errors from the `.super` parser (those TS does not see: ambiguous text, `<` in text, lit
 * syntax…) and their quick fixes, computed on the copy of the source (`SOURCE_LANGUAGE`).
 */
import type { LanguageServicePlugin } from '@volar/language-service';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { formatWithBiome } from '../../lang/src/biome.ts';
import { formatSuper } from '../../lang/src/format.ts';
import { parse } from '../../lang/src/parser.ts';
import { SOURCE_LANGUAGE } from './language-plugin.ts';

const isSuper = (document: TextDocument) => document.languageId === SOURCE_LANGUAGE;

export const superSyntaxService: LanguageServicePlugin = {
  name: 'super-syntax',
  capabilities: {
    diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false },
    codeActionProvider: { codeActionKinds: ['quickfix'] },
    documentFormattingProvider: true,
  },
  create(context) {
    return {
      provideDiagnostics(document) {
        if (!isSuper(document)) return;
        return parse(document.getText()).diagnostics.map((d) => ({
          range: { start: document.positionAt(d.start), end: document.positionAt(d.end) },
          message: d.message,
          severity: 1,
          source: 'super',
        }));
      },
      // File formatting: TypeScript by Biome, templates by `format.ts` (nothing on a syntax error).
      provideDocumentFormattingEdits(document) {
        if (!isSuper(document)) return;
        const source = context.decodeEmbeddedDocumentUri(URI.parse(document.uri))?.[0];
        if (!source) return;
        const text = document.getText();
        const formatted = formatSuper(text, { formatTs: (code) => formatWithBiome(code, source.fsPath) });
        if (formatted === null || formatted === text) return [];
        return [{ range: { start: document.positionAt(0), end: document.positionAt(text.length) }, newText: formatted }];
      },
      provideCodeActions(document, range) {
        if (!isSuper(document)) return;
        // The edit targets the `.super` file itself (positions identical to the copy).
        const sourceUri = context.decodeEmbeddedDocumentUri(URI.parse(document.uri))?.[0].toString() ?? document.uri;
        const start = document.offsetAt(range.start);
        const end = document.offsetAt(range.end);
        return parse(document.getText())
          .diagnostics.filter((d) => d.fix && d.start <= end && d.end >= start)
          .map((d) => {
            const fix = d.fix as NonNullable<typeof d.fix>;
            return {
              title: fix.title,
              kind: 'quickfix',
              isPreferred: true,
              edit: {
                changes: {
                  [sourceUri]: [{ range: { start: document.positionAt(fix.start), end: document.positionAt(fix.end) }, newText: fix.text }],
                },
              },
            };
          });
      },
    };
  },
};
