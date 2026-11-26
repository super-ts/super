#!/usr/bin/env node
/**
 * Language server for `.super` files, on stdio: `node packages/lang-server/src/server.ts --stdio`.
 * Volar + TypeScript service, with TypeScript 6 (Volar does not support TypeScript 7 yet).
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
 * The TypeScript service restricted to `.super` files. The editor may also send us `.ts` files (Zed
 * does): their usual server already handles them, so neither errors nor completion are duplicated.
 * The internal names of the virtual TypeScript (`__s`, `__e0`…) are removed from completion.
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
