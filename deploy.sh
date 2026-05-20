#!/bin/bash
set -e

APP_SOURCE="/var/www/audit/app/source"

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
