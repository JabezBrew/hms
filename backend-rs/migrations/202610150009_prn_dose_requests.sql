-- Explicit prescriber policy is optional for legacy compatibility. Missing policy
-- never authorizes a PRN request; no dose limits are inferred or backfilled.
ALTER TABLE prescriptions ADD COLUMN prn_policy jsonb;
ALTER TABLE medication_courses ADD COLUMN prescription_prn_policy jsonb;
ALTER TABLE medication_administrations
    ADD COLUMN prn_request_id uuid,
    ADD COLUMN prn_indication text,
    ADD COLUMN prn_requested_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_prn_policy_check CHECK (
    prn_policy IS NULL OR (
        lower(trim(frequency)) = 'prn' AND inventory_item_id IS NOT NULL
        AND jsonb_typeof(prn_policy) = 'object'
        AND prn_policy ?& ARRAY['minimum_interval_hours','maximum_doses_per_24_hours','stock_units_per_dose','indication','stock_unit']
        AND NOT jsonb_path_exists(prn_policy, '$.* ? (@ == null)')
        AND (prn_policy->>'minimum_interval_hours')::integer IN (4, 6, 8, 12, 24)
        AND (prn_policy->>'maximum_doses_per_24_hours')::integer BETWEEN 1 AND 24 / (prn_policy->>'minimum_interval_hours')::integer
        AND (prn_policy->>'stock_units_per_dose')::bigint BETWEEN 1 AND 9007199254740991
        AND length(trim(prn_policy->>'indication')) BETWEEN 1 AND 500
        AND length(trim(prn_policy->>'stock_unit')) > 0
    )
);
ALTER TABLE medication_administrations ADD CONSTRAINT medication_administrations_prn_request_check CHECK (
    (prn_request_id IS NULL AND prn_indication IS NULL AND prn_requested_by_user_id IS NULL)
    OR (prn_request_id IS NOT NULL AND prescription_id IS NOT NULL AND medication_course_id IS NOT NULL
        AND pharmacy_fulfillment_id IS NOT NULL AND prn_requested_by_user_id IS NOT NULL
        AND lower(trim(frequency)) = 'prn' AND length(trim(prn_indication)) BETWEEN 1 AND 500)
);
CREATE UNIQUE INDEX medication_administrations_prn_request_idx
    ON medication_administrations(facility_id, prn_request_id) WHERE prn_request_id IS NOT NULL;
CREATE INDEX medication_administrations_prn_actual_idx
    ON medication_administrations(facility_id, prescription_id, administered_at DESC)
    WHERE status = 'administered' AND administered_at IS NOT NULL;
CREATE INDEX medication_administrations_prn_pending_idx
    ON medication_administrations(facility_id, prescription_id, id)
    WHERE status = 'scheduled' AND prn_request_id IS NOT NULL;
CREATE INDEX prescriptions_prn_patient_idx
    ON prescriptions(facility_id, patient_id, prescribed_at DESC, id DESC)
    WHERE lower(trim(frequency)) = 'prn';
