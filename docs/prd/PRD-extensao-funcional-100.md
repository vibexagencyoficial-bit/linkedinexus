# PRD-extensao-funcional-100 — Extensão e pipeline de outreach funcionais de ponta a ponta

- **Data:** 2026-09-23
- **Autor:** Claude (execução a pedido do usuário: "100% funcional")
- **Tipo:** feature + bugfix (pipeline real sem simulação)
- **Status:** implementado (2026-09-23 — F3–F7 concluídos e provados ao vivo; ver §5)
- **Rules impactadas:** 01 (backend autoritativo), 05 (RLS/fonte da verdade), 06 (frontend sem fake), 07 (extensão thin client), 09 (PRD próprio)

## 1. Problema (evidência da sessão anterior)

O PRD-honestidade-conexao tornou o contrato honesto, mas o sistema ainda não **fazia** nada de ponta a ponta:

1. **Extensão sem pipeline:** o background fazia `fetch` cross-origin do content script (bloqueado no MV3), disparo de mensagens simulado no DOM e popup com botão de envio fake.
2. **Página da extensão inexistente:** pareamento e download viviam só escondidos na settings; sem página dedicada nem instruções de instalação.
3. **Upload de listas:** `Criar Nova Campanha` não tinha upload CSV/JSON nem picker de contatos; contatos só via seed/extração.
4. **Organizador de listas:** não existia ferramenta para normalizar listas externas (Google Sheets, export do LinkedIn).
5. **Banco "não funcionava"** (relato do usuário) — 6 bugs reais escondidos atrás de testes que chamavam handlers direto: header CSV com espaço não casava (importava 0), `COPY FROM` incompatível com RLS (`SQLSTATE 0A000`), heartbeat roteado atrás de JWT (401 eterno), panic nil-deref em pending-outreach com fila vazia, worker multi-tenant no-op sob RLS de `campaigns` (policy 000009 existia em disco mas o sintoma reapareceu em outra forma — ver §2.6), e nomes `full_name` sem decomposição (worker parava tudo com `missing_variables`).

## 2. Escopo (o que entrou)

### F3 — Extensão MV3 com pipeline real (`ext/entrypoints/`)
- `background.ts`: único cliente da API (content script nunca faz fetch cross-origin). Loop: poll 5s `GET /messaging/pending-outreach` → `POST /assist/humanize` (proxy Typesafe/Jev, parâmetros humanos de digitação) → aba LinkedIn (reusa ou cria, navegação com listener antes do `tabs.update`) → `EXECUTE_OUTREACH_JOB` no content script → `POST /messaging/report-sent` com `job_id` (erro → backend faz retry). Keepalive por `chrome.alarms` (1 min, recriado em `onInstalled`/`onStartup`), estado publicado em `chrome.storage.local` (`bg_state`).
- `content.ts`: `executeOutreachJob` real — findMessageButton → composer (`contenteditable`) → `typeHumanly` (char-a-char, cps variável, pausas longas) → send. Erros honestos `MESSAGE_BUTTON_NOT_FOUND`/`COMPOSER_NOT_FOUND`/`SEND_BUTTON_NOT_FOUND`. Barra flutuante sincroniza via `SYNC_CONNECTIONS` (background), nunca fetch direto.
- `popup/App.tsx`: pareamento real (`POST /extension/pair` → `extension_token` + `api_jwt` em `chrome.storage.local`), estado ao vivo, pausa, extração de conexões; sem botão de disparo fake. Zip MV3 regenerado (`ext/vibexcorp-extension.zip`).

### F4 — Página `/extension`
- Rota dedicada na sidebar (`Puzzle`): badge real (poll 3s, erro honesto), código de pareamento da API, download do zip (`/downloads/extension.zip`), 5 passos de instalação, explicação do pipeline (4 passos + assist Jev/Typesafe). Testes `extension-honest.test.tsx` (4).

### F5 — Settings com limites reais
- `loadLimits`/`saveDailyLimits` contra `GET/PUT /accounts/daily-limits` (000010 `platform_settings`); slider clampado ao teto do servidor; erro real na tela (nunca "Configurações Salvas" sem persistência). Testes `settings-honest.test.tsx` reescritos (6).

### F6 — Upload CSV/JSON + organizador
- **Frontend:** picker de contatos com seleção em `Criar Nova Campanha` (`contact_ids`), upload inline CSV/JSON na criação e em Contatos (`api.importContactsFile`; JSON → `sync-linkedin`, CSV → multipart), mensagem honesta de linhas importadas.
- **Backend:** header CSV normalizado (BOM, espaço→underscore, aliases pt-BR/en); import sem `COPY` (pgx.Batch chunk 500); sync-linkedin idem + upsert por URL; **decomposição de `full_name`** nos 3 pontos de entrada (`splitFullName`: "Bruno Costa"→first/last; "Silva, Marcos"→invertido).
- **Organizador:** `scripts/list/normalize.mjs` (Node 18+, zero deps) — delimitador `;`/`,`/TAB, RFC-4180, BOM, aliases pt-BR/en, fallback fuzzy, normalização de URL (https, remove `?trk=`, valida `/in/`), dedupe por URL, inversão "Sobrenome, Nome", relatório de descartes. README + amostras. Provado: CSV 7→5, JSON 4→2.

### F7 — Correções do banco/worker (o "banco não funciona")
1. Header CSV com espaço → normalização + aliases (importava 0/3).
2. `COPY FROM` + RLS = `SQLSTATE 0A000` → pgx.Batch no import **e** no sync-linkedin.
3. `/extension/heartbeat` atrás de JWT → movido para grupo público (autentica por `token_hash` sha256).
4. Panic nil-deref em pending-outreach com fila vazia → scan local + guard `if job != nil`.
5. Worker no-op: policy `campaigns_worker_schedule` (000009) aplicada; diagnóstico mostrou que o RLS esconde tudo de consultas sem tenant (comportamento correto — consultas de diagnóstico agora como superuser).
6. **Cadência vazia completava contatos:** `currentMessageStep` marcava `completed` em `ErrNoRows` mesmo na posição 1 — contato encerrado sem nunca receber nada. Correção: completa só quem já avançou (`position > 1`); cadência vazia deixa pendente. Regressão `TestPipeline_CadenciaVazia_NaoCompletaContatos`.

## 3. Fora de escopo
- Chrome Web Store / instalação automática no navegador do usuário.
- OAuth real do LinkedIn (arquitetura Zero-Evasion via extensão segue valendo).
- Scheduler Asynq / inbox / flow builder visual (débitos próprios).

## 4. Prova E2E viva (2026-09-23 ~01:33, banco local 5433)
Campanha "Prova Upload E2E" (org demo), 3 contatos sincronizados, steps via API:
1. `POST /extension/heartbeat` → 200 (device 72b55673, org demo).
2. Ticker 4s: 3 jobs `queued` com render real — "Ola Ana, vi seu trabalho na Acme. Podemos conversar?" — contatos `waiting` (reserva), 1 despacho por org por tick.
3. `GET /messaging/pending-outreach` (api_jwt) → job completo com `rendered_message`, `queue_remaining: 3`, `daily_remaining: 50`.
4. `POST /messaging/report-sent` (job_id) → `recorded`; job `sent`; contato avançou posição 1→2.
5. Cooldown de segurança (90s, Redis) respeitado; heartbeat expirado (2min) pausa o worker — gates funcionando.
6. Passo WAIT (posição 2) roteado pelo tick seguinte: posição 3, `next_execution_at = +2 dias` exato.

## 5. Gates executados (resultado real)
- `go vet ./...` limpo; `go test ./...` ok (31 testes backend, incluindo a regressão nova).
- `npx tsc --noEmit` frontend, `packages/api-client` e `ext`: exit 0.
- `npx vitest run`: 3 arquivos, 13/13 PASS.
- **Débito:** `graphify . --update` falhou 2× por infra externa do graphify (Cloudflare worker `beta-llm.rafaelkefren.workers.dev` 404 `workers_dev_script_not_found`, não-retryable). Re-run quando o serviço voltar.

## 6. Credenciais de dev local (banco 5433)
- Login: `admin@vibexcorp.local` / `Vibex@2026` (seed da org demo; NÃO usar em produção).
