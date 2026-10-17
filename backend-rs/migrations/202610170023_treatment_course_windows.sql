-- Preserve initial generation evidence; only an explicit reviewed command may
-- extend the recorded schedule boundary. No doses or stock policy are inferred.
ALTER TABLE medication_courses ADD COLUMN scheduled_through timestamptz;
UPDATE medication_courses SET scheduled_through=generation_window_end;
ALTER TABLE medication_courses ADD CONSTRAINT medication_courses_scoped_identity_key
    UNIQUE (facility_id,id,patient_id,admission_case_id,prescription_id);

ALTER TABLE pharmacy_fulfillments ADD COLUMN source_kind text;
UPDATE pharmacy_fulfillments SET source_kind=CASE
    WHEN lower(trim(frequency))='prn' THEN 'prn_aggregate' ELSE 'initial_generation' END;
ALTER TABLE pharmacy_fulfillments ALTER COLUMN source_kind SET NOT NULL;
ALTER TABLE pharmacy_fulfillments ALTER COLUMN source_kind SET DEFAULT 'initial_generation';
ALTER TABLE pharmacy_fulfillments ADD CONSTRAINT pharmacy_fulfillments_source_kind_check
    CHECK (source_kind IN ('initial_generation','prn_aggregate','scheduled_window'));
ALTER TABLE pharmacy_fulfillments
    DROP CONSTRAINT pharmacy_fulfillments_facility_id_medication_course_id_key;
CREATE UNIQUE INDEX pharmacy_fulfillments_original_kind_idx
    ON pharmacy_fulfillments(facility_id,medication_course_id)
    WHERE source_kind IN ('initial_generation','prn_aggregate');
CREATE UNIQUE INDEX pharmacy_fulfillments_exact_window_idx
    ON pharmacy_fulfillments(facility_id,medication_course_id,coverage_start,coverage_end)
    WHERE source_kind='scheduled_window';
CREATE INDEX medication_courses_admission_cursor_idx
    ON medication_courses(facility_id,patient_id,admission_case_id,created_at DESC,id DESC);
CREATE INDEX pharmacy_fulfillments_course_cursor_idx
    ON pharmacy_fulfillments(facility_id,medication_course_id,created_at DESC,id DESC);
CREATE INDEX medication_administrations_course_review_idx
    ON medication_administrations(facility_id,medication_course_id,scheduled_at,id);
-- Authenticated complete-course integrity probes inspect only the known course
-- identity, returning an error rather than materializing foreign child data.
CREATE INDEX medication_administrations_course_integrity_idx
    ON medication_administrations(medication_course_id)
    WHERE medication_course_id IS NOT NULL;
CREATE INDEX pharmacy_fulfillments_course_integrity_idx
    ON pharmacy_fulfillments(medication_course_id);
ALTER TABLE medication_administrations ADD CONSTRAINT medication_administrations_scoped_course_key
    UNIQUE (facility_id,id,patient_id,admission_case_id,prescription_id,medication_course_id);

CREATE TABLE medication_course_stops (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    medication_course_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    admission_case_id uuid NOT NULL,
    prescription_id uuid NOT NULL,
    reason text NOT NULL CHECK (length(trim(reason))>0 AND octet_length(reason)<=2000),
    recorded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    recorded_by_display_name text NOT NULL,
    recorded_at timestamptz NOT NULL,
    ward_id uuid NOT NULL REFERENCES wards(id) ON DELETE RESTRICT,
    ward_name text NOT NULL,
    source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot)='object'),
    course_snapshot jsonb NOT NULL CHECK (jsonb_typeof(course_snapshot)='object'),
    context_snapshot jsonb NOT NULL CHECK (jsonb_typeof(context_snapshot)='object'),
    evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
    UNIQUE (facility_id,medication_course_id),
    UNIQUE (id,facility_id,medication_course_id),
    FOREIGN KEY (facility_id,medication_course_id,patient_id,admission_case_id,prescription_id)
        REFERENCES medication_courses(facility_id,id,patient_id,admission_case_id,prescription_id)
        ON DELETE RESTRICT
);
ALTER TABLE medication_administrations ADD COLUMN local_course_stop_id uuid;
CREATE INDEX medication_administrations_course_retirable_idx
    ON medication_administrations(facility_id,medication_course_id,id)
    WHERE status IN ('scheduled','held') AND administered_at IS NULL
        AND outcome_recorded_at IS NULL AND local_course_stop_id IS NULL;
CREATE INDEX medication_administrations_course_awaiting_supply_idx
    ON medication_administrations(facility_id,medication_course_id,scheduled_at,id)
    WHERE status='scheduled' AND NOT is_dispensed;
ALTER TABLE medication_administrations ADD CONSTRAINT medication_administrations_local_stop_fk
    FOREIGN KEY (local_course_stop_id,facility_id,medication_course_id)
    REFERENCES medication_course_stops(id,facility_id,medication_course_id) ON DELETE RESTRICT;

CREATE TABLE treatment_course_requests (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL,
    admission_case_id uuid NOT NULL,
    prescription_id uuid NOT NULL,
    medication_course_id uuid NOT NULL,
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    operation text NOT NULL CHECK (operation IN ('stopped','supply_window_created')),
    reviewed_input jsonb NOT NULL CHECK (jsonb_typeof(reviewed_input)='object'),
    receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
    recorded_at timestamptz NOT NULL,
    UNIQUE (facility_id,actor_user_id,request_hash),
    UNIQUE (id,facility_id,patient_id,admission_case_id,prescription_id,medication_course_id),
    FOREIGN KEY (facility_id,medication_course_id,patient_id,admission_case_id,prescription_id)
        REFERENCES medication_courses(facility_id,id,patient_id,admission_case_id,prescription_id)
        ON DELETE RESTRICT
);
CREATE TABLE treatment_course_request_doses (
    request_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    admission_case_id uuid NOT NULL,
    prescription_id uuid NOT NULL,
    medication_course_id uuid NOT NULL,
    medication_administration_id uuid NOT NULL,
    original_membership jsonb NOT NULL CHECK (jsonb_typeof(original_membership)='object'),
    PRIMARY KEY (request_id,medication_administration_id),
    FOREIGN KEY (request_id,facility_id,patient_id,admission_case_id,prescription_id,medication_course_id)
        REFERENCES treatment_course_requests(id,facility_id,patient_id,admission_case_id,prescription_id,medication_course_id)
        ON DELETE RESTRICT,
    FOREIGN KEY (facility_id,medication_administration_id,patient_id,admission_case_id,prescription_id,medication_course_id)
        REFERENCES medication_administrations(facility_id,id,patient_id,admission_case_id,prescription_id,medication_course_id)
        ON DELETE RESTRICT
);
CREATE INDEX treatment_course_request_doses_member_idx
    ON treatment_course_request_doses(request_id,medication_administration_id);

CREATE FUNCTION reject_treatment_evidence_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'treatment_course_evidence_is_immutable';
END $$;
CREATE TRIGGER medication_course_stops_immutable BEFORE UPDATE OR DELETE ON medication_course_stops
    FOR EACH ROW EXECUTE FUNCTION reject_treatment_evidence_rewrite();
CREATE TRIGGER treatment_course_requests_immutable BEFORE UPDATE OR DELETE ON treatment_course_requests
    FOR EACH ROW EXECUTE FUNCTION reject_treatment_evidence_rewrite();
CREATE TRIGGER treatment_course_request_doses_immutable BEFORE UPDATE OR DELETE ON treatment_course_request_doses
    FOR EACH ROW EXECUTE FUNCTION reject_treatment_evidence_rewrite();
