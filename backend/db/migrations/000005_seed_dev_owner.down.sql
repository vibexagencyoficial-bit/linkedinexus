-- VibexCorp LinkedIn Outreach - Database Schema Migration 000005 (DOWN)
BEGIN;
SELECT set_config('app.organization_id', id::text, true)
FROM organizations WHERE slug = 'vibexcorp-dev';
DELETE FROM users WHERE email = 'admin@vibexcorp.com';
DELETE FROM organizations WHERE slug = 'vibexcorp-dev';
COMMIT;
