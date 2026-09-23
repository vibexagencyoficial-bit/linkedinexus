-- VibexCorp LinkedIn Outreach - Migration 000009 (DOWN)
-- Remove a policy administrativa de agendamento do worker.

DROP POLICY IF EXISTS campaigns_worker_schedule ON campaigns;
