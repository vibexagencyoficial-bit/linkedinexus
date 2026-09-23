-- VibexCorp LinkedIn Outreach - Database Schema Migration 000007 (UP)
-- O pareamento e pre-tenant: a extensao nao tem JWT ainda; o codigo efemero
-- gerado no SaaS e a credencial. As policies abaixo liberam SELECT/UPDATE
-- em extension_devices somente quando o handler declara o modo de pareamento
-- (set_config('app.pairing_lookup','on', true) na transacao do handler).
-- Demais queries permanecem isoladas por app.organization_id.

DROP POLICY IF EXISTS extension_devices_pairing ON extension_devices;
CREATE POLICY extension_devices_pairing ON extension_devices
    FOR SELECT
    USING (NULLIF(current_setting('app.pairing_lookup', true), '') = 'on');

DROP POLICY IF EXISTS extension_devices_pairing_update ON extension_devices;
CREATE POLICY extension_devices_pairing_update ON extension_devices
    FOR UPDATE
    USING (NULLIF(current_setting('app.pairing_lookup', true), '') = 'on')
    WITH CHECK (NULLIF(current_setting('app.pairing_lookup', true), '') = 'on');
