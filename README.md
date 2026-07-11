# server-monitor

Moniteur de serveur ultra-léger, **zéro dépendance** — un fichier Node.js + un dashboard HTML.

## Prérequis

**Node.js ≥ 18.15**. C'est tout — pas de npm install, pas de base de données, pas de framework.

## Installation

```bash
git clone https://github.com/Simon256px/server-monitor.git
cd server-monitor
node server.js
```

Pas de git ? Télécharger le [ZIP](https://github.com/Simon256px/server-monitor/archive/refs/heads/main.zip), extraire, puis `node server.js`.

## Ce que ça affiche

Dashboard **plein écran, sans défilement** — 7 métriques, rien d'autre :

- **CPU** — jauge en arc de ticks + historique 2 min en matrice de points
- **RAM** — % utilisé, Go utilisés / totaux + historique
- **Disk** — % utilisé du volume courant, barre de points
- **Uptime** — durée + date de démarrage
- **Network speed** — débit ↓↑ en direct + historique
- **Traffic** — octets ↓↑ cumulés depuis le boot
- **OS** — version, architecture, hostname, version Node

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

- `server.js` échantillonne CPU/RAM chaque seconde (`os.cpus()`), le disque via `fs.statfs` et le réseau via `netstat` / `/proc/net/dev` (natif Windows · Linux · macOS)
- `/api/stats` renvoie le tout en JSON, avec 2 minutes d'historique
- `public/index.html` (autonome, aucun asset externe) rafraîchit toutes les 2 s

C'est tout. ~500 lignes au total.
