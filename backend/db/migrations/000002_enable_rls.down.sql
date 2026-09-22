-- VibexCorp LinkedIn Outreach - Database Schema Migration 000002 (DOWN)
DROP POLICY IF EXISTS flow_templates_tenant_isolation ON flow_templates;
ALTER TABLE flow_templates DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit_logs;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS events_tenant_isolation ON events;
ALTER TABLE events DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_tenant_isolation ON messages;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_tenant_isolation ON conversations;
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_jobs_tenant_isolation ON message_jobs;
ALTER TABLE message_jobs DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_contacts_tenant_isolation ON campaign_contacts;
ALTER TABLE campaign_contacts DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_steps_tenant_isolation ON campaign_steps;
ALTER TABLE campaign_steps DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaigns_tenant_isolation ON campaigns;
ALTER TABLE campaigns DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS linkedin_accounts_tenant_isolation ON linkedin_accounts;
ALTER TABLE linkedin_accounts DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_tenant_isolation ON users;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contacts_tenant_isolation ON contacts;
ALTER TABLE contacts DISABLE ROW LEVEL SECURITY;
