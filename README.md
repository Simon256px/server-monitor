# server-monitor

Moniteur de serveur ultra-léger, **zéro dépendance** — un fichier Node.js + un dashboard HTML.

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

## Comment ça marche

- `server.js` échantillonne `os.cpus()` chaque seconde et garde 2 minutes d'historique en mémoire
- `/api/stats` renvoie le tout en JSON
- `public/index.html` (autonome, aucun asset externe) rafraîchit toutes les 2 s

C'est tout. ~350 lignes au total.
