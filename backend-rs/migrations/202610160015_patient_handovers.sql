-- Clinical patient narratives are distinct from ward shift headers. No inferred backfill.
CREATE TABLE patient_handovers (
 id uuid PRIMARY KEY,
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
 admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE RESTRICT,
 ward_id uuid NOT NULL REFERENCES wards(id) ON DELETE RESTRICT,
 author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 current_revision bigint NOT NULL CHECK(current_revision>0),
 status text NOT NULL CHECK(status IN ('recorded','voided')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(facility_id,id)
);
CREATE TABLE patient_handover_revisions (
 id uuid PRIMARY KEY,
 facility_id uuid NOT NULL,
 handover_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 kind text NOT NULL CHECK(kind IN ('recorded','amended','voided')),
 shift_date date NOT NULL,
 shift_type text NOT NULL CHECK(shift_type IN ('day','evening','night')),
 intended_recipient_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 patient_condition text NOT NULL CHECK(length(trim(patient_condition)) BETWEEN 1 AND 4000),
 ongoing_issues text NOT NULL CHECK(length(ongoing_issues)<=2000),
 pending_tasks text NOT NULL CHECK(length(pending_tasks)<=2000),
 medication_changes text NOT NULL CHECK(length(medication_changes)<=2000),
 key_events text NOT NULL CHECK(length(key_events)<=2000),
 care_plan_updates text NOT NULL CHECK(length(care_plan_updates)<=2000),
 family_updates text NOT NULL CHECK(length(family_updates)<=2000),
 reason text NOT NULL CHECK(length(reason)<=2000 AND (kind='recorded' OR length(trim(reason))>0)),
 recorded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(handover_id,revision),
 FOREIGN KEY(facility_id,handover_id) REFERENCES patient_handovers(facility_id,id) ON DELETE RESTRICT
);
ALTER TABLE patient_handovers ADD CONSTRAINT patient_handovers_current_revision_fk
 FOREIGN KEY(id,current_revision) REFERENCES patient_handover_revisions(handover_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE patient_handover_commands (
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 command_kind text NOT NULL CHECK(command_kind IN ('record','amend','void')),
 target_id uuid REFERENCES patient_handovers(id) ON DELETE RESTRICT,
 result_id uuid REFERENCES patient_handovers(id) ON DELETE RESTRICT,
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 receipt jsonb,
 PRIMARY KEY(facility_id,request_key_hash)
);
CREATE INDEX patient_handovers_patient_cursor_idx ON patient_handovers(facility_id,patient_id,created_at DESC,id DESC);
CREATE INDEX patient_handovers_admission_cursor_idx ON patient_handovers(facility_id,admission_case_id,created_at DESC,id DESC);
CREATE INDEX patient_handover_history_cursor_idx ON patient_handover_revisions(facility_id,handover_id,recorded_at DESC,id DESC);
CREATE INDEX handover_recipient_cursor_idx ON ward_staff_assignments(facility_id,ward_id,assigned_at,id) WHERE is_active AND role_category='nursing';
CREATE FUNCTION patient_handover_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'patient_handover_evidence_immutable'; END $$;
CREATE TRIGGER patient_handover_revisions_immutable BEFORE UPDATE OR DELETE ON patient_handover_revisions FOR EACH ROW EXECUTE FUNCTION patient_handover_evidence_immutable();
CREATE FUNCTION patient_handover_scope_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.facility_id,NEW.patient_id,NEW.admission_case_id,NEW.ward_id,NEW.author_user_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.facility_id,OLD.patient_id,OLD.admission_case_id,OLD.ward_id,OLD.author_user_id,OLD.created_at) THEN RAISE EXCEPTION 'patient_handover_scope_immutable'; END IF;
 IF OLD.status='voided' OR NEW.current_revision<>OLD.current_revision+1 THEN RAISE EXCEPTION 'patient_handover_revision_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER patient_handover_scope_immutable BEFORE UPDATE ON patient_handovers FOR EACH ROW EXECUTE FUNCTION patient_handover_scope_immutable();
CREATE FUNCTION patient_handover_scope_valid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admission_cases a JOIN patients p ON p.id=a.patient_id AND p.facility_id=a.facility_id JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id JOIN users u ON u.facility_id=a.facility_id AND u.id=NEW.author_user_id WHERE a.id=NEW.admission_case_id AND a.facility_id=NEW.facility_id AND a.patient_id=NEW.patient_id AND a.ward_id=NEW.ward_id) THEN RAISE EXCEPTION 'patient_handover_context_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER patient_handover_scope_valid BEFORE INSERT ON patient_handovers FOR EACH ROW EXECUTE FUNCTION patient_handover_scope_valid();
CREATE FUNCTION patient_handover_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.receipt IS NOT NULL OR NEW.receipt IS NULL OR NEW.result_id IS NULL OR ROW(NEW.facility_id,NEW.request_key_hash,NEW.patient_id,NEW.actor_user_id,NEW.command_kind,NEW.target_id,NEW.payload_digest) IS DISTINCT FROM ROW(OLD.facility_id,OLD.request_key_hash,OLD.patient_id,OLD.actor_user_id,OLD.command_kind,OLD.target_id,OLD.payload_digest) THEN RAISE EXCEPTION 'patient_handover_command_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER patient_handover_command_guard BEFORE UPDATE OR DELETE ON patient_handover_commands FOR EACH ROW EXECUTE FUNCTION patient_handover_command_guard();
CREATE FUNCTION patient_handover_command_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM patient_handover_commands WHERE facility_id=NEW.facility_id AND request_key_hash=NEW.request_key_hash AND receipt IS NULL) THEN RAISE EXCEPTION 'patient_handover_command_incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER patient_handover_command_complete AFTER INSERT ON patient_handover_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION patient_handover_command_complete();
