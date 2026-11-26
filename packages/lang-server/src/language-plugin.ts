/**
 * Le plugin de langage Volar des fichiers `.super` : chaque fichier devient un TS virtuel (celui de
 * `super-tsc`), que le service TypeScript analyse ; les positions passent par les correspondances.
 */
import type { CodeInformation, CodeMapping, LanguagePlugin, VirtualCode } from '@volar/language-core';
import type * as ts from 'typescript';
import type { URI } from 'vscode-uri';
import { toVirtual } from '../../lang/src/virtual.ts';
import { writeVirtualFile } from '../../lang/src/virtual-files.ts';

/** Code recopié de la source : tout fonctionne (complétion, survol, renommage, erreurs). */
const COPIED: CodeInformation = { verification: true, completion: true, semantic: true, navigation: true, structure: true, format: false };
/** Code produit pour un élément : seulement pour y rattacher les erreurs. */
const GENERATED: CodeInformation = { verification: true };
/** Nom de balise ou d'attribut : tout sauf la complétion, qui vient de `template-completion.ts`. */
const NAME: CodeInformation = { ...COPIED, completion: false };
/** Code incomplet (instruction en cours de frappe) : complétion et survol, mais pas ses erreurs. */
const ASSIST: CodeInformation = { completion: true, semantic: true, navigation: true };

/** Langage du code embarqué qui recopie la source `.super`. */
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
    // La source telle quelle : Volar ne donne aux services que des codes virtuels, et les erreurs
    // du parser (`syntax-service.ts`) se calculent sur la source.
    embeddedCodes: [
      {
        id: 'source',
        languageId: SOURCE_LANGUAGE,
        snapshot: textSnapshot(source),
        // Erreurs du parser et formatage (`syntax-service.ts`), complétion dans les balises
        // (`template-completion.ts`), complétion et survol des déclarations (`component-declarations.ts`).
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
  // Décidé par l'extension, pas par le langage annoncé par l'éditeur : Zed, qui colore les `.super`
  // comme du TSX, les ouvre en `typescriptreact`, et TS les lirait alors comme du TSX brut.
  createVirtualCode(uri, _languageId, snapshot) {
    if (!uri.path.endsWith('.super')) return;
    // Sur disque aussi (sans l'aide à la frappe, pour rester du TS valide) : les `.ts` qui importent
    // ce composant, servis par le serveur TS habituel, en voient les types à jour à chaque frappe.
    writeVirtualFile(uri.fsPath, snapshot.getText(0, snapshot.getLength()));
    return superCode(snapshot);
  },
  updateVirtualCode(uri, _code, snapshot) {
    writeVirtualFile(uri.fsPath, snapshot.getText(0, snapshot.getLength()));
    return superCode(snapshot);
  },
  typescript: {
    // 7 = ScriptKind.Deferred : TS ne lit pas le fichier lui-même, il passe par le TS virtuel.
    extraFileExtensions: [{ extension: 'super', isMixedContent: true, scriptKind: 7 }],
    getServiceScript(root) {
      // 3 = ScriptKind.TS
      return { code: root, extension: '.ts', scriptKind: 3 };
    },
  },
};
