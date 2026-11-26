---
name: server-data-layer-design
description: "Esquisse (2026-11-26) d'une couche données serveur façon TanStack Query au-dessus des commandes de store : API proposée @read/@write, options, questions ouvertes. Rien n'est décidé ni codé."
metadata:
  node_type: memory
  type: project
  originSessionId: 3c13be38-b243-42d8-baba-a2b3dec8b45f
  modified: 2026-11-26T14:58:42.685Z
---

Discussion du 2026-11-26, à rouvrir plus tard à la demande de l'utilisateur. Piste n°2 de [[framework-gap-analysis]]. Rien n'est validé : c'est une proposition à moi, l'utilisateur n'a encore rien tranché.

**Why:** reprendre le sujet sans refaire l'analyse ni réinventer l'API.
**How to apply:** repartir de cette esquisse, vérifier par grep que rien n'a été ajouté depuis, commencer par faire trancher les questions ouvertes (surtout 1 et 3).

## Principe proposé
- Contrat et composants inchangés (`send`, `nom:done`/`nom:failed`).
- Politiques déclarées sur les commandes du store par décorateurs `@read` (chargement) et `@write` (écriture), importés de `@super/core`.
- Le cache reste l'état du store (sélecteurs inchangés) ; la couche retient seulement, par clé, quand et avec quelle entrée la commande a réussi.

## Options esquissées
- `@read` : `key: (input) => [...]` (clés globales, préfixe invalidable ; dédoublonnage implicite dès qu'il y a une clé, une seule promesse, un seul :done), `fresh` (ms), `revalidateOn: ['focus','online']`, `retry` (`3` ou `{ times, delay(attempt), when(reason) }`, `when` typé sur les raisons de la commande), `concurrency`, `debounce`.
- `@write` : `optimistic: (state, input) => state` (fonction pure), `invalidates: (input) => [[...]]`, `concurrency`, retry 0 par défaut.
- `concurrency` : `'parallel'` (défaut) | `'latest'` | `'queue'` | `'drop'` | `{ mode, per: (input) => sousClé }`.
- Appel dépassé (`latest`) : `this.set` sans effet, `this.signal` annulé (passer le signal au port/fetch).
- Retry relance toute la méthode (écritures avant l'await rejouées).
- Optimiste robuste : garder état confirmé + liste des écritures optimistes en cours, état visible = confirmé + rejeu ; un échec retire la sienne et recalcule (pas de restauration de photo, qui écraserait les autres changements).
- Invalidation : si un composant affiché lit la donnée, relance avec la dernière entrée connue pour la clé ; sinon marquée périmée. Manuel : `this.invalidate([...])` dans un store, `app.invalidate([...])` en user-land.
- Vue d'un contrat côté composant : `loading(cmd, input?)` (sans valeur), `refreshing(cmd, input?)` (avec valeur), `error(cmd, input?)` (raison ou null), `stale(cmd, input?)`, `refresh(cmd, input)` (ignore la fraîcheur). `pending` = loading || refreshing.
- Tests : dédoublonnage, retry avec fake timers + `record`, rollback optimiste sans écraser une autre écriture ; aide à prévoir type `expire(store, key)`.

## Cas concret de la démo
`examples/demo/src/@core/catalog/store.ts` gère à la main latest-wins (`#latest`, `#latestSearch`) et le debounce (`wait`) : premier candidat de migration (`concurrency: 'latest'`, `debounce: 250`). `loadErrorMessage` dans l'état clignoterait avec retry → le remplacer par le sélecteur `error`. Table proposée : search/load `latest`, profile.save `drop`, checkEmail `latest`+debounce, checkout.pay `drop`.

## Questions ouvertes
1. État rangé par clé (`pages: Record<…>`) imposé au user-land, ou cache par clé géré par Super (plus TanStack, mais sort du « tout dans l'état du store »). Sans ça, pas de stale-while-revalidate.
2. `this.signal` par appel (élargir le sens du signal du store) vs second paramètre `ctx` (obligerait à assouplir `Commands<Self>`, paramètres strictement égaux).
3. Événements : servi par cache → `:done` avec `{ cached: true }` ? annulé par latest → pas de `:failed`, plutôt `:cancelled` ? retry → rien avant épuisement.
4. Décorateurs (politique près de la méthode, mais `key`/`optimistic` à annoter, pas d'inférence TC39) vs `policies: {…}` dans `super({…})` (inféré depuis le contrat, mais éloigné).
5. Politiques côté store (implémentation) ; seule `concurrency` change ce qu'observe un composant, à mentionner peut-être dans le contrat.

Ordre suggéré : trancher 1 et 3, puis implémenter seulement `concurrency` et `retry`.

Lié : [[class-api-migration]], [[component-store-events]], [[super-internals-stay-in-packages]].
