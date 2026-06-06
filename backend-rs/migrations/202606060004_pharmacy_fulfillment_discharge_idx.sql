CREATE INDEX IF NOT EXISTS pharmacy_fulfillments_discharge_clearance_idx
    ON pharmacy_fulfillments (
        facility_id,
        admission_case_id,
        patient_id,
        dispensed_at DESC,
        id
    )
    WHERE status = 'dispensed';
