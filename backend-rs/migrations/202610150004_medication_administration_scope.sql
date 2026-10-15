-- Patient/admission MAR windows must seek within their own schedule before
-- cursor pagination, independently of other patients' dose volume.
CREATE INDEX medication_administrations_facility_patient_schedule_idx
    ON medication_administrations (facility_id, patient_id, scheduled_at, id);

CREATE INDEX medication_administrations_facility_admission_schedule_idx
    ON medication_administrations (facility_id, admission_case_id, scheduled_at, id);
