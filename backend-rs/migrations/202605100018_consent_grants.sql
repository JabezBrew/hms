CREATE TABLE consent_grants (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    scope text NOT NULL,
    purpose text NOT NULL,
    status text NOT NULL,
    expires_at timestamptz,
    revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    revoked_at timestamptz,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consent_grants_facility_created_idx
    ON consent_grants (facility_id, created_at, id);

CREATE INDEX consent_grants_patient_created_idx
    ON consent_grants (patient_id, created_at, id);

CREATE INDEX consent_grants_facility_status_expires_idx
    ON consent_grants (facility_id, status, expires_at, id);
