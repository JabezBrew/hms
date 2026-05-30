CREATE INDEX IF NOT EXISTS admission_cases_facility_status_admitted_idx
    ON admission_cases (facility_id, status, admitted_at, id)
    WHERE status IN ('admitted', 'discharge_pending');
