---
name: brand-logo
description: "logo « Super. » et favicon « S. », choix de police et couleurs, limites des chemins relatifs (2026-11-26)"
metadata:
  node_type: memory
  type: project
  originSessionId: f4d068a8-2f10-4d8f-994a-646ecf30254e
  modified: 2026-11-26T16:07:28.578Z
---

Logo validé par l'utilisateur le 2026-11-26 : « Super. » avec point lavande, favicon « S. ». L'utilisateur préfère des lettres blanches avec liseré sombre plutôt que du texte noir sur fond clair.

- Police : le site est en system-ui, mais le logo est vectorisé en Inter Bold (OFL) ; SF Pro exclu pour raison de licence.
- Couleurs : point toujours #c4b5fd (rgb(196,181,253), choix de l'utilisateur). Version sombre : texte #e6e8eb plein. Version claire et favicon : blanc avec liseré #1f2328 (paint-order stroke), point lavande toujours sans liseré (demande explicite), agrandi d’un demi-trait pour garder sa masse ; lettres un peu espacées.
- Favicon SVG sur fond transparent ; apple-touch-icon et icon-512 sur fond blanc (iOS noircit le transparent).
- Le favicon a un point agrandi (~13 % de la hauteur du S) pour rester lisible à 16 px.
- Sources dans `assets/` à la racine ; copies dans `docs/assets/`, `examples/demo/public/` et `assets/` du sous-module tree-sitter-super (dépôt publié à part, chemin relatif impossible). Le script de génération était temporaire (opentype.js + resvg), non versionné.

**Why:** les README pointent en chemins relatifs (`assets/…`, `../../assets/…`).
**How to apply:** à la publication npm ou de l'extension Zed hors du dépôt, passer en URL absolues (raw GitHub) ; voir [[publication-plan]]. Les paquets n'ont pas encore de README.
