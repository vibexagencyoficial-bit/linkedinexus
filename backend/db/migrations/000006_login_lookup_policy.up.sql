-- VibexCorp LinkedIn Outreach - Database Schema Migration 000006 (UP)
-- O lookup de login e pre-tenant: nenhuma organizacao e conhecida antes de
-- autenticar. A policy abaixo permite SELECT em users somente quando a API
-- declara o modo de lookup (set_config('app.login_lookup','on', true) DENTRO
-- da transacao do handler). Todas as demais queries continuam sujeitas ao
-- isolamento por app.organization_id.

DROP POLICY IF EXISTS users_login_lookup ON users;
CREATE POLICY users_login_lookup ON users
    FOR SELECT
    USING (NULLIF(current_setting('app.login_lookup', true), '') = 'on');
