# server-monitor

Moniteur de serveur ultra-léger, **zéro dépendance** — un fichier Node.js + un dashboard HTML.

## Prérequis

**Node.js ≥ 18**. C'est tout — pas de npm install, pas de base de données, pas de framework.

## Installation

```bash
git clone https://github.com/Simon256px/server-monitor.git
cd server-monitor
node server.js
```

Pas de git ? Télécharger le [ZIP](https://github.com/Simon256px/server-monitor/archive/refs/heads/main.zip), extraire, puis `node server.js`.

## Ce que ça affiche

- **Jauge CPU** en temps réel (arc de ticks, style rétro-terminal)
- **Mémoire** utilisée / libre / totale
- **Historique 2 minutes** (CPU, mémoire, cœur le plus chargé) en matrice de points
- Tendances ↑↓ sur la dernière minute, uptime, infos machine

## Lancer

```bash
node server.js
```

Puis ouvrir **http://localhost:3000** (port configurable via `PORT`).

## Stack

| Techno | Rôle |
|---|---|
| Node.js (modules natifs `http`, `os`, `fs`) | serveur + collecte des stats |
| HTML/CSS/JS vanilla (un seul fichier, aucun asset externe) | dashboard |

Aucune dépendance npm, aucun build, aucun service tiers.

## Comment ça marche

- `server.js` échantillonne `os.cpus()` chaque seconde et garde 2 minutes d'historique en mémoire
- `/api/stats` renvoie le tout en JSON
- `public/index.html` (autonome, aucun asset externe) rafraîchit toutes les 2 s

C'est tout. ~350 lignes au total.
