---
name: framework-gap-analysis
description: "Comparaison (2026-11-25) : ce que React/Next, Vue/Nuxt, Angular, Svelte/SvelteKit, Solid, Lit font et que Super ne fait pas. Pistes de chantiers et priorités recommandées."
metadata:
  node_type: memory
  type: project
  originSessionId: 23e028e1-75a4-4a57-abb3-a2a82f9d5836
  modified: 2026-11-25T20:45:28.380Z
---

Analyse faite le 2026-11-25 à la demande de l'utilisateur (vérifiée par grep dans packages/*/src et docs/limitations.html). Aucun de ces chantiers n'est décidé : ce sont des pistes. Contexte : [[class-api-migration]].

**Why:** servir de base quand l'utilisateur choisit le prochain chantier, sans refaire l'inventaire.
**How to apply:** avant de proposer une fonctionnalité, vérifier qu'elle n'a pas été ajoutée depuis (grep) ; respecter la philosophie « le reste au user-land » ([[super-internals-stay-in-packages]]).

## Priorité recommandée (mon avis, non validé par l'utilisateur)
1. Lazy loading des routes + loaders (données chargées avec la navigation, préchargement au survol).
2. Couche données serveur au-dessus des commandes (dédoublonnage, stale-while-revalidate, retry, invalidation, optimiste + rollback), façon TanStack Query.
3. Devtools / journal des commandes (le flux commande → :done/:failed sur EventTarget s'y prête).

## Production
- Pas de code splitting (aucun `import()` dans le router), bundle unique.
- Pas de loaders liés aux routes, pas de prefetch.
- Pas de cache de données serveur.
- Pas de SSR/SSG/hydratation (piste : @lit-labs/ssr).
- (Fait 2026-11-25 : HMR des composants.)
- Pas de devtools.

## Router
Guards async ; guard de sortie (modifs non enregistrées) ; base path (/app/) ; query typée/validée (cf. validateSearch TanStack) ; restauration du scroll + focus après navigation ; titre de page (fait 2026-11-26 : `@title`, `this.page`) mais pas encore `<meta>`/`<head>` ; routes imbriquées/layouts (non vérifié).

## Composants
- (Fait 2026-11-26 : contenu `content` + emplacements `<:nom>`.)
- Pas de contexte/injection hiérarchique (thème, locale, store limité à un sous-arbre) : seulement des stores globaux par nom.
- Pas de portails (overlays : déjà question ouverte dans limitations.html).
- Pas de transitions/animations (entrée/sortie, View Transitions API).
- Pas de computed/effect locaux : `reactive()` = valeur brute d'un sélecteur (choix assumé, mais surprendra les gens de Vue/Solid).
- Pas d'interop custom element : `<tag>` en HTML brut non supporté, pas d'observedAttributes.
- Pas de shadow DOM ni de styles scopés.

## Stores
Persistance (localStorage, faite en user-land dans la démo par `subscribe` + adapter) ; undo/redo, snapshots ; dépendances déclarées entre stores + cycles (question ouverte) ; politique d'annulation des commandes concurrentes (takeLatest/switchMap ; AbortSignal présent mais pas de politique déclarative).

## Écosystème
Paquets non publiés ; pas de `create-super` ni de CLI de scaffolding ; pas d'i18n ; pas de Storybook ; templates en `.super` avec serveur de langage (2026-11-26, voir [[super-template-language]]) ; pas encore d'extension Zed dédiée.

## Fait dans la foulée
Ligne obsolète « clé mal orthographiée non signalée » retirée de docs/limitations.html le 2026-11-25 (corrigé par `KnownKeys<T>`), llms*.txt régénérés.
