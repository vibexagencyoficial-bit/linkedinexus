-- VibexCorp LinkedIn Outreach - Database Schema Migration 000005 (UP)
-- Seed do tenant owner de desenvolvimento + usuario owner com hash bcrypt real.
-- Requisito da Fase D (PRD-honestidade-conexao): /auth/login valida contra a
-- tabela users; sem bootstrap admin123 no handler.
-- users tem FORCE ROW LEVEL SECURITY e a role da API nao e superuser, entao o
-- INSERT so passa com app.organization_id setado (BEGIN + set_config local).

INSERT INTO organizations (name, slug)
VALUES ('VibexCorp (Dev)', 'vibexcorp-dev')
ON CONFLICT (slug) DO NOTHING;

BEGIN;
SELECT set_config('app.organization_id', id::text, true)
FROM organizations WHERE slug = 'vibexcorp-dev';

INSERT INTO users (organization_id, email, password_hash, name, role)
SELECT id, 'admin@vibexcorp.com',
       '$2a$10$w9D39x9PpQsDa8LerCreDOxwsPQVDQKoSMQ5EHrDa2T4sjHLuMGfm',
       'Lucas (VibexCorp)', 'owner'
FROM organizations WHERE slug = 'vibexcorp-dev'
ON CONFLICT (email) DO NOTHING;
COMMIT;
