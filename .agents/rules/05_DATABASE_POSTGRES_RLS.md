# Regra 05: PostgreSQL, Multi-Tenancy e Row Level Security (RLS)

> **Escopo:** Modelagem de dados, isolamento multi-inquilino e integridade relacional.

---

## 1. Fonte Única da Verdade (Source of Truth)
- O PostgreSQL armazena todo o estado persistente do sistema.
- Proibido qualquer acesso direto ao PostgreSQL a partir de clientes externos (frontend Next.js ou extensão Chrome). Toda mutação e leitura passa pela API Go.

## 2. Multi-Tenancy Obrigatório
- Todas as tabelas de dados de negócio possuem obrigatoriamente a coluna `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`.
- O valor de `organization_id` NUNCA é aceito do corpo ou parâmetro da requisição sem validação cruzada com o token JWT autenticado.

## 3. Row Level Security (RLS)
- Habilitar RLS em todas as tabelas multi-tenant:
  ```sql
  ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation_policy ON contacts
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
  ```
- No Go (`pgxpool`), antes de cada query ou dentro da transação, estabelecer o parâmetro local:
  ```sql
  SET LOCAL app.organization_id = $1;
  ```
- Testes automatizados de regressão devem validar que Tenant A não pode visualizar nem modificar registros de Tenant B.

## 4. Idempotência e Deduplicação no Banco
- Índice único para contatos por tenant:
  ```sql
  CREATE UNIQUE INDEX idx_contacts_org_linkedin ON contacts(organization_id, linkedin_url);
  ```
- Índice único determinístico para prevenir dupla execução do mesmo step:
  ```sql
  CREATE UNIQUE INDEX idx_message_jobs_idempotency ON message_jobs(campaign_id, contact_id, campaign_step_id);
  ```
