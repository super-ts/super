---
name: publication-plan
description: "plan complet de publication de Super (npm @super-ts/*, extension Zed, grammaire) et du travail en local sans publier ; état et décisions ouvertes"
metadata:
  node_type: memory
  type: project
  originSessionId: 3eb42326-f106-4b70-a507-1c4ba7689c46
  modified: 2026-11-26T15:16:44.484Z
---

# Plan de publication de Super

Demandé par l'utilisateur le 2026-11-26. Trois objectifs :
1. un dev fait `npm install @super-ts/…` et ça marche ;
2. l'utilisateur pousse des versions sur npm et sur Zed ;
3. il travaille en local sans rien publier.

Ordre retenu : dépôts privés d'abord (phase 1), puis les phases 2 à 8, puis le passage en public (en anglais), puis les publications. Cocher les étapes au fil de l'eau, et vérifier dans le code avant de dire qu'une étape est faite.

## Décisions prises

- **Scope npm `@super-ts`** (l'org `super` était prise), dépôt déjà renommé : voir [[npm-scope-super-ts]].
- **Changesets**, avec un groupe `fixed` : tous les paquets `@super-ts/*` ont toujours la même version, y compris `@super-ts/language-server`. Une PR qui touche `ui` fait monter tout le monde à la release.
- **Une seule source de version :** le `package.json` des paquets. Le README et la doc sont mis à jour par un script, jamais à la main.
- **Release par PR :** une PR « Version packages » est tenue par `changesets/action`, et son merge publie sur npm (provenance, trusted publishing OIDC, sans token).
- **L'extension Zed a sa propre version**, hors groupe `fixed` : elle ne sort que si l'extension ou la grammaire changent. Elle installe depuis npm le serveur de la même version que `@super-ts/lang` du projet, ou la dernière à défaut.

## Décisions ouvertes (à demander à l'utilisateur)

- **Version de départ :** `0.1.0` (conseillé, l'API bouge encore) ou `1.0.0`.
- **Nom du dépôt GitHub** de Super, et celui de la grammaire (par exemple `tree-sitter-super`).
- **Licence** (MIT ?), pour les paquets, l'extension et la grammaire.
- **Id de l'extension Zed :** `super` est sûrement pris, `super-lang` est proposé. Pas de « zed » ni « extension » dans l'id.

## État constaté le 2026-11-26

- Le dossier n'était pas un dépôt git (seul `editors/tree-sitter-super` en était un, local, sans remote) ; corrigé par la phase 1.
- `packages/core`, `dom`, `ui`, `testing`, `vite`, `lang` n'ont pas de `package.json`. `lint` n'a que `config.json`. Tout passe par les alias de `tsconfig.json` et `vite.config.ts` vers `src/`.
- Pas de build : uniquement du `.ts` source, avec des imports en `.ts`.
- Des imports sortent de leur paquet :
  - `packages/vite/src/index.ts` importe `../../lang/src/{compile,source-map,virtual-files}.ts` ;
  - `packages/lang-server/src/*` importe `../../lang/src/*.ts`.
- `packages/lang-server` (nom actuel `super-language-server`, privé) a son propre `node_modules` avec TypeScript 6, parce que Volar refuse TS 7. Un `npm i` de Volar à la racine a donné une erreur ERESOLVE.
- `packages/ui/src/index.ts` importe `./styles.css`.
- Le code généré par le plugin importe `@super-ts/core/internal` et `@super-ts/dom/internal`.
- `editors/zed/extension.toml` :
  - id `super` ;
  - description en français ;
  - grammaire en `file:///Users/…/editors/tree-sitter-super` + `rev` ;
  - pas de licence.
- `editors/zed/src/lib.rs` cherche `node_modules/super-language-server/src/server.ts` puis `packages/lang-server/src/server.ts`. Il lance le serveur en TS brut, et ses messages sont en français. Il accepte déjà `lsp.super-language-server.binary`.
- La doc dit que les paquets ne sont pas publiés : `docs/llms.txt`, `docs/chantiers.html`, la partie alias de `llms-full.txt`, et l'installation dans le README.

## Phase 1 : dépôts privés, tout câblé en local (décidé le 2026-11-26)

But : versionner et sauvegarder, sans rien publier. Le câblage local reste tel quel (alias, `file://` pour la grammaire).

- [x] `.gitignore` racine complété (`.claude/settings.local.json`, `editors/tree-sitter-super` le temps de le brancher en sous-module).
- [x] Mémoire déplacée dans `./.claude/memory` du dépôt ; `~/.claude/projects/-Users-dimitrilahaye-Documents-perso-super/memory` est un lien symbolique vers elle. Elle est versionnée avec le reste.
- [x] `git init` et premier commit du dépôt Super, branche `main`.
- [x] Organisation GitHub `super-ts` ; dépôts privés `super-ts/super` et `super-ts/tree-sitter-super`, tous deux sur `main`, poussés le 2026-11-26 par l'hôte SSH `github.perso` (clé perso `dimitrilahaye`). Commits signés `dimitrilahaye <contact@dimitrilahaye.net>` (config locale des deux dépôts).
- [x] La grammaire est un sous-module de Super (`.gitmodules` en HTTPS, URL locale surchargée en `github.perso`), citée dans le README.
- [x] Une autre session a réécrit l'historique local des deux dépôts (messages en anglais, Conventional Commits, mon commit fourre-tout `d2fb748` scindé). L'ancien historique de la grammaire reste dans sa branche locale `backup/pre-conventional-commits`.
- [x] Grammaire passée sur `main` en local et poussée (nouvelle branche) ; `.gitmodules` en `branch = main`.
- [x] `main` est la branche par défaut des deux dépôts ; `master` supprimée sur GitHub ; `main` réécrit de Super poussé en force avec l'accord de l'utilisateur (2026-11-26). Phase 1 terminée.
- Leçon : dans ce dossier, d'autres sessions travaillent en parallèle. Ne jamais faire `git add -A` : n'ajouter que les fichiers touchés soi-même.

## Passage en public (plus tard, après les phases 2 à 8)

- **Nouveau dépôt public créé à partir d'un commit propre**, sans `.claude/memory` ni l'historique privé. Le dépôt privé reste l'archive de travail. Ne pas rendre public le dépôt privé, sinon toute la mémoire part avec l'historique.
- **Tout passe en anglais** dans les dépôts publics (demande de l'utilisateur) : README, doc HTML et `llms*.txt`, commentaires du code, messages d'erreur du framework et du plugin, tests, textes de l'extension Zed, grammaire. C'est un chantier à part entière, à faire avant le premier dépôt public.
- **GitHub Pages pour la doc** : un workflow lance `npm run docs:index` puis publie `docs/`. Pages sur un dépôt privé demande un compte payant, d'où son arrivée au passage en public.
- La grammaire passe en public elle aussi, puis `extension.toml` pointe vers son URL HTTPS (phase 6).

## Phase 2 : des paquets npm réels (moi)

- [ ] Un `package.json` par paquet : `name`, `version`, `type: module`, `exports` (avec `types`), `files: ["dist"]`, `license`, `repository` (avec `directory`, nécessaire à la provenance), `publishConfig.access: public`.
  - `core` : exports `.` et `./internal`.
  - `dom` : dépend de `lit-html` et de `@super-ts/core` (version exacte) ; exports `.` et `./internal`.
  - `ui` : dépend de `dom` et `core` ; `sideEffects: ["*.css"]` ; CSS copié dans `dist`.
  - `testing` : dépend de `core` et `dom` ; `vitest` en peer.
  - `vite` : dépend de `@super-ts/lang` ; `vite` en peer.
  - `lang` : `bin.super-tsc` ; `typescript` (7) en peer ; il lance Biome pour le formatage, donc décider si `@biomejs/biome` est en peer ou en dépendance optionnelle.
  - `lint` : `files: ["config.json"]`.
  - `language-server` : voir la phase 5.
- [ ] Remplacer les imports `../../lang/src/…` de `vite` par `@super-ts/lang` (exporter ce qu'il faut depuis `lang`).
- [ ] Ajouter `"workspaces"` à la racine, en listant les paquets un par un. Tester si `lang-server` peut y entrer (TS 6 imbriqué). Sinon, il reste hors workspaces et un script aligne sa version.
- [ ] Garder les alias vers `src/` pour le développement : la démo et les tests ne dépendent pas du build.

## Phase 3 : build (moi)

- [ ] Un `tsconfig.build.json` par paquet : tsc 7, `declaration`, `rewriteRelativeImportExtensions`, sortie dans `dist/`, tests et `__fixtures__` exclus.
- [ ] Un script racine `npm run build` qui construit tous les paquets dans l'ordre des dépendances.
- [ ] Le binaire `super-tsc` est compilé en JS avec un shebang Node.

## Phase 4 : test d'installation comme un vrai utilisateur (moi)

- [ ] Un script `scripts/smoke-install.mjs` :
  1. `npm pack` de chaque paquet ;
  2. création d'une app Vite vierge dans un dossier temporaire et installation des tarballs ;
  3. écriture d'un contrat, d'un store, d'un composant `.super` et d'un test ;
  4. `super-tsc`, `vite build`, `vitest run`.
- [ ] Ce script tourne en CI. C'est lui qui attrape les erreurs que les alias cachent.

## Phase 5 : serveur de langage publiable (moi)

- [ ] Renommer le paquet `@super-ts/language-server`, le rendre public et le mettre dans le groupe `fixed`.
- [ ] L'assembler en un seul `dist/server.js` avec Rolldown (déjà présent par Vite 8). Le code de `lang` est inclus ; `typescript@6`, Volar et `vscode-uri` restent des dépendances. `bin` pointe vers `dist/server.js`.
- [ ] Le tester une fois assemblé : tests de `server.test.ts` lancés sur le `dist`.

## Phase 6 : grammaire publique (l'utilisateur, puis moi)

- [ ] L'utilisateur crée le dépôt GitHub public de `editors/tree-sitter-super` et pousse (le `src/parser.c` généré est déjà commité).
- [ ] Je fais passer `[grammars.super]` de `extension.toml` en `https://github.com/…` + `rev`.
- [ ] Une CI dans ce dépôt : `tree-sitter generate` sans diff, puis parsing des `.super` sans `ERROR`.

## Phase 7 : extension Zed publiable (moi)

- [ ] `lib.rs`, dans l'ordre :
  1. le réglage `lsp.super-language-server.binary` l'emporte ;
  2. sinon, lire la version de `node_modules/@super-ts/lang/package.json` dans le projet ;
  3. `zed::npm_install_package("@super-ts/language-server", version)`, ou `zed::npm_package_latest_version` si le projet n'a pas Super ;
  4. lancer `dist/server.js` avec `zed::node_binary_path()`.

  Retirer la recherche dans `packages/lang-server` : le dépôt Super passe par le réglage `binary` dans son `.zed/settings.json`.
- [ ] `extension.toml` : nouvel id, `name`, description en anglais, `authors`, `repository`, capacité `npm:install`.
- [ ] Les messages de `lib.rs` en anglais, la licence dans `editors/zed`, le README de l'extension en anglais.
- [ ] Un job CI qui compile l'extension en `wasm32-wasip2`.

## Phase 8 : Changesets, version et CI (moi)

- [ ] `@changesets/cli`, avec `.changeset/config.json` :
  - groupe `fixed` sur `@super-ts/*` ;
  - `access: public`, `baseBranch: main` ;
  - `ignore` pour la démo.
- [ ] `scripts/sync-version.mjs` lit la version de `packages/core/package.json` et la reporte :
  - dans le README, entre `<!-- version -->` et `<!-- /version -->` (badge, ligne d'installation) ;
  - dans la doc HTML (en-tête ou pied) et dans `llms*.txt` (par `docs/tools/build-docs-index.mjs`).
- [ ] Script racine `"version": "changeset version && node scripts/sync-version.mjs"`, et un test qui vérifie que le README et la doc annoncent la version des paquets.
- [ ] La doc :
  - une section d'installation (`npm i @super-ts/core @super-ts/dom`, `npm i -D @super-ts/vite @super-ts/lang @super-ts/testing`) ;
  - retirer « non publiés » de `llms.txt`, de `chantiers.html` et des passages sur les alias ;
  - mettre à jour `outillage.html#zed` (installation depuis le registre Zed).
- [ ] `.github/workflows/ci.yml`, sur chaque PR : `npm run check`, `npm run build`, le test d'installation, `changeset status --since=origin/main`, la compilation de l'extension.
- [ ] `.github/workflows/release.yml`, sur `main` : `changesets/action`. Il ouvre la PR « Version packages » ; son merge lance le build et `changeset publish` avec provenance (`permissions: id-token: write`).

## Phase 9 : première publication npm (l'utilisateur)

- [ ] Vérification préalable de bout en bout avec Verdaccio (voir « Travailler en local »).
- [ ] `npm login`, avec un compte membre de l'org `super-ts` et la 2FA activée.
- [ ] `npm run build && npx changeset publish` depuis sa machine. Le trusted publishing exige que le paquet existe déjà sur npm, d'où cette première publication à la main.
- [ ] Sur npmjs.com, pour chaque paquet : Settings, puis Trusted publishers, puis GitHub Actions (dépôt + `release.yml`). Ensuite, interdire la publication par token.

## Phase 10 : première publication Zed (l'utilisateur)

Elle ne peut partir qu'après la phase 9, puisque l'extension installe le serveur depuis npm.

1. Fork de `zed-industries/extensions`.
2. Le dépôt Super en sous-module HTTPS.
3. Une entrée dans `extensions.toml` : `submodule`, `path = "editors/zed"`, `version`.
4. `pnpm sort-extensions`.
5. Une PR, avec une seule extension par PR. La relecture prend quelques semaines.

## Publier ensuite (routine)

**npm :**
1. Chaque PR qui touche un paquet contient un changeset (`npx changeset` : paquets, niveau, phrase pour le changelog). La CI le réclame.
2. Merger la PR « Version packages » quand on veut sortir une version : tout part sur npm, avec tag `vX.Y.Z` et release GitHub.

**Zed**, seulement si l'extension ou la grammaire ont changé :
1. monter `version` dans `extension.toml` et `Cargo.toml` (et `rev` si la grammaire a changé) ;
2. merger ;
3. ouvrir une PR sur le fork de `zed-industries/extensions` (sous-module à jour et `version`).

Une nouvelle version du framework seule ne demande rien côté Zed.

## Travailler en local sans publier

- **Framework :** rien ne change. Les alias vers `src/`, `npm run dev`, `npm run check`.
- **Ce qui partira sur npm :** `npm run build` puis le test d'installation de la phase 4. Il installe les tarballs dans une app vierge, sans registre.
- **Extension Zed :**
  - `zed: install dev extension` sur `editors/zed`, puis « Rebuild » dans la page Extensions après chaque modification. Elle remplace la version publiée tant qu'elle est installée (même id).
  - Logs : `zed --foreground` pour les `println!` de l'extension, `zed: open log`, `dev: open language server logs`.
- **Grammaire :**
  - pour itérer sans Zed : `tree-sitter parse fichier.super` et `npm run check` dans `editors/tree-sitter-super` ;
  - pour la voir dans Zed : commiter, reporter le `rev`, faire « Rebuild ». Zed exige un hash de commit. L'URL `file://` reste possible en local ; il faudra un script `editors/zed/use-local-grammar.sh` qui commite et met à jour le `rev`, en remettant l'URL GitHub avant une PR Zed.
- **Serveur de langage sans le publier :** le réglage `lsp.super-language-server.binary` dans le `.zed/settings.json` du projet de test, vers `packages/lang-server/src/server.ts` (source) ou `packages/lang-server/dist/server.js` (assemblé), avec les arguments `--stdio`. Puis `editor: restart language server`, sans rebuild de l'extension.
- **Toute la chaîne npm + Zed, avant la première publication ou après un changement de la façon dont l'extension installe le serveur :** Verdaccio, un faux npm local.
  1. `npx verdaccio` (http://localhost:4873) ;
  2. `npm publish --registry http://localhost:4873` des paquets ;
  3. ajouter temporairement `@super-ts:registry=http://localhost:4873` dans `~/.npmrc` (global : Zed lance npm dans son propre dossier de travail, le `.npmrc` du projet n'est pas lu) ;
  4. ouvrir un projet de test avec l'extension dev ;
  5. retirer la ligne de `~/.npmrc`.

  À terme, un script `scripts/local-registry.sh` fera tout ça d'un coup.
- **Limite :** il n'y a pas de canal beta dans le registre Zed. Quelqu'un d'autre qui veut tester une version non publiée de l'extension doit cloner le dépôt et avoir Rust.

## Répartition

- **Moi, en local, sans rien publier :** phases 1 (git init), 2, 3, 4, 5, 7, 8, et la mise à jour du `rev` en phase 6.
- **L'utilisateur :** les dépôts GitHub, le push, la licence et les décisions ouvertes, les phases 9 et 10.

Liés : [[npm-scope-super-ts]], [[todo-later]], [[super-template-language]].
