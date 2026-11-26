---
name: class-api-migration
description: "Chantier en cours (depuis 2026-11-25) : passer Super d'une API à factories (contract(), defineStore, component) à une API à classes (SuperContract, SuperStore, SuperElement). Décisions, essais, état."
metadata:
  node_type: memory
  type: project
  originSessionId: ae220bef-b1c1-418a-a9fd-60ecd065eedc
  modified: 2026-11-25T18:47:42.480Z
---

Chantier lancé le 2026-11-25 à la demande de l'utilisateur : API à classes, plus expressive, moins verbeuse. Doc à mettre à jour seulement quand l'utilisateur sera content. Les tests doivent passer.

**Why:** l'utilisateur préfère un bootstrap moins imbriqué, des méthodes nommées, `this`.
**How to apply:** suivre les décisions ci-dessous sans les re-litiger ; mettre à jour la section « État » à chaque étape. Migration terminée le 2026-11-25 (code, tests, doc) : la suite = les limites connues listées plus bas.

## Décisions validées

Contrat
- `class CartContract extends SuperContract<CartTypes>` ; `super({ name: 'cart' })` ; sélecteurs = méthodes `(s: CartState, ...args)`, `s` annoté à la main (pas d'inférence possible sur une méthode de classe).
- Les types métier (Product, CartLine…) vont dans un dossier user-land `src/domain/`.

Store
- `class CartStore extends SuperStore<CartContract> implements Commands<CartStore>` (générique gardé, `Commands<Self>` retrouve le contrat par `infer`).
- `Commands<Self>` : paramètres strictement égaux (Equals, pas de bivariance), `Awaited<retour>` comparé au résultat déclaré (`void` ou R d'`Outcome<R,…>`), commande manquante = erreur. Testé OK avec tsc --strict.
- Toute méthode publique d'un store est une commande (Commands le vérifie : méthode publique hors contrat = erreur). Helpers en `#privé` (pas `private`).
- `super({ initialState, ... })` dans le constructeur (pas de champ : initialisé après super()). Dépendances via le constructeur, annotées.
- Lien runtime store→contrat : `super({ contract: 'cart', initialState })` (choix utilisateur 2026-11-25, parmi valeur/`SuperStore.of`/chaîne). Le générique `SuperStore<CartContract>` reste ; le nom est vérifié (NameOf<K> dans le registre `Contracts`). Les clés de createApp ne suffisaient pas : le store a besoin des sélecteurs dès sa création.
- `Store.create()` renvoie la poignée du contrat (send/on/selectors/subscribe), jamais l'instance. Pas de garde runtime sur `this.add()` (abandonnée). Dans un store : `this.send('add')` = commande suivie, `this.#helper()` = code partagé.

Composant
- `class ShopScreen extends SuperElement`, `static tag = '...'` obligatoire.
- Méthodes protected sur SuperElement : `this.contract('cart')`, `this.state(...)`, `this.reactive(selector)`, `this.ref<T>()` ; contexte façon `inject()` d'Angular (contexte courant pendant `create`).
- Champs : `cart = this.contract('cart')`, `lines = this.reactive(this.cart.selectors.lines)` ; lecture `.value`.
- `on()` dans le constructeur, activé à connectedCallback, libéré à disconnectedCallback.
- Hooks protected `mounted()` / `unmounted()` ; surcharger connectedCallback/disconnectedCallback = erreur au premier create.
- Handlers passés aux enfants : champs fléchés.
- `SuperElement.create(props, { on })` fait `new this()` ; `<tag>` en HTML brut non supporté.
- Garde runtime : `on()`, `reactive()`, `contract()`, `state()` lèvent pendant un `render`.
- Zéro import de `@core/` dans un composant : `contract('cart')` par chaîne, dictionnaire de types généré par le plugin Vite (fichier .d.ts committé, CI vérifie qu'il est à jour ; unicité des noms vérifiée).
- querySelector : on laisse faire le user-land (pas de règle).

## Essais

- Méthode de classe + implements : paramètres non inférés (TS7031) → annotation obligatoire.
- implements simple : laisse passer paramètre plus étroit (bivariance) et retour de donnée → d'où `Commands<Self>` exact.
- `protected` incompatible avec implements (TS2420).

- RENOMMAGE (2026-11-25, demandé) : `this.reactive(…)` s'appelle désormais `this.selector(…)` (marque mieux l'intention), et son type de retour `Reactive<T>` devient `Selection<T>` (classe interne `SelectionValue`). Partout ailleurs dans cette note, « reactive » = `selector`.

## Implémentation (choix techniques)

- L'API à classes s'appuie sur le runtime existant : `compileContract(Class)` produit l'objet `Contract` legacy (sélecteurs = méthodes du prototype), `SuperStore.create` passe par `buildStore(prepare)` (Store refactoré pour se construire depuis une préparation).
- Ancien type `Commands` (map de commandes) renommé `CommandMap` ; `Commands<Self>` = le nouveau check.
- `this.fail(reason)` lève `CommandFailure(null, …)` : `null` = « la commande en cours ». Limite : la raison est typée sur l'union de toutes les raisons du contrat, pas par commande.
- Noms réservés dans un store (méthodes protected) : get, set, selectors, emit, send, fail, signal. Une commande ne peut pas s'appeler ainsi.
- Handle (`create()`) expose maintenant `selectors` (remplace `read(Contract, state)` dans les tests).
- Registre runtime : `registerContract(name, () => Class)` (internal), rempli par le module virtuel du plugin Vite.
- SuperContract n'a qu'un générique : `SuperContract<CartTypes>` (le state est dans les types).

Côté composant (écarts par rapport au design discuté) :
- Pas de contexte global façon inject() : `this.contract()` etc. sont des méthodes, la poignée est paresseuse (résolue au montage par requestStore, car un élément en construction n'est pas dans le DOM).
- Props : `this.props.x` (getter simple, le setter re-rend), pas de `.value`.
- `reactive(fn)` : suivi des lectures façon signal ; re-rend seulement si la valeur (stabilisée par share) change. Un sélecteur lu directement dans render abonne aussi (re-rend à tout changement du store).
- `Child.create(props, { on })` : dans un render → directive mountChild (instance gardée) ; hors render → l'élément. Décidé par `currentRendering()`.
- Ancien type `SuperElement<P>` (interface d'élément) renommé `ComponentElement<P>`.
- `renderError(error)` (ex-`fallback`, renommé le 2026-11-25 à la demande ; `onError` écarté car déjà pris par createApp) ; `signal` protected (après montage). La phase d'erreur s'appelle encore `'fallback'` (partagée avec l'ancienne API) : à renommer à la suppression ?
- `on()` déclaré à la préparation est rejoué à chaque montage ; posé une fois monté (mounted, gestionnaire), il vit jusqu'au démontage (pas de doublon).

## Ajustements du 2026-11-25 (après la migration de la démo)

- Générique nommé : `SuperElement<{ props: {...}; emits: {...} }>` (les deux clés facultatives), à l'image de SuperContract. Sous le capot : fantômes séparés `[PROPS]`, `[EVENTS]`, et `[ACCEPTS]` (fonction contravariante) pour que le router et `ElementClass<P>` vérifient les props d'un écran dans les deux sens (exactement les paramètres du chemin). `PropsIn<any>`/`EmitsIn<any>` = any (sinon `object | {}`). `ElementClass.new()` renvoie `HTMLElement`, `create` aussi (le `create` statique générique, à `this` typé, ne permettait pas de vérifier les props).
- `this.router.href('counter', { id })` : méthode de la vue du router (`RouterView`, `ViewOf<N>`), pas un sélecteur, donc n'abonne pas le composant. Runtime : `routerHrefs` (router-link.ts) posé par createRouter. Plus aucun composant de la démo n'importe `routes.ts` (supprime aussi l'import circulaire routes ↔ écrans). `Router.href` reste pour le user-land hors composants.
- `pending()` = n'importe quelle commande du store ; `pending('load')` = cette commande ; `pending('x', { id })` = pour ce body.

- [x] (2026-11-25) Sélecteurs vérifiés à la compilation à la déclaration du store : `SuperStore<K extends AnyContract & CheckedContract<K>>` refuse un 1er paramètre qui n'accepte pas l'état, et un sélecteur nommé `pending`. Piège corrigé au passage : un type mappé sur `keyof K` doit utiliser `-?`, sinon la propriété fantôme facultative ajoute `undefined` aux clés et casse le calcul en silence (SelectorKey, PublicMethodKey). `isStore` (interne, inutilisé) supprimé.

## Organisation de la démo (demandée le 2026-11-25)

- `src/@components/<écran>/index.ts` (+ `index.css`, `index.test.ts`), sous-composants en fichiers à plat dans le dossier de l'écran (ex. `counter/counter-controls.ts`), composants réutilisables dans `src/@components/shared/`. Dossiers en kebab-case, sans suffixe `-screen` (`shop/index.ts` exporte `ShopScreen`). La coquille : `app-shell/`.
- `src/@core/<nom>/contract.ts | store.ts | store.test.ts`. Le plugin Vite reconnaît `contract.ts` et `*.contract.ts` (`isContractFile`).
- Imports par dossier : `@components/shop`, `@core/cart/store`.
- Style demandé : les props d'un composant dans un alias local `type Props = { id: string };` placé au-dessus du commentaire de la classe, puis `SuperElement<{ props: Props }>` ; idem `type Emits = {...}` → `SuperElement<{ props: Props; emits: Emits }>` sur une ligne.
- Les liens de docs/*.html vers les fichiers de la démo ont été mis à jour (chemins seulement, contenu à réécrire plus tard).

## État

- [x] packages/core : SuperContract, SuperStore, Commands<Self> + tests runtime (classes.test.ts) et types (classes.test-d.ts), fixture __fixtures__/basket.ts. Les deux trous (bivariance, retour de donnée) sont bouchés et testés.
- [x] packages/dom : SuperElement (element.ts) + 10 tests runtime + tests de types (element.test-d.ts). Router, `mount` (testing), createApp acceptent les classes ; stores résolus aussi par nom ; `use('cart')` et guard `read('cart')` pour les composants/routes à l'ancienne.
- [x] Plugin Vite (packages/vite/src/contracts.ts) : scan de `src/@core/**/*.contract.ts` (`export class X extends SuperContract` + `super({ name })`), noms en double refusés, module virtuel `virtual:super/contracts` (registerContract lazy) injecté sur la même ligne en tête des modules @core qui mentionnent SuperStore (hors contrats, pour éviter les cycles/TDZ), `src/@core/contracts.d.ts` réécrit à buildStart et au watch s'il change (style aligné sur biome). Fichier généré à committer. 4 tests.
- [x] Exemple panier migré : domain/shop.ts (Product, CartLine, Order, PRODUCTS, linesOf), cart/checkout contract+store en classes, ShopScreen et ConfirmDialog en SuperElement, checkout-screen garde component() mais `use('cart')`/`use('checkout')`, routes.ts `read('cart')`, main.ts et tests via `cart.selectors`. `npm run check` vert le 2026-11-25 (219 tests).
- [x] Étape 1 (2026-11-25) : router en contrat-classe. `this.contract('router')` : sélecteurs route/path/params/query, commandes navigate/visit/back, typé par `AppRouterContractOf<typeof Router>`. Runtime : classe `RouterSelectors` inscrite sous 'router' par @super-ts/dom (+ screen/errorScreen, non typés, pour l'outlet) ; createApp mappe aussi 'router' ; la vue lit via `readStore(store, state, contractByName(name))`. Le plugin Vite détecte `export const X = defineRouter` dans src et l'ajoute au d.ts (nom 'router' réservé). `RouterOutlet` est une SuperElement (écouteur ERROR_EVENT posé dans le constructeur : un écran peut planter au 1er rendu). NotFoundScreen et ErrorScreen de la démo migrés ; app-shell appelle `RouterOutlet.create()`.
- [x] Étape 2 : constructeur d'un enfant qui plante → `FailedChild` (`<super-failed-child>`) à sa place, qui signale l'erreur au nom de l'enfant, phase 'setup', à son insertion. Testé.
- [x] Étape 3 : `fakeStore('counter', { state, commands })` par nom + type `FakeCommands<'counter'>` (@super-ts/testing). Encore bâti sur defineStore : à repasser sur buildStore à la suppression de l'ancienne API.
- [x] Étape 4 (2026-11-25) : tous les contrats/stores de la démo en classes (counter, timer, error-log, profile), types métier dans src/domain/ (counter.ts, error-log.ts, profile.ts, shop.ts). Composants migrés : CounterControls, CounterListItem, CounterListScreen, CounterScreen, TimerWidget, TimerShortcuts, ErrorsScreen (+ FragileCard, BrokenChild, GuardedPanel, DoubleFailure avec renderError), WidgetScreen (ref), ExamplesScreen, AppShell. Nouveau sélecteur `label(s, id)` dans CounterContract (la projection `find(id)?.label` n'est plus permise dans reactive). 226 tests verts, bundle 24,5 Ko gzip.
- Piège : un champ de composant ne peut pas porter le nom d'une propriété native d'HTMLElement (`slot`, `title`, `hidden`, `id`…) : erreur TS2416. Renommé `widgetSlot`.
- [x] Étape 5 (2026-11-25) : `this.form(options)` dans SuperElement. createForm découpé : tout est prêt à la construction ; `env.connect(attach)` branche le store (écouteurs :done/:failed, pending) — appelé tout de suite par l'ancienne API, à chaque montage par SuperElement (`connectors`). `submit.to` accepte une ContractView (phantom `__commands` pour inférer les commandes) ; `viewEntries` (WeakMap vue → entrée) retrouve le store. CheckoutScreen et ProfileScreen migrés : plus aucun component() ni import de @core/ dans les composants de la démo. 227 tests verts, bundle 23,7 Ko gzip.
- [ ] @super-ts/testing : `fakeStore` pour un contrat-classe (par nom).
- [ ] Durcir la règle Vite « un composant n'importe rien de @core/ (hors types) » une fois tout migré.
- [x] Étape 6 (2026-11-25) : ancienne API supprimée. Tests du framework réécrits sur les classes par 5 agents en parallèle (core, composants, formulaires, router, testing), avec fixtures préfixées (`core-`, `cmp-`, `form-`, `rt-`, `tst-`) dans `__fixtures__/`. Puis suppression : contract()/read()/hasSelectors/TypedContract, defineStore/StoreDefinition/StoreSetup/StoreOf, component()/props()/emits()/use/ComponentDef/StoreView/ComponentElement, AnyRouter/RouterContract. Router : `buildStore` + `compileContract(RouterSelectors)` (contrat nommé 'router') ; createApp ne mappe plus que par nom. `@super-ts/testing` : `mount(Class)` renvoie l'instance typée (`Mounted<T>`), `fakeStore(name)` seulement, sur buildStore. Phase d'erreur `'fallback'` renommée `'renderError'`. `this.fail()` : le store complète la CommandFailure (commande + body). Plugin Vite : règles SuperContract/SuperStore → @core, SuperElement → @components ; un composant n'importe de @core que des types. 220 tests, bundle 23,5 Ko gzip.
- [x] (2026-11-25) Props lisibles dès les champs/constructeur : Super les dépose avant `new` (`construct(Class, props)`, variable `constructing` consommée par le constructeur de base) ; la directive enfant appelle `def.create(props)`. Store introuvable au montage (phase setup) désormais rattrapé par le renderError du composant lui-même. Tests + doc à jour.
- Limites restantes : un composant ne rattrape pas sa propre erreur de constructeur par son renderError ; `mount()` d'une classe dont le constructeur plante lève directement ; `this.fail` typé sur l'union des raisons du contrat (décision du 2026-11-25 : on laisse ; la vérification par commande exigerait `return this.fail()` et `.catch(() => null)` + test, friction jugée trop forte pour un risque couvert par les tests de store) ; rien ne vérifie que le 1er paramètre d'un sélecteur est l'état du contrat ; `pending` comme nom de sélecteur refusé seulement à l'exécution ; un seul router typé ('router').
- [x] Doc réécrite (2026-11-25) par 5 agents à partir d'une fiche commune (/tmp/super-reorg/api-brief.md, temporaire) : les 22 pages + README. Ancres héritées renommées (composants : preparation-ou-render, un-composant-sans-store, un-composant-pour-un-effet-de-bord, les-outils-d-un-composant, mounted-et-unmounted ; faq : selecteurs-sur-le-contrat, preparation-et-render, champ-ou-render, au-montage, render-error-ou-ecran-erreur ; erreurs : render-error, ou-mettre-un-render-error ; api : api-superstore, api-superelement ; stores : le-constructeur, les-commandes). 0 lien interne cassé, llms*.txt régénérés par `npm run docs:index`. guarantees.html ne cite que des vérifications présentes dans les *.test-d.ts.
- [x] Clé inconnue dans les types d'un contrat (`command` au lieu de `commands`) refusée depuis le 2026-11-25 : `KnownKeys<T>` dans le paramètre du constructeur de SuperContract, erreur sur `super({ name })`. Testé (classes.test-d.ts), doc à jour (contracts.html, guarantees.html).
- [x] HMR des composants (2026-11-25) : chaque tag est défini une fois avec une classe relais (`relays` dans element.ts) dont le prototype pointe sur la version courante ; `construct` fait `Reflect.construct(relay.current, [], Relay)` (un parent non rechargé qui tient l'ancienne classe obtient la nouvelle ; les anciennes versions restent acceptées par define). `hotReplace(classes, { privateFields })` (exporté par `@super-ts/dom/internal`, nouvel alias dans vite.config.ts et les deux tsconfig) : swap du prototype + re-rendu des éléments affichés (état gardé) ; rechargement complet si les champs diffèrent (noms + code des fonctions, clés `_$` de lit ignorées), si champs #privés, ou si la sonde plante. Le plugin Vite (`hotModuleCode`) ajoute en fin de module @components, en dev seulement (`command === 'serve'`, pas en mode test), `import.meta.hot.accept()` + l'appel. Vérifié dans Chrome (playwright-core dans /tmp) : écran et enfant remplacés à chaud avec état gardé, champ ajouté → rechargement. Absent du build. Doc : architecture.html#remplacement-a-chaud, limitations.html.
- [x] `reactive()` tranché (2026-11-25) : sélecteur sans paramètre `this.reactive(this.cart.selectors.lines)`, ou fonction `this.reactive(() => this.cart.selectors.quantity(this.props.sku))`. Règle : la fonction renvoie la valeur d'UN sélecteur telle quelle ; condition et calcul se font dans render (ex. `${this.props.show ? this.count.value : 0}`). Vérifié à la compilation : les sélecteurs vus d'un composant (`ElementSelectors`) renvoient `Selected<T>` (T & marque fantôme portant T), `reactive<R extends SelectorValue>` et `.value` est `Unselected<R>` (type exact). `null`/`undefined` ne portent pas de marque → vérifiés à l'exécution : le résultat doit être l'une des valeurs renvoyées par un sélecteur pendant le calcul. Recalculé à chaque rendu donc suit les props. La marque n'existe que côté composant (pas sur `this.selectors` du store ni sur le handle).
- [x] `this.router` (2026-11-25, demandé) : getter protected sur SuperElement, vue créée au 1er accès (lisible dans render ; résolue tout de suite si déjà monté, sinon au montage), un composant qui ne le lit pas se monte sans router. `this.contract('router')` refusé (type `StoreContractName` = ContractName sans 'router', + erreur runtime). Type `AppRouterView<N = 'router'>` : DOIT rester générique, sinon boucle de types (écrans du router → this.router → Contracts['router']) et sélecteurs vides en silence. RouterOutlet lit `this.router` casté. Démo migrée, 243 tests verts.
- [x] Doc `this.router` à jour (2026-11-25) : plus aucune mention de `this.contract('router')` sauf comme refus (router.html, guarantees.html) ; lignes `this.router` ajoutées aux tableaux d'api.html et components.html.
