-- Deterministic scoped cursor reads; no clinical data or inferred associations.
CREATE INDEX treatment_sheets_facility_cursor_idx
    ON treatment_sheets (facility_id, updated_at, id);
CREATE INDEX treatment_sheets_facility_patient_cursor_idx
    ON treatment_sheets (facility_id, patient_id, updated_at, id);
CREATE INDEX treatment_sheets_facility_admission_cursor_idx
    ON treatment_sheets (facility_id, admission_case_id, updated_at, id);
CREATE INDEX nursing_alerts_facility_cursor_idx
    ON nursing_alerts (facility_id, created_at, id);
CREATE INDEX nursing_alerts_facility_patient_cursor_idx
    ON nursing_alerts (facility_id, patient_id, created_at, id);
CREATE INDEX nursing_alerts_facility_admission_cursor_idx
    ON nursing_alerts (facility_id, admission_case_id, created_at, id);
CREATE INDEX nursing_alerts_open_critical_cursor_idx
    ON nursing_alerts (facility_id, created_at DESC, id DESC)
    WHERE status = 'open' AND severity IN ('high', 'critical');
CREATE INDEX handoffs_facility_cursor_idx
    ON handoffs (facility_id, created_at, id);
CREATE INDEX handoffs_facility_ward_cursor_idx
    ON handoffs (facility_id, ward_id, created_at, id);
