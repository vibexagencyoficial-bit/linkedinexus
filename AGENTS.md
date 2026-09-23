# VibexCorp LinkedIn Outreach — Diretrizes do Projeto (AGENTS.md)

> **Documento Oficial de Governança e Arquitetura do Workspace**
> **Projeto:** VibexCorp LinkedIn Outreach (SaaS & Automação B2B)
> **Versão:** 1.0 (Modular Monolith)

---

## 1. Visão Geral e Arquitetura

O **VibexCorp LinkedIn Outreach** é uma solução corporativa B2B de alto desempenho para gestão de campanhas, sequências de cadência, templates dinâmicos, follow-ups automatizados e governança de outreach no LinkedIn com segurança e compliance estritos.

### Princípios Invioláveis
1. **Modular Monolith**: Backend Go único com módulos desacoplados em `internal/`. Proibido microservices prematuros.
2. **PostgreSQL como Source of Truth**: Toda persistência definitiva, auditoria, estado de contatos e campanhas reside no PostgreSQL com Row Level Security (RLS).
3. **Redis para Coordenação Transitória**: Fila Asynq, cache de leitura transitória, distributed locks, rate limiting de segurança e controle de idempotência. Nunca substituir o PostgreSQL.
4. **Backend Autoritário**: Toda lógica de negócios, agendamento, retries, validações e decisões reside no backend Go.
5. **Thin Clients**: Frontend Next.js e Extensão Chrome (WXT) são thin clients sem scheduler nem regras de negócio críticas.
6. **Platform Safety First**: Sem métodos de evasão, fingerprint spoofing ou bypass. Respeito rigoroso aos limites operacionais, backpressure, circuit breaker e Stop on Reply em tempo real.

---

## 2. Stack Tecnológica

| Camada | Tecnologia | Detalhes / Versão |
|---|---|---|
| **Backend API / Workers** | Go 1.27+ | Chi Router, pgx, sqlc, go-playground/validator |
| **Queue / Background** | Asynq + Redis | Scheduler dedicado, workers concorrentes com distributed lock |
| **Database** | PostgreSQL 16+ | Migrations versionadas, Row Level Security (RLS), RLS multi-tenant |
| **Cache & Distributed Locks** | Redis 7+ | Redlock / Distributed Locks, Asynq broker, rate limiter |
| **Frontend Dashboard** | Next.js 16 (App Router) | React 19, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query |
| **Chrome Extension** | WXT (Manifest V3) | React, TypeScript, Thin Client, chrome.storage, REST API client |
| **Observability & Logs** | OpenTelemetry + slog | JSON estruturado, correlation IDs (trace_id, request_id, job_id) |
| **API Contracts** | OpenAPI 3.x | `api/openapi.yaml` como contrato único, gerando TypeScript client |

---

## 3. Estrutura de Diretórios Padronizada

```
.
├── .agents/
│   ├── rules/             # Regras locais normativas de arquitetura, banco, go, frontend
│   └── skills/            # Skills versionadas locais do projeto
├── memory/
│   └── 001_registro_continuo_memoria.md # Log contínuo e cumulativo de memória (limite 2500 linhas)
├── api/
│   └── openapi.yaml       # Especificação OpenAPI 3.x autoritativa
├── backend/
│   ├── cmd/
│   │   ├── api/           # Servidor HTTP Chi REST & SSE
│   │   ├── worker/        # Processamento assíncrono de jobs Asynq
│   │   └── scheduler/     # Polling e agendamento de steps elegíveis para fila
│   ├── internal/          # Módulos de domínio (modular monolith)
│   │   ├── auth/          # Autenticação JWT e resolução de organization_id
│   │   ├── organizations/ # Gestão de tenants
│   │   ├── users/         # Gestão de usuários
│   │   ├── accounts/      # Gestão e health de contas do LinkedIn
│   │   ├── contacts/      # Gestão, importação e deduplicação de contatos
│   │   ├── campaigns/     # Ciclo de vida e estado das campanhas
│   │   ├── flow/          # Flow Builder (Recommended & Custom Flows)
│   │   ├── templates/     # TemplateRenderer com resolução segura de variáveis
│   │   ├── scheduler/     # Motor de elegibilidade e scheduling
│   │   ├── messaging/     # Motor de execução idempotente de mensagens
│   │   ├── conversations/ # Inbox, detecção de reply (Stop on Reply)
│   │   ├── safety/        # PlatformSafetyService, Circuit Breaker e backpressure
│   │   ├── ratelimit/     # Token bucket / Sliding window por conta
│   │   ├── events/        # Event bus e SSE streaming
│   │   ├── audit/         # Trilha de auditoria imutável
│   │   └── queue/         # Definição e handlers de jobs Asynq
│   ├── platform/          # Infraestrutura e utilitários
│   │   ├── postgres/      # Conexão pgxpool e injeção de tenant RLS
│   │   ├── redis/         # Cliente Redis e locks distribuídos
│   │   ├── logger/        # slog estruturado JSON com correlation IDs
│   │   └── telemetry/     # OpenTelemetry tracing e métricas
│   └── db/
│       ├── migrations/    # Scripts SQL versionados (up/down)
│       └── queries/       # Queries SQL para sqlc
├── frontend/              # Aplicação Next.js 16 (App Router)
│   ├── src/
│   │   ├── app/           # Rotas App Router (/dashboard, /campaigns, /contacts, etc.)
│   │   ├── components/    # Componentes UI (shadcn/ui, Flow Builder, Metric Cards)
│   │   ├── lib/           # TanStack Query, API client gerado, stores de UI
│   │   └── styles/        # Tailwind e tokens de design VibexCorp
├── ext/                   # Extensão Chrome WXT (Manifest V3)
│   ├── src/
│   │   ├── background/    # Service Worker WXT
│   │   ├── content/       # Content scripts para contexto seguro no LinkedIn
│   │   ├── popup/         # Popup de status rápido e auth
│   │   ├── sidepanel/     # Painel lateral interativo
│   │   └── api/           # API Client compartilhado via OpenAPI
├── scripts/
│   └── local/               # Boot local SEM Docker (disco D): start.ps1, stop.ps1, status.ps1
└── docker-compose.yml     # Legado (não usado no dev local — ver scripts/local + PRD-honestidade-conexao §4b)
```

> **Dev local sem Docker (obrigatório):** todo estado vive no disco **D** (`D:\vibex`: pgdata:5433, redis:6380, logs, tmp, caches). Subir com `powershell -ExecutionPolicy Bypass -File scripts\local\start.ps1`, conferir com `status.ps1`, derrubar com `stop.ps1`. Detalhes em `docs/prd/PRD-honestidade-conexao.md` §4b. O `docker-compose.yml` é legado e não deve ser usado.

---

## 4. Definition of Done (DoD) & Comandos de Validação

Nenhuma tarefa é considerada finalizada sem:
1. `go vet ./...` e `go test -v ./...` sem falhas no backend.
2. `npx tsc --noEmit` sem erros no frontend e extensão.
3. Migrations SQL testadas com RLS funcionando e testes de vazamento cross-tenant validados.
4. Teste crítico de idempotência: reenfileirar 10x o mesmo job deve persistir exatamente 1 envio.
5. Teste de Stop on Reply: detecção de reply antes da execução deve cancelar o step seguinte.
6. Registro detalhado no arquivo ativo de `memory/001_registro_continuo_memoria.md`.
7. **Ritual de governança obrigatório (Regra 09 — `.agents/rules/09_PRD_E_GOVERNANCA.md`):** toda feature, correção, refactor ou migração não-trivial exige, ANTES de codar, um PRD em `docs/prd/PRD-<slug>.md` + declaração de impacto nas rules 01–08 + atualização do `api/openapi.yaml` se a API mudar + registro de intenção no `memory/` ativo (+ `/graphify` quando a skill estiver instalada); e DEPOIS de implementar, apensar decisões/testes/DoD ao `memory/`, atualizar as rules com precedente novo e marcar o status no PRD. Sem esses itens, a tarefa NÃO está concluída.
