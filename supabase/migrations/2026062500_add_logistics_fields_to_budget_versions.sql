-- Add logistics columns to budget_versions table
ALTER TABLE budget_versions 
  ADD COLUMN logistics_date text,
  ADD COLUMN logistics_time text,
  ADD COLUMN logistics_location text;
