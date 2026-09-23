-- Migration 000011 (UP): RLS na tabela organizations.
--
-- 000002 habilitou RLS em contacts/users/campaigns/... mas Organizations
-- ficou de fora: qualquer sessão autenticada lia nome/slug/platform_settings
-- de TODAS as organizações. A partir daqui cada organização só enxerga a si
-- mesma (mesma chave app.organization_id das demais tabelas).
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_tenant_isolation ON organizations;
CREATE POLICY organizations_tenant_isolation ON organizations
    FOR ALL
    USING (id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
    WITH CHECK (id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
