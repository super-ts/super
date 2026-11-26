/**
 * The Volar language plugin for `.super` files: each file becomes virtual TypeScript (the same as
 * `super-tsc`'s), which the TypeScript service analyses; positions go through the mappings.
 */
import type { CodeInformation, CodeMapping, LanguagePlugin, VirtualCode } from '@volar/language-core';
import type * as ts from 'typescript';
import type { URI } from 'vscode-uri';
import { toVirtual } from '../../lang/src/virtual.ts';
import { writeVirtualFile } from '../../lang/src/virtual-files.ts';

/** Code copied from the source: everything works (completion, hover, rename, errors). */
const COPIED: CodeInformation = { verification: true, completion: true, semantic: true, navigation: true, structure: true, format: false };
/** Code generated for an element: only to attach errors to it. */
const GENERATED: CodeInformation = { verification: true };
/** Tag or attribute name: everything except completion, which comes from `template-completion.ts`. */
const NAME: CodeInformation = { ...COPIED, completion: false };
/** Incomplete code (statement being typed): completion and hover, but not its errors. */
const ASSIST: CodeInformation = { completion: true, semantic: true, navigation: true };

/** Language of the embedded code that copies the `.super` source. */
export const SOURCE_LANGUAGE = 'super-source';

const textSnapshot = (text: string): ts.IScriptSnapshot => ({
  getText: (start, end) => text.slice(start, end),
  getLength: () => text.length,
  getChangeRange: () => undefined,
});

function superCode(snapshot: ts.IScriptSnapshot): VirtualCode {
  const source = snapshot.getText(0, snapshot.getLength());
  const virtual = toVirtual(source, { assist: true });
  const mappings: CodeMapping[] = virtual.mappings.map(({ source, generated, verify, complete }) => {
    const sourceLength = source.end - source.start;
    const generatedLength = generated.end - generated.start;
    const copied = verify === false ? ASSIST : complete === false ? NAME : COPIED;
    return sourceLength === generatedLength
      ? { sourceOffsets: [source.start], generatedOffsets: [generated.start], lengths: [sourceLength], data: copied }
      : {
          sourceOffsets: [source.start],
          generatedOffsets: [generated.start],
          lengths: [sourceLength],
          generatedLengths: [generatedLength],
          data: verify === false ? {} : GENERATED,
        };
  });
  return {
    id: 'root',
    languageId: 'typescript',
    snapshot: textSnapshot(virtual.code),
    mappings,
    // The source as is: Volar only gives services virtual codes, and the parser's errors
    // (`syntax-service.ts`) are computed on the source.
    embeddedCodes: [
      {
        id: 'source',
        languageId: SOURCE_LANGUAGE,
        snapshot: textSnapshot(source),
        // Parser errors and formatting (`syntax-service.ts`), completion inside tags
        // (`template-completion.ts`), completion and hover for declarations (`component-declarations.ts`).
        mappings: [
          {
            sourceOffsets: [0],
            generatedOffsets: [0],
            lengths: [source.length],
            data: { verification: true, completion: true, format: true, semantic: true },
          },
        ],
      },
    ],
  };
}

export const superLanguagePlugin: LanguagePlugin<URI> = {
  getLanguageId(uri) {
    if (uri.path.endsWith('.super')) return 'super';
  },
  // Decided by the extension, not by the language the editor announces: Zed, which highlights `.super` files
  // as TSX, opens them as `typescriptreact`, and TS would then read them as raw TSX.
  createVirtualCode(uri, _languageId, snapshot) {
    if (!uri.path.endsWith('.super')) return;
    // On disk too (without the typing assistance, to stay valid TypeScript): the `.ts` files that import
    // this component, served by the usual TS server, see its up-to-date types on every keystroke.
    writeVirtualFile(uri.fsPath, snapshot.getText(0, snapshot.getLength()));
    return superCode(snapshot);
  },
  updateVirtualCode(uri, _code, snapshot) {
    writeVirtualFile(uri.fsPath, snapshot.getText(0, snapshot.getLength()));
    return superCode(snapshot);
  },
  typescript: {
    // 7 = ScriptKind.Deferred: TS does not read the file itself, it goes through the virtual TypeScript.
    extraFileExtensions: [{ extension: 'super', isMixedContent: true, scriptKind: 7 }],
    getServiceScript(root) {
      // 3 = ScriptKind.TS
      return { code: root, extension: '.ts', scriptKind: 3 };
    },
  },
};
