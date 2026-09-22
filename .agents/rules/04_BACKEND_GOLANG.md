# Regra 04: Backend Go, Chi, Asynq e Observabilidade

> **Escopo:** Padrões de engenharia para o backend em Go.

---

## 1. Roteamento e Handlers (Chi)
- O roteador HTTP oficial é `github.com/go-chi/chi/v5`.
- Todos os endpoints sob o prefixo `/api/v1`.
- Middlewares obrigatórios:
  - `RequestID`: Injeção de correlation ID em cada requisição.
  - `RealIP`: Extração segura do IP do cliente via proxy.
  - `Logger`: Structured logging via `log/slog` com `request_id`, `path`, `status`, `duration`.
  - `Recoverer`: Tratamento seguro de pânicos.
  - `AuthTenant`: Extração e validação do JWT, resolução do usuário e determinação estrita de `organization_id`.
  - `RLSContext`: Configuração de contexto para conexão transacional no PostgreSQL.

## 2. Processamento em Fila e Agendamento (Asynq)
- Fila baseada em Redis com `hibiken/asynq`.
- Tipos de jobs:
  - `campaign:step:execute`: Execução idempotente do step de mensagem.
  - `campaign:contact:schedule`: Agendamento de contatos para execução.
  - `campaign:followup:schedule`: Agendamento de follow-ups após tempo de espera.
  - `conversation:sync`: Sincronização de respostas para Stop on Reply.
  - `campaign:metrics:update`: Recálculo e agregação de métricas da campanha.
- Scheduler independente em `cmd/scheduler`: busca apenas contatos elegíveis (`waiting` e `next_execution_at <= NOW()`), adquire distributed lock no Redis e enfileira jobs no Asynq de forma transacional.

## 3. Logs Estruturados e Telemetria
- Utilizar exclusivamente a biblioteca padrão `log/slog` configurada com `slog.NewJSONHandler`.
- Formato padrão com campos obrigatórios: `level`, `time`, `msg`, `event`, `organization_id`, `campaign_id`, `contact_id`, `request_id`, `job_id`, `duration_ms`.
- Proibição absoluta de logar senhas, tokens de autenticação ou dados sensíveis.
- Tracing OpenTelemetry integrado para propagação de contexto distribuído entre API, Scheduler e Workers.
