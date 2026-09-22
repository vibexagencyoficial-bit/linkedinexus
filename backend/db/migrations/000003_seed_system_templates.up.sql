-- VibexCorp LinkedIn Outreach - Database Schema Migration 000003 (UP)
-- Seed Recommended System Cadence Templates

INSERT INTO flow_templates (id, organization_id, name, description, is_system_template, created_at, updated_at)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    NULL,
    'Vibex Recommended B2B Outreach',
    'Cadência padrão de 3 etapas com verificação contínua de resposta e intervalos seguros recomendados pela VibexCorp.',
    true,
    NOW(),
    NOW()
) ON CONFLICT DO NOTHING;

INSERT INTO flow_template_steps (id, flow_template_id, position, step_type, name, template_body, delay_amount, delay_unit, conditions)
VALUES
(
    gen_random_uuid(),
    'a0000000-0000-0000-0000-000000000001',
    1,
    'message',
    'Mensagem Inicial de Conexão',
    'Olá {{first_name}}, tudo bem?\n\nVi que você atua como {{job_title}} na {{company}} e achei muito interessante a trajetória da equipe. Gostaria de trocar uma ideia rápida sobre otimização de processos B2B.\n\nUm abraço!',
    0,
    'days',
    '{}'::jsonb
),
(
    gen_random_uuid(),
    'a0000000-0000-0000-0000-000000000001',
    2,
    'wait',
    'Aguardar Janela de Resposta #1',
    '',
    2,
    'days',
    '{}'::jsonb
),
(
    gen_random_uuid(),
    'a0000000-0000-0000-0000-000000000001',
    3,
    'check_reply',
    'Checar Resposta (Stop on Reply)',
    '',
    0,
    'days',
    '{"stop_if_replied": true}'::jsonb
),
(
    gen_random_uuid(),
    'a0000000-0000-0000-0000-000000000001',
    4,
    'message',
    'Follow-up #1: Compartilhar Valor',
    'Oi {{first_name}}, passando rapidamente por aqui!\n\nImagino que sua rotina na {{company}} esteja corrida. Desenvolvemos recentemente um modelo prático de cadência e gostaria de saber se faz sentido compartilhar um benchmark rápido com você.\n\nFico à disposição!',
    0,
    'days',
    '{}'::jsonb
),
(
    gen_random_uuid(),
    'a0000000-0000-0000-0000-000000000001',
    5,
    'wait',
    'Aguardar Janela de Resposta #2',
    '',
    4,
    'days',
    '{}'::jsonb
),
(
    gen_random_uuid(),
    'a0000000-0000-0000-0000-000000000001',
    6,
    'check_reply',
    'Checar Resposta (Stop on Reply)',
    '',
    0,
    'days',
    '{"stop_if_replied": true}'::jsonb
),
(
    gen_random_uuid(),
    'a0000000-0000-0000-0000-000000000001',
    7,
    'message',
    'Follow-up Final: Breakup Amigável',
    '{{first_name}}, tudo bem?\n\nImagino que agora não seja a prioridade para a {{company}}, então não quero lotar sua caixa de entrada. Deixo meu contato aberto caso queira retomar essa conversa no futuro.\n\nSucesso nos negócios!',
    0,
    'days',
    '{}'::jsonb
),
(
    gen_random_uuid(),
    'a0000000-0000-0000-0000-000000000001',
    8,
    'end',
    'Fim de Cadência',
    '',
    0,
    'days',
    '{}'::jsonb
) ON CONFLICT DO NOTHING;
