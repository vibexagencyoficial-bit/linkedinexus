# Regra 01: Arquitetura e Padrões Globais

> **Escopo:** Regras arquiteturais invioláveis para o ecossistema VibexCorp LinkedIn Outreach.

---

## 1. Modular Monolith
- O backend Go é um monolito modular.
- Não crie microsserviços neste estágio.
- A comunicação entre módulos ocorre via interfaces Go limpas e tipadas.
- Toda regra de negócio deve residir em `internal/<modulo>`, desacoplada dos handlers HTTP (`cmd/api`).

## 2. Separação Estrita de Responsabilidades
- **PostgreSQL**: Fonte única da verdade (Source of Truth).
- **Redis**: Exclusivo para filas (Asynq), distributed locks, cache efêmero, rate limiting e deduplicação transitória. Não utilizar como persistência definitiva.
- **Go Backend**: Núcleo autoritativo de inteligência, validações, agendamento de steps e políticas de segurança.
- **Next.js Frontend**: Interface thin client (consumidor de API REST e SSE). Zero lógica de agendamento ou regras de negócio críticas.
- **Chrome Extension (WXT)**: Thin client para interação contextual no navegador. Proibido conter scheduler, retries autônomos ou controle de campanhas.

## 3. Atomicidade e Idempotência
- Toda execução de step ou transição de estado DEVE ser atômica e transacional (`BEGIN ... COMMIT`).
- Chave de idempotência obrigatória composta por: `campaign_id + contact_id + campaign_step_id`.
- O banco DEVE possuir restrição UNIQUE na tabela de execuções para impedir duplicidade sob concorrência.

## 4. Resiliência e Desacoplamento
- O sistema deve operar de modo que:
  - O frontend possa cair sem interromper os workers.
  - A extensão possa ser fechada sem afetar a fila ou as campanhas em andamento.
  - O Redis possa reiniciar sem corromper ou perder o estado definitivo salvo no PostgreSQL.
  - Os workers possam reiniciar e recuperar jobs pendentes sem duplicidade.
