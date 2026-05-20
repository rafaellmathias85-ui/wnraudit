# WNR-Audit — Deploy em VPS Hostinger

**URL de produção:** `https://wnrtecnologia.com.br/wnraudit`
**Repositório GitHub:** `rafaellmathias85-ui/wnraudit`
**Pipeline:** VSCode → GitHub (`main`) → VPS Hostinger (self-hosted runner)

---

## Estrutura de diretórios no VPS

```
/var/www/audit/
  app/                        ← git clone do repositório (gerenciado pelo workflow)
    source/                   ← monorepo pnpm
      .env                    ← variáveis de ambiente (NÃO vai para o GitHub)
      artifacts/
        api-server/dist/      ← bundle da API (gerado no build)
        wnr-audit/dist/public ← assets estáticos do frontend (gerado no build)
    deploy.sh                 ← copiado pelo workflow para cá no git clone
    db/
  deploy.sh                   ← cópia fora do git (sobrevive ao git reset --hard)
  .env.backup                 ← backup automático do .env durante o deploy
```

---

## Conteúdo do repositório

| Caminho | O que é |
|---------|---------|
| `source/` | Código-fonte completo (monorepo pnpm) |
| `deploy.sh` | Script de build e restart executado no VPS |
| `.github/workflows/deploy.yml` | Workflow do GitHub Actions (self-hosted runner) |
| `db/` | Dump de produção em JSON — **não vai para o GitHub** |
| `.env.example` | Modelo de variáveis de ambiente |

---

## Pré-requisitos no VPS

```bash
node --version    # 24.x
pnpm --version    # 10.x   (npm i -g pnpm se ausente)
psql --version    # 15+
nginx -v          # já ativo
# Self-hosted runner do GitHub já instalado e rodando
```

---

## Passo a passo — primeira subida manual

O primeiro clone é feito automaticamente pelo workflow na primeira execução.
Se precisar clonar manualmente:

```bash
sudo mkdir -p /var/www/audit/app
sudo chown -R ubuntu:ubuntu /var/www/audit
cd /var/www/audit/app
git clone https://github.com/rafaellmathias85-ui/wnraudit.git .
```

### Banco de dados

```bash
sudo -u postgres psql -c "CREATE USER wnraudit WITH PASSWORD 'TROQUE_ESSA_SENHA';"
sudo -u postgres psql -c "CREATE DATABASE wnraudit OWNER wnraudit;"

cd /var/www/audit/app/source
DATABASE_URL=postgres://wnraudit:SENHA@127.0.0.1:5432/wnraudit \
  pnpm --filter @workspace/db run push
```

Restaurar dados de produção (opcional):

```bash
DATABASE_URL=postgres://wnraudit:SENHA@127.0.0.1:5432/wnraudit \
  node /var/www/audit/app/db/restore.mjs
```

### Variáveis de ambiente

```bash
cp /var/www/audit/app/.env.example /var/www/audit/app/source/.env
nano /var/www/audit/app/source/.env
```

| Variável | Valor para produção |
|----------|---------------------|
| `DATABASE_URL` | `postgres://wnraudit:SENHA@127.0.0.1:5432/wnraudit` |
| `PORT` | `8080` |
| `SESSION_SECRET` | resultado de `openssl rand -hex 32` |
| `CLERK_SECRET_KEY` | Painel Clerk → API Keys |
| `CLERK_PUBLISHABLE_KEY` | Painel Clerk → API Keys |
| `VITE_CLERK_PUBLISHABLE_KEY` | mesmo valor da anterior |
| `MS_OAUTH_CLIENT_ID` | `7324093c-8f5d-4efe-92d2-aa845c8f0542` |
| `MS_OAUTH_CLIENT_SECRET` | Azure App Registration → Certificates & secrets |
| `MS_OAUTH_REDIRECT_URI` | `https://wnrtecnologia.com.br/api/oauth/ms/callback` |
| `FRONTEND_BASE_URL` | `https://wnrtecnologia.com.br/wnraudit` |
| `BASE_PATH` | `/wnraudit/` |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | `sk-ant-...` |

### Build inicial (manual, primeira vez)

```bash
cd /var/www/audit/app/source
NODE_ENV=production pnpm run build
```

### Serviço systemd

Crie `/etc/systemd/system/wnraudit-api.service`:

```ini
[Unit]
Description=WNR-Audit API
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/audit/app/source
EnvironmentFile=/var/www/audit/app/source/.env
ExecStart=/usr/bin/node --enable-source-maps artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wnraudit-api
sudo systemctl status wnraudit-api
```

Comandos de operação:

```bash
sudo systemctl restart wnraudit-api
sudo journalctl -u wnraudit-api -f
sudo journalctl -u wnraudit-api --since "5 minutes ago"
```

### Sudoers — deploy sem senha interativa

```bash
echo "ubuntu ALL=(ALL) NOPASSWD: /bin/systemctl restart wnraudit-api" \
  | sudo tee /etc/sudoers.d/wnraudit-deploy
sudo chmod 440 /etc/sudoers.d/wnraudit-deploy
```

### Nginx — adicionar ao servidor existente

Localize o bloco HTTPS de `wnrtecnologia.com.br`:

```bash
grep -rl "wnrtecnologia.com.br" /etc/nginx/sites-enabled/
```

Adicione dentro do `server { listen 443 ... }`:

```nginx
# WNR-Audit — API
# ATENCAO: verificar se /api/ ja e usado por outro sistema (ss -tlnp | grep 8080)
location /api/ {
    proxy_pass         http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto https;
    proxy_read_timeout 120s;
}

# WNR-Audit — Frontend SPA
location /wnraudit/ {
    alias      /var/www/audit/app/source/artifacts/wnr-audit/dist/public/;
    try_files  $uri $uri/ /wnraudit/index.html;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Pipeline — como funciona

```
VSCode (edita código)
    │
    ▼ git push origin main
github.com/rafaellmathias85-ui/wnraudit
    │
    ▼ GitHub Actions — self-hosted runner no VPS
VPS /var/www/audit/app
    ├── git fetch + git reset --hard origin/main
    ├── Preserva source/.env  →  restaura após reset
    ├── Copia deploy.sh para /var/www/audit/deploy.sh
    └── Executa /var/www/audit/deploy.sh
          ├── pnpm install --frozen-lockfile
          ├── NODE_ENV=production pnpm run build
          ├── sudo systemctl restart wnraudit-api
          └── curl http://127.0.0.1:8080/api/healthz
```

### Configurar o self-hosted runner no VPS

No GitHub: **rafaellmathias85-ui/wnraudit → Settings → Actions → Runners → New self-hosted runner**

Siga as instruções geradas pelo GitHub para instalar o runner no VPS (Ubuntu).
O runner deve rodar como serviço para sobreviver a reboots:

```bash
sudo ./svc.sh install
sudo ./svc.sh start
```

---

## Fluxo de trabalho diário

```bash
# No terminal do VSCode:
git add .
git commit -m "descrição da mudança"
git push origin main
# O self-hosted runner no VPS executa o deploy automaticamente
```

---

## Configurações externas (uma vez)

**Clerk:** [dashboard.clerk.com](https://dashboard.clerk.com) → Domains → `wnrtecnologia.com.br`

**Azure AD:** Portal Azure → App Registrations → WNR-Audit → Authentication → Redirect URIs:
```
https://wnrtecnologia.com.br/api/oauth/ms/callback
```

---

## Validação

```bash
curl -sS https://wnrtecnologia.com.br/api/healthz
# Esperado: {"ok":true}
```

Acesse `https://wnrtecnologia.com.br/wnraudit` — login com `rafael@wticorp.com.br` promove automaticamente para super_admin.

---

## Observações — coexistência no VPS

- Porta interna `8080` exclusiva do wnraudit: `ss -tlnp | grep 8080`
- Banco isolado: usuário `wnraudit`, database `wnraudit`
- Serviço isolado: `wnraudit-api`
- Diretório isolado: `/var/www/audit/`
- O `.env` em `source/.env` é preservado automaticamente pelo workflow a cada deploy
