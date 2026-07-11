# server-monitor

Moniteur de serveur ultra-léger qui n'utilise **que ce qui est déjà dans Linux** :
Python 3 (préinstallé sur Ubuntu/Debian) et sa bibliothèque standard.
**Rien à installer** — ni runtime, ni paquet, ni dépendance. Deux fichiers.

## Ce que ça affiche

Dashboard **plein écran, sans défilement** — 7 métriques, rien d'autre :

- **CPU** — jauge en arc de ticks + historique 2 min en matrice de points
- **RAM** — % utilisé, Go utilisés / totaux + historique
- **Disk** — % utilisé du volume racine, barre de points
- **Uptime** — durée + date de démarrage
- **Network speed** — débit ↓↑ en direct + historique
- **Traffic** — octets ↓↑ cumulés depuis le boot
- **OS** — distribution, architecture, hostname, version Python

## Installer sur un serveur Linux

Rien à installer : Python 3 est déjà sur le serveur (`python3 --version`).

### En une commande (recommandé)

Copiez le dossier sur le serveur, puis lancez le script :

```bash
# depuis votre machine
scp -r server-monitor utilisateur@IP_DU_SERVEUR:~/

# sur le serveur
sudo bash ~/server-monitor/install.sh
```

Le script installe dans `/opt/server-monitor`, crée le service systemd
(démarrage au boot, redémarrage auto), vérifie que l'API répond et affiche
le bloc nginx à ajouter. Si le repo est public, encore plus court —
directement sur le serveur :

```bash
curl -fsSL https://raw.githubusercontent.com/Simon256px/server-monitor/main/install.sh | sudo bash
```

### À la main — tester sans rien installer

```bash
python3 server.py
```

C'est tout — le dashboard est sur `http://IP_DU_SERVEUR:3000` (les URL exactes
s'affichent au démarrage ; port via `PORT`, interface via `HOST`).

### À la main — lancer au démarrage (systemd)

```bash
sudo mkdir -p /opt/server-monitor
sudo cp ~/server.py /opt/server-monitor/
sudo cp -r ~/public /opt/server-monitor/

sudo tee /etc/systemd/system/server-monitor.service > /dev/null <<'EOF'
[Unit]
Description=server-monitor
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/server-monitor/server.py
Environment=HOST=127.0.0.1
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now server-monitor
```

> `HOST=127.0.0.1` = port 3000 invisible de l'extérieur, prévu pour passer par
> nginx ci-dessous. Pour exposer directement le port : retirez cette ligne et
> `sudo ufw allow 3000/tcp`.

### Derrière nginx (recommandé)

Aucun port à ouvrir : nginx (déjà sur 80/443) fait le pont. Dans le bloc
`server { ... }` de votre site :

```nginx
location /monitor/ {
    proxy_pass http://127.0.0.1:3000/;
}
location = /monitor { return 301 /monitor/; }
```

Puis `sudo nginx -t && sudo systemctl reload nginx` →
dashboard sur `http://votre-domaine/monitor/`.

Pour protéger l'accès par mot de passe, ajoutez dans le bloc `location` :

```nginx
auth_basic "monitor";
auth_basic_user_file /etc/nginx/.htpasswd;   # créé avec : htpasswd -c /etc/nginx/.htpasswd simon
```

## Comment ça marche

- `server.py` (bibliothèque standard uniquement) échantillonne chaque seconde :
  CPU via `/proc/stat`, RAM via `/proc/meminfo`, disque via `shutil.disk_usage`,
  réseau via `/proc/net/dev` — et garde 2 minutes d'historique en mémoire
- `/api/stats` renvoie le tout en JSON (`http.server` de la stdlib)
- `public/index.html` (autonome, aucun asset externe) rafraîchit toutes les 2 s
- Fonctionne aussi sous Windows/macOS pour le développement (fallbacks intégrés)

C'est tout. ~600 lignes au total, Python ≥ 3.8.

## Stack

| Techno | Rôle |
|---|---|
| Python 3 stdlib (déjà dans Linux) | serveur HTTP + collecte des stats |
| HTML/CSS/JS vanilla (un seul fichier, aucun asset externe) | dashboard |

Aucune installation, aucune dépendance, aucun build.

## Licence

[MIT](LICENSE)
