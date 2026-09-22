-- VibexCorp LinkedIn Outreach - Database Schema Migration 000004 (UP)
-- Extension Devices & LinkedIn Account Capabilities

-- 1. Extension Devices (Pairing, Heartbeat, Token Hash)
CREATE TABLE IF NOT EXISTS extension_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(255) NOT NULL,
    pairing_code VARCHAR(32),
    pairing_expires_at TIMESTAMPTZ,
    token_hash VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_extension_devices_org ON extension_devices(organization_id);
CREATE INDEX IF NOT EXISTS idx_extension_devices_pairing ON extension_devices(pairing_code) WHERE pairing_code IS NOT NULL;

-- 2. LinkedIn Account Capabilities (Discovered and authorized explicitly)
CREATE TABLE IF NOT EXISTS linkedin_account_capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    linkedin_account_id UUID NOT NULL REFERENCES linkedin_accounts(id) ON DELETE CASCADE,
    profile_read BOOLEAN NOT NULL DEFAULT true,
    connections_read BOOLEAN NOT NULL DEFAULT true,
    messaging_available BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_account_capabilities UNIQUE (linkedin_account_id)
);
CREATE INDEX IF NOT EXISTS idx_account_capabilities_org ON linkedin_account_capabilities(organization_id);

-- 3. Enable RLS on both tables
ALTER TABLE extension_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_devices FORCE ROW LEVEL SECURITY;
CREATE POLICY extension_devices_tenant_isolation ON extension_devices
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

ALTER TABLE linkedin_account_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkedin_account_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY account_capabilities_tenant_isolation ON linkedin_account_capabilities
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
