# Regra 03: Skills, Qualidade e Critérios de Aceite

> **Escopo:** Catálogo de skills aplicadas e critérios rigorosos de verificação.

---

## 1. Gestão de Skills
- Skills locais ficam em `.agents/skills/`.
- Antes de iniciar uma feature complexa ou visual, alinhar proativamente ou selecionar as skills mais adequadas (ex: `frontend-design`).
- Skills de design devem ser consultadas para evitar layouts genéricos, respeitando a estética corporativa B2B da VibexCorp.

## 2. Padrões de Qualidade de Código
- **Go**: Seguir Clean Architecture, nomes idiomáticos, tratamento explícito de erros (sem panics em runtime de produção), injeção de dependência explícita, zero goroutines soltas sem context cancellation.
- **TypeScript**: Modo estrito (`strict: true`), proibição de `any`, tipos gerados via OpenAPI sem duplicidade manual.
- **SQL**: Totalmente tipado via sqlc, índices planejados para filtros e foreign keys, parametrização estrita contra SQL injection.

## 3. Critérios de Aceite Inegociáveis (Gate de Conclusão)
- Compilação Go (`go vet ./...` e `go test ./...`) passando com zero erros.
- Checagem TypeScript (`tsc --noEmit`) com zero erros.
- Testes unitários e de integração validando RLS, concorrência e idempotência.
- Trilha de auditoria e logs estruturados em formato JSON para todas as ações do pipeline.
