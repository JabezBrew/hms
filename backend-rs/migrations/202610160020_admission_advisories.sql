-- This checklist is separate from admission activation/intake blockers and general nursing work.
CREATE UNIQUE INDEX admission_cases_advisory_scope_key ON admission_cases(facility_id,id,patient_id);
CREATE INDEX admission_cases_advisory_patient_cursor_idx ON admission_cases(facility_id,patient_id,created_at DESC,id DESC);
CREATE TABLE admission_advisories (
 id uuid PRIMARY KEY,
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
 admission_case_id uuid NOT NULL,
 captured_ward_id uuid NOT NULL REFERENCES wards(id) ON DELETE RESTRICT,
 captured_ward_name text NOT NULL,
 task_type text NOT NULL CHECK(task_type IN ('pharmacy_med_rec','baseline_lab_followup','infection_control','dietary','social_work','transport','documents','other')),
 phase text NOT NULL CHECK(phase IN ('pre_activation','post_activation')),
 notes text NOT NULL CHECK(length(trim(notes)) BETWEEN 1 AND 4000),
 status text NOT NULL CHECK(status IN ('pending','completed','acknowledged_unresolved','cancelled')),
 version bigint NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_by_display_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 decision_source text CHECK(decision_source IN ('manual','admission_case_cancelled','admission_discharged')),
 decision_reason text CHECK(length(decision_reason)<=2000),
 system_reason_code text CHECK(system_reason_code IN ('admission_case_cancelled','admission_discharged')),
 decided_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 decided_by_display_name text,
 decided_at timestamptz,
 decision_ward_id uuid REFERENCES wards(id) ON DELETE RESTRICT,
 decision_ward_name text,
 UNIQUE(facility_id,admission_case_id,task_type),
 UNIQUE(facility_id,id,patient_id,admission_case_id),
 FOREIGN KEY(facility_id,admission_case_id,patient_id) REFERENCES admission_cases(facility_id,id,patient_id) ON DELETE RESTRICT,
 CONSTRAINT admission_advisory_decision_evidence CHECK (
   (status='pending' AND version=1 AND decision_source IS NULL AND decision_reason IS NULL AND system_reason_code IS NULL AND decided_by_user_id IS NULL AND decided_by_display_name IS NULL AND decided_at IS NULL AND decision_ward_id IS NULL AND decision_ward_name IS NULL)
   OR
   (status<>'pending' AND version=2 AND decision_source IS NOT NULL AND decided_by_user_id IS NOT NULL AND decided_by_display_name IS NOT NULL AND decided_at IS NOT NULL AND decision_ward_id IS NOT NULL AND decision_ward_name IS NOT NULL
    AND ((decision_source='manual' AND system_reason_code IS NULL AND (status='completed' OR (decision_reason IS NOT NULL AND length(trim(decision_reason))>0)))
       OR (decision_source<>'manual' AND status='cancelled' AND decision_reason IS NULL AND system_reason_code IS NOT NULL AND system_reason_code=decision_source)))
 )
);
CREATE INDEX admission_advisories_case_idx ON admission_advisories(facility_id,admission_case_id,created_at,id);
CREATE TABLE admission_advisory_commands (
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL,
 admission_case_id uuid NOT NULL,
 advisory_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('created','decided')),
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 receipt jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(facility_id,request_key_hash),
 FOREIGN KEY(facility_id,advisory_id,patient_id,admission_case_id) REFERENCES admission_advisories(facility_id,id,patient_id,admission_case_id) ON DELETE RESTRICT
);
CREATE FUNCTION admission_advisory_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'admission_advisory_evidence_immutable'; END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'pending' OR NEW.version<>1) THEN RAISE EXCEPTION 'admission_advisory_context_invalid'; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD.status<>'pending' OR NEW.status='pending' OR NEW.version<>OLD.version+1
      OR ROW(NEW.id,NEW.facility_id,NEW.patient_id,NEW.admission_case_id,NEW.captured_ward_id,NEW.captured_ward_name,NEW.task_type,NEW.phase,NEW.notes,NEW.created_by_user_id,NEW.created_by_display_name,NEW.created_at)
         IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.patient_id,OLD.admission_case_id,OLD.captured_ward_id,OLD.captured_ward_name,OLD.task_type,OLD.phase,OLD.notes,OLD.created_by_user_id,OLD.created_by_display_name,OLD.created_at)
   THEN RAISE EXCEPTION 'admission_advisory_evidence_immutable'; END IF;
 END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(
   SELECT 1 FROM admission_cases a JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id JOIN users u ON u.facility_id=a.facility_id AND u.id=NEW.created_by_user_id
   WHERE a.facility_id=NEW.facility_id AND a.id=NEW.admission_case_id AND a.patient_id=NEW.patient_id AND a.ward_id=NEW.captured_ward_id AND w.name=NEW.captured_ward_name AND w.status='active' AND u.display_name=NEW.created_by_display_name
     AND ((a.status='ready_for_activation' AND NEW.phase='pre_activation') OR (a.status IN ('admitted','discharge_pending') AND NEW.phase='post_activation'))
 ) THEN RAISE EXCEPTION 'admission_advisory_context_invalid'; END IF;
 IF NEW.status<>'pending' AND NOT EXISTS(
   SELECT 1 FROM admission_cases a JOIN wards w ON w.facility_id=a.facility_id AND w.id=a.ward_id JOIN users u ON u.facility_id=a.facility_id AND u.id=NEW.decided_by_user_id
   WHERE a.facility_id=NEW.facility_id AND a.id=NEW.admission_case_id AND a.patient_id=NEW.patient_id
     AND a.ward_id=NEW.decision_ward_id AND w.name=NEW.decision_ward_name AND u.display_name=NEW.decided_by_display_name
     AND (NEW.decision_source='manual' OR (NEW.decision_source='admission_case_cancelled' AND a.status='cancelled') OR (NEW.decision_source='admission_discharged' AND a.status='discharged'))
 ) THEN RAISE EXCEPTION 'admission_advisory_context_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admission_advisory_guard BEFORE INSERT OR UPDATE OR DELETE ON admission_advisories FOR EACH ROW EXECUTE FUNCTION admission_advisory_guard();
CREATE FUNCTION admission_advisory_command_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'admission_advisory_command_immutable'; END $$;
CREATE TRIGGER admission_advisory_command_immutable BEFORE UPDATE OR DELETE ON admission_advisory_commands FOR EACH ROW EXECUTE FUNCTION admission_advisory_command_immutable();
