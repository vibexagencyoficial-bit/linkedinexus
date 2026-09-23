# Regra 09: PRD, Contexto Persistente e Governança Obrigatória por Mudança

> **Escopo:** Obrigação de documentar toda feature, correção, refactor ou migração ANTES e DEPOIS de implementar, mantendo o projeto sempre com contexto correto. Precedência normativa: esta regra complementa as Regras 01–08 e a Regra 02 (memória contínua); em caso de conflito, valem as regras de segurança (01, 05, 08).

---

## 1. Obrigatoriedade (o que exige ritual)

TODA mudança não-trivial exige o ritual desta regra:

- Nova feature, nova tela, novo endpoint, novo job/worker.
- Correção de bug (qualquer severidade que altere comportamento).
- Refactor, migração de schema, mudança de contrato OpenAPI.
- Mudança em auth, RLS/tenancy, rate limit, circuit breaker, pareamento de extensão.

**Trivial (dispensado):** typo, formatação, comentário, renomeação sem mudança de comportamento, pergunta direta. Em caso de dúvida, aplica o ritual.

## 2. Ritual obrigatório (ordem fixa)

### 2.1 ANTES de escrever código

1. **PRD da mudança** em `docs/prd/PRD-<slug>.md` (template na §5). Arquivo novo por mudança, nomeado `PRD-<area>-<descricao-curta>.md` (ex.: `PRD-auth-remover-demo-token.md`). Nunca reutilizar o PRD de outra mudança.
2. **Preencher impacto nas rules**: o PRD deve declarar explicitamente quais arquivos de `.agents/rules/01–08` são impactados e, se a mudança criar precedente novo, propor a atualização da rule correspondente (a edição da rule entra no mesmo PR/commit da mudança).
3. **Contexto persistente**: registrar a intenção no documento ativo de `memory/` (Regra 02 — apensar ao final, nunca criar arquivo novo) com link para o PRD. Se `/graphify` estiver instalado (`~/.claude/skills/graphify/SKILL.md`), executar também o graphify da mudança; se não estiver instalado, registrar no PRD e na memória `graphify: pendente (skill não instalada)` — a ausência da skill NÃO dispensa o registro em `memory/`.
4. **Contrato OpenAPI**: se a mudança toca a API, atualizar `api/openapi.yaml` no mesmo PRD antes de codar (o cliente TS é gerado do contrato; proibido drift manual — Regra 06 §2).

### 2.2 DURANTE a implementação

- TDD obrigatório (Regra 03 §3): teste primeiro, depois código. Cobrir no mínimo: caminho feliz, falha/erro honesto (sem fallback que fabrique sucesso) e, quando aplicável, isolamento cross-tenant (RLS) e idempotência (reenfileirar 10x → 1 efeito).
- Proibido `catch` que fabrique sucesso no frontend, backdoor de auth (`demo_token`, token por comprimento), seed de status "conectado" no boot do backend, dados fake como reais. Erro real deve chegar à UI como erro real.

### 2.3 DEPOIS de implementar (Definition of Done documental)

1. Apensar ao `memory/` ativo: decisões, arquivos criados/alterados, testes executados com resultados, status DoD (conforme Regra 02 §2 — data, título, decisões, arquivos, testes, status).
2. Atualizar a(s) rule(s) impactada(s) se a mudança criou ou alterou precedente arquitetural.
3. Marcar no PRD: `Status: implementado | testes: <resultado> | memória: <link/âncora>`.

Sem os 3 itens, a tarefa NÃO está concluída.

## 3. Graphify (contexto persistente em grafo)

- Quando a skill `graphify` estiver instalada, seu uso é **obrigatório** para toda mudança não-trivial (mesmo ritual do PRD: antes = intenção/entidades; depois = resultado/relações).
- Comando: `/graphify` conforme `~/.claude/skills/graphify/SKILL.md`.
- Se a skill não estiver instalada: registrar `graphify: pendente` no PRD e na memória; abrir item de ação para instalar. A pendência deve ser resolvida (instalar ou remover formalmente esta seção), nunca normalizada como permanente.
- O grafo NÃO substitui `memory/` nem as rules — os três coexistem: grafo = relações/entidades, memória = histórico cronológico, rules = norma vigente.

## 4. Checklist de revisão (para code review)

- [ ] Existe `docs/prd/PRD-<slug>.md` com problema, escopo, fora de escopo, contrato e plano de testes?
- [ ] Impacto nas rules 01–08 declarado? Rules atualizadas se houve precedente novo?
- [ ] Registro apensado ao `memory/` ativo (sem arquivo novo)?
- [ ] Graphify executado ou marcado `pendente` com motivo?
- [ ] `api/openapi.yaml` atualizado se a API mudou?
- [ ] Nenhum fallback que fabrique sucesso, nenhum dado fake como real?
- [ ] Testes de RLS cross-tenant + idempotência quando aplicável?
- [ ] `go vet` + `go test` e `tsc --noEmit` verdes?

## 5. Template de PRD (copiar para cada `docs/prd/PRD-<slug>.md`)

```markdown
# PRD-<slug>

- **Data:**
- **Autor:**
- **Tipo:** [feature | bugfix | refactor | migração | contrato]
- **Status:** [proposto | em implementação | implementado]
- **Rules impactadas:** [ex.: 04, 05, 07]
- **Graphify:** [executado | pendente — motivo]

## 1. Problema (evidência, não opinião)
## 2. Escopo (o que entra)
## 3. Fora de escopo (o que NÃO entra)
## 4. Contrato (endpoints/tipos/eventos; link para diff do openapi.yaml)
## 5. Plano de implementação (passos + TDD por passo)
## 6. Riscos e segurança (RLS, auth, rate limit, rollback)
## 7. DoD (testes exigidos + resultado após implementar)
## 8. Memória (âncora do registro em memory/)
```
