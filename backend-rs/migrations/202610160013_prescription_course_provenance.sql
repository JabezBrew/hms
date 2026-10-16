-- Existing orders have no fabricated instructions or renewal provenance.
ALTER TABLE prescriptions
    ADD COLUMN instructions text NOT NULL DEFAULT '' CHECK(length(instructions)<=4000),
    ADD COLUMN reason text NOT NULL DEFAULT '' CHECK(length(reason)<=2000);

-- Each source can lead to one deliberately reviewed successor. Repeated renewals
-- follow the new course, rather than creating siblings from the same old order.
CREATE TABLE prescription_course_provenance (
    prescription_id uuid PRIMARY KEY REFERENCES prescriptions(id) ON DELETE RESTRICT,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    source_prescription_id uuid NOT NULL REFERENCES prescriptions(id) ON DELETE RESTRICT,
    relation text NOT NULL CHECK(relation IN ('renewal','replacement')),
    change_reason text NOT NULL CHECK(length(trim(change_reason)) BETWEEN 1 AND 2000),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    recorded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    UNIQUE(facility_id,source_prescription_id),
    CHECK(prescription_id<>source_prescription_id)
);

-- Immutable command receipts contain protected clinical detail. They are never
-- included in hot list DTOs, audit metadata or logs. Idempotency lookup keys are hashed.
CREATE TABLE prescription_commands (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
    source_prescription_id uuid NOT NULL REFERENCES prescriptions(id) ON DELETE RESTRICT,
    actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    command_type text NOT NULL CHECK(command_type IN ('new_course','documentation')),
    payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
    receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(facility_id,request_key_hash)
);

-- PRN safety survives a deliberate new course. Root-first membership is never
-- inferred from medication names and no clinical limits are backfilled.
CREATE TABLE prescription_prn_safety_groups (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    root_prescription_id uuid NOT NULL UNIQUE REFERENCES prescriptions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(facility_id,patient_id,id),
    CHECK(id=root_prescription_id)
);
ALTER TABLE prescriptions ADD COLUMN prn_safety_group_id uuid;
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_prn_safety_group_fk
    FOREIGN KEY(facility_id,patient_id,prn_safety_group_id) REFERENCES prescription_prn_safety_groups(facility_id,patient_id,id) ON DELETE RESTRICT;
ALTER TABLE medication_administrations ADD COLUMN prn_safety_group_id uuid;
ALTER TABLE medication_administrations ADD CONSTRAINT medication_administrations_prn_safety_group_fk
    FOREIGN KEY(facility_id,patient_id,prn_safety_group_id) REFERENCES prescription_prn_safety_groups(facility_id,patient_id,id) ON DELETE RESTRICT;
INSERT INTO prescription_prn_safety_groups(id,facility_id,patient_id,root_prescription_id)
    SELECT id,facility_id,patient_id,id FROM prescriptions WHERE lower(trim(frequency))='prn';
UPDATE prescriptions SET prn_safety_group_id=id WHERE lower(trim(frequency))='prn';
UPDATE medication_administrations m SET prn_safety_group_id=p.prn_safety_group_id
    FROM prescriptions p WHERE p.id=m.prescription_id AND p.facility_id=m.facility_id AND p.patient_id=m.patient_id AND p.prn_safety_group_id IS NOT NULL;
CREATE INDEX prescriptions_prn_safety_group_idx ON prescriptions(facility_id,prn_safety_group_id,id)
    WHERE prn_safety_group_id IS NOT NULL;
CREATE INDEX medication_administrations_prn_group_actual_idx
    ON medication_administrations(facility_id,prn_safety_group_id,administered_at DESC)
    WHERE status='administered' AND prn_safety_group_id IS NOT NULL;
CREATE INDEX medication_administrations_prn_group_pending_idx
    ON medication_administrations(facility_id,prn_safety_group_id,id)
    WHERE status='scheduled' AND prn_safety_group_id IS NOT NULL;

-- Cover existing internal prescription writers too. This assigns provenance,
-- never a dose limit. Once assigned, a safety group cannot be reset by edits.
CREATE FUNCTION maintain_prescription_prn_safety_group() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='UPDATE' AND OLD.prn_safety_group_id IS NOT NULL
        AND NEW.prn_safety_group_id IS DISTINCT FROM OLD.prn_safety_group_id THEN
        RAISE EXCEPTION 'prescription_prn_safety_group_immutable';
    END IF;
    IF lower(trim(NEW.frequency))='prn' AND NEW.prn_safety_group_id IS NULL THEN
        INSERT INTO prescription_prn_safety_groups(id,facility_id,patient_id,root_prescription_id)
            VALUES(NEW.id,NEW.facility_id,NEW.patient_id,NEW.id);
        NEW.prn_safety_group_id=NEW.id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER prescription_prn_safety_group_guard
    BEFORE INSERT OR UPDATE OF frequency,prn_safety_group_id ON prescriptions
    FOR EACH ROW EXECUTE FUNCTION maintain_prescription_prn_safety_group();
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_prn_safety_group_present
    CHECK(lower(trim(frequency))<>'prn' OR prn_safety_group_id IS NOT NULL);
