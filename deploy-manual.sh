#!/bin/bash
# Deploy manual para VPS quando o GitHub Actions runner nao esta disponivel.
# Uso: bash deploy-manual.sh
# Requer: plink.exe (PuTTY) em PATH ou ajustar PLINK abaixo.
#
# Alternativa SSH: ssh adminwti@4.228.218.45 -p 22 'bash -s' < deploy-manual.sh

set -e
WORKSPACE=/home/adminwti/actions-runner/_work/wnraudit/wnraudit
APP=$WORKSPACE/source

echo "==> Atualizando codigo..."
cd $WORKSPACE
git fetch origin main
git reset --hard origin/main
git log --oneline -3

echo "==> Schema migration..."
DBURL=$(grep '^DATABASE_URL=' $APP/.env | cut -d= -f2-)
psql "$DBURL" <<SQL
ALTER TABLE phishing_employees ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES microsoft_tenants(id) ON DELETE SET NULL;
ALTER TABLE phishing_campaigns ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES microsoft_tenants(id) ON DELETE SET NULL;
SQL
echo "==> Schema OK."

echo "==> Build frontend (vite)..."
BASE_PATH=/wnraudit/app/ FRONTEND_BASE_URL=https://wnrtecnologia.com.br/wnraudit/app NODE_ENV=production \
  $APP/artifacts/wnr-audit/node_modules/.bin/vite build --config $APP/artifacts/wnr-audit/vite.config.ts

echo "==> Build API..."
cd $APP/artifacts/api-server
NODE_ENV=production node ./build.mjs

echo "==> Copiando frontend..."
DIST=$APP/artifacts/wnr-audit/dist/public
sudo cp -r "$DIST/." /var/www/wnraudit/public/
sudo chown -R www-data:www-data /var/www/wnraudit/public/

echo "==> Copiando API para producao..."
# O servico systemd usa /var/www/wnraudit/app/source/artifacts/api-server/dist/
# (WorkingDirectory no unit file), nao o workspace do runner.
API_PROD=/var/www/wnraudit/app/source/artifacts/api-server
sudo cp -r $APP/artifacts/api-server/dist/. $API_PROD/dist/
sudo chown -R adminwti:adminwti $API_PROD/dist/

echo "==> Reiniciando API..."
sudo systemctl restart wnraudit-api
sleep 3
curl -sf http://127.0.0.1:8080/api/healthz >/dev/null 2>&1 && echo "==> API OK." || { echo "AVISO: API nao respondeu:"; sudo journalctl -u wnraudit-api -n 20 --no-pager; }
echo "==> Deploy concluido. Commit: $(cd $WORKSPACE && git rev-parse --short HEAD)"
