-- VibexCorp LinkedIn Outreach - Database Schema Migration 000012 (UP)
-- Sessões de acesso TEMPORÁRIAS e revogáveis (painel + extensão). Toda sessão
-- vive por hash (nunca token cru), com expires_at curto e revoked_at para
-- revogação imediata (logout, desconectar, comprometimento).
-- Policies: (1) isolamento por organização p/ INSERT e leitura scoped;
-- (2) lookup por hash sem contexto de tenant (refresh/middleware) só com o
-- modo declarado transacionalmente pelo handler (set_config app.session_lookup).

CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    user_id UUID NOT NULL,
    device_id UUID,
    token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('panel', 'extension', 'refresh')),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_org ON auth_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_kind_expiry ON auth_sessions(kind, expires_at);

-- Expiração do extension_token (device): 30d, renovável por re-pareamento.
ALTER TABLE extension_devices ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_sessions_tenant_isolation ON auth_sessions;
CREATE POLICY auth_sessions_tenant_isolation ON auth_sessions
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

DROP POLICY IF EXISTS auth_sessions_hash_lookup ON auth_sessions;
CREATE POLICY auth_sessions_hash_lookup ON auth_sessions
    FOR SELECT
    USING (NULLIF(current_setting('app.session_lookup', true), '') = 'on');

DROP POLICY IF EXISTS auth_sessions_hash_update ON auth_sessions;
CREATE POLICY auth_sessions_hash_update ON auth_sessions
    FOR UPDATE
    USING (NULLIF(current_setting('app.session_lookup', true), '') = 'on')
    WITH CHECK (NULLIF(current_setting('app.session_lookup', true), '') = 'on');
