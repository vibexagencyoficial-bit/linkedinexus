-- VibexCorp LinkedIn Outreach - Database Schema Migration 000004 (DOWN)
DROP POLICY IF EXISTS account_capabilities_tenant_isolation ON linkedin_account_capabilities;
DROP TABLE IF EXISTS linkedin_account_capabilities CASCADE;

DROP POLICY IF EXISTS extension_devices_tenant_isolation ON extension_devices;
DROP TABLE IF EXISTS extension_devices CASCADE;
