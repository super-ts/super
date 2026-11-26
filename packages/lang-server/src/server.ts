#!/usr/bin/env node
/**
 * Serveur de langage des fichiers `.super`, sur stdio : `node packages/lang-server/src/server.ts --stdio`.
 * Volar + service TypeScript, avec TypeScript 6 (Volar ne supporte pas encore TypeScript 7).
 */
import { createConnection, createServer, createTypeScriptProject } from '@volar/language-server/node.js';
import type { LanguageServicePlugin, LanguageServicePluginInstance } from '@volar/language-service';
import ts from 'typescript';
import { create as createTypeScriptServices } from 'volar-service-typescript';
import { componentDeclarationsService } from './component-declarations.ts';
import { superLanguagePlugin } from './language-plugin.ts';
import { superSyntaxService } from './syntax-service.ts';
import { templateCompletionService } from './template-completion.ts';

/**
 * Le service TypeScript limité aux `.super`. L'éditeur peut nous envoyer aussi des `.ts` (Zed le
 * fait) : leur serveur habituel s'en occupe déjà, on ne double ni les erreurs ni la complétion.
 * Les noms internes du TS virtuel (`__s`, `__e0`…) sont retirés de la complétion.
 */
function onlySuper(plugin: LanguageServicePlugin): LanguageServicePlugin {
  return {
    ...plugin,
    create(context) {
      const instance = plugin.create(context);
      const guarded: LanguageServicePluginInstance = { ...instance };
      for (const [name, method] of Object.entries(instance)) {
        if (!name.startsWith('provide') || typeof method !== 'function') continue;
        (guarded as Record<string, unknown>)[name] = (document: { uri: string }, ...args: unknown[]) => {
          if (!decodeURIComponent(document.uri).includes('.super')) return;
          const result = method.call(instance, document, ...args);
          return name === 'provideCompletionItems' ? Promise.resolve(result).then(hideInternals) : result;
        };
      }
      return guarded;
    },
  };
}

function hideInternals<T extends { items: Array<{ label: string | { label: string } }> } | null | undefined>(list: T): T {
  if (!list) return list;
  list.items = list.items.filter((item) => !/^__/.test(typeof item.label === 'string' ? item.label : item.label.label));
  return list;
}

const connection = createConnection();
const server = createServer(connection);

connection.listen();

connection.onInitialize((params) =>
  server.initialize(
    params,
    createTypeScriptProject(ts, undefined, () => ({ languagePlugins: [superLanguagePlugin] })),
    [...createTypeScriptServices(ts).map(onlySuper), superSyntaxService, templateCompletionService, componentDeclarationsService],
  ),
);
connection.onInitialized(server.initialized);
connection.onShutdown(server.shutdown);
