-- Migration 000010 (UP): Platform Settings por organização.
-- Fonte da verdade dos limites globais configurados na tela de settings
-- (limite diário desejado + janela de execução) — fim do "salvar" fake.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS platform_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
