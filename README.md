# VibexCorp LinkedIn Outreach

Plataforma B2B de automação de outreach no LinkedIn: campanhas com cadência,
sequências de follow-up, inbox com detecção de resposta (Stop on Reply),
extensão Chrome (Manifest V3) como executora das ações no LinkedIn e painel
Next.js com métricas em tempo real (incluindo latência do Jev).

> **Você está no Windows.** O caminho oficial para rodar tudo aqui é
> **WSL2 + Docker Engine** (seção [Como iniciar](#como-iniciar-wsl2--docker-engine)).
> O `scripts/local/start.ps1` é legado do ambiente antigo (Postgres/Redis
> nativos no disco D, portas 5433/6380) e **não deve ser usado** junto com o
> Docker — escolha um dos dois.

---

## ⚠️ OBRIGATÓRIO: API key oficial do Jev (Typesafe)

Sem a chave, o sistema sobe normalmente, mas o assistente de automação humana
**não decide nada**: todo `/assist/humanize` cai em `source: "fallback"` com
`page_state: "assist_not_configured"` e `jev_ms: 0`. O painel mostra "—" no KPI
de latência e a extensão exibe `(fallback)`.

A chave **oficial** sai do **MCP `jev-orchestrator`** (é a mesma credencial que
o agente usa para chamar o Jev):

1. Abra as configurações do MCP `jev-orchestrator` no seu ambiente (ZCode /
   painel do provedor Typesafe).
2. Copie a **API key** da conta (formato `Bearer`, sem prefixo — só o token).
3. Cole no `.env` (raiz do repo), no campo `TYPESAFE_API_KEY`:

```bash
cp .env.example .env   # se ainda não existe
```

```env
TYPESAFE_API_URL=https://api.typesafe.ai/v1/systemone
TYPESAFE_API_KEY=cole_sua_api_key_aqui   # ← TROQUE pela key do MCP jev-orchestrator
TYPESAFE_MODEL=jev-1.13.0
JEV_CONFIDENCE_FLOOR=0.5
ASSIST_RATE_PER_MIN=60
```

Regras de segurança (não negociáveis):

- A chave **nunca sai do backend** (fica no `.env`, lida via `os.Getenv` em
  `backend/internal/api/assist.go`). Nunca commite o `.env` (está no
  `.gitignore`), nunca cole a key em log, issue, print ou prompt.
- O `state` enviado à Typesafe é **estrutural** (ação, fingerprint da página,
  seletores candidatos, idioma) — nunca contém `.env`, tokens, cookies ou
  credenciais.
- Para validar que o Jev está decidindo de verdade: chame
  `POST /api/v1/assist/humanize` autenticado e confira `source: "typesafe"` com
  `jev_ms > 0`; no `api.log` deve aparecer
  `assist Jev: pacing decidido para a execução` com `pacing_level` e `jev_ms`.

---

## Arquitetura

```
┌─────────────┐   HTTPS/REST+SSE    ┌──────────────────────┐
│  Extensão   │ ◄─────────────────► │   Backend Go (Chi)   │
│ Chrome MV3  │  /extension/*       │   :8080 (/api/v1)     │
│ (WXT/React) │  /assist/humanize   │                      │
│ executora   │  /messaging/*       │  ┌────────────────┐  │
└─────────────┘                     │  │ Jev/Typesafe   │──┼──► api.typesafe.ai
                                    │  │ (proxy /assist)│  │    (só o backend chama,
┌─────────────┐   REST + SSE        │  └────────────────┘  │     com TYPESAFE_API_KEY)
│  Painel     │ ◄─────────────────► │                      │
│ Next.js 15  │  /dashboard/*       │  Postgres 16 (RLS)   │
│ :3000       │  /activity, /inbox  │  Redis 7 (rate/fila) │
└─────────────┘                     └──────────────────────┘
        ▲ Traefik (:80) como API Gateway: CORS allowlist + rate limit
        │ (login 10/min, pair 6/min, global 100/s) — infra/traefik/traefik.yml
```

**Princípios (AGENTS.md):** Modular Monolith (Go único, sem microservices
prematuros); **PostgreSQL é a source of truth** (RLS multi-tenant por
`organization_id`); Redis só para coordenação transitória (fila, locks, rate
limit); backend autoritário; frontend e extensão são *thin clients*.

### Backend — `backend/` (Go 1.26, Chi, pgx, sqlc)

| Pasta | Papel |
|---|---|
| `cmd/api` | Servidor HTTP REST + SSE (`:8080`) |
| `cmd/worker` | Jobs assíncronos de outreach |
| `cmd/scheduler` | Polling de steps elegíveis para fila |
| `internal/api` | Handlers + router (`router.go`), rate limit, assist Jev (`assist.go`) |
| `internal/auth` | JWT + sessões DB-backed (`auth_sessions`: access 15 min, refresh 7 dias rotacionado, extensão 60 min) |
| `internal/messaging` | Motor idempotente de execução de mensagens |
| `internal/safety` | Kill switch, circuit breaker, backpressure, Stop on Reply |
| `internal/ratelimit` | Token bucket/sliding window por conta |
| `internal/events` | Event bus + SSE (`GET /events/stream`) |
| `internal/templates` | Renderizador de templates com variáveis seguras |
| `internal/queue`, `internal/scheduler` | Fila e motor de elegibilidade |
| `platform/postgres`, `platform/redis` | Conexões pgxpool (com RLS) e Redis |
| `platform/logger`, `platform/telemetry` | slog JSON + OpenTelemetry |
| `db/migrations` (12) | Schema versionado + RLS + seed do owner dev |
| `db/queries` | Queries do sqlc |

Principais rotas (`api/openapi.yaml` é o contrato autoritativo):

- `POST /api/v1/auth/login` · `POST /api/v1/auth/refresh` · `GET /api/v1/auth/me`
- `POST /api/v1/extension/pairing-code` → `POST /api/v1/extension/pair` → `POST /api/v1/extension/heartbeat` (prova de vida) → `POST /api/v1/extension/token`
- `POST /api/v1/assist/humanize` — proxy Jev: devolve `HumanizeParams` + `jev_ms`, `assist_total_ms`, `cached`, `pacing_level` (`conservative|moderate|energetic`)
- `GET /api/v1/messaging/pending-outreach` · `POST /api/v1/messaging/report-sent` (com `assist_*` + 3 tempos) · `POST /api/v1/messaging/report-reply`
- `GET /api/v1/dashboard/metrics` (inclui `jev_avg_ms` + `jev_samples`, 24h) · `GET /api/v1/activity` · `GET /api/v1/events/stream` (SSE)
- CRUD: `/contacts`, `/campaigns` (+ steps/start/pause/resume), `/conversations`, `/templates`, `/settings/*`, `/accounts/*`, `POST /api/v1/system/pause-outreach`, `POST /api/v1/settings/kill-switch`
- `GET /health`, `GET /ready`, `GET /api/v1/downloads/extension.zip`

### Frontend — `frontend/` (Next.js 15, React 19, Tailwind, Vitest)

Painel em `src/app/`: `/login`, `/` (dashboard + KPI "Latência média do Jev"),
`/activity` (trilha com `Jev N ms · total M ms · ida-volta K ms · fonte`),
`/campaigns`, `/contacts`, `/inbox`, `/templates`, `/extension` (pareamento +
download do zip), `/settings`. `src/lib/api.ts` e `src/lib/sse.ts` falam com a
API (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_EVENTS_URL`); tipos compartilhados em
`packages/api-client/src/index.ts`.

### Extensão — `ext/` (WXT, Manifest V3, React)

Thin client executora: `background.ts` (service worker com `chrome.alarms`
como keepalive — sem a permissão `alarms` o polling morre em ~30 s e "nada
acontece na tela"), `content.ts` (executa no LinkedIn com delays humanizados
decididos pelo Jev), `popup/` + `sidepanel/`. Mede `roundtrip_ms` (ida-volta
até `/assist/humanize`) e exibe `Jev: X ms · ida-volta Y ms (fonte)` no popup.

### Infra — `infra/` + `docker-compose.yml`

`infra/traefik/traefik.yml` (gateway: CORS allowlist sem wildcard +
`chrome-extension://`, rate limits, security headers), `infra/docker/` com os
4 Dockerfiles (api, worker, scheduler, frontend).

---

## Pré-requisitos

- **Windows 10/11** com **WSL2** instalado e uma distro (Ubuntu 24.04
  recomendado): `wsl --install` no PowerShell admin, reinicie, crie o usuário.
- **Docker Engine dentro do WSL** (recomendado) **ou** Docker Desktop com
  integração WSL ativada. Verifique dentro do WSL: `docker compose version`.
- Node 22+ e Go 1.26+ **só** se for desenvolver fora dos containers.
- Porta **80** (Traefik), **8080** (API), **3000** (frontend), **5432**
  (Postgres), **6379** (Redis) livres no Windows.
- Repo clonado **dentro do filesystem do WSL** (`~/LinkedinNexus`), não em
  `/mnt/d` — bind mounts no `/mnt` são lentos e quebram hot-reload.

---

## Como iniciar (WSL2 + Docker Engine)

```bash
# 1. Entre no WSL e vá para o projeto
wsl
cd ~/LinkedinNexus/linkedinexus   # raiz do repo (onde está o docker-compose.yml)

# 2. Configure o ambiente (inclui a API key do Jev — ver seção OBRIGATÓRIO acima)
cp .env.example .env
nano .env   # preencha TYPESAFE_API_KEY (e o resto se precisar)

# 3. Suba tudo (Postgres + Redis + Traefik + API + Frontend)
docker compose up -d --build

# 4. Confira
docker compose ps
curl http://localhost:8080/health        # {"status":"alive"}
curl http://localhost:80/api/v1/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@vibexcorp.com","password":"admin123"}'
```

Endereços:

| Serviço | URL |
|---|---|
| Painel | http://localhost:3000 (ou http://localhost via Traefik) |
| API | http://localhost:8080 (`/api/v1`, `/health`, `/ready`) |
| Gateway Traefik | http://localhost:80 (+ dashboard em :8081) |
| Postgres | `localhost:5432` (`vibex_outreach` / `vibex_admin`) |
| Redis | `localhost:6379` |

Login inicial (seed `000005_seed_dev_owner`): `admin@vibexcorp.com` /
`admin123`. Troque a senha após o primeiro acesso.

```bash
# Logs e ciclo de vida
docker compose logs -f api        # assist/Jev aparece aqui (linhas "assist ...")
docker compose logs -f frontend
docker compose down               # derruba tudo (mantém volumes pg/redis)
docker compose down -v            # derruba e APAGA o banco (cuidado)
```

> Nota: o `docker-compose.yml` monta `backend/db/migrations` no init do
> Postgres e injeta `DATABASE_URL`/`REDIS_URL` apontando para os serviços
> `postgres`/`redis` — não é preciso rodar migrations manualmente no boot via
> Docker. As envs `TYPESAFE_*` entram no container da API pelo `env_file`
> (adicione-as ao serviço `api` se regenerar o compose; hoje o bloco
> `environment` da API carrega o essencial e o `.env` cobre o resto).

---

## Como usar

1. **Configure a API key do Jev** (seção no topo) e suba a stack. Sem ela, tudo
   funciona em modo `fallback` — mas sem decisões do Jev.
2. **Conecte a conta LinkedIn**: Painel → conta → conectar (acompanhe
   `/accounts/current`).
3. **Instale a extensão**: Painel → `/extension` → Baixar zip (ou use
   `ext/vibexcorp-extension.zip`) → `chrome://extensions` → modo desenvolvedor
   → "Carregar sem compactação" na pasta descompactada. Para desenvolver:
   `cd ext && npm install && npm run dev` (ou `npm run build` para o `.output`).
4. **Pareie**: Painel → `/extension` → gerar código de pareamento (8 hex,
   válido por minutos) → cole no popup da extensão. O badge só fica
   **CONECTADA** com heartbeat real (`/extension/heartbeat` a cada ~1 min via
   `chrome.alarms`); estado é sempre do banco, nunca local.
5. **Campanhas**: crie campanha → adicione contatos (manual, CSV em
   `/contacts/import` ou sync do LinkedIn) → defina steps/cadência → **Start**.
   O scheduler enfileira, a extensão executa com ritmo decidido pelo Jev
   (`pacing_level` + jitter humano) e confirma em `/messaging/report-sent`.
6. **Acompanhe**: dashboard (KPIs + latência média do Jev), `/activity` (cada
   disparo com `Jev N ms · total M ms · ida-volta K ms · fonte typesafe|fallback`),
   `/inbox` (respostas; Stop on Reply pausa a cadência automaticamente).
7. **Segurança operacional**: rate limit (login 10/min, pair 5/10min, global
   120 req/min + Traefik), CORS allowlist (painéis locais + `chrome-extension://`),
   kill switch global em `/settings` (congela todos os envios).

---

## Validação (Definition of Done)

```bash
cd backend && go vet ./... && go test ./...        # suite inclui e2e + cross-tenant
cd ../frontend && npx tsc --noEmit && npm test      # 24 testes Vitest
cd ../ext && npx tsc --noEmit && npm run build      # WXT MV3 em .output/
```

Testes críticos exigidos pelo AGENTS.md: idempotência (reenfileirar 10× o mesmo
job = 1 envio), Stop on Reply, RLS sem vazamento cross-tenant, badge de conexão
só com estado real do banco.

---

## Mapa do repositório

```
.
├── api/openapi.yaml            # contrato OpenAPI autoritativo da API
├── backend/                    # Go: cmd/{api,worker,scheduler}, internal/*, db/migrations (12)
├── frontend/                   # Next.js 15: dashboard, activity, inbox, campaigns, extension...
├── ext/                        # Extensão WXT MV3 (background/content/popup/sidepanel)
├── packages/api-client/        # tipos TS compartilhados (fonte do frontend)
├── infra/{traefik,docker}/     # gateway + Dockerfiles
├── scripts/local/              # LEGADO (boot nativo sem Docker) — não usar com Docker
├── docs/{prd,plano}/           # PRDs + plano funcional
├── memory/                     # log contínuo de memória do projeto
└── docker-compose.yml          # stack oficial: postgres, redis, traefik, api, frontend
```
