import type { AnyStore } from '@super-ts/core';
import { ERROR_REPORT, type ErrorDetail, type ErrorPhase } from './component.ts';
import { ROUTER_NAME, type RouterHandle } from './router-contract.ts';
import { routerAttachments } from './router-link.ts';

/** Context protocol event: it bubbles up from the component to the nearest provider. */
export const CONTEXT_REQUEST = 'super:context-request';

/** The store is requested by its contract's name. */
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
      `[super] <${from.localName}>: no store provided for the contract "${contract}". ` +
        'Add it to createApp({ stores }) or to mount(..., { stores }).',
    );
  }
  return found;
}

export interface App {
  readonly root: HTMLElement;
  /** Replaces the root's content with the given element. */
  mount<T extends Element>(element: T): T;
  /** Removes the provider and empties the root. */
  dispose(): void;
}

export type AppOptions = {
  root: HTMLElement;
  stores?: AnyStore[];
  /** Router created by `createRouter`: provided to components like a store, and wired to links. */
  router?: RouterHandle<any>;
  /**
   * Called for any construction, render or `renderError` error of a component rendered under
   * `root`, whether it was caught or not. Without `onError`, the error goes to the console.
   */
  onError?: (error: Error, info: ErrorInfo) => void;
};

/** Context of a component error, received by `onError`. */
export type ErrorInfo = {
  /** Tag of the component that crashed. */
  tag: string;
  phase: ErrorPhase;
  /** What caught it (a component with `renderError`, `super-router-outlet`), or `null`. */
  caughtBy: string | null;
};

/**
 * Provides stores (and the router) to all components rendered under `root`. Several apps
 * can be nested: the one nearest to the component answers first.
 */
export function createApp({ root, stores = [], router, onError }: AppOptions): App {
  const provided = stores;
  const byContract = new Map<string, AnyStore>();
  for (const store of provided) {
    if (byContract.has(store.contract.name)) {
      throw new Error(`[super] two stores provided for the contract "${store.contract.name}"`);
    }
    byContract.set(store.contract.name, store);
  }
  // The router is provided under the name 'router': `this.router`, and `RouterOutlet`.
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
        event.stopPropagation(); // the nearest application reports, only once
        detail.reported = true;
        onError(detail.error, { tag: detail.tag, phase: detail.phase, caughtBy: detail.caughtBy });
      },
      { signal },
    );
  }

  // The router now reads the stores of this application, for its guards.
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

/** A click on `<a href="/…">` becomes a router navigation, unless intended otherwise. */
function interceptLink(event: MouseEvent, router: RouterHandle) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const anchor = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
  if (!anchor || anchor.hasAttribute('download') || anchor.hasAttribute('data-native')) return;
  if (anchor.target && anchor.target !== '_self') return;
  const path = anchor.getAttribute('href');
  if (!path || !path.startsWith('/') || path.startsWith('//')) return; // external or relative: the browser handles it
  event.preventDefault();
  void router.send('visit', path);
}
