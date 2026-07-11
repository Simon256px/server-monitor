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

### Variante binaire compilé (Go) — encore plus sobre

Même dashboard, même API, mais **un seul binaire statique** (~6 Mo sur disque,
~8-12 Mo de RAM au lieu de ~15 Mo pour Python). À compiler une fois sur n'importe
quelle machine avec [Go](https://go.dev/dl/) installé (compilation croisée intégrée) :

```bash
# binaire pour serveur Linux x86_64 (dist/server-monitor-linux-x64)
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w" -o dist/server-monitor-linux-x64 .
# pour ARM64 : GOARCH=arm64 → dist/server-monitor-linux-arm64
```

Puis même installation, avec le drapeau `--binary` :

```bash
scp -r server-monitor utilisateur@IP_DU_SERVEUR:~/    # le dossier avec dist/
sudo bash ~/server-monitor/install.sh --binary
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

### Sur un sous-domaine dédié (ex. `monitor.exemple.com`)

Plus propre quand on a déjà d'autres sites sur le serveur : le moniteur a son
propre nom, son propre certificat, et ne touche pas aux configs existantes.

1. **DNS** : créez un enregistrement `A` `monitor` → l'IP du serveur.

2. **Mot de passe** (sans installer `apache2-utils`, `openssl` suffit) :
   ```bash
   printf "simon:$(openssl passwd -apr1)\n" | sudo tee /etc/nginx/.htpasswd
   ```

3. **Bloc nginx dédié** (HTTP d'abord, pour que Certbot puisse valider) :
   ```bash
   sudo tee /etc/nginx/sites-available/monitor.exemple.com > /dev/null <<'EOF'
   server {
       listen 80;
       listen [::]:80;
       server_name monitor.exemple.com;

       location / {
           proxy_pass http://127.0.0.1:3000/;
           auth_basic "server-monitor";
           auth_basic_user_file /etc/nginx/.htpasswd;
       }
   }
   EOF
   sudo ln -s /etc/nginx/sites-available/monitor.exemple.com /etc/nginx/sites-enabled/monitor.exemple.com
   sudo nginx -t && sudo systemctl reload nginx
   ```

4. **HTTPS** une fois le DNS propagé (`getent hosts monitor.exemple.com` doit
   répondre l'IP) :
   ```bash
   sudo certbot --nginx -d monitor.exemple.com
   ```

> Pièges vécus : le lien symbolique dans `sites-enabled/` doit exister sinon le
> bloc n'est jamais chargé (`ls -la /etc/nginx/sites-enabled/` pour vérifier) ;
> et testez toujours avec **`sudo nginx -t`** — sans `sudo`, on obtient un faux
> « Permission denied » sur les certificats. Vérifiez le résultat côté serveur
> avec `curl -sI https://monitor.exemple.com` : un `401` + `WWW-Authenticate`
> confirme que le moniteur répond (le reste n'est que du cache navigateur).

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
| Python 3 stdlib (déjà dans Linux) — **ou** binaire Go statique | serveur HTTP + collecte des stats |
| HTML/CSS/JS vanilla (un seul fichier, aucun asset externe) | dashboard |

Aucune installation sur le serveur, aucune dépendance, aucun build web.
Les deux implémentations exposent la même API et embarquent le même dashboard —
choisissez : Python (zéro préparation) ou Go (empreinte mémoire minimale).

## Licence

[MIT](LICENSE)
