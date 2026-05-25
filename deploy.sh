#!/bin/bash
set -e

APP_SOURCE="/var/www/wnraudit/app/source"
export BASE_PATH="${BASE_PATH:-/wnraudit/app/}"
export FRONTEND_BASE_URL="${FRONTEND_BASE_URL:-https://wnrtecnologia.com.br/wnraudit/app}"

if [ ! -f "$APP_SOURCE/.env" ]; then
  echo "==> $APP_SOURCE/.env nao encontrado. Criando .env isolado a partir de .env.example..."
  cp "$APP_SOURCE/../.env.example" "$APP_SOURCE/.env"
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
  corepack enable
fi
pnpm install --frozen-lockfile

echo "==> Build de producao..."
NODE_ENV=production pnpm run build

echo "==> Reiniciando servico wnraudit-api..."
sudo systemctl restart wnraudit-api

echo "==> Verificando saude da API..."
sleep 3
curl -sf http://127.0.0.1:8080/api/healthz || (echo "ERRO: API nao respondeu apos restart" && exit 1)

echo "==> Configurando Nginx para /wnraudit/app..."
NGINX_FILE="/etc/nginx/sites-available/wnrtecnologia"
AUDIT_PUBLIC_DIR="$APP_SOURCE/artifacts/wnr-audit/dist/public"
if [ ! -f "$AUDIT_PUBLIC_DIR/index.html" ]; then
  echo "ERRO: build do frontend nao encontrou $AUDIT_PUBLIC_DIR/index.html"
  exit 1
fi

if [ ! -f "$NGINX_FILE" ]; then
  echo "ERRO: arquivo do Nginx nao encontrado em $NGINX_FILE"
  exit 1
fi

sudo cp "$NGINX_FILE" "$NGINX_FILE.bak.$(date +%Y%m%d%H%M%S)"
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
target = None
for match in server_matches:
    open_brace = text.find("{", match.start())
    close_brace = find_matching_brace(text, open_brace)
    if close_brace == -1:
        continue
    server_text = text[match.start() : close_brace + 1]
    if "wnrtecnologia.com.br" in server_text or "4.228.218.45" in server_text:
        target = (match.start(), close_brace)
        break

if target is None:
    raise SystemExit("Nao encontrei o bloco server do wnrtecnologia para inserir o WNR Audit.")

start, close = target
server_text = text[start : close + 1]
patterns = [
    r"\n\s*location = /wnraudit/app \{[\s\S]*?\n\s*\}",
    r"\n\s*location \^~ /wnraudit/app/api/ \{[\s\S]*?\n\s*\}",
    r"\n\s*location \^~ /wnraudit/app/ \{[\s\S]*?\n\s*\}",
    r"\n\s*location = /wnraudit-app-index\.html \{[\s\S]*?\n\s*\}",
]
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
sudo nginx -t
sudo systemctl reload nginx
curl -sfI -H "Host: wnrtecnologia.com.br" http://127.0.0.1/wnraudit/app/ >/dev/null || (echo "ERRO: Nginx nao serviu /wnraudit/app/" && exit 1)

echo "==> Deploy WNR-Audit concluido com sucesso."
