-- Breaking epoch026. No legacy encounter/referral link is inferred or backfilled.
CREATE TABLE referral_consultation_starts (
 id uuid PRIMARY KEY,
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
 referral_id uuid NOT NULL,
 encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE RESTRICT,
 visit_id uuid REFERENCES visits(id) ON DELETE RESTRICT,
 admission_case_id uuid REFERENCES admission_cases(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 practitioner_profile_id uuid NOT NULL REFERENCES practitioner_profiles(id) ON DELETE RESTRICT,
 source_mode text NOT NULL CHECK(source_mode IN('new_outpatient','existing_admission_encounter')),
 recorded_at timestamptz NOT NULL,
 detail jsonb NOT NULL CHECK(jsonb_typeof(detail)='object'),
 UNIQUE(facility_id,id),UNIQUE(facility_id,referral_id),
 FOREIGN KEY(facility_id,referral_id) REFERENCES referrals(facility_id,id) ON DELETE RESTRICT,
 CHECK((source_mode='new_outpatient')=(admission_case_id IS NULL))
);
CREATE INDEX referral_consultation_encounter_idx ON referral_consultation_starts(facility_id,encounter_id);
CREATE INDEX referral_consultation_patient_actor_idx ON referral_consultation_starts(facility_id,patient_id,actor_user_id);
CREATE TABLE referral_consultation_start_commands (
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
 referral_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 result_id uuid,
 receipt jsonb,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(facility_id,request_key_hash),UNIQUE(facility_id,result_id),
 FOREIGN KEY(facility_id,referral_id) REFERENCES referrals(facility_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(facility_id,result_id) REFERENCES referral_consultation_starts(facility_id,id) ON DELETE RESTRICT
);
CREATE FUNCTION referral_consultation_start_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e encounters; r referrals; c admission_cases; p practitioner_profiles; booking appointments; actor_name text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'referral_consultation_start_immutable'; END IF;
 SELECT * INTO r FROM referrals WHERE id=NEW.referral_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id FOR SHARE;
 SELECT * INTO e FROM encounters WHERE id=NEW.encounter_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id FOR SHARE;
 SELECT pp.* INTO p FROM practitioner_profiles pp JOIN staff_profiles s ON s.id=pp.staff_id AND s.facility_id=pp.facility_id WHERE pp.id=NEW.practitioner_profile_id AND pp.facility_id=NEW.facility_id AND s.user_id=NEW.actor_user_id;
 SELECT display_name INTO actor_name FROM users WHERE id=NEW.actor_user_id AND facility_id=NEW.facility_id AND is_active;
 IF e.id IS NULL OR r.id IS NULL OR p.id IS NULL OR actor_name IS NULL OR r.status NOT IN('accepted','scheduled') OR e.status<>'in_progress' OR e.ended_at IS NOT NULL
 OR e.visit_id IS DISTINCT FROM NEW.visit_id
 OR (NEW.visit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM visits WHERE id=NEW.visit_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id))
 OR (r.status='scheduled' AND NOT EXISTS(SELECT 1 FROM appointments WHERE id=r.scheduled_appointment_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id AND status IN('scheduled','checked_in')))
 THEN RAISE EXCEPTION 'referral_consultation_source_invalid'; END IF;
 IF r.status='scheduled' THEN
  SELECT * INTO booking FROM appointments WHERE id=r.scheduled_appointment_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id FOR SHARE;
  IF jsonb_typeof(NEW.detail->'appointment_at_start') IS DISTINCT FROM 'object'
   OR NEW.detail->'appointment_at_start'->>'id' IS DISTINCT FROM booking.id::text
   OR NEW.detail->'appointment_at_start'->>'clinic_id' IS DISTINCT FROM booking.clinic_id::text
   OR NEW.detail->'appointment_at_start'->>'practitioner_user_id' IS DISTINCT FROM booking.practitioner_user_id::text
   OR NEW.detail->'appointment_at_start'->>'status' IS DISTINCT FROM booking.status
   OR (NEW.detail->'appointment_at_start'->>'starts_at')::timestamptz IS DISTINCT FROM booking.starts_at
   OR (NEW.detail->'appointment_at_start'->>'ends_at')::timestamptz IS DISTINCT FROM booking.ends_at
   THEN RAISE EXCEPTION 'referral_consultation_appointment_evidence_invalid'; END IF;
 ELSE
  IF r.scheduled_appointment_id IS NOT NULL OR NEW.detail->'appointment_at_start' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'referral_consultation_appointment_evidence_invalid'; END IF;
 END IF;
 IF NEW.source_mode='new_outpatient' THEN
  IF e.encounter_type<>'outpatient' OR e.started_at<>NEW.recorded_at OR e.created_by_user_id IS DISTINCT FROM NEW.actor_user_id
  OR NOT EXISTS(SELECT 1 FROM patients WHERE id=NEW.patient_id AND facility_id=NEW.facility_id AND record_status IN('registered','restricted') AND vital_status<>'deceased')
  THEN RAISE EXCEPTION 'referral_consultation_outpatient_invalid'; END IF;
 ELSE
  SELECT * INTO c FROM admission_cases WHERE id=NEW.admission_case_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id AND encounter_id=NEW.encounter_id AND visit_id IS NOT DISTINCT FROM NEW.visit_id AND status IN('admitted','discharge_pending');
  IF c.id IS NULL THEN RAISE EXCEPTION 'referral_consultation_admission_invalid'; END IF;
 END IF;
 IF (NEW.detail->>'id') IS DISTINCT FROM NEW.id::text OR (NEW.detail->>'patient_id') IS DISTINCT FROM NEW.patient_id::text OR (NEW.detail->>'referral_id') IS DISTINCT FROM NEW.referral_id::text
 OR (NEW.detail->>'encounter_id') IS DISTINCT FROM NEW.encounter_id::text OR (NEW.detail->>'visit_id') IS DISTINCT FROM NEW.visit_id::text OR (NEW.detail->>'admission_case_id') IS DISTINCT FROM NEW.admission_case_id::text
 OR (NEW.detail->>'recorded_by_user_id') IS DISTINCT FROM NEW.actor_user_id::text OR (NEW.detail->>'recorded_by_practitioner_profile_id') IS DISTINCT FROM NEW.practitioner_profile_id::text
 OR (NEW.detail->>'source_mode') IS DISTINCT FROM NEW.source_mode OR (NEW.detail->>'recorded_by_display_name') IS DISTINCT FROM actor_name
 OR (NEW.detail->>'recorded_at')::timestamptz IS DISTINCT FROM NEW.recorded_at OR (NEW.detail->>'encounter_started_at')::timestamptz IS DISTINCT FROM e.started_at
 OR (NEW.detail->>'encounter_type') IS DISTINCT FROM e.encounter_type OR (NEW.detail->>'encounter_status_at_start') IS DISTINCT FROM 'in_progress'
 OR (NEW.detail->>'link_version') IS DISTINCT FROM '1' OR (NEW.detail->>'encounter_created')::boolean IS DISTINCT FROM (NEW.source_mode='new_outpatient')
 OR (NEW.detail->>'source_referral_status') IS DISTINCT FROM r.status OR (NEW.detail->>'resulting_referral_status') IS DISTINCT FROM r.status
 OR (NEW.detail->>'scheduled_appointment_id') IS DISTINCT FROM r.scheduled_appointment_id::text
 OR (NEW.detail->>'admission_admitted_at')::timestamptz IS DISTINCT FROM c.admitted_at
 OR (NEW.detail->>'admission_placement_revision_at_start')::bigint IS DISTINCT FROM c.placement_revision
 THEN RAISE EXCEPTION 'referral_consultation_detail_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_consultation_start_scope BEFORE INSERT ON referral_consultation_starts FOR EACH ROW EXECUTE FUNCTION referral_consultation_start_guard();
CREATE TRIGGER referral_consultation_start_immutable BEFORE UPDATE OR DELETE ON referral_consultation_starts FOR EACH ROW EXECUTE FUNCTION referral_consultation_start_guard();
CREATE FUNCTION referral_consultation_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.receipt IS NOT NULL OR NEW.receipt IS NULL OR NEW.result_id IS NULL
 OR (to_jsonb(NEW)-'receipt'-'result_id') IS DISTINCT FROM(to_jsonb(OLD)-'receipt'-'result_id')
 THEN RAISE EXCEPTION 'referral_consultation_command_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_consultation_command_immutable BEFORE UPDATE OR DELETE ON referral_consultation_start_commands FOR EACH ROW EXECUTE FUNCTION referral_consultation_command_guard();
CREATE FUNCTION referral_consultation_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='referral_consultation_starts' THEN
  IF NOT EXISTS(SELECT 1 FROM referral_consultation_start_commands WHERE facility_id=NEW.facility_id AND result_id=NEW.id AND receipt IS NOT NULL) THEN RAISE EXCEPTION 'referral_consultation_start_incomplete'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM referral_consultation_start_commands c WHERE c.facility_id=NEW.facility_id AND c.request_key_hash=NEW.request_key_hash AND NOT EXISTS(
   SELECT 1 FROM referral_consultation_starts s WHERE s.facility_id=c.facility_id AND s.id=c.result_id AND s.patient_id=c.patient_id AND s.referral_id=c.referral_id AND s.actor_user_id=c.actor_user_id
   AND jsonb_typeof(c.receipt)='object' AND c.receipt->'link'=s.detail AND c.receipt->>'replayed'='false'
   AND (c.receipt->>'recorded_at')::timestamptz=s.recorded_at AND c.receipt->>'input_digest'=encode(c.payload_digest,'hex')
   AND jsonb_typeof(c.receipt->'reviewed_input')='object'
   AND c.receipt->'reviewed_input'->>'client_request_id'=c.receipt->>'client_request_id'
   AND c.receipt->'reviewed_input'->>'expected_link_version'='0'
   AND c.receipt->'reviewed_input'->>'expected_context_token' ~ '^[0-9a-f]{64}$'
   AND sha256(uuid_send((c.receipt->>'client_request_id')::uuid))=c.request_key_hash
   AND c.receipt->'reviewed_input'->'source'->>'mode'=s.source_mode
   AND ((s.source_mode='existing_admission_encounter'
    AND c.receipt->'reviewed_input'->'source'->>'admission_case_id'=s.admission_case_id::text
    AND c.receipt->'reviewed_input'->'source'->>'encounter_id'=s.encounter_id::text)
    OR (s.source_mode='new_outpatient' AND ((s.visit_id IS NULL AND c.receipt->'reviewed_input'->'source'->'visit'->>'choice'='no_visit')
     OR (s.visit_id IS NOT NULL AND c.receipt->'reviewed_input'->'source'->'visit'->>'choice'='existing_visit'
      AND c.receipt->'reviewed_input'->'source'->'visit'->>'visit_id'=s.visit_id::text))))
   AND (c.receipt->'reviewed_input'->'restricted_record_override'='null'::jsonb OR (
    jsonb_typeof(c.receipt->'reviewed_input'->'restricted_record_override')='object'
    AND ((c.receipt->'reviewed_input'->'restricted_record_override')-'reason_code'-'reason_note_present')='{}'::jsonb
    AND octet_length(c.receipt->'reviewed_input'->'restricted_record_override'->>'reason_code') BETWEEN 1 AND 64
    AND jsonb_typeof(c.receipt->'reviewed_input'->'restricted_record_override'->'reason_code')='string'
    AND jsonb_typeof(c.receipt->'reviewed_input'->'restricted_record_override'->'reason_note_present')='boolean'))
  )) THEN RAISE EXCEPTION 'referral_consultation_command_incomplete'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER referral_consultation_start_complete AFTER INSERT ON referral_consultation_starts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION referral_consultation_complete_guard();
CREATE CONSTRAINT TRIGGER referral_consultation_command_complete AFTER INSERT ON referral_consultation_start_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION referral_consultation_complete_guard();
-- Bound care identity survives historical closure. Exact no-ops remain valid;
-- clinical documentation and the first legitimate terminal outcome are separate.
CREATE FUNCTION encounter_care_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM admission_cases WHERE encounter_id=OLD.id) OR EXISTS(SELECT 1 FROM referral_consultation_starts WHERE encounter_id=OLD.id) THEN RAISE EXCEPTION 'encounter_identity_bound'; END IF;
  RETURN OLD;
 END IF;
 IF ROW(NEW.id,NEW.facility_id,NEW.patient_id,NEW.visit_id,NEW.encounter_type,NEW.started_at) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.patient_id,OLD.visit_id,OLD.encounter_type,OLD.started_at)
 AND (EXISTS(SELECT 1 FROM admission_cases WHERE encounter_id=OLD.id) OR EXISTS(SELECT 1 FROM referral_consultation_starts WHERE encounter_id=OLD.id))
 THEN RAISE EXCEPTION 'encounter_identity_bound'; END IF;
 IF OLD.status IN('completed','cancelled','finished') AND ROW(NEW.status,NEW.ended_at) IS DISTINCT FROM ROW(OLD.status,OLD.ended_at) THEN RAISE EXCEPTION 'encounter_terminal_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER encounter_care_identity BEFORE UPDATE OR DELETE ON encounters FOR EACH ROW EXECUTE FUNCTION encounter_care_identity_guard();
CREATE FUNCTION admission_encounter_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e encounters;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.visit_id IS NOT NULL AND NEW.visit_id IS DISTINCT FROM OLD.visit_id THEN RAISE EXCEPTION 'admission_visit_identity_bound'; END IF;
  IF (OLD.encounter_id IS NOT NULL OR EXISTS(SELECT 1 FROM referral_consultation_starts WHERE admission_case_id=OLD.id))
   AND ROW(NEW.id,NEW.facility_id,NEW.patient_id,NEW.encounter_id,NEW.visit_id) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.patient_id,OLD.encounter_id,OLD.visit_id)
   THEN RAISE EXCEPTION 'admission_encounter_identity_bound'; END IF;
  IF ROW(NEW.facility_id,NEW.patient_id,NEW.encounter_id,NEW.visit_id) IS NOT DISTINCT FROM ROW(OLD.facility_id,OLD.patient_id,OLD.encounter_id,OLD.visit_id) THEN RETURN NEW; END IF;
 END IF;
 IF NEW.encounter_id IS NOT NULL THEN
  SELECT * INTO e FROM encounters WHERE id=NEW.encounter_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id FOR SHARE;
  IF e.id IS NULL OR e.visit_id IS DISTINCT FROM NEW.visit_id THEN RAISE EXCEPTION 'admission_encounter_binding_invalid'; END IF;
 END IF;
 IF NEW.visit_id IS NOT NULL THEN
  PERFORM id FROM visits WHERE id=NEW.visit_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'admission_visit_binding_invalid'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admission_encounter_binding BEFORE INSERT OR UPDATE ON admission_cases FOR EACH ROW EXECUTE FUNCTION admission_encounter_binding_guard();
