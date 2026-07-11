#!/usr/bin/env bash
# server-monitor — installation en une commande (Ubuntu/Debian avec systemd)
#
#   Version Python (rien à installer) :   sudo bash install.sh
#   Version binaire Go (~5 Mo de RAM) :   sudo bash install.sh --binary
#     (le binaire dist/server-monitor-linux-<arch> doit être à côté du script,
#      compilé avec : go build — voir README)
#   Ou à distance (repo public requis) :
#     curl -fsSL https://raw.githubusercontent.com/Simon256px/server-monitor/main/install.sh | sudo bash
#
# Installe dans /opt/server-monitor + service systemd "server-monitor".
# Par défaut le port 3000 n'écoute qu'en local (HOST=127.0.0.1), prévu pour nginx.
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/Simon256px/server-monitor/main"
DEST="/opt/server-monitor"
MODE="python"
[ "${1:-}" = "--binary" ] && MODE="binary"

[ "$(id -u)" -eq 0 ] || { echo "Lancez avec sudo : sudo bash install.sh"; exit 1; }
command -v systemctl >/dev/null || { echo "systemd requis"; exit 1; }

mkdir -p "$DEST/public"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"

if [ "$MODE" = "binary" ]; then
  case "$(uname -m)" in
    x86_64) SUF="x64" ;;
    aarch64) SUF="arm64" ;;
    *) echo "architecture $(uname -m) non gérée — utilisez la version Python"; exit 1 ;;
  esac
  BIN=""
  for c in "$DIR/dist/server-monitor-linux-$SUF" "$DIR/server-monitor-linux-$SUF"; do
    [ -f "$c" ] && BIN="$c" && break
  done
  [ -n "$BIN" ] || { echo "binaire server-monitor-linux-$SUF introuvable à côté du script"; exit 1; }
  echo "-> installation du binaire ($BIN)"
  cp "$BIN" "$DEST/server-monitor"
  chmod 755 "$DEST/server-monitor"
  EXEC="$DEST/server-monitor"
else
  command -v python3 >/dev/null || { echo "python3 introuvable (il est pourtant inclus dans Ubuntu/Debian)"; exit 1; }
  if [ -f "$DIR/server.py" ]; then
    echo "-> installation depuis la copie locale ($DIR)"
    cp "$DIR/server.py" "$DEST/server.py"
    cp "$DIR/public/index.html" "$DEST/public/index.html"
  else
    echo "-> téléchargement depuis GitHub"
    curl -fsSL "$REPO_RAW/server.py" -o "$DEST/server.py"
    curl -fsSL "$REPO_RAW/public/index.html" -o "$DEST/public/index.html"
  fi
  chmod 644 "$DEST/server.py" "$DEST/public/index.html"
  EXEC="$(command -v python3) $DEST/server.py"
fi

cat > /etc/systemd/system/server-monitor.service <<EOF
[Unit]
Description=server-monitor
After=network.target

[Service]
ExecStart=$EXEC
Environment=HOST=127.0.0.1
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now server-monitor
sleep 2

if curl -fsS http://127.0.0.1:3000/api/stats >/dev/null 2>&1; then
  echo "OK  server-monitor tourne (service systemd actif, demarre au boot)"
else
  echo "!!  le service ne repond pas encore — diagnostic : journalctl -u server-monitor -n 20"
  exit 1
fi

cat <<'NGINX'

Dernière étape (manuelle) — exposer via nginx, dans le bloc server { ... } de votre site :

    location /monitor/ {
        proxy_pass http://127.0.0.1:3000/;
    }
    location = /monitor { return 301 /monitor/; }

puis :  sudo nginx -t && sudo systemctl reload nginx
   ->  http://votre-serveur/monitor/

(Pour exposer directement le port 3000 sans nginx : supprimez la ligne
 Environment=HOST=127.0.0.1 du service, puis
 sudo systemctl daemon-reload && sudo systemctl restart server-monitor
 et sudo ufw allow 3000/tcp)
NGINX
