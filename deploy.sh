#!/bin/bash
set -e

# APP_SOURCE vem do CI (actions/checkout) ou usa path legado como fallback
APP_SOURCE="${APP_SOURCE:-/var/www/wnraudit/app/source}"
export BASE_PATH="${BASE_PATH:-/wnraudit/app/}"
export FRONTEND_BASE_URL="${FRONTEND_BASE_URL:-https://wnrtecnologia.com.br/wnraudit/app}"

echo "==> APP_SOURCE: $APP_SOURCE"

if [ ! -f "$APP_SOURCE/.env" ]; then
  echo "==> .env nao encontrado. Criando a partir de .env.example..."
  cp "$APP_SOURCE/.env.example" "$APP_SOURCE/.env"
fi

set_env_var() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$APP_SOURCE/.env"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$APP_SOURCE/.env"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$APP_SOURCE/.env"
  fi
}

set_env_var "BASE_PATH" "$BASE_PATH"
set_env_var "FRONTEND_BASE_URL" "$FRONTEND_BASE_URL"

echo "==> Instalando dependencias..."
cd "$APP_SOURCE"
if ! command -v pnpm >/dev/null 2>&1; then
  sudo npm install -g pnpm
fi
pnpm install --frozen-lockfile

echo "==> Build de producao..."
NODE_ENV=production pnpm -r --if-present run build

echo "==> Copiando frontend para /var/www/wnraudit/public/..."
FRONTEND_DIST="$APP_SOURCE/artifacts/wnr-audit/dist/public"
if [ ! -f "$FRONTEND_DIST/index.html" ]; then
  echo "ERRO: build do frontend nao encontrou $FRONTEND_DIST/index.html"
  exit 1
fi
sudo mkdir -p /var/www/wnraudit/public
sudo cp -r "$FRONTEND_DIST/." /var/www/wnraudit/public/
sudo chown -R www-data:www-data /var/www/wnraudit/public/
echo "==> Frontend copiado para /var/www/wnraudit/public/"

echo "==> Configurando servico wnraudit-api..."
API_DIR="$APP_SOURCE/artifacts/api-server"
NODE_BIN="$(which node)"
ENV_FILE="$APP_SOURCE/.env"

sudo tee /etc/systemd/system/wnraudit-api.service > /dev/null <<SERVICE
[Unit]
Description=WNR Audit API Server
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=$API_DIR
ExecStart=$NODE_BIN --enable-source-maps ./dist/index.mjs
EnvironmentFile=$ENV_FILE
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload

echo "==> Reiniciando servico wnraudit-api..."
sudo systemctl restart wnraudit-api || true

echo "==> Configurando Nginx para /wnraudit/app..."
AUDIT_PUBLIC_DIR="/var/www/wnraudit/public"

# Auto-detectar o arquivo de configuracao nginx do dominio
NGINX_FILE=""
for candidate in \
  "/etc/nginx/sites-available/wnrtecnologia" \
  "/etc/nginx/sites-available/wnrtecnologia.com.br" \
  "/etc/nginx/conf.d/wnrtecnologia.conf" \
  "/etc/nginx/sites-available/default" \
  "/etc/nginx/nginx.conf"; do
  if sudo test -f "$candidate" && sudo grep -qE "wnrtecnologia\.com\.br|4\.228\.218\.45" "$candidate"; then
    NGINX_FILE="$candidate"
    echo "==> Nginx config encontrado em: $NGINX_FILE"
    break
  fi
done

if [ -z "$NGINX_FILE" ]; then
  echo "ERRO: Nao foi possivel encontrar o arquivo nginx que referencia wnrtecnologia.com.br"
  echo "==> Arquivos em sites-available:"
  sudo ls -la /etc/nginx/sites-available/ 2>/dev/null || true
  echo "==> Arquivos em conf.d:"
  sudo ls -la /etc/nginx/conf.d/ 2>/dev/null || true
  exit 1
fi

NGINX_BAK="$NGINX_FILE.wnraudit-bak"
sudo cp "$NGINX_FILE" "$NGINX_BAK"

sudo AUDIT_PUBLIC_DIR="$AUDIT_PUBLIC_DIR" NGINX_FILE="$NGINX_FILE" python3 - <<'PY'
from pathlib import Path
import os
import re

path = Path(os.environ["NGINX_FILE"])
public_dir = os.environ["AUDIT_PUBLIC_DIR"].rstrip("/")
text = path.read_text()

block = f"""
  location = /wnraudit/app {{
    return 301 /wnraudit/app/;
  }}

  location ^~ /wnraudit/app/api/ {{
    rewrite ^/wnraudit/app/api/(.*)$ /api/$1 break;
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }}

  location ^~ /wnraudit/app/ {{
    alias {public_dir}/;
    index index.html;
    try_files $uri $uri/ /wnraudit-app-index.html;
  }}

  location = /wnraudit-app-index.html {{
    internal;
    alias {public_dir}/index.html;
  }}

"""

def find_matching_brace(value: str, open_brace: int) -> int:
    depth = 0
    for index in range(open_brace, len(value)):
        char = value[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    return -1

server_matches = list(re.finditer(r"\bserver\s*\{", text))
targets = []
for match in server_matches:
    open_brace = text.find("{", match.start())
    close_brace = find_matching_brace(text, open_brace)
    if close_brace == -1:
        continue
    server_text = text[match.start() : close_brace + 1]
    if "wnrtecnologia.com.br" in server_text or "4.228.218.45" in server_text:
        targets.append((match.start(), close_brace))

if not targets:
    raise SystemExit("Nao encontrei o bloco server do wnrtecnologia para inserir o WNR Audit.")

print(f"Injetando em {len(targets)} bloco(s) server correspondente(s).")

patterns = [
    r"\n\s*location = /wnraudit/app \{[\s\S]*?\n\s*\}",
    r"\n\s*location \^~ /wnraudit/app/api/ \{[\s\S]*?\n\s*\}",
    r"\n\s*location \^~ o/wnraudit/app/api/ \{[\s\S]*?\n\s*\}",
    r"\n\s*location \^~ /wnraudit/app/ \{[\s\S]*?\n\s*\}",
    r"\n\s*location = /wnraudit-app-index\.html \{[\s\S]*?\n\s*\}",
]

# Processar em ordem reversa para preservar os offsets dos blocos anteriores
for start, close in reversed(targets):
    server_text = text[start : close + 1]
    for pattern in patterns:
        server_text = re.sub(pattern, "", server_text)

    location_root = re.search(r"\n\s*location\s+/(\s+)?\{", server_text)
    if location_root:
        server_text = (
            server_text[: location_root.start()]
            + block
            + server_text[location_root.start() :]
        )
    else:
        server_text = server_text[:-1] + block + "\n}"

    text = text[:start] + server_text + text[close + 1 :]

path.write_text(text)
PY

sudo ln -sf "$NGINX_FILE" /etc/nginx/sites-enabled/wnrtecnologia

echo "==> Validando configuracao nginx..."
if ! sudo nginx -t 2>&1; then
  echo "ERRO: nginx -t falhou. Restaurando backup..."
  sudo cp "$NGINX_BAK" "$NGINX_FILE"
  sudo nginx -t && sudo systemctl reload nginx
  exit 1
fi

sudo systemctl reload nginx
echo "==> Nginx recarregado com sucesso."
curl -sfL -H "Host: wnrtecnologia.com.br" http://127.0.0.1/wnraudit/app/ >/dev/null || (echo "ERRO: Nginx nao serviu /wnraudit/app/" && exit 1)

echo "==> Verificando saude da API..."
sleep 3
if curl -sf http://127.0.0.1:8080/api/healthz >/dev/null 2>&1; then
  echo "==> API respondeu com sucesso."
else
  echo "AVISO: API nao respondeu em /api/healthz. Verifique o .env e os logs:"
  sudo journalctl -u wnraudit-api -n 40 --no-pager || true
  echo "==> Frontend esta servido. Corrija o .env e reinicie: sudo systemctl restart wnraudit-api"
fi

echo "==> Deploy WNR-Audit concluido."
