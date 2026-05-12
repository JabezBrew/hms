CREATE TABLE referrals (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    to_service text NOT NULL,
    priority text NOT NULL,
    status text NOT NULL,
    reason text,
    sla_due_at timestamptz NOT NULL,
    accepted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    accepted_at timestamptz,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX referrals_facility_created_idx
    ON referrals (facility_id, created_at, id);

CREATE INDEX referrals_patient_created_idx
    ON referrals (patient_id, created_at, id);

CREATE INDEX referrals_facility_status_sla_idx
    ON referrals (facility_id, status, sla_due_at, id);

CREATE TABLE clinic_waitlist_entries (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    service text NOT NULL,
    priority text NOT NULL,
    status text NOT NULL,
    offered_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    offered_at timestamptz,
    promoted_at timestamptz,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clinic_waitlist_facility_created_idx
    ON clinic_waitlist_entries (facility_id, created_at, id);

CREATE INDEX clinic_waitlist_service_status_priority_idx
    ON clinic_waitlist_entries (facility_id, service, status, priority, created_at, id);
