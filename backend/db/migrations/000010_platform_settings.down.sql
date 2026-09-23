-- Migration 000010 (DOWN)
ALTER TABLE organizations
    DROP COLUMN IF EXISTS platform_settings;
