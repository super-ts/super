<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo-light.svg" alt="Super." width="260" />
  </picture>
</p>

Un framework front minimaliste, typé de bout en bout. Il encadre trois choses, les **stores**, les **composants** et le **routing**, et laisse tout le reste à ton projet.

Avec Super, l'IDE connaît le body de chaque commande, le payload de chaque événement et les paramètres de chaque route. Un lien sans son paramètre, un écran aux mauvaises props, une commande inconnue ou une faute dans un template ne compilent pas.

> Statut : draft exploratoire. L'API peut encore bouger, et les paquets ne sont pas publiés sur npm.

## En un coup d'œil

```ts
// src/@core/counter/contract.ts : ce qu'on lit, ce qu'on demande, ce qu'on écoute
type CounterState = { counts: Readonly<Record<string, number>> };

export class CounterContract extends SuperContract<{
  state: CounterState;
  commands: { increment(input: { id: string }): Outcome<{ count: number }, 'storage'> };
}> {
  constructor() {
    super({ name: 'counter' });
  }
  count(s: CounterState, id: string) {
    return s.counts[id] ?? 0;
  }
}

// src/@core/counter/store.ts : l'implémentation, et le seul endroit où l'on attend
export class CounterStore extends SuperStore<CounterContract> implements Commands<CounterStore> {
  #repository: CounterRepository;

  constructor({ repository }: { repository: CounterRepository }) {
    super({ contract: 'counter', initialState: { counts: {} } });
    this.#repository = repository;
  }

  async increment({ id }: { id: string }) {
    const count = this.selectors.count(id) + 1;
    await this.#repository.save(id, count).catch(() => this.fail('storage'));
    this.set((s) => ({ counts: { ...s.counts, [id]: count } }));
    return { count }; // Super publie increment:done, ou increment:failed avec la raison
  }
}
```

Un composant s'écrit dans un fichier `.super` : du TypeScript dont les méthodes écrivent leurs éléments comme des instructions, avec `if`, `for` et `switch` au milieu du HTML. Il déclare dans sa classe son tag (`@tag`), ses props (`@prop`), ses événements (`@emit`) et, s'il en pose un, le titre de la page (`@title`). Ce qu'il prépare une fois s'y déclare aussi : les stores (`@contract`), les lectures (`@selector`), l'état local (`@state`), les formulaires (`@form`), les références (`@ref`) et les écouteurs (`@on`).

```tsx
// src/@components/shared/counter-button.super : demande le store par son nom, n'attend jamais
import { SuperElement } from '@super-ts/dom';

export class CounterButton extends SuperElement {
  @tag = 'counter-button';
  @prop counterId: string;
  @contract counter;
  @selector count = () => this.counter.selectors.count(this.counterId);

  render() {
    <button on:click={() => this.counter.send('increment', { id: this.counterId })}>{this.count.value}</button>
  }
}
```

## Pourquoi Super

- **Le contrat est la seule porte d'un store.** Un composant demande le store par le nom de son contrat (`@contract counter;`), lit par les sélecteurs, envoie des commandes et écoute des événements, rien d'autre. Il se teste donc avec un faux store.
- **La vue envoie et laisse filer.** Une commande ne renvoie rien à l'appelant. Le store fait le travail asynchrone ; Super suit chaque commande (« en cours », réussie, échouée avec une raison typée) et publie son issue.
- **Préparer, puis afficher.** Les déclarations d'un composant préparent une fois (stores, état local, lectures, écouteurs), `render` affiche à chaque rendu. On ne peut pas créer d'abonnement pendant le rendu par erreur.
- **On ne re-rend que ce qu'on affiche.** Un composant se re-rend seulement si la valeur qu'il lit a changé.
- **Une architecture minimale, vérifiée.** Deux dossiers imposés (`src/@core/`, `src/@components/`), et le plugin Vite refuse ce qui sort du cadre. Tout le reste reste à toi.
- **Des templates typés.** Dans un `.super`, une balise inconnue, une prop manquante ou mal typée, un événement que l'enfant n'émet pas ou un objet affiché par erreur sont des erreurs de compilation, signalées dans l'éditeur et par `npm run typecheck`.
- **Le titre de la page suit les données.** ``@title = () => `Compteur ${this.label.value}`;`` est recalculé à chaque rendu ; le dernier composant monté qui pose un titre l'emporte, et le précédent revient à son démontage.
- **Le standard web d'abord.** Un store est un `EventTarget`, un composant est un custom element. Les `.super` sont compilés vers lit-html, sans que tu l'importes jamais. L'app d'exemples complète (six exemples) pèse 24,6 Ko gzip, lit-html compris.

## Démarrer

```bash
npm install
npm run dev        # l'app d'exemples (examples/demo) sur http://localhost:5173
npm test           # les tests (Vitest, happy-dom)
npm run typecheck  # super-tsc : les types des .ts et des .super
npm run lint       # Biome (ordre des imports, formatage) et formatage des .super
npm run format     # formate tout (.ts par Biome, .super par le formateur des .super)
npm run check      # lint, typecheck, tests, puis index de la doc
npm run docs       # la documentation sur http://localhost:5174
```

Les paquets sont des workspaces npm (`packages/*`). Dans ce dépôt, `@super-ts/…` se résout vers les sources (`packages/*/src`), sans build : par les alias de `tsconfig.json` et `vite.config.ts` dans l'app et les tests, et par la condition d'export `@super-ts/source` pour Node (le `.npmrc` la passe à tous les scripts npm, et Vite charge sa config avec `--configLoader native` pour en profiter). Lance donc Vite et Vitest par `npm run …`.

Pour les erreurs et la complétion dans les `.super`, branche ton éditeur sur le serveur de langage de `packages/lang-server`. Sous Zed, installe l'extension de `editors/zed` comme extension de développement (`zed: install dev extension`). Voir [Outillage](docs/tooling.html).

La grammaire Tree-sitter des `.super`, utilisée par l'extension Zed, vit dans son propre dépôt : [super-ts/tree-sitter-super](https://github.com/super-ts/tree-sitter-super). Elle est branchée ici en sous-module, dans `editors/tree-sitter-super` : clone avec `git clone --recurse-submodules`, ou lance `git submodule update --init` après coup.

## Documentation

La documentation est un site statique dans [`docs/`](docs/index.html). Ouvre `docs/index.html` dans un navigateur, ou lance `npm run docs`. Elle a une recherche intégrée (touche `/`).

- [Démarrer](docs/getting-started.html) : ta première fonctionnalité, du contrat au test.
- [Exemples](docs/examples.html) : ce que montre chaque fichier de l'app d'exemples.
- [Architecture](docs/architecture.html) : ce que Super impose, ce qui reste à toi.
- [Commandes et événements](docs/commands-and-events.html) : le trajet d'une action, du clic à l'écran.
- [Composants](docs/components.html) : préparation et `render`, et où mettre quoi.
- [Templates](docs/templates.html) : la syntaxe des fichiers `.super` ; et [Outillage](docs/tooling.html) : `super-tsc`, serveur de langage, éditeur, Vite.
- [Router](docs/router.html) : chemins typés, redirections, guards ; et [Gérer les erreurs](docs/errors.html).
- [Formulaires](docs/forms.html) : tous les types de champs, règles, vérifications asynchrones, listes, erreurs du serveur.
- [Questions fréquentes](docs/faq.html) et [API](docs/api.html).
- [Limites](docs/limitations.html).
- [Chantiers et questions ouvertes](docs/roadmap.html).

### Pour un LLM ou un agent de code

La doc existe aussi en markdown, au format [llms.txt](https://llmstxt.org) :

- [`docs/llms.txt`](docs/llms.txt) : l'index, une ligne par page.
- [`docs/llms-full.txt`](docs/llms-full.txt) : toute la doc en un fichier, code compris.
- [`docs/llms-small.txt`](docs/llms-small.txt) : la même, sans la FAQ, le catalogue des exemples ni les renvois vers l'app d'exemples, pour les petites fenêtres de contexte.

Ces fichiers sont générés à partir des pages HTML, comme l'index de recherche. Pour retirer un passage de la version courte, marque-le `data-llm="skip"` dans le HTML (voir `docs/tools/llms.mjs`).

L'index de recherche et les fichiers pour les LLM se régénèrent à chaque `npm run check` (ou `npm run docs:index`). `npm run docs:check` échoue s'ils ne sont plus à jour, et la génération échoue si une page contient une balise HTML que le convertisseur ne sait pas traduire.

## Le dépôt

```
packages/core      SuperContract, SuperStore : contrats, sélecteurs, stores
packages/dom       SuperElement, rendu, createApp, router
packages/testing   mount, fakeStore, record
packages/ui        le kit d'interface @super-ts/ui : champs reliés aux formulaires, CommandButton, RouteLink, fenêtres, table…
packages/vite      le plugin : compilation des .super, règles d'architecture, alias @core / @components, contracts.d.ts
packages/lang      le langage .super : parser, compilation vers lit, TS virtuel, super-tsc (SPEC.md)
packages/lang-server  le serveur de langage des .super (Volar sur TypeScript 6)
packages/lint      la configuration Biome (ordre des imports)
examples/demo      l'app d'exemples : compteurs, formulaire, boutique, erreurs, widget, composition, kit
editors/zed        l'extension Zed des .super (langage « Super » et lancement du serveur de langage)
editors/tree-sitter-super  la grammaire Tree-sitter des .super (sous-module, dépôt super-ts/tree-sitter-super)
docs/              le site de documentation et les fichiers llms*.txt (docs/tools : génération de l'index et des llms*.txt)
```
