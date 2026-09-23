# PRD-honestidade-conexao — Fim dos placeholders de conexão (LinkedIn + Extensão)

- **Data:** 2026-09-22
- **Autor:** Claude (auditoria a pedido do usuário)
- **Tipo:** bugfix (contrato honesto de integração) + governança
- **Status:** implementado (2026-09-22 — A1, A2, B0, B1, B2, C, D, E e openapi+cliente concluídos e verdes; ver §5.1)
- **Rules impactadas:** 01 (backend autoritativo/thin clients), 04 (handlers Chi + auth), 05 (RLS/fonte da verdade), 06 (frontend sem lógica fake), 07 (extensão thin client/pareamento), 09 (este PRD é o primeiro sob a Regra 09)
- **Graphify:** executado 2026-09-22 — skill instalada via `uv tool install graphifyy` + `graphify install`; grafo em `graphify-out/` (575 nós, 1166 arestas, 49 comunidades; AST 506 + semântico 35 das rules/PRD). God nodes: `Server` (handlers.go), `writeJSON`, `VibexApiClient`, `GetClaims`. Uso futuro: `graphify query "<pergunta>"` e `graphify . --update` após cada mudança.

## 1. Problema (evidência)

Auditoria de 2026-09-22 (frontend `settings/page.tsx`, `auth-context.tsx`; backend `internal/api/handlers.go`, `internal/auth/auth.go`; migrations `000001`, `000002`, `000004`) encontrou que o sistema **fabrica sucesso**:

1. **Conectar LinkedIn sem prova:** `HandleConnectAccount` grava `status='connected'` para qualquer `display_name`; o campo `session_key` do request é ignorado. No frontend, `handleQuickConnectLinkedIn`/`handleConnectLinkedIn` têm `catch` que injeta `connected: true` hardcoded se a API falhar. Resultado: botão "Conectar" sempre "funciona".
2. **Extensão "conectada" sem existir:** `NewServer` semeia `devices{"current": now}` no boot; `HandleExtensionStatus` lê esse seed e retorna `CONNECTED` nos primeiros 10 min de vida do servidor, sem nenhum dispositivo real. `HandlePairExtension` aceita qualquer código com `len >= 3` e emite `device_id` + `extension_token` mesmo sem Postgres.
3. **Pareamento demo:** `handleGeneratePairing` gera código via `Math.random()` local quando a API falha — código que nenhuma extensão pode validar.
4. **Auth com backdoors:** `auth.go ParseToken` aceita literal `demo_token_vibex_2026` e qualquer string de 64 chars como identidade válida; `HandleLogin` faz bootstrap de usuário default e aceita `admin123` como senha universal no fallback; `auth-context.tsx` cria sessão demo automaticamente quando não há token salvo.
5. **Banco existe mas está morto:** schema `extension_devices` + `linkedin_account_capabilities` + RLS existem (`000004`, `000002`), porém o Postgres está offline (servidor caiu para `inMemoryStore`) e **nenhum handler chama `ExecWithTenant`** (`postgres.go:47` nunca invocado) — com o banco no ar, as policies RLS exigiriam `app.organization_id` nunca setado → zero linhas → tudo cairia no fallback in-memory do mesmo jeito.
6. **Dados fake como reais:** `HandleSyncLinkedInContacts` com corpo vazio semeia 5 contatos fictícios; `HandleCampaignPreview` retorna preview fixo; `HandleGetCampaignSteps` retorna step default fixo; limites/janela na tela de settings são cosméticos (salvar só mostra toast).
7. **CORS permissivo:** `router.go` autoriza qualquer origem (`return true`), contrariando o comentário "restritivo".

## 2. Escopo (o que entra)

- **Fase A — Contrato honesto (sem banco):** remover todos os `catch` que fabricam sucesso no frontend; remover seed `devices["current"]`; `HandleExtensionStatus` sem dispositivo real → `OFFLINE`; `HandlePairExtension` sem Postgres → `503` honesto em vez de token fictício; `HandleConnectAccount` sem Postgres → `503` honesto em vez de `connected`; login sem banco → `401/503` honesto (sem bootstrap `admin123`).
- **Fase B — Postgres como verdade:** subir Postgres+Redis via `docker-compose`; todos os handlers de leitura/escrita passam a usar `ExecWithTenant` (ou `SET LOCAL` por conexão); RLS validado com teste cross-tenant; `inMemoryStore` vira apenas cache de leitura transitória ou é removido onde conflitar com a verdade do banco.
- **Fase C — Pareamento real ponta a ponta:** `HandlePairExtension` exige código existente e não-expirado (`404 INVALID_PAIRING_CODE` caso contrário); `HandleExtensionStatus` consulta só `extension_devices` com `last_seen_at` recente + `status='active'`; `HandleConnectAccount` exige evidência (dispositivo pareado com heartbeat recente OU `session_key` verificável), senão `428 PRECONDITION_REQUIRED`/`412`.
- **Fase D — Auth sem backdoor:** remover `demo_token`, token-por-comprimento e fallback `admin123`; `auth-context` sem auto-sessão demo; erro real de login chega à UI (a tela de login já tem slot de erro — `setError` — hoje inalcançável).
- **Fundação (este passo):** Regra 09 criada, AGENTS.md §4 item 7 adicionado, este PRD registrado, memória apensada.

## 3. Fora de escopo (o que NÃO entra)

- Reescrever scheduler/worker Asynq, templates, inbox, flow builder (têm seus próprios débitos, mas funcionam sobre o contrato atual).
- Instalar a extensão no navegador do usuário / publicar na Chrome Web Store.
- Trocar JWT por OAuth real do LinkedIn (a arquitetura Zero-Evasion via extensão continua valendo — Regra 07).
- Endurecer CORS para produção (anotar como débito; dev continua aberto).
- **Débitos cosméticos registrados no encerramento (2026-09-22, sem implementar):** `daily_limit`/janela na tela de settings continuam hardcodados (salvar só mostra toast) — mesmo tratamento já dado ao CORS: anotado aqui, fora deste PRD.

## 4. Contrato (mudanças de API — aplicar no `api/openapi.yaml` na implementação)

- `POST /accounts/connect` sem evidência → `428` + `{error: {code: "EVIDENCE_REQUIRED"}}` (novo código de erro padronizado §41).
- `POST /extension/pair` com código inexistente/expirado → `404 INVALID_PAIRING_CODE` (já existe o código; passar a retorná-lo de verdade).
- `POST /extension/pairing-code`, `GET /extension/status` e demais protegidas sem Postgres → `503` com `code: "STORE_UNAVAILABLE"` (novo), em vez de dado fictício.
- `POST /auth/login` sem banco/usuário → `401 AUTH_INVALID_CREDENTIALS` (sem bootstrap).
- `GET /extension/status`: `connected` passa a significar exclusivamente "dispositivo `active` com heartbeat < 2 min".

## 4b. Infra local SEM Docker (obrigatório — disco D)

**Decisão (2026-09-22, a pedido do usuário):** nada roda em Docker neste projeto e NADA no disco C. Todo estado local (dados do Postgres, dump AOF do Redis, logs, artefatos de build) reside no disco D.

- **Postgres:** binários já presentes via Scoop (PostgreSQL 18.6-3); o cluster de dados vive em `D:\vibex\pgdata` (criado via `initdb` na D, porta **5433** para não colidir com nada no C). `DATABASE_URL=postgres://vibex_admin:vibex_secure_password_2026@localhost:5433/vibex_outreach?sslmode=disable`.
- **Redis:** binário Scoop já presente (Redis 8.10.1); roda com `redis-server --port 6380 --dir D:\vibex\redis --dbfilename dump.rdb --appendonly yes --requirepass vibex_redis_pass_2026` (porta **6380**, dados em `D:\vibex\redis`).
- **Motivo das portas não-padrão:** 5432/6379 podem estar ocupadas por serviços alheios (ex.: o Next da `alfa-engenharia` ocupa a 3000). 5433/6380 são exclusivas do VibexCorp e documentadas nos scripts.
- **Scripts (raiz `scripts/local/`):** `start.ps1` (sobe pg + redis + aplica migrations + valida `pg_isready`/PING + sobe `api.exe` na 8080 + `next dev --port 3001` com `TMPDIR`/`TEMP` apontados para `D:\vibex\tmp`), `stop.ps1` (derruba os 4 processos na ordem inversa), `status.ps1` (health de cada camada + portas). Todos os scripts recusam-se a rodar se `D:` não estiver montado.
- **Caches fora do C:** `npm_config_cache=D:\vibex\cache\npm`, `NEXT` com `TEMP/TMP=D:\vibex\tmp`, `GOCACHE=D:\vibex\cache\go-build`, `GOMODCACHE=D:\vibex\cache\go-mod`, `uv`/`pip` cache em `D:\vibex\cache\uv`. Nada de build escreve em `%LOCALAPPDATA%`/`C:\Users`.
- **Migrations:** aplicadas na ordem `000001–000004` via `psql -f` contra o cluster D (sem `docker-entrypoint-initdb.d`). RLS validado pelo teste de fumaça B1 antes da migração B2.
- **Rollback:** parar scripts + apagar `D:\vibex\pgdata` recria do zero via `initdb` + migrations (nenhum estado vive fora de `D:\vibex`).

## 5. Plano de implementação (passos + TDD por passo)

1. **Fase A1 — frontend honesto:** deletar ramos `catch`-fabrica-sucesso em `settings/page.tsx` (3 ocorrências) e `auth-context.tsx` (2 ocorrências); exibir `err.message` real na UI. TDD: teste de componente/mock que simula API 500 e assertiva que o badge continua `NOT CONNECTED`/`OFFLINE` + mensagem de erro visível.
2. **Fase A2 — backend honesto sem banco:** remover seed `devices["current"]`; status sem fonte real → `OFFLINE`; pair/connect sem Postgres → `503 STORE_UNAVAILABLE`. TDD: teste de handler com `pgClient = nil` assertivando `503`, não `200`.
   - **Status final (2026-09-22, A2 concluída):** TDD red→green (`internal/tests/honesty_test.go`, 6 testes). Removidos: seed `devices["current"]`, bootstrap de login com `admin123` e o backdoor universal `req.Password != "admin123"` (bcrypt estrito), fallback in-memory do `HandleExtensionStatus`. Novos: `503 STORE_UNAVAILABLE` sem store (pair, pairing-code, connect, status, login), `404 INVALID_PAIRING_CODE` real (código inexistente/expirado/consumido), `OFFLINE` sem device ativo, janela de heartbeat 2 min, heartbeat autentica o device **por `token_hash`** (token falso → 401). Efeito colateral revelado e corrigido: com `vibex_admin` NOSUPERUSER, queries sem `app.organization_id` retornavam 0 linhas (o bootstrap escondia isso) — criadas policies de lookup pre-tenant (`000006` login, `000007` pair, `000008` heartbeat por token_hash) liberadas só via `set_config(..., true)` transacional (nunca vaza para a conexão poolada). E2E ao vivo: login 200, gerar código 200, pair 200, status `CONNECTED`, heartbeat 200, token falso 401.
3. **Fase B0 — infra local em D (pré-requisito da B1):** criar `D:\vibex\{pgdata,redis,logs,tmp,cache}` + `scripts/local/{start,stop,status}.ps1` conforme §4b; apontar caches (npm/Next/Go/uv) para D; validar `status.ps1` verde com pg+redis vazios antes de qualquer migration.
   - **Status (2026-09-22):** scripts escritos e validados (sintaxe OK); legados parados (`stop.ps1` derrubou api.exe:8080 e next:3001). **Bloqueio no boot:** `initdb` do Scoop (PostgreSQL 18.6) falha com `exception 0xC0000135` — `postgres.exe` não encontra as DLLs dele quando invocado por caminho absoluto. **Correção pendente:** no `start.ps1`, antes de chamar `initdb`/`pg_ctl`/`psql`, adicionar `$env:PATH = "$PgBin;$env:PATH"` (o scoop não põe o bin no PATH da sessão). Depois re-rodar `start.ps1` e exigir `status.ps1` verde.
   - **Status final (2026-09-22, B0 concluída):** causa raiz do 0xC0000135 era `libxml2.dll` ausente no pacote Scoop (importada pelo `postgres.exe`). Runtimes agora autocontidos em `D:\vibex\tools\{pgsql,redis}` (nada instalado no C — regra do usuário; patch no Scoop revertido). Deadlocks de pipe nativo (`pg_ctl start | Out-Null`) e de `-Wait` em processo daemonizado corrigidos; redis usa `-WorkingDirectory` (backslash quebrava `--dir`). `status.ps1` 8/8 verde.
4. **Fase B1 — banco vivo em D:** `start.ps1` sobe o cluster `D:\vibex\pgdata:5433` + Redis `:6380`; aplicar migrations `000001–000004` via `psql -f`; teste de fumaça RLS (policy bloqueia sem `app.organization_id`, libera com). Pendência extra: criar migration `000005_seed_dev_owner` (organização + usuário `admin@vibexcorp.com` com hash bcrypt) para a Fase D ter login real.
   - **Status final (2026-09-22, B1 concluída):** migrations `000001`–`000005` aplicadas como `vibex_admin` (NOSUPERUSER — superuser bypassaria o RLS); smoke aprovado (sem ctx → 0 linhas mesmo para o dono; ctx por tenant → só a própria org; cross-tenant isolado nos dois sentidos); `000005_seed_dev_owner` criada (org `vibexcorp-dev` + `admin@vibexcorp.com` owner, bcrypt de `admin123`). API em :8080 `alive` conectada ao banco real (sem fallback in-memory).
5. **Fase B2 — tenant em todo handler:** introduzir helper que resolve `orgID` do claim e abre transação com `SET LOCAL`; migrar handlers de accounts/contacts/campaigns/extension. TDD: teste cross-tenant (Tenant A não lê/escreve Tenant B) por tabela tocada.
   - **Status final (2026-09-22, B2 concluída):** helpers `tenantOr401` + `withTenantDB` (transação com tenant, sem fallback para org default) aplicados em todos os handlers de leitura/escrita (accounts, contacts CRUD/CSV/sync com COPY+dedup, campaigns CRUD/steps/start/pause/resume/killswitch, dashboard, outreach, report, conversations, activity, templates); `ErrNoRows` absorvido para 404/200 honestos; sentinelas para 404/428 vs 503. TDD: `internal/tests/cross_tenant_test.go` (isolamento A/B + sem ctx → 0 linhas). Verde contra banco local.
6. **Fase C — pareamento real:** validação estrita de código + heartbeat; `connect` exige evidência. TDD: código expirado → `404`; heartbeat velho → `OFFLINE`; connect sem evidência → `428`.
   - **Status final (2026-09-22, C concluída):** `Connect` exige `session_key` não-vazia OU device active com `last_seen_at > NOW()-2min`, senão `428 EVIDENCE_REQUIRED`; `ExtensionStatus` OFFLINE sem device, ONLINE só heartbeat <=2min; código inválido/expirado/consumido → `404 INVALID_PAIRING_CODE`. TDD: `internal/tests/pairing_e2e_test.go` (E2E vivo: expiração/consumo/inexistente → 404; OFFLINE inicial; connect sem evidência → 428; fluxo feliz pair→heartbeat→CONNECTED).
7. **Fase D — auth:** remover backdoors; login real contra `users` (bcrypt). TDD: `demo_token` rejeitado; senha errada → `401`; login certo → JWT válido no middleware.
   - **Status final (2026-09-22, D concluída):** removidos `demo_token_vibex_2026` e token-64-chars de `ParseToken` (só JWT HS256), rota `POST /auth/demo-token`, sessão demo e `fallbackUser` do `auth-context`, auto-connect da extensão; login propaga erro real. TDD: `internal/tests/auth_e2e_test.go` (5 testes Go) + `frontend/src/test/auth-honest.test.tsx` (3 testes vitest).
8. **Fase E — limpeza de fakes:** remover seed de 5 contatos, preview fixo, steps default fixos, `camp-001`; telas passam a mostrar empty-state honesto (já existem empty-states bons em contacts/dashboard — reutilizar).
   - **Status final (2026-09-22, E concluída):** removido `inMemoryStore` (tipo + campo + init + import `sync`) e `HandleDemoToken`; `HandleCampaignPreview` reescrito para render real (template MESSAGE posição 1 × até 5 contatos reais, `can_launch` só sem `{{` não resolvido); exemplos de template zerados; builder sem fallback fake (`previews:[]` + `can_launch:false` + `previewError`); empty-states honestos reutilizados (inbox/contacts/dashboard). Migration `000009_worker_schedule_policy` (worker multi-tenant por org, kill-switch por org).
9. Cada fase: `go vet ./...`, `go test ./...`, `tsc --noEmit`, apêndice em `memory/`, status neste PRD.

### 5.1 Estado atual da execução (2026-09-22)

| Fase | Status | O que falta |
|---|---|---|
| B0 (infra D + runtimes) | **100%** | — (runtimes autocontidos em `D:\vibex\tools\{pgsql,redis}`; `status.ps1` 8/8 verde) |
| B1 (migrations + RLS smoke) | **100%** | — (`000001`–`000005` aplicadas; smoke: sem ctx=0, com ctx=1, cross-tenant isolado; `000005_seed_dev_owner` criada) |
| A2 (backend honesto, TDD) | **100%** | — (6 testes TDD; seed/backdoor/fallback removidos; 503/404/OFFLINE reais; E2E vivo verde) |
| A1 (frontend honesto, TDD) | **100%** | — (vitest; 5 testes settings + 3 auth; catch-fakes e Math.random removidos; erros reais na UI) |
| B2 (tenant em todo handler) | **100%** | — (`tenantOr401`+`withTenantDB`; cross-tenant verde; 401 sem tenant) |
| C (pareamento real) | **100%** | — (404 código inválido/expirado/consumido; 428 sem evidência; E2E vivo verde) |
| D (auth sem backdoor) | **100%** | — (demo-token/64-chars/admin123 mortos backend+frontend+ext; 5 testes Go + 3 vitest) |
| E (limpeza de fakes) | **100%** | — (inMemory removido; preview honesto; migration 000009 worker multi-tenant) |
| openapi.yaml + cliente TS | **100%** | — (ErrorEnvelope + 6 paths novos; ApiError com code/status/details; tsc limpo) |
8. Cada fase: `go vet ./...`, `go test ./...`, `tsc --noEmit`, apêndice em `memory/`, status neste PRD.

## 6. Riscos e segurança

- **Regressão de UX local:** devs acostumados ao "1 clique que sempre funciona" passarão a ver erros reais até o banco subir — mitigado pela Fase B vir logo após a A, e por mensagens de erro acionáveis ("Postgres offline — rode scripts/local/start.ps1").
- **Disco C contaminado:** mitigado pelos scripts recusarem boot sem `D:` montado + env de caches apontados para `D:\vibex\cache` (§4b); `status.ps1` verifica que nenhum lock/socket vive fora de `D:\vibex`.
- **RLS mal aplicado pode zerar leituras:** mitigado pelo teste de fumaça B1 antes da migração B2.
- **Tokens de extensão já emitidos para códigos inexistentes** não correspondem a nenhuma linha — invalidados implicitamente pela Fase C (nenhum `token_hash` no banco); sem ação de rotação necessária (ambiente dev).
- **Rollback:** cada fase é reversível por commit; nenhuma migration nova é exigida (schema já existe) — só correção de uso.

## 7. DoD

- [x] Nenhum `catch` fabrica `connected: true`; nenhum `Math.random()` como pairing; nenhum seed de status no boot.
- [x] Sem Postgres: endpoints retornam `503 STORE_UNAVAILABLE`, nunca dado fictício com `200`.
- [x] Com Postgres: RLS cross-tenant validado por teste; idempotência 10x→1 e Stop-on-Reply (DoD AGENTS.md itens 4–5) verdes.
- [x] `demo_token`/token-64-chars/`admin123` rejeitados por teste.
- [x] `go vet` + `go test -v ./...` verdes; `tsc --noEmit` verde no frontend.
- [x] `api/openapi.yaml` com os novos códigos de erro; cliente TS regenerado/alinhado.
- [x] Memória apensada; rules atualizadas se surgirem precedentes novos; este PRD marcado `implementado`.
- [x] Ação graphify: skill instalada e grafo inicial construído (ver linha Graphify no cabeçalho).

## 8. Memória

Registro apensado em `memory/001_registro_continuo_memoria.md` na seção `[2026-09-22] - Auditoria honestidade + Regra 09 + PRD-honestidade-conexao`.
