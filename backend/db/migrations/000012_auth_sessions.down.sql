-- VibexCorp LinkedIn Outreach - Database Schema Migration 000012 (DOWN)
DROP POLICY IF EXISTS auth_sessions_hash_update ON auth_sessions;
DROP POLICY IF EXISTS auth_sessions_hash_lookup ON auth_sessions;
DROP POLICY IF EXISTS auth_sessions_tenant_isolation ON auth_sessions;
DROP TABLE IF EXISTS auth_sessions;
