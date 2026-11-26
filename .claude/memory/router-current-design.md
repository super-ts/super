---
name: router-current-design
description: Décisions de design actées le 2026-11-26 pour this.router.current (params/query typés, réactifs) et le typage des routes dans defineRouter
metadata:
  type: project
---

Chantier « paramètres de route et query réactifs partout », décisions prises avec l'utilisateur le 2026-11-26 :

- `defineRouter` : une route est soit une chaîne (cas simples), soit `{ path, params: params<T>({…}), query: query<T>({…}) }`. Le type `T` écrit par l'utilisateur est la source ; la description runtime est vérifiée contre lui : `String`/`Number`/`Boolean` (constructeurs natifs), `{ oneOf: [...], default }`, `{ type: Number, default }`, `[String]` pour une liste (vaut `[]` si absente). Clé obligatoire dans le type ⇒ `default` exigé ; clé optionnelle ⇒ pas de défaut.
- Valeur de query invalide (`?sort=foo`, `?page=abc`) : traitée comme absente (défaut ou undefined).
- Paramètre de chemin invalide (`/counters/toto` avec `id: number`) : PAS d'écran `'*'` ; l'écran de la route le gère : valeur `undefined` + `isValid()` sur chaque feuille et sur la sélection (`this.id.isValid()` puis `this.id.value` affiné). Naviguer depuis `render` n'est pas dans la philosophie : `mounted()` ou guard.
- `this.router.selectors` est renommé `this.router.current` ; les feuilles restent des fonctions (cohérence avec les autres contrats) : `current.name()`, `current.path()`, `current.params.id()`, `current.query.sort()`, `this.selector(this.router.current.params.id)`.
- Les écrans ne reçoivent plus params/query en props.
- Typage par écran : option D + C. Implémenté (2026-11-26) : le plugin Vite génère `interface ScreenRoutes { tag: route }` dans contracts.d.ts ; le compilateur `.super` (virtual.ts, routeInserts) ajoute `{ route: __s.RouteOfTag<'tag'> }` au paramètre de `SuperElement`. L'augmentation de module a été écartée : invisible pour le serveur de l'éditeur (Volar). Un `this`-polymorphe a été écarté : types différés, `params.id` introuvable. `.ts` : `SuperElement<{ route: 'counter' }>` à la main.
- `navigate`/`href`/`redirect` : `params` et `query` séparés (`{ to, params, query }`), valeurs typées (sérialisées dans l'URL).
- Pas de raccourci `setQuery` pour l'instant (on fait `navigate` avec `...query`).

**Why:** idée de l'utilisateur (voir [[todo-later]]), pour simplifier tout composant qui dépend de l'URL.
**How to apply:** suivre ces décisions sans les rediscuter ; mettre à jour ce fichier à l'avancée du chantier.

État au 2026-11-26 : implémenté et testé (paquets dom, lang, vite, démo migrée, lint/typecheck/tests verts). Ajout imposé par les tests : les rendus en attente passent parents d'abord (`scheduleRender` dans element.ts), sinon l'écran remplacé par l'outlet se re-rendait avec la route suivante. Doc HTML confiée à un agent ce jour-là, à vérifier.
