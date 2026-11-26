import type { AnyStore } from '@super-ts/core';
import { ERROR_REPORT, type ErrorDetail, type ErrorPhase } from './component';
import { ROUTER_NAME, type RouterHandle } from './router-contract';
import { routerAttachments } from './router-link';

/** Événement du context protocol : il remonte du composant jusqu'au fournisseur le plus proche. */
export const CONTEXT_REQUEST = 'super:context-request';

/** Le store est demandé par le nom de son contrat. */
type ContextRequestDetail = { contract: string; provide: (store: AnyStore) => void };

export function requestStore(from: HTMLElement, contract: string): any {
  let found: AnyStore | null = null;
  from.dispatchEvent(
    new CustomEvent<ContextRequestDetail>(CONTEXT_REQUEST, {
      bubbles: true,
      composed: true,
      detail: { contract, provide: (store) => (found = store) },
    }),
  );
  if (!found) {
    throw new Error(
      `[super] <${from.localName}> : aucun store fourni pour le contrat "${contract}". ` +
        'Ajoute-le à createApp({ stores }) ou à mount(..., { stores }).',
    );
  }
  return found;
}

export interface App {
  readonly root: HTMLElement;
  /** Remplace le contenu de la racine par l'élément donné. */
  mount<T extends Element>(element: T): T;
  /** Retire le fournisseur et vide la racine. */
  dispose(): void;
}

export type AppOptions = {
  root: HTMLElement;
  stores?: AnyStore[];
  /** Router créé par `createRouter` : fourni aux composants comme un store, et branché sur les liens. */
  router?: RouterHandle<any>;
  /**
   * Appelé pour toute erreur de construction, de rendu ou de `renderError` d'un composant rendu sous
   * `root`, qu'elle ait été rattrapée ou non. Sans `onError`, l'erreur part dans la console.
   */
  onError?: (error: Error, info: ErrorInfo) => void;
};

/** Contexte d'une erreur de composant, reçu par `onError`. */
export type ErrorInfo = {
  /** Tag du composant qui a planté. */
  tag: string;
  phase: ErrorPhase;
  /** Ce qui l'a rattrapée (un composant avec `renderError`, `super-router-outlet`), ou `null`. */
  caughtBy: string | null;
};

/**
 * Fournit des stores (et le router) à tous les composants rendus sous `root`. Plusieurs apps
 * peuvent s'imbriquer : la plus proche du composant répond en premier.
 */
export function createApp({ root, stores = [], router, onError }: AppOptions): App {
  const provided = stores;
  const byContract = new Map<string, AnyStore>();
  for (const store of provided) {
    if (byContract.has(store.contract.name)) {
      throw new Error(`[super] deux stores fournis pour le contrat "${store.contract.name}"`);
    }
    byContract.set(store.contract.name, store);
  }
  // Le router est fourni sous le nom 'router' : `this.router`, et `RouterOutlet`.
  if (router) byContract.set(ROUTER_NAME, router);

  const controller = new AbortController();
  const { signal } = controller;

  root.addEventListener(
    CONTEXT_REQUEST,
    (event) => {
      const { contract, provide } = (event as CustomEvent<ContextRequestDetail>).detail;
      const store = byContract.get(contract);
      if (!store) return;
      event.stopPropagation();
      provide(store);
    },
    { signal },
  );

  if (router) root.addEventListener('click', (event) => interceptLink(event, router), { signal });

  if (onError) {
    root.addEventListener(
      ERROR_REPORT,
      (event) => {
        const detail = (event as CustomEvent<ErrorDetail>).detail;
        event.stopPropagation(); // l'application la plus proche signale, une seule fois
        detail.reported = true;
        onError(detail.error, { tag: detail.tag, phase: detail.phase, caughtBy: detail.caughtBy });
      },
      { signal },
    );
  }

  // Le router lit désormais les stores de cette application, pour ses guards.
  if (router) routerAttachments.get(router)?.((contract) => byContract.get(contract));

  return {
    root,
    mount(element) {
      root.replaceChildren(element);
      return element;
    },
    dispose() {
      controller.abort();
      root.replaceChildren();
    },
  };
}

/** Un clic sur `<a href="/…">` devient une navigation du router, sauf intention contraire. */
function interceptLink(event: MouseEvent, router: RouterHandle) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const anchor = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
  if (!anchor || anchor.hasAttribute('download') || anchor.hasAttribute('data-native')) return;
  if (anchor.target && anchor.target !== '_self') return;
  const path = anchor.getAttribute('href');
  if (!path || !path.startsWith('/') || path.startsWith('//')) return; // externe ou relatif : le navigateur gère
  event.preventDefault();
  void router.send('visit', path);
}
