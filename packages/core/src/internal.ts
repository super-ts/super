/**
 * Plomberie partagée entre les paquets Super (`@super-ts/dom`, `@super-ts/testing`). Jamais importée par
 * une application : rien ici ne fait partie de l'API publique.
 */

export { compileContract, contractByName, contractClass, registerContract } from './classes';
export type { Contract, Selectors } from './contract';
export { bindSelectors } from './contract';
export { shallowEqual, share } from './memo';
export type { StorePreparation, StoreTools } from './store';
export { buildStore, NO_OUTCOME, readStore, topics } from './store';
