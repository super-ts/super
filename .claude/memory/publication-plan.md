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

## Décisions tranchées le 2026-11-26

- **Version de départ :** `0.1.0`.
- **Dépôts :** organisation GitHub `super-ts`, dépôts `super-ts/super` et `super-ts/tree-sitter-super`.
- **Licence :** MIT, `Copyright (c) 2026 Dimitri Lahaye`, pour tout (paquets, extension, grammaire). Raisons données : norme des frameworks front, compatible avec lit-html (BSD-3), Volar et tree-sitter-typescript (MIT), acceptée par Zed. Le LICENSE de la grammaire reprend aussi la mention de tree-sitter-typescript (Max Brunsfeld).

## Décision encore ouverte

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

## Phase 2 : des paquets npm réels (faite le 2026-11-26)

- [x] `LICENSE` MIT à la racine, dans chaque paquet (npm publie chaque dossier séparément), dans `editors/zed` (+ `license` dans Cargo.toml) et dans la grammaire (non commitée là-bas au moment de la phase 2).
- [x] Un `package.json` par paquet (`@super-ts/core|dom|ui|testing|vite|lang|lint`), version `0.1.0`, descriptions en anglais, `author: Dimitri Lahaye` (sans e-mail, il serait public sur npm), `repository.directory`, `publishConfig.access: public`, `files: ["dist"]`.
  - Dépendances internes en version exacte. `dom` : `lit-html` (retiré de la racine). `vite` : `@super-ts/lang`, peer `vite ^8`. `lang` : peers `@super-ts/dom` (le code compilé l'importe), `typescript ^7` (`super-tsc` lance `npx tsc`), `@biomejs/biome` optionnel (le formateur lance le Biome du projet). `testing` n'importe pas vitest : pas de peer. `ui` : `sideEffects: ["**/*.css"]`. `lint` : exports `./config.json`.
  - `bin.super-tsc` reporté en phase 3 (il doit pointer vers `dist`).
- [x] **Résolution vers les sources sans build** : chaque export a la forme `{ "@super-ts/source": "./src/x.ts", "types": "./dist/x.d.ts", "default": "./dist/x.js" }`. Le `.npmrc` du dépôt fait `node-options=--conditions=@super-ts/source` pour tous les scripts npm. Piège trouvé : le chargeur de config par défaut de Vite (`bundle`) résout les imports nus avec des conditions fixes (`node`, `module-sync`) et ignore celles de Node, donc `dev`, `build:example`, `test` et `test:watch` passent `--configLoader native` (Node charge la config). Conséquence : lancer Vite et Vitest par `npm run`, pas par `npx` nu. Les alias tsconfig/vite restent pour l'app et les tests (alias `@super-ts/lang` ajouté à vite.config).
- [x] `packages/vite/src/index.ts` importe `compile`, `composeMap`, `SourceMap`, `writeVirtualFile` depuis `@super-ts/lang` (exportés par `packages/lang/src/index.ts`).
- [x] `"workspaces"` à la racine (les 7 paquets listés un par un) ; `lang-server` reste hors workspaces pour l'instant (phase 5). `npm run check` vert (457 tests), build de la démo et serveur de dev vérifiés.
- À savoir pour la phase 3 : `virtual.ts` lit `check.ts` à l'exécution (`readFileSync(import.meta.dirname, 'check.ts')`), il faudra donc livrer ce fichier dans `dist`. Le README annonce 24,6 Ko gzip pour la démo, alors que le build fait 38,3 Ko gzip, déjà avant la phase 2 : chiffre périmé à corriger.

## Phase 3 : build (faite le 2026-11-26)

- [x] `tsconfig.build.json` à la racine (base : tsc 7, `declaration`, `rewriteRelativeImportExtensions`, `noEmitOnError`, `types: []`, sans `paths` ni condition `@super-ts/source`) et un par paquet (`rootDir: src`, `outDir: dist`, tests, `*.test-d.ts` et `__fixtures__` exclus ; `types: ["node"]` pour `lang` et `vite`). Chaque paquet lit ses dépendances @super-ts/* par leurs `dist/*.d.ts`, comme chez un utilisateur.
- [x] `npm run build` → `scripts/build.mjs` : vide `dist`, lance tsc dans l'ordre core, dom, testing, ui, lang, vite, copie les fichiers non compilés (`ui` : `styles.css`, `styles.d.css.ts` ; `lang` : `check.ts`, lu à l'exécution par `virtual.ts`), rend les binaires exécutables.
- [x] `bin` de `@super-ts/lang` : `super-tsc` → `dist/cli.js` et `super-fmt` → `dist/format-cli.js`, avec shebang. Leur garde « lancé directement » compare `realpathSync(argv[1])` : via le lien de `node_modules/.bin`, l'ancien test d'égalité échouait en silence.
- Changements de code faits pour le build :
  - imports relatifs de core, dom, ui, testing passés en `.ts` (comme lang et vite) : le JS émis réécrit en `.js`, sinon il ne se chargeait pas dans Node. Les `.d.ts` gardent `./x.ts` et se résolvent bien (vérifié en `bundler` et `nodenext`).
  - `ui/src/app.ts` : `CommandRef.view` typé `{ selectors: unknown; send: unknown }` au lieu de `ContractView<any>`. Sans contrat déclaré (build du kit), `ContractName` vaut `never` et TS 7 refuse `any` pour cette contrainte.
  - `ui/src/styles.d.css.ts` type `import './styles.css'` (`allowArbitraryExtensions` dans le tsconfig.build de ui). Livré dans dist : sans lui, un projet sans `vite/client` et sans `skipLibCheck` casse sur `dist/index.d.ts`.
  - `**/dist` exclu du tsconfig racine.
- Vérifié : `npm run check` vert (457 tests), build de la démo, chargement de `dist` dans Node sans la condition source, binaires via lien symbolique, typecheck d'un projet utilisateur contre les `.d.ts` avec `skipLibCheck: false` (bundler et nodenext), `npm pack --dry-run`.
- Trouvé en vérifiant chaque commit dans un clone neuf (2026-11-26), défauts antérieurs à la phase 3 :
  - `npm ci` à la racine ne suffit pas : `packages/lang-server` (hors workspaces) a son propre `node_modules`, sans lequel le typecheck casse. Réglé de fait par la phase 5 (lang-server dans les workspaces) ; d'ici là, `npm ci` aussi dans `packages/lang-server`.
  - CORRIGÉ le 2026-11-26 : `super-tsc` ne ramenait pas les erreurs sur les `.super` si le chemin du projet passait par un lien symbolique (ex. `/tmp` → `/private/tmp` sur macOS). `cli.ts` part maintenant du chemin réel du tsconfig et ramène les fichiers cités par tsc à leur chemin réel ; test dans `check.test.ts`.
- Pas de source maps ni de declaration maps : `src` n'est pas publié, elles pointeraient dans le vide. À rouvrir si on publie `src`.

## Phase 4 : test d'installation comme un vrai utilisateur (faite le 2026-11-26, sauf la CI)

- [x] `npm run smoke` → `scripts/smoke-install.mjs` : build, `npm pack` des 7 paquets, app Vite vierge dans un dossier temporaire qui installe les tarballs (outils aux versions du dépôt, `--prefer-offline`), l'exemple du bouton de thème de `docs/demarrer.html` (contrat, store, `.super`, test) plus un `.super` qui utilise `Button` du kit, puis `vite build`, `super-tsc`, `super-tsc` sur un `.super` cassé (doit signaler l'erreur sur le `.super`), `vitest run`, `biome format`, `super-fmt --write/--check`, `biome check` avec `@super-ts/lint`. Contrôles en plus : aucun paquet ne livre `src/`, le plugin écrit `contracts.d.ts`, la CSS du kit est dans le build. `--keep` garde l'app ; elle est gardée en cas d'échec.
  - Le script retire `NODE_OPTIONS` et les variables `npm_*` de l'environnement : sinon la condition `@super-ts/source` du `.npmrc` du dépôt fuit dans l'app et pointe vers des `src/` absents des tarballs.
- [ ] Le faire tourner en CI : avec la phase 8 (il n'y a pas encore de workflow).
- Bugs trouvés et corrigés par ce test :
  - **CSS du kit absente du build** dès qu'une app n'importe que certains composants : avec `sideEffects: ["**/*.css"]`, le bundler saute `index.js` (sans effet de bord) et perd son `import './styles.css'`. La démo avait le même bug en production (CSS 9,9 → 21 Ko après correction ; invisible en dev). Corrigé : `sideEffects` liste aussi `./dist/index.js` et `./src/index.ts`.
  - **`super-tsc` lancé depuis un dossier atteint par un lien** (`/var` → `/private/var` sur macOS, donc tout dossier temporaire) : erreurs rapportées sur le TS virtuel. tsc écrit ses chemins relatifs à son dossier courant logique (PWD) et `npx` se replace à la racine du paquet dans un workspace. Corrigé : `cli.ts` lance le `bin/tsc` du `typescript` résolu depuis le projet, avec `cwd` et `PWD` au dossier réel du projet, et résout ses chemins depuis ce dossier. Test CLI dans `check.test.ts`.
- Remarques, non corrigées :
  - `super-fmt` exige `biome.json` et `node_modules/.bin/biome` dans le même dossier (`biome.ts`) : à revoir pour les monorepos où Biome est hissé plus haut.
  - `super-tsc` sur un projet neuf échoue tant que `src/@core/contracts.d.ts` n'existe pas : il est écrit par le plugin Vite (`vite build` ou `vite`). La doc dit de le committer ; le smoke lance `vite build` d'abord.

## Phase 5 : serveur de langage publiable (faite le 2026-11-26, sauf le groupe `fixed`)

- [x] `packages/lang-server` s'appelle `@super-ts/language-server` (0.1.0, public, `files: ["dist"]`, `bin.super-language-server` → `dist/server.js`). Il est dans les workspaces : son `package-lock.json` et son `node_modules` à part sont supprimés, un `npm ci` racine suffit dans un clone neuf. TypeScript 6 reste imbriqué dans `packages/lang-server/node_modules` (TS 7 à la racine) ; `declarations.test.ts` lit `../node_modules/typescript/lib/tsserver.js`, toujours valable.
- [x] Assemblé par Rolldown (devDependency explicite, même version que celle de Vite 8) dans `scripts/build.mjs` : un `dist/server.js` (≈ 107 Ko, shebang) qui embarque le code de lang (importé par `../../lang/src/…`). Externes : les `dependencies` du paquet (TypeScript 6, Volar, volar-service-typescript, vscode-uri) et les modules Node. `check.ts` de lang est copié dans `dist` (lu à l'exécution par le code de `virtual.ts` embarqué).
- [x] Testé assemblé : `server.test.ts` pilote `SUPER_LS_SERVER` s'il est défini. `npm run smoke` installe le tarball du serveur dans l'app (TS 6 et Volar venus de npm) et lance les 25 tests sur ce serveur installé.
- [ ] Groupe `fixed` de Changesets : avec la phase 8.
- Doc : tableau des paquets de `docs/index.html` mis à jour.
- Pour la phase 7 : `editors/zed/src/lib.rs` cherche encore `node_modules/super-language-server/src/server.ts`, chemin mort depuis le renommage (repli sur `packages/lang-server/src/server.ts` dans le dépôt) ; `docs/outillage.html` décrit ce comportement. Le nom du serveur LSP côté Zed (`super-language-server`, réglage `lsp.super-language-server.binary`) ne change pas.

## Phase 6 : grammaire publique (l'utilisateur, puis moi)

Préparé le 2026-11-26 dans `editors/tree-sitter-super` (commits locaux, à pousser) :
- [x] Dépôt entièrement en anglais britannique (README, commentaires de `grammar.js`, `scanner.c`, `scanner.h`, descriptions). Fichiers générés inchangés.
- [x] Tests autonomes `test/corpus/` (`npm test` = `tree-sitter test`, 8 cas avec noms de champ) : if/else, for avec key, switch, déclaration, slot nommé, @tag/@title, texte commençant par un mot réservé, point-virgule automatique. `npm run check` (lit les .super du dépôt Super) ne marche que dans le sous-module.
- [x] Versionnage par **release-please** (choix de l'utilisateur, après essai de Changesets) : `release-please-config.json` (type node, tag `vX.Y.Z`, `bump-minor-pre-major`, `extra-files` pour `$.metadata.version` de `tree-sitter.json`, `bootstrap-sha` = commit des tests), `.release-please-manifest.json` à 0.1.0, workflow `.github/workflows/release-please.yml` (`googleapis/release-please-action@v4`), `CHANGELOG.md` avec l'entrée 0.1.0, `version` dans `package.json`.
  - Pourquoi pas Changesets : @manypkg/find-root prend comme racine le premier parent qui déclare des workspaces ; depuis le sous-module, toute commande `changeset` remonte à la racine de Super et y écrit (`"workspaces": []` → aucun paquet ; `["."]` → npm casse).
- [x] Dépôt `super-ts/tree-sitter-super` passé en public par l'utilisateur ; commits poussés et tag annoté `v0.1.0` (sur `b8c59a9`) poussé le 2026-11-26 ; pointeur du sous-module avancé dans Super.
- [ ] L'utilisateur : cocher « Allow GitHub Actions to create and approve pull requests » dans les réglages Actions de l'**organisation** `super-ts` (grisé au niveau du dépôt, verrouillé par l'org). La permission par défaut peut rester en lecture : le workflow déclare `contents: write` et `pull-requests: write`. Sans ce réglage, release-please échoue à ouvrir sa PR.
- [x] `[grammars.super]` de `extension.toml` en `https://github.com/super-ts/tree-sitter-super`, `rev` = `b8c59a9` (tag v0.1.0, même grammaire compilée que l'ancienne rev). Vérifié : clone HTTPS à la rev, compilation de `parser.c` + `scanner.c`, `generate` sans diff, `npm test`. L'utilisateur doit réinstaller l'extension dev. Conséquence : pour voir une modification de grammaire dans Zed, il faut maintenant la **pousser** (le script `use-local-grammar.sh` prévu plus bas permettrait de repasser en `file://` le temps d'itérer).
- [x] CI de la grammaire (`.github/workflows/ci.yml`, `actions/checkout@v6` et `setup-node@v6`, Node 24) : `npm ci`, `tree-sitter generate` puis `git diff --exit-code -- src`, `npm test`. Commit `93e5cfc`, à pousser pour la voir tourner.

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
