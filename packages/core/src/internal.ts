/**
 * Plumbing shared between the Super packages (`@super-ts/dom`, `@super-ts/testing`). Never imported by
 * an application: nothing here is part of the public API.
 */

export { compileContract, contractByName, contractClass, registerContract } from './classes.ts';
export type { Contract, Selectors } from './contract.ts';
export { bindSelectors } from './contract.ts';
export { shallowEqual, share } from './memo.ts';
export type { StorePreparation, StoreTools } from './store.ts';
export { buildStore, NO_OUTCOME, readStore, topics } from './store.ts';
