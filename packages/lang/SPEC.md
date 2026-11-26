# Fichiers `.super` : spécification

Un fichier `.super` est un module TypeScript dont les méthodes de classe peuvent contenir des
éléments HTML écrits comme des instructions. Tout le reste du fichier est du TS ordinaire.

Statut : brouillon, version 0. Les points marqués « v0 » sont des limites assumées de cette
première version.

## Exemple

```tsx
import { SuperElement } from '@super-ts/dom';
import { ConfirmDialog } from '../shared/confirm-dialog';

export class ShopScreen extends SuperElement {
  @tag = 'shop-screen';
  @title = 'Boutique';
  @contract cart;
  @selector lines = this.cart.selectors.lines;

  render() {
    <main class="screen">
      <h1>Boutique</h1>
      if (this.lines.value.length === 0) {
        <p class="empty">Aucun article pour l’instant.</p>
      } else {
        <ul>
          for (const l of this.lines.value; key l.product.sku) {
            const { product } = l;
            <li>{product.label} <button on:click={() => this.cart.send('remove', { sku: product.sku })}>−</button></li>
          }
        </ul>
      }
    </main>
  }
}
```

## Déclarations d'un composant

Une classe qui étend `SuperElement` déclare dans son corps son tag, ses props, ses événements et
le titre de la page, sans générique :

```tsx
export class ConfirmDialog extends SuperElement {
  @tag = 'confirm-dialog';
  @title = 'Confirmation';
  @prop question: string;
  @prop tone: 'neutral' | 'danger' = 'neutral';
  @prop note?: string;
  @emit answered: { confirmed: boolean };
}
```

| Déclaration              | Sens                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `@tag = 'x-y';`          | Le tag du custom element. Obligatoire (sauf classe `abstract`), une chaîne avec un tiret. |
| `@title = …;`            | Le titre de la page tant que le composant est monté : une chaîne, ou une fonction suivie. |
| `@prop nom: T;`          | Une prop obligatoire, lue par `this.nom` (toujours la valeur courante).                   |
| `@prop nom?: T;`         | Une prop facultative (`T \| undefined`).                                                  |
| `@prop nom: T = valeur;` | Une prop facultative avec une valeur par défaut, calculée une fois par instance.          |
| `@emit nom: T;`          | Un événement, émis par `this.emit('nom', …)` (`void` s'il ne transporte rien).            |

- `@prop` et `@emit` sont du TS valide (des champs décorés) ; `@tag = …` et `@title = …` ne le sont
  pas : le formateur et la grammaire Tree-sitter les connaissent.
- Le compilateur en tire les types du composant (`SuperElement<{ props; emits }>`), vérifiés aux
  balises qui l'utilisent (`<ConfirmDialog question="…" on:answered={…} />`).
- Une prop ne peut pas porter le nom d'une propriété des éléments HTML (`id`, `title`, `hidden`…) :
  c'est une erreur de type. C'est pour ça que le contenu écrit entre les balises remplit `content`
  (et non `children`, propriété native).
- `this.props` reste disponible (toutes les props, en lecture seule).
- `@title = () => …` est recalculé après chaque rendu, avec les mêmes lectures que `render`
  (`@title = () => this.label.value`). Le dernier composant monté qui pose un titre l'emporte ; à
  son démontage, le titre précédent revient. Ailleurs (gestionnaire, `mounted`),
  `this.page.title = …` fait de même.
- Erreurs : tag manquant ou écrit `static tag`, générique `SuperElement<…>` écrit à la main,
  déclaration en double, prop sans type, `?` avec une valeur par défaut, déclaration hors d'un
  composant.

### Préparation : stores, lectures, état, formulaire, références, écouteurs

Ce que le composant prépare une fois (à sa construction) se déclare aussi dans le corps de sa classe :

```tsx
export class ProfileScreen extends SuperElement {
  @tag = 'profile-screen';
  @contract profile;                                   // this.contract('profile')
  @contract shop = 'catalog';                          // un autre nom de champ
  @selector saving = () => this.profile.selectors.pending('save');
  @state local = { saved: null as string | null };
  @form edit = { initial: { name: '' }, submit: { to: this.profile, command: 'save' } };
  @ref nameInput: HTMLInputElement;

  @on('profile', 'save:done')
  onSaved({ result }) {
    this.local.set({ saved: result.id });
  }
}
```

| Déclaration                        | Équivaut à                                    | Se lit par                            |
| ---------------------------------- | --------------------------------------------- | ------------------------------------- |
| `@contract cart;`                  | `cart = this.contract('cart')`                | `this.cart.selectors`, `.send`, `.on` |
| `@contract shop = 'catalog';`      | `shop = this.contract('catalog')`             | idem                                  |
| `@selector nom = …;`               | `nom = this.selector(…)`                      | `this.nom.value`                      |
| `@state nom = { … };`              | `nom = this.state({ … })`                     | `this.nom.get()`, `this.nom.set(…)`   |
| `@form nom = { … };`               | `nom = this.form({ … })`                      | `this.nom.bind()`, `.field('x')`…     |
| `@ref nom: T;`                     | `nom = this.ref<T>()`                         | `ref={this.nom}`, `this.nom.value`    |
| `@on('contrat', 'événement') m(p)` | `this.contract('contrat').on('événement', …)` | appelée à chaque événement, monté     |

- `@on` n'exige pas de `@contract` : il ouvre lui-même l'accès au contrat. Le paramètre de la méthode
  est typé par l'événement (`save:done` : `{ input, result }`). `@on('router', 'navigated')` écoute
  le router. Le nom de l'événement est écrit tel quel (pas de gabarit `` `${x}:done` ``).
- Un contrat se déclare une fois par composant ; `@contract router` est refusé (`this.router`).
- Pas de type sur `@contract`, `@selector`, `@state`, `@form` : il vient de la valeur (élargir avec
  `as`). `@ref` déclare le type de son élément et n'a pas de valeur.
- L'ordre compte comme pour des champs : un `@selector` qui lit `this.cart` vient après `@contract cart`.
- Les anciennes formes (`cart = this.contract('cart')`, `this.cart.on(…)` dans le constructeur)
  sont des erreurs dans un `.super`, avec une correction rapide qui réécrit la ligne (sauf pour les
  écouteurs).
- Dans l'éditeur, `@` propose toutes les déclarations avec un gabarit et leur documentation au
  survol ; `@contract ` propose les contrats de l'app pas encore déclarés (`@contract cart;`, ou
  `errorLog = 'error-log';` pour un nom qui n'est pas un identifiant) ; `@contract x = '…'` et
  `@on('…', '…')` complètent les noms de contrats et d'événements.

Un composant écrit dans un `.ts` garde `static tag`, le générique `SuperElement<{ props; emits }>`
et les méthodes (`this.contract(…)`, `this.selector(…)`, `this.state(…)`, `this.form(…)`,
`this.ref<T>()`, `.on(…)` dans le constructeur).

## Où peut-on écrire un élément

Un élément est une instruction : il s'écrit là où une instruction est attendue, dans le corps
d'une méthode, et il est émis à cet endroit. `render()` ne renvoie rien.

En TS, un `<` ouvre un élément quand il est suivi d'une lettre et que le jeton précédent est `{`,
`}`, `;`, ou le `:` d'un `case` / `default`, ou quand il est en début de ligne (ce qui garde le
template lisible pendant la frappe d'une ligne inachevée). Ailleurs (`a < b`, `Map<K, V>`, `<T>(x: T) => x`),
c'est du TS.

Un élément dans une expression (`const x = <p />`, `() => <p />`) n'est pas permis : on écrit
une méthode qui émet ses éléments, et on l'appelle (voir « Interpolation »).

Limite v0 : une signature d'appel générique dans un type littéral (`{ <T>(x: T): T }`) est prise
pour un élément. On la sort dans un `type` ou une `interface` d'un fichier `.ts`.

## Enfants d'un élément

Entre `<tag>` et `</tag>`, chaque enfant est l'une de ces formes.

| Forme         | Exemple                                     |
| ------------- | ------------------------------------------- |
| Texte brut    | `Total : `                                  |
| Interpolation | `{formatPrice(total)}`                      |
| Commentaire   | `{/* … */}`                                 |
| Élément       | `<strong>…</strong>`, `<br />`              |
| Condition     | `if (x) { … } else if (y) { … } else { … }` |
| Boucle        | `for (const x of xs; key x.id) { … }`       |
| Choix         | `switch (s) { case 'a': … default: … }`     |
| Déclaration   | `const { product } = line;` ou `let n = 0;` |

Le corps d'un `if`, d'un `for` ou d'un `case` suit les mêmes règles que les enfants d'un élément.

### Le texte et ses ambiguïtés

Le texte s'écrit brut. Un enfant est lu comme une instruction seulement s'il commence par :

- `if (`, `for (`, `switch (` (espaces permis avant la parenthèse) ;
- `const` ou `let`, suivi d'un nom ou d'une déstructuration, puis de `=` ;
- `else` juste après le `}` d'un `if` ;
- `case`, `default:` ou `break;` dans un `switch`.

Un texte qui commence ainsi (`for (more info) see below`) est lu comme une instruction ; s'il
n'en est pas une, c'est une erreur, avec la correction proposée : l'entourer d'accolades,
`{'for (more info) see below'}`. Le parser ne devine jamais.

Pendant la frappe, une instruction incomplète (`if (this.` sans `)` ni `{`, un bloc sans `}`) est
signalée, mais l'éditeur complète déjà dans sa condition. Cette aide n'existe que dans l'éditeur :
`super-tsc` vérifie le code tel qu'il est.

Les caractères `<`, `{` et `}` ne s'écrivent pas dans le texte : `{'<'}`, `{'{'}`, `{'}'}`.

Les espaces suivent les règles du HTML : chaque suite de blancs, retours à la ligne compris, compte
pour une espace (`contenant` puis `<code>` à la ligne suivante donne « contenant offline »). Les
blancs au début et à la fin d'un élément, d'un bloc (`if`, `for`, `case`) ou à côté d'une
instruction ne rendent rien. Deux éléments de la méthode séparés seulement par des blancs sont
séparés par une espace ; s'il y a du code entre eux, non.

### Ne rien rendre

Une méthode qui n'émet aucun élément ne rend rien : `render() {}` est l'équivalent du
`return null` de lit.

### Interpolation

`{expr}` affiche une chaîne, un nombre ou un booléen ; `null` et `undefined` n'affichent rien.
Un objet est refusé à la compilation (fini les `[object Object]`). L'appel d'une méthode qui émet
des éléments (`{this.#row(line)}`) est permis : elle ne renvoie rien, c'est accepté.

### Boucle

Seul `for…of` est accepté. `key expr`, après un `;` dans les parenthèses, identifie chaque
élément pour que le rendu suive les déplacements ; sans `key`, le rendu est positionnel.

### Choix

Chaque `case` s'arrête au `case` ou au `default` suivant, ou à la fin du `switch` : pas de
cascade d'un `case` à l'autre. `break;` est permis mais inutile. Pour un choix exhaustif, un
`default: {assertNever(x)}` suffit, TS le vérifie.

## Attributs

| Forme                  | Effet                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| `class="screen"`       | Attribut fixe                                                                |
| `href={url}`           | Attribut calculé ; `null` ou `undefined` le retire                           |
| `disabled={busy}`      | Attribut booléen (liste HTML connue) : présent si vrai                       |
| `disabled`             | Attribut booléen toujours présent                                            |
| `prop:value={v}`       | Propriété DOM plutôt qu'attribut (`el.value = v`)                            |
| `on:click={handler}`   | Écouteur ; le type de l'événement vient de la balise                         |
| `ref={this.input}`     | Référence (`@ref input: T;`) : refusée si `T` n'est pas le type de la balise |
| `{order.field('nom')}` | Directive d'élément : `form.bind()`, `form.field('nom')`                     |

Une balise sans tiret doit être une balise HTML ou SVG connue (une faute de frappe est une
erreur) ; une balise avec tiret est un élément personnalisé.

Une valeur d'attribut est une chaîne, un nombre, un booléen, `null` ou `undefined`.

`on:` sur un élément natif n'accepte que les événements de cette balise (`HTMLElementEventMap`).
Limite v0 : écouter sur un `<div>` un événement personnalisé remonté d'un enfant n'est pas permis.

Les préfixes de lit (`@click`, `?disabled`, `.value`) sont refusés, avec la forme à utiliser.

## Composants enfants

Une balise qui commence par une majuscule est une classe SuperElement en portée :

```tsx
<ConfirmDialog question="Vider le panier ?" on:answered={this.onClearAnswered} />;
```

Les attributs sont ses props, vérifiés contre ses `@prop` (prop manquante ou en trop, mauvais type) ;
`on:x` s'abonne à ses `@emit`. C'est l'équivalent de
`ConfirmDialog.create({ question }, { on: { answered } })`.

Limite v0 : pas de directive sur un composant (`<Card {…} />` est une erreur).

### Enfants et emplacements nommés

Un composant qui accepte des enfants le déclare dans ses props, avec le type `Children` de
`@super-ts/dom`, et les place où il veut par une interpolation :

```tsx
@prop heading: string;
@prop content: Children;
@prop footer?: Children;

render() {
  <section>
    <h2>{this.heading}</h2>
    {this.content}
    if (this.footer) {
      <footer>{this.footer}</footer>
    }
  </section>
}
```

- Les enfants écrits entre les balises du composant remplissent `content`.
- Un emplacement nommé est une autre prop de type `Children`, remplie de l'une de deux façons :
  par un emplacement `<:footer>…</:footer>` écrit entre les balises du composant, ou par l'appel
  d'une méthode qui émet des éléments (`footer={this.#footer()}`, une telle méthode renvoie
  `Children`).
- Tout est vérifié contre les `@prop` du composant : des enfants pour un composant qui n'en
  déclare pas, des enfants ou un emplacement obligatoires qui manquent, un emplacement inconnu.
- Un emplacement `<:nom>` se place directement dans un composant, sans attribut, une seule fois par
  nom ; `<:content>` n'existe pas (les enfants directs remplissent déjà `content`).
- Les enfants et les emplacements sont rendus dans le rendu du parent : leurs écouteurs, leurs
  lectures de store et leur état sont ceux du parent, et ils suivent son rendu. Le composant qui
  les reçoit les garde quand il se re-rend seul.
- Une liste d'emplacements (des onglets) est une prop `Children[]`, remplie par des appels de
  méthodes : `panels={[this.#profile(), this.#security()]}`.

## Éléments vides

`<br>`, `<input>`, `<img>` et les autres éléments vides HTML peuvent s'écrire sans `/>`. Tout
autre élément sans enfant s'écrit `<tag />`.

## Vérification des types

En ligne de commande, `node packages/lang/src/cli.ts <tsconfig>` (utilisé par `npm run typecheck`)
vérifie avec le TypeScript 7 du dépôt. Dans l'éditeur, `packages/lang-server` est un serveur de
langage Volar sur TypeScript 6 (Volar ne supporte pas encore TypeScript 7) : erreurs, correction
rapide « entourer d'accolades », complétion, survol, aller à la définition.

L'outillage transforme chaque fichier `.super` en TS virtuel que le compilateur vérifie, avec une
correspondance de positions pour rapporter les erreurs dans le `.super`.

- Les instructions (`if`, `for`, `switch`, déclarations) sont recopiées telles quelles.
- Chaque élément devient une suite d'appels typés à plat (`open`, `attr`, `on`, `use`, `text`)
  dans un bloc : pas de fonction fléchée, sinon TS oublierait le rétrécissement de
  `this.x.value` établi par un `if`.
- Un composant devient `Composant.create(props, { on })`, dont le typage existe déjà.
- Les déclarations des appels (`check.ts`) sont ajoutées à la fin, dans un `declare namespace __s` :
  le TS virtuel n'importe rien et se vérifie avec le tsconfig du projet tel quel.

## Compilation

Le plugin Vite (`superPlugin`) compile chaque `.super` en TS, puis oxc en retire les types. Un
import sans extension trouve un `.super` (`@components/shop` → `shop/index.super`).

- Une méthode qui contient des éléments (`render()`, `#row(item)`…) renvoie la liste de ce
  qu'elle émet. Son corps est enveloppé dans une fonction fléchée : un `return;` anticipé garde ce
  qui est déjà émis. `return x;` y est refusé à la compilation (la méthode renvoie ce qu'elle
  émet) ; une fonction imbriquée (`xs.map((x) => { return x * 2; })`) reste libre.
- Chaque élément devient un gabarit lit (`html\`…\``) ; des enfants sans instruction restent dans
  le gabarit du parent.
- Des enfants avec instructions deviennent un trou calculé : une fonction qui pousse des gabarits
  dans une liste, avec le vrai `if` / `for` / `switch`, et les déclarations telles quelles.
- `for (… ; key k)` devient `repeat` de lit (les éléments suivent les déplacements) ; sans `key`,
  une simple boucle.
- `on:x` → `@x`, `prop:x` → `.x`, `ref={r}` et `{d}` → directive d'élément, un attribut booléen
  connu → `?x`, un autre attribut calculé → `x=${v ?? nothing}`.
- Le code produit garde les numéros de ligne de la source, et le plugin fournit une source map
  (JS final → `.super`, ligne et colonne) : traces d'erreur et débogueur pointent la source.

## Types des `.super` vus depuis un `.ts`

Pour chaque `.super`, `super-tsc`, le serveur de langage (à chaque frappe) et Vite (en dev)
écrivent sous `<dossier du tsconfig>/.super/` (ignoré par git) :

- `virtual/…/index.ts` : le TS virtuel ;
- `types/…/index.d.ts` : la déclaration des exports du fichier, dont les types sont tirés du TS
  virtuel (une classe y devient `declare class X extends <la classe du TS virtuel> {}`), et
  `index.d.ts.map`, sa source map vers le `.super`.

Les tsconfig déclarent `types` dans `paths` et `rootDirs` (puis `virtual` dans `rootDirs`, pour les
imports relatifs du TS virtuel) : `routes.ts` importe `@components/shop` et en voit les types, pour
`tsc` comme pour le serveur TS de l'éditeur. Le serveur TS suit la source map de la déclaration :
« aller à la définition » depuis un `.ts` ouvre le composant `.super`.

## Formatage

`npm run format` formate les `.super` (et `npm run lint` le vérifie) : le TS par Biome, avec la
configuration du dépôt, les templates par `packages/lang/src/format.ts`. Une balise tient sur une
ligne si elle entre dans la largeur, sinon un attribut par ligne ; un composant qui reçoit des
enfants, et un emplacement `<:nom>`, s'écrivent toujours sur plusieurs lignes ; le texte suivi remplit les
lignes ; une liste d'éléments sans texte garde un élément par ligne ; les lignes vides entre
enfants sont gardées (une au plus). Une ligne n'est coupée que là où il y a déjà un blanc, ou au
bord d'un élément, d'un bloc ou d'une instruction : le rendu ne change jamais. Un fichier qui a des
erreurs de syntaxe n'est pas formaté.
