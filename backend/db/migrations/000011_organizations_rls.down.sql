-- Migration 000011 (DOWN): remove o RLS da tabela organizations (estado de
-- antes — não recomendado, mas necessário para reverter a migration).
DROP POLICY IF EXISTS organizations_tenant_isolation ON organizations;
ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
