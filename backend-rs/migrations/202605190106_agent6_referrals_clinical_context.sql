ALTER TABLE referrals
    ADD COLUMN scheduled_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
    ADD COLUMN scheduled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN scheduled_at timestamptz;

CREATE INDEX referrals_scheduled_appointment_idx
    ON referrals (scheduled_appointment_id)
    WHERE scheduled_appointment_id IS NOT NULL;

ALTER TABLE clinic_waitlist_entries
    ADD COLUMN scheduled_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
    ADD COLUMN promoted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN cancelled_at timestamptz,
    ADD COLUMN cancellation_reason text;

CREATE INDEX clinic_waitlist_scheduled_appointment_idx
    ON clinic_waitlist_entries (scheduled_appointment_id)
    WHERE scheduled_appointment_id IS NOT NULL;

CREATE TABLE problem_artifact_links (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    problem_id uuid NOT NULL REFERENCES patient_problems(id) ON DELETE CASCADE,
    artifact_kind text NOT NULL,
    artifact_id uuid NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (problem_id, artifact_kind, artifact_id),
    UNIQUE (facility_id, artifact_kind, artifact_id, problem_id)
);

CREATE INDEX problem_artifact_links_artifact_idx
    ON problem_artifact_links (facility_id, artifact_kind, artifact_id, created_at DESC, id);

CREATE INDEX problem_artifact_links_patient_idx
    ON problem_artifact_links (facility_id, patient_id, created_at DESC, id);
