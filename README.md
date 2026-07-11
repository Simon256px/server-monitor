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

## Déployer sur un serveur Linux

```bash
# 1. Node.js ≥ 18.15 (Debian/Ubuntu)
sudo apt install -y nodejs        # ou via nodesource si la version apt est trop vieille

# 2. Récupérer et lancer
git clone https://github.com/Simon256px/server-monitor.git
cd server-monitor
node server.js
```

Le serveur écoute sur **toutes les interfaces** (`0.0.0.0`) : le dashboard est
accessible sur `http://IP_DU_SERVEUR:3000`. Les URL exactes s'affichent au démarrage.
Si un pare-feu tourne : `sudo ufw allow 3000/tcp`.

### Lancer au démarrage (systemd)

```ini
# /etc/systemd/system/server-monitor.service
[Unit]
Description=server-monitor
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/server-monitor/server.js
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
```

```bash
sudo cp -r server-monitor /opt/
sudo systemctl enable --now server-monitor
```

> ⚠️ Le dashboard est en lecture seule mais sans authentification : sur un serveur
> exposé à Internet, limitez le port 3000 à votre IP (`ufw allow from VOTRE_IP to any port 3000`)
> ou placez-le derrière un reverse proxy avec auth.

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

## Licence

[MIT](LICENSE)
