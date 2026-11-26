import type { AnyStore } from '@super-ts/core';

/** Trouve le store fourni par l'application pour un contrat. */
export type StoreLookup = (contract: string) => AnyStore | undefined;

/**
 * Lien interne entre un router et l'application qui le reçoit : `createApp` donne au router de
 * quoi lire les stores, pour ses guards. Module sans dépendance, pour éviter un import circulaire.
 */
export const routerAttachments = new WeakMap<object, (lookup: StoreLookup) => void>();

/** Lien interne entre le store d'un router et ses chemins : `this.router.href(…)` construit l'URL. */
export const routerHrefs = new WeakMap<object, (name: string, params?: object) => string>();
