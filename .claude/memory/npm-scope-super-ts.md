---
name: npm-scope-super-ts
description: le scope npm des paquets est @super-ts (l'org "super" était prise) ; le dépôt est déjà renommé
metadata:
  type: project
---

L'utilisateur a créé l'org npm `super-ts` le 2026-11-26, car `super` était déjà pris. Le même jour, tout le dépôt est passé de `@super/…` à `@super-ts/…` : alias tsconfig/vite, imports, plugin vite (architecture.ts, contracts.ts génère `@super-ts/…`), groupe Biome `@super-ts/**` dans packages/lint/config.json, docs et llms*.txt. `npm run check` vert après coup (457 tests).

**Why:** le scope `@super` n'est pas disponible sur npm.

**How to apply:** n'écrire que `@super-ts/…` dans le code, la doc et les noms de paquets. Les `package.json` de packages/* n'ont pas encore de nom scopé : à ajouter au moment de publier. Lié : [[todo-later]], [[ui-kit-design]].
