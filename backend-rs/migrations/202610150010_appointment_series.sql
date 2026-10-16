-- Governed explicit-slot series are distinct from the old unused recurrence helper.
ALTER TABLE appointment_series
    ADD COLUMN clinic_id uuid REFERENCES clinics(id) ON DELETE RESTRICT,
    ADD COLUMN service_id uuid REFERENCES appointment_types(id) ON DELETE RESTRICT,
    ADD COLUMN occurrence_count smallint,
    ADD COLUMN request_key_hash text,
    ADD COLUMN request_fingerprint text;
ALTER TABLE appointment_series ADD CONSTRAINT appointment_series_governed_check CHECK (
    (request_key_hash IS NULL AND request_fingerprint IS NULL AND occurrence_count IS NULL)
    OR (request_key_hash IS NOT NULL AND length(request_key_hash)=64
        AND request_fingerprint IS NOT NULL AND length(request_fingerprint)=64
        AND occurrence_count IS NOT NULL AND occurrence_count BETWEEN 2 AND 50 AND clinic_id IS NOT NULL AND service_id IS NOT NULL
        AND created_by_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX appointment_series_request_key_idx
    ON appointment_series(facility_id,created_by_user_id,request_key_hash)
    WHERE request_key_hash IS NOT NULL;
CREATE INDEX appointment_series_patient_page_idx
    ON appointment_series(facility_id,patient_id,created_at DESC,id DESC)
    WHERE request_key_hash IS NOT NULL;
CREATE INDEX appointments_series_member_idx ON appointments(facility_id,series_id,id)
    WHERE series_id IS NOT NULL;
CREATE TABLE appointment_series_cancellations (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    series_id uuid NOT NULL REFERENCES appointment_series(id) ON DELETE RESTRICT,
    actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    request_key_hash text NOT NULL CHECK(length(request_key_hash)=64),
    request_fingerprint text NOT NULL CHECK(length(request_fingerprint)=64),
    cutoff_at timestamptz NOT NULL,
    cancelled_appointment_ids uuid[] NOT NULL,
    retained_appointment_ids uuid[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(facility_id,series_id,actor_user_id,request_key_hash),
    CHECK(cardinality(cancelled_appointment_ids)+cardinality(retained_appointment_ids) BETWEEN 2 AND 50)
);
