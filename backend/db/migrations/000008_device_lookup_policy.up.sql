-- VibexCorp LinkedIn Outreach - Database Schema Migration 000008 (UP)
-- Heartbeat da extensao: o device e resolvido pelo hash do token (par criado no
-- pareamento), sem depender de claims fabricados. As policies liberam
-- SELECT/UPDATE somente quando o handler declara o modo de lookup
-- (set_config('app.device_lookup','on', true) na transacao do handler).

DROP POLICY IF EXISTS extension_devices_heartbeat ON extension_devices;
CREATE POLICY extension_devices_heartbeat ON extension_devices
    FOR SELECT
    USING (NULLIF(current_setting('app.device_lookup', true), '') = 'on');

DROP POLICY IF EXISTS extension_devices_heartbeat_update ON extension_devices;
CREATE POLICY extension_devices_heartbeat_update ON extension_devices
    FOR UPDATE
    USING (NULLIF(current_setting('app.device_lookup', true), '') = 'on')
    WITH CHECK (NULLIF(current_setting('app.device_lookup', true), '') = 'on');
