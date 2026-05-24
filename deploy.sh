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
pnpm install --frozen-lockfile

echo "==> Build de producao..."
NODE_ENV=production pnpm run build

echo "==> Reiniciando servico wnraudit-api..."
sudo systemctl restart wnraudit-api

echo "==> Verificando saude da API..."
sleep 3
curl -sf http://127.0.0.1:8080/api/healthz || (echo "ERRO: API nao respondeu apos restart" && exit 1)

echo "==> Deploy WNR-Audit concluido com sucesso."
