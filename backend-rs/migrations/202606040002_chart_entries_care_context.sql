ALTER TABLE chart_entries
    ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chart_entries_facility_encounter_time_idx
    ON chart_entries (facility_id, encounter_id, measured_at DESC, id DESC)
    WHERE encounter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS chart_entries_facility_visit_time_idx
    ON chart_entries (facility_id, visit_id, measured_at DESC, id DESC)
    WHERE visit_id IS NOT NULL;
