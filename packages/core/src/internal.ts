/**
 * Plomberie partagée entre les paquets Super (`@super-ts/dom`, `@super-ts/testing`). Jamais importée par
 * une application : rien ici ne fait partie de l'API publique.
 */

export { compileContract, contractByName, contractClass, registerContract } from './classes.ts';
export type { Contract, Selectors } from './contract.ts';
export { bindSelectors } from './contract.ts';
export { shallowEqual, share } from './memo.ts';
export type { StorePreparation, StoreTools } from './store.ts';
export { buildStore, NO_OUTCOME, readStore, topics } from './store.ts';
