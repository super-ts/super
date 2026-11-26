---
name: props-emits-without-generic
description: "Réflexion ouverte (2026-11-26) pour déclarer props et émissions dans le corps du composant (this.prop / this.emitter) au lieu du générique SuperElement<{ props; emits }>"
metadata:
  node_type: memory
  type: project
  originSessionId: 33f93c49-f5be-45ab-876d-f954798962ed
  modified: 2026-11-26T13:31:55.445Z
---

Demandé le 2026-11-26, pas encore lancé. But de l'utilisateur : ne plus écrire `class X extends SuperElement<{ props: Props; emits: Emits }>` (jugé trop « à la React ») et tout déclarer dans le corps de la classe, comme `this.contract()`, `this.state()`, `this.selector()`.

Pistes proposées par l'utilisateur :
1. Props en champs : `id: number = this.prop(12)` (12 = valeur par défaut).
2. Émissions : `this.emitter({ close: { reason: CloseReason } })`, qui pose l'émetteur du composant sans générique.

**Why:** cohérence avec le reste de l'API à classes (tout passe par des méthodes protected dans les champs), moins de cérémonie.
**How to apply:** quand l'utilisateur relance le sujet, partir de ces questions sans les redécouvrir. Ne pas trancher seul : présenter les options.

Questions à creuser (contraintes du code actuel, element.ts) :
- Le générique alimente aujourd'hui les fantômes `[PROPS]`, `[EVENTS]`, `[ACCEPTS]` qui typent `Child.create(props, { on })`, `ElementClass<P>` et la vérification dans les deux sens des props d'un écran par le router (paramètres du chemin). Il faudrait dériver ces types de l'instance (`InstanceType<C>` : champs marqués `Prop<T>` / émetteur marqué), sans boucle de types (cf. piège `AppRouterView` qui doit rester générique).
- Obligatoire vs facultatif : `this.prop<number>()` sans défaut = obligatoire, `this.prop(12)` = facultatif ? Comment l'exprimer sur le type de `create`.
- Réactivité : un champ simple `this.id` ne peut pas re-rendre au changement de prop. Il faut soit un objet (`.value`, comme `selector`), soit un accessor installé par Super après l'initialisation des champs (les initialiseurs de champs écrasent ce que pose le constructeur de base), soit les décorateurs `accessor`.
- Les props sont déjà déposées avant `new` (`construct` / `constructing`) : `this.prop()` peut lire la valeur reçue au moment de l'initialisation du champ.
- Collision de noms : un champ ne peut pas porter le nom d'une propriété native d'HTMLElement (TS2416). L'exemple `id` lui-même collisionne ; `this.props.x` évitait le problème.
- `this.emitter({ close: { reason: CloseReason } })` : un objet littéral est une valeur, pas un type. Il faudrait `this.emitter<{ close: { reason: CloseReason } }>()` ou un schéma runtime. Et comment `on:close` côté parent retrouve le type (marque sur le champ émetteur) ; que devient `this.emit(...)` actuel.
- Le langage `.super` (voir [[super-template-language]]) pourrait offrir une syntaxe dédiée plutôt que des appels de méthodes.

## Orientation choisie (2026-11-26)

L'utilisateur valide des décorateurs dans les `.super` : `@prop` et `@emit` (au singulier). Le compilateur les retire et écrit lui-même `SuperElement<{ props; emits }>` + un accessor par prop (`this.question`, sans `.value`). Choisis plutôt que des mots-clés `prop`/`emits` parce que c'est du TS valide : Biome et Tree-sitter les parsent déjà. Pas besoin de `!` (tsc ne voit jamais la source brute, seulement le TS virtuel).
Proposé par l'utilisateur, en discussion : `@tag('confirm-dialog')` à la place de `static tag`, et `@title(...)` pour le titre de page. Doivent garder des parenthèses (`@tag "x"` n'est pas du TS valide). Il n'existe aujourd'hui aucune gestion de `document.title` dans Super. `title` est une propriété native d'HTMLElement : pas de méthode `title()`, le décorateur évite le conflit. Reste à trancher : titre dynamique (fonction qui reçoit l'écran, suivie comme un sélecteur ?) et `@title` sur un composant qui n'est pas un écran.

Suite (2026-11-26) : l'utilisateur veut `@tag = 'confirm-dialog';` (obligatoire, erreur si absent) et `@title = '…';` en champs DANS la classe. Ce n'est pas du TS valide (décorateur sans nom de membre) : faisable car on a notre parser/grammaire/formateur, mais Biome et Tree-sitter ne le prennent plus tels quels. Forme encore à confirmer par l'utilisateur. Le titre est porté par l'écran, pas par le router (accord). Pas de `@title((screen) => …)` : le titre dynamique se pose en impératif au montage. Idée de l'utilisateur : un wrapper façon `document` accessible de n'importe quel composant pour redéfinir le titre ; ma proposition : lié à la durée de vie du composant (pile, le dernier monté gagne, retiré au démontage), `@title` = raccourci de cet appel au montage, ce qui rend `@title` valable sur tout composant.

Décidé (2026-11-26) : forme « propriété de classe » pour tout : `@tag = '…';` (obligatoire, erreur de compilation si absent ; `static tag` reste pour les .ts purs), `@title = '…';`, `@prop`, `@emit`. Nom `this.page` validé (pas `this.document`). Proposé pour la lecture suivie : `@title = () => \`Compteur ${this.label.value}\`` (fléchée de champ, `this` = l'instance), évaluée dans le même suivi que `render` juste après lui, donc recalculée quand le composant se re-rend ; `this.page.title` accepte aussi une fonction. VALIDÉ le 2026-11-26 avec les cinq formes : `@title = '…'` (fixe), `@title = () => …` (suivi après chaque rendu), `this.page.title = '…'` en impératif (fixe), `this.page.title = () => …` (suivi, remplace le précédent du composant), pile (dernier monté gagne, ceux en dessous suivent en coulisse). Router : `title: { default, suffix }`. Refus : `this.page.title` pendant render ; lecture de `this.page.title` impossible ; avertissement dev si fonction suivie sans render. Implémentation lancée le 2026-11-26 dans l'ordre @tag → @prop/@emit → @title/this.page.

## Implémenté le 2026-11-26 (npm run check vert, 444 tests)

- Parser (`parser.ts`) : `SuperFile.classes` (ClassInfo : nom, abstract, `element`, membres `SuperMember`, `staticTag`) ; erreurs : tag manquant, `static tag` dans un .super (avec correction), générique `SuperElement<…>` écrit à la main, doublons, prop sans type, `?` + défaut, hors composant.
- TS virtuel (`virtual.ts`, `classEdits`) : générique écrit par le compilateur (route + props + emits) ; `@prop` → `declare readonly x: T` (ou `readonly x: T = (d)`) ; `@title` → `protected readonly __superTitle = (this.page.title = (…))` ; noms vérifiés par `__s.ownName` dans une méthode `__superNames()` (un champ/bloc statique déclenchait TS2729).
- Compilateur : `@prop` → getter sur `this.props`, défaut dans un champ `__superDefault_x` (une fois par instance) ; `@title` → champ `__superTitle`.
- (Remplacé : la prop du contenu s'appelle `content`, voir plus bas.)
- Noms natifs refusés : démo renommée `title` → `heading` (KitPage, Card, Panel des fixtures), `id` → `counterId` (CounterListItem). `page` est désormais réservé (champ `page` de kit/table.super renommé `pageNumber`).
- Runtime : `packages/dom/src/page.ts` (pile, `configureTitle`), `this.page` sur SuperElement, `createRouter(R, { title: { default, suffix } })`. Pas d'avertissement « fonction sans render » : render est abstrait, toujours appelé.
- Formateur : `@tag _ =` le temps de Biome. Grammaire Tree-sitter : règle `super_declaration` dans `class_body` (commit 797ec58 dans editors/tree-sitter-super après réécriture de l'auteur, rev reportée dans extension.toml), highlight `@attribute` ; l'extension Zed est à réinstaller par l'utilisateur.
- SPEC.md à jour.
- Suite (2026-11-26, demandé) : complétion après `@` + survol documenté (`packages/lang-server/src/component-declarations.ts`, code embarqué `source` passé à `semantic: true`). Démo : `@title` sur les écrans + KitPage (non-écran), `createRouter(Router, { title: { default: 'Super · exemples', suffix: ' · Super' } })`. Nouvel exemple de `subscribe` dans main.ts : panier enregistré dans le localStorage (`adapters/saved-cart.ts`, `CartStore.create({ quantities })`), l'ancien `subscribe` → `document.title` supprimé. Doc réécrite par 4 agents depuis /tmp/super-docs/brief-declarations.md (temporaire).
- FAIT (2026-11-26, choix utilisateur) : la convention `children` est renommée `content` partout (compilateur, TS virtuel, complétion `<:`, erreur `<:content>`, @super-ts/ui `.ts` compris, démo, doc, SPEC). Plus d'exception : `@prop content: Children;` lu par `this.content`. `this.props` ne sert plus dans un `.super`.

Lié : [[class-api-migration]], [[component-store-events]].

## Déclarations de préparation (2026-11-26, demandé, points 1 à 5 validés)

- `@contract cart;` / `@contract shop = 'catalog';`, `@selector x = …;`, `@state x = {…};`, `@form x = {…};`, `@ref x: T;`, `@on('contrat', 'événement') methode(p) { … }`. Lowering : les champs `x = this.contract(…)` etc. (TS virtuel : `readonly`) ; `@on` → champ `nom = this.contract('c').on('e', (p) => { corps })` (paramètre typé par l'événement ; `this.router` pour 'router'). `@on` n'exige pas de `@contract` (choix proposé, l'utilisateur avait demandé).
- Erreurs : contrat en double, `@contract router`, contrat non littéral, type sur @contract/@selector/@state/@form, `@ref` sans type, `@on` mal écrit ; anciennes formes (`x = this.contract(…)`…) refusées dans un composant `.super` avec correction rapide (`oldPreparation` dans parser.ts) ; `.on(` dans le constructeur refusé (`checkConstructors`), sans correction.
- Démo migrée par les corrections rapides (/tmp/super-migrate/apply-fixes.ts) + écouteurs à la main (counter : une méthode `@on` par événement, plus de boucle sur CHANGES).
- Complétion : `@` propose les 10 déclarations ; noms de contrats/événements via le TS virtuel (chaînes recopiées) ; fixture `packages/lang-server/src/__fixtures__/project/contracts.ts` (contrat `basket`).
- `<Form>` écarté (discussion) : un formulaire est de l'état du composant, la balise est déjà `<form {edit.bind()}>`.
- Doc : 4 agents depuis /tmp/super-docs/brief-preparation.md.
