ALTER TABLE referrals
    ADD COLUMN IF NOT EXISTS acceptance_notes text,
    ADD COLUMN IF NOT EXISTS decline_reason text,
    ADD COLUMN IF NOT EXISTS specialist_notes text,
    ADD COLUMN IF NOT EXISTS recommendations text,
    ADD COLUMN IF NOT EXISTS completed_at timestamptz;
