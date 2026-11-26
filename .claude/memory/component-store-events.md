---
name: component-store-events
description: "Comment un composant s'abonne aux événements d'un store (this.<store>.on), ce qui existe, où c'est utilisé, et le trou connu (pas de désabonnement)"
metadata:
  node_type: memory
  type: project
  originSessionId: 33f93c49-f5be-45ab-876d-f954798962ed
  modified: 2026-11-26T13:00:35.656Z
---

État constaté le 2026-11-26 : c'est prévu et utilisé.

- API : `this.cart.on('emptied' | 'add:done' | 'add:failed', listener)` (`ContractView.on`, packages/dom/src/element.ts ~l.124 et ~l.544). Typé par le contrat : événements `emit` du contrat + cycle de vie des commandes `nom:done` `{ input, result }` / `nom:failed` `{ input, reason, error }`.
- Posé dans le constructeur : mis en attente, rejoué à chaque montage. Posé une fois monté (gestionnaire, `mounted`) : vit jusqu'au démontage, pas reposé ensuite. Interdit pendant `render` (erreur runtime). Désabonnement automatique via l'AbortSignal du composant. Erreur d'écouteur → `onError`, phase `'listener'`.
- Un store écoute un autre store pareil (`cart.on(...)` dans le constructeur de CheckoutStore), arrêté à son `dispose()`.
- Usages démo : shop/index.super (emptied, add:done), profile/index.super (save:done), kit/forms.super (notices sur save:done / reset:done). Doc : components.html, stores.html, forms.html.
- Règle de conception : `on` pour un fait ponctuel (notification, navigation après sauvegarde) ; l'affichage de l'état passe par les sélecteurs lus dans render.

Trou connu : côté composant `on` renvoie `void` (le `on` du store renvoie `Unsubscribe`). Impossible de retirer un écouteur avant le démontage. Piste si un cas réel apparaît : renvoyer `Unsubscribe` ou accepter `{ signal }`.

Lié : [[class-api-migration]], [[props-emits-without-generic]].
