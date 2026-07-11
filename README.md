# server-monitor

Moniteur de serveur ultra-léger construit avec **une seule techno : [Deno](https://deno.com)**
(TypeScript). Il se compile en **un binaire autonome** : rien à installer sur le serveur —
ni runtime, ni paquet, ni base de données.

## Ce que ça affiche

Dashboard **plein écran, sans défilement** — 7 métriques, rien d'autre :

- **CPU** — jauge en arc de ticks + historique 2 min en matrice de points
- **RAM** — % utilisé, Go utilisés / totaux + historique
- **Disk** — % utilisé du volume courant, barre de points
- **Uptime** — durée + date de démarrage
- **Network speed** — débit ↓↑ en direct + historique
- **Traffic** — octets ↓↑ cumulés depuis le boot
- **OS** — version, architecture, hostname, runtime

## Installer sur un serveur Linux

**Un seul fichier à copier.** Depuis une machine où le binaire est compilé
(voir « Compiler » ci-dessous) :

```bash
scp dist/server-monitor-linux-x64 utilisateur@IP_DU_SERVEUR:~/server-monitor-bin
```

Puis sur le serveur :

```bash
chmod +x ~/server-monitor-bin
./server-monitor-bin
```

C'est tout — le dashboard est sur `http://IP_DU_SERVEUR:3000` (les URL exactes
s'affichent au démarrage ; port via `PORT`, interface via `HOST`).

### Lancer au démarrage (systemd)

```bash
sudo mkdir -p /opt/server-monitor
sudo mv ~/server-monitor-bin /opt/server-monitor/server-monitor
sudo chmod 755 /opt/server-monitor/server-monitor

sudo tee /etc/systemd/system/server-monitor.service > /dev/null <<'EOF'
[Unit]
Description=server-monitor
After=network.target

[Service]
ExecStart=/opt/server-monitor/server-monitor
Environment=HOST=127.0.0.1
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now server-monitor
```

> `HOST=127.0.0.1` = port 3000 invisible de l'extérieur, prévu pour passer par nginx
> ci-dessous. Pour exposer directement le port : retirez cette ligne et
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

## Compiler / développer

Prérequis : [Deno](https://docs.deno.com/runtime/getting_started/installation/) ≥ 2.1
(un binaire lui aussi — `curl -fsSL https://deno.land/install.sh | sh`).

```bash
deno task dev                # lancer depuis les sources
deno task compile:linux      # binaire Linux x86_64  → dist/
deno task compile:linux-arm  # binaire Linux ARM64   → dist/
deno task compile:windows    # binaire Windows       → dist/
```

La compilation croisée fonctionne depuis n'importe quel OS (le dashboard HTML est
embarqué dans le binaire).

## Comment ça marche

- `main.ts` échantillonne chaque seconde : CPU (`/proc/stat` sous Linux), RAM,
  disque (`statfs`), réseau (`/proc/net/dev` sous Linux, `netstat` sinon), et garde
  2 minutes d'historique en mémoire
- `/api/stats` renvoie le tout en JSON
- `public/index.html` (autonome, aucun asset externe) rafraîchit toutes les 2 s

C'est tout. ~550 lignes au total.

## Stack

| Techno | Rôle |
|---|---|
| Deno (TypeScript, API natives + compat `node:os`/`node:fs`) | serveur + collecte + compilation en binaire |
| HTML/CSS/JS vanilla (un seul fichier, embarqué dans le binaire) | dashboard |

Aucune dépendance externe, aucun `npm install`, aucun build web.

## Licence

[MIT](LICENSE)
