---
name: ui-kit-design
description: "Décisions de design actées pour le kit d'interface @super-ts/ui (2026-11-26) et questions encore ouvertes"
metadata:
  node_type: memory
  type: project
  originSessionId: 45832986-ac49-4dc4-ba9b-953c462a40ba
  modified: 2026-11-26T11:32:19.034Z
---

Chantier « ui kit », décisions prises avec l'utilisateur le 2026-11-26. Implémenté le même jour (packages/ui, écrit en .ts ; écran /kit dans la démo ; app-shell utilise RouteLink) :

- Paquet `@super-ts/ui`, qui dépend de `@super-ts/dom` (pas l'inverse). Pas de fichiers à copier façon shadcn.
- Style : par défaut sobre, piloté par des variables CSS `--super-*` (accent, radius, font, surface, border…), CSS du kit dans `@layer super-ui` avec sélecteurs `:where(…)` : l'app surcharge sans `!important` (`:root`, mode sombre, zone, instance par classe, règle directe). Composants en DOM normal (pas de shadow DOM).
- Contenu : composants propres à Super (Field/Select/Checkbox/RadioGroup reliés à `this.form`, CommandButton lié à `pending`, RouteLink typé avec aria-current, Toasts sur les issues de commandes, ErrorPanel) ; primitives accessibles (Dialog, ConfirmDialog, Modal, Menu, Tabs, Disclosure, Tooltip, Popover, Combobox) ; affichage (Button, Badge, Spinner, EmptyState, Skeleton, Table).
- PAS de composants de mise en page (Stack, Cluster, Grid, Card) : l'utilisateur laisse la mise en page au CSS de l'app.
- `<Table>` et `<Combobox>` : deux modes, statique (données données, aucune mise à jour) ou branché (Table sur la route, Combobox sur une commande).
- `<Modal>` dérive de `<Dialog>` : même mécanique, contenu libre, sans boutons d'action.

Réponses de l'utilisateur : Table branchée émet `request {sort, page}` (au montage et à chaque changement), le parent la relie à sa commande avec le param de route (library/2 → 12 remonte l'écran) ; statique = trie/pagine seule. Modal : fermeture paramétrable (`closeOn`), défaut croix + Échap. v1 : tous les composants.
Choix techniques à connaître : `fieldOf(form, name)` / `commandOf(view, cmd, input)` (références typées, pas de directive sur composant) ; Toasts via `createToasts()` + `on()` dans le parent ; fenêtres = `<dialog>` natif monté = ouvert ; pas d'API popover (happy-dom ne l'a pas). Changement framework associé : une vue de contrat lue dans le rendu d'un autre composant abonne le composant qui rend.
**Why:** chantier choisi par l'utilisateur après le router (voir [[router-current-design]]).
**How to apply:** suivre ces décisions sans les rediscuter ; mettre à jour à l'avancée.
