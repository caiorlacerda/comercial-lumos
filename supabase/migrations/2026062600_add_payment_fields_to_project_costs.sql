-- Migration: Add payment tracking fields to project_costs
-- Created: 2026-06-26

ALTER TABLE project_costs
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente',
ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES app_users(id) ON DELETE SET NULL;
