---
name: todo-later
description: "Liste des chantiers que l'utilisateur a explicitement mis de côté « pour plus tard » (à reproposer quand il demande la suite)"
metadata:
  node_type: memory
  type: project
  originSessionId: 7da6ae2f-c13c-418d-bedf-384d0c5fe160
  modified: 2026-11-25T23:47:27.615Z
---

Chantiers que l'utilisateur a demandé de garder pour plus tard. Les reproposer quand il demande « la suite », sans les lancer d'office.

**Why:** l'utilisateur veut une liste de choses à faire plus tard qu'il n'a pas à se rappeler lui-même.
**How to apply:** quand un chantier est fait, le retirer d'ici ; avant de le proposer, vérifier dans le code qu'il n'a pas été fait entre-temps.

- **Publier Super sur npm et l'extension Zed** : plan complet dans [[publication-plan]] (2026-11-26).
- Paramètres de route et query réactifs : passé en chantier le 2026-11-26, voir [[router-current-design]].
- **Suites du chantier router (2026-11-26)**, laissées de côté par l'utilisateur : raccourci pour changer une seule clé de query (aujourd'hui `navigate` avec `...query`) ; descriptions par schéma Zod/Valibot (Standard Schema) ; `{ invalid: 'not-found' }` par paramètre pour renvoyer vers `'*'` ; `oneOf` non exhaustif à la compilation (limite documentée).
- **Suites du kit @super-ts/ui (2026-11-26)** : textes encore sans prop (« Vérification… », « Chargement… » de Table/Combobox, pagination, « Détails ») ; tri sur plusieurs colonnes ; API `popover` native quand le navigateur l'a (repli manuel sinon) ; `fieldOf` limité au rendu du composant propriétaire du formulaire.
- (2026-11-26) Les chantiers recommandés (chargement à la demande + loaders, couche données serveur, journal des commandes), ces suites et les questions ouvertes sont rédigés dans `docs/roadmap.html` (sommaire Référence, après « Limites ») : tenir cette page à jour quand un chantier est fait ou ajouté.
- **GitHub Pages de la doc + CI de redéploiement sur `docs/**` + lien dans le README** : demandé puis reporté le 2026-11-26, bloqué par le dépôt privé. Détails dans [[publication-plan]] (section passage en public).
