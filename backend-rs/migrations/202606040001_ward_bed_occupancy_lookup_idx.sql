CREATE INDEX IF NOT EXISTS admission_cases_active_bed_lookup_idx
    ON admission_cases (facility_id, bed_id, admitted_at DESC, id DESC)
    WHERE status IN ('admitted', 'discharge_pending');

CREATE INDEX IF NOT EXISTS beds_ward_created_lookup_idx
    ON beds (facility_id, ward_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS beds_section_created_lookup_idx
    ON beds (facility_id, section_id, created_at ASC, id ASC);
