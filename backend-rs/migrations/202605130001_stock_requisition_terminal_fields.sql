ALTER TABLE stock_requisitions
    ADD COLUMN IF NOT EXISTS rejection_reason text,
    ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
