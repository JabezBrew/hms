ALTER TABLE patients
    ADD COLUMN record_status text NOT NULL DEFAULT 'registered',
    ADD COLUMN vital_status text NOT NULL DEFAULT 'presumed_alive',
    ADD COLUMN superseded_by_patient_id uuid,
    ADD COLUMN record_status_reason_code text,
    ADD COLUMN record_status_reason_note text,
    ADD COLUMN record_status_updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN record_status_updated_at timestamptz;

UPDATE patients
SET record_status = CASE status
        WHEN 'inactive' THEN 'restricted'
        ELSE 'registered'
    END,
    vital_status = CASE status
        WHEN 'deceased' THEN 'deceased'
        ELSE 'presumed_alive'
    END,
    record_status_reason_code = CASE status
        WHEN 'inactive' THEN 'legacy_inactive_unreviewed'
        ELSE record_status_reason_code
    END,
    record_status_updated_at = CASE status
        WHEN 'inactive' THEN now()
        ELSE record_status_updated_at
    END
WHERE status IN ('inactive', 'deceased');

ALTER TABLE patients
    ADD CONSTRAINT patients_facility_id_unique
        UNIQUE (facility_id, id),
    ADD CONSTRAINT patients_record_status_check
        CHECK (record_status IN ('registered', 'restricted', 'entered_in_error', 'superseded')),
    ADD CONSTRAINT patients_vital_status_check
        CHECK (vital_status IN ('presumed_alive', 'deceased', 'unknown')),
    ADD CONSTRAINT patients_superseded_canonical_check
        CHECK (
            (record_status = 'superseded' AND superseded_by_patient_id IS NOT NULL)
            OR (record_status <> 'superseded' AND superseded_by_patient_id IS NULL)
        ),
    ADD CONSTRAINT patients_superseded_not_self_check
        CHECK (superseded_by_patient_id IS NULL OR superseded_by_patient_id <> id),
    ADD CONSTRAINT patients_superseded_same_facility_fk
        FOREIGN KEY (facility_id, superseded_by_patient_id)
        REFERENCES patients (facility_id, id)
        ON DELETE RESTRICT;

CREATE INDEX patients_facility_record_status_created_idx
    ON patients (facility_id, record_status, created_at DESC, id DESC);

CREATE INDEX patients_facility_vital_status_created_idx
    ON patients (facility_id, vital_status, created_at DESC, id DESC);

CREATE INDEX patients_identity_exact_idx
    ON patients (
        facility_id,
        lower(first_name),
        lower(last_name),
        date_of_birth,
        sex,
        id
    );

CREATE INDEX patients_identity_dob_first_name_idx
    ON patients (facility_id, date_of_birth, lower(first_name), created_at DESC, id DESC);

CREATE INDEX patients_identity_dob_last_name_idx
    ON patients (facility_id, date_of_birth, lower(last_name), created_at DESC, id DESC);

CREATE INDEX patients_superseded_by_patient_idx
    ON patients (facility_id, superseded_by_patient_id)
    WHERE superseded_by_patient_id IS NOT NULL;

CREATE UNIQUE INDEX admission_cases_one_current_per_patient_idx
    ON admission_cases (facility_id, patient_id)
    WHERE status IN ('ready_for_activation', 'admitted', 'discharge_pending');

CREATE UNIQUE INDEX triage_queue_one_current_per_patient_idx
    ON triage_queue (facility_id, patient_id)
    WHERE status IN ('waiting', 'assigned');

CREATE TABLE patient_identity_lookup_sessions (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    lookup_fingerprint text NOT NULL,
    candidate_patient_ids uuid[] NOT NULL DEFAULT '{}',
    strong_duplicate_found boolean NOT NULL DEFAULT FALSE,
    created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX patient_identity_lookup_sessions_active_idx
    ON patient_identity_lookup_sessions (facility_id, id, expires_at);

CREATE TABLE care_area_intake_idempotency_keys (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    care_area text NOT NULL,
    idempotency_key_hash text NOT NULL,
    request_fingerprint text NOT NULL,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    visit_id uuid REFERENCES visits(id) ON DELETE RESTRICT,
    admission_case_id uuid REFERENCES admission_cases(id) ON DELETE RESTRICT,
    triage_id uuid REFERENCES triage_queue(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
    CONSTRAINT care_area_intake_idempotency_care_area_check
        CHECK (care_area IN ('outpatient', 'inpatient', 'emergency')),
    CONSTRAINT care_area_intake_idempotency_result_check
        CHECK (
            (completed_at IS NULL AND visit_id IS NULL AND admission_case_id IS NULL AND triage_id IS NULL)
            OR (completed_at IS NOT NULL AND care_area = 'outpatient' AND visit_id IS NOT NULL AND admission_case_id IS NULL AND triage_id IS NULL)
            OR (completed_at IS NOT NULL AND care_area = 'inpatient' AND admission_case_id IS NOT NULL)
            OR (completed_at IS NOT NULL AND care_area = 'emergency' AND visit_id IS NOT NULL AND triage_id IS NOT NULL AND admission_case_id IS NULL)
        )
);

CREATE UNIQUE INDEX care_area_intake_idempotency_unique_idx
    ON care_area_intake_idempotency_keys (
        facility_id,
        created_by_user_id,
        care_area,
        idempotency_key_hash
    );

CREATE INDEX care_area_intake_idempotency_patient_idx
    ON care_area_intake_idempotency_keys (facility_id, patient_id, created_at DESC);
