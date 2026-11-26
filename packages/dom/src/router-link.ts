import type { AnyStore } from '@super-ts/core';

/** Finds the store the application provides for a contract. */
export type StoreLookup = (contract: string) => AnyStore | undefined;

/**
 * Internal link between a router and the application that receives it: `createApp` gives the router
 * a way to read the stores, for its guards. Module without dependencies, to avoid a circular import.
 */
export const routerAttachments = new WeakMap<object, (lookup: StoreLookup) => void>();

/** Internal link between a router's store and its paths: `this.router.href(…)` builds the URL. */
export const routerHrefs = new WeakMap<object, (name: string, params?: object) => string>();
