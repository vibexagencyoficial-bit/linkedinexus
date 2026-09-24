-- VibexCorp LinkedIn Outreach - Migration 000009 (UP)
-- Admin schedule: permite ao worker de outreach listar as orgs com campanha
-- running sem vazar linhas de negócio. O grão de tenant continua garantido
-- porque cada passo do worker executa depois sob SET LOCAL app.organization_id
-- da própria org (policies *_tenant_isolation, FORCE RLS).
--
-- A role de runtime é vibex_admin (NOSUPERUSER, sem BYPASSRLS): sem esta policy
-- o SELECT DISTINCT em campaigns retorna 0 linhas e o worker vira no-op — o
-- que é seguro, porém paralisia silenciosa. A policy expõe SOMENTE
-- organization_id de campanhas running (nenhum nome, contato ou mensagem).

DROP POLICY IF EXISTS campaigns_worker_schedule ON campaigns;
CREATE POLICY campaigns_worker_schedule ON campaigns
    FOR SELECT
    USING (status = 'running');
