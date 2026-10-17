-- Reviewed clinical responses are distinct from operational referral routing.
-- Breaking runtime epoch024: older runtimes must not read/write these bodies.
ALTER TABLE referrals
 ADD COLUMN response_version bigint NOT NULL DEFAULT 0 CHECK(response_version>=0),
 ADD CONSTRAINT referrals_facility_identity UNIQUE(facility_id,id);
CREATE TABLE referral_response_revisions (
 id uuid PRIMARY KEY,
 facility_id uuid NOT NULL,
 referral_id uuid NOT NULL,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
 version bigint NOT NULL CHECK(version>0),
 operation text NOT NULL CHECK(operation IN('legacy_observed','draft_saved','completed','amended')),
 status text NOT NULL CHECK(status IN('sent','accepted','scheduled','declined','completed','cancelled')),
 to_service text NOT NULL,
 priority text NOT NULL CHECK(priority IN('routine','urgent','emergency')),
 specialist_notes text,
 recommendations text,
 amendment_reason text,
 completed_at timestamptz,
 recorded_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 recorded_by_display_name text,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 imported_legacy boolean NOT NULL DEFAULT false,
 UNIQUE(facility_id,id),UNIQUE(referral_id,version),
 FOREIGN KEY(facility_id,referral_id) REFERENCES referrals(facility_id,id) ON DELETE RESTRICT,
 CHECK(imported_legacy=(operation='legacy_observed')),
 CHECK(imported_legacy OR (recorded_by_user_id IS NOT NULL AND recorded_by_display_name IS NOT NULL
   AND length(btrim(specialist_notes)) BETWEEN 10 AND 20000 AND specialist_notes IS NOT NULL
   AND recommendations IS NOT NULL AND length(recommendations)<=10000
   AND (amendment_reason IS NULL OR length(amendment_reason)<=500))),
 CHECK(imported_legacy OR (operation='amended')=(amendment_reason IS NOT NULL AND length(btrim(amendment_reason))>0))
);
-- Preserve only the current observed imported snapshot, never invent its author
-- or original response time from unrelated referral creation/acceptance fields.
INSERT INTO referral_response_revisions(id,facility_id,referral_id,patient_id,version,operation,status,to_service,priority,specialist_notes,recommendations,completed_at,imported_legacy)
 SELECT gen_random_uuid(),facility_id,id,patient_id,1,'legacy_observed',status,to_service,priority,specialist_notes,recommendations,completed_at,true
 FROM referrals WHERE specialist_notes IS NOT NULL OR recommendations IS NOT NULL OR completed_at IS NOT NULL OR status='completed';
UPDATE referrals SET response_version=1 WHERE EXISTS(SELECT 1 FROM referral_response_revisions v WHERE v.referral_id=referrals.id);
CREATE TABLE referral_response_commands (
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
 referral_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 operation text NOT NULL CHECK(operation IN('save_draft','complete','amend')),
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 result_id uuid,
 receipt jsonb,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(facility_id,request_key_hash),
 FOREIGN KEY(facility_id,referral_id) REFERENCES referrals(facility_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(facility_id,result_id) REFERENCES referral_response_revisions(facility_id,id) ON DELETE RESTRICT
);
CREATE INDEX referral_response_history_idx ON referral_response_revisions(facility_id,referral_id,version DESC);
CREATE FUNCTION referral_response_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'referral_response_revision_immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM referrals r WHERE r.id=NEW.referral_id AND r.facility_id=NEW.facility_id AND r.patient_id=NEW.patient_id)
  OR (NEW.recorded_by_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.recorded_by_user_id AND u.facility_id=NEW.facility_id))
 THEN RAISE EXCEPTION 'referral_response_scope_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_response_revision_immutable BEFORE UPDATE OR DELETE ON referral_response_revisions FOR EACH ROW EXECUTE FUNCTION referral_response_revision_guard();
CREATE TRIGGER referral_response_revision_scope BEFORE INSERT ON referral_response_revisions FOR EACH ROW EXECUTE FUNCTION referral_response_revision_guard();
CREATE FUNCTION referral_response_root_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.facility_id,NEW.patient_id,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.patient_id,OLD.created_by_user_id,OLD.created_at)
 THEN RAISE EXCEPTION 'referral_response_root_identity_immutable'; END IF;
 IF NEW.response_version<OLD.response_version OR NEW.response_version>OLD.response_version+1 THEN RAISE EXCEPTION 'referral_response_version_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_response_root_identity_immutable BEFORE UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION referral_response_root_identity_guard();
CREATE FUNCTION referral_response_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.receipt IS NOT NULL OR NEW.receipt IS NULL OR NEW.result_id IS NULL
 OR (to_jsonb(NEW)-'receipt'-'result_id') IS DISTINCT FROM (to_jsonb(OLD)-'receipt'-'result_id')
 THEN RAISE EXCEPTION 'referral_response_command_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_response_command_immutable BEFORE UPDATE OR DELETE ON referral_response_commands FOR EACH ROW EXECUTE FUNCTION referral_response_command_guard();
CREATE FUNCTION referral_response_command_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM referral_response_commands c WHERE c.facility_id=NEW.facility_id AND c.request_key_hash=NEW.request_key_hash AND
 (c.receipt IS NULL OR c.result_id IS NULL OR NOT EXISTS(
 SELECT 1 FROM referral_response_revisions v WHERE v.facility_id=c.facility_id AND v.id=c.result_id AND v.referral_id=c.referral_id AND v.patient_id=c.patient_id AND v.recorded_by_user_id=c.actor_user_id AND NOT v.imported_legacy
 AND v.operation=CASE c.operation WHEN 'save_draft' THEN 'draft_saved' WHEN 'complete' THEN 'completed' WHEN 'amend' THEN 'amended' END
 AND jsonb_typeof(c.receipt)='object' AND jsonb_typeof(c.receipt->'response')='object'
 AND c.receipt->>'operation'=v.operation AND c.receipt->>'replayed'='false'
 AND c.receipt->'response'->>'id'=v.id::text
 AND c.receipt->'response'->>'patient_id'=c.patient_id::text
 AND c.receipt->'response'->>'referral_id'=c.referral_id::text
 AND c.receipt->'response'->>'recorded_by_user_id'=c.actor_user_id::text
 AND c.receipt->'response'->>'operation'=v.operation
 AND c.receipt->'response'->>'version'=v.version::text
 AND c.receipt->'response'->>'status'=v.status)))
 THEN RAISE EXCEPTION 'referral_response_command_incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER referral_response_command_complete AFTER INSERT ON referral_response_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION referral_response_command_complete_guard();
-- Trusted fixture/import writers may still supply a current legacy snapshot.
-- Observe it without fabricating its original clinician or authored time.
CREATE FUNCTION referral_response_observe_import() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_version bigint;
BEGIN
 IF (TG_OP='INSERT' AND NEW.response_version=0 AND (NEW.specialist_notes IS NOT NULL OR NEW.recommendations IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.status='completed'))
 OR (TG_OP='UPDATE' AND NEW.response_version=OLD.response_version AND
 (ROW(NEW.specialist_notes,NEW.recommendations,NEW.completed_at) IS DISTINCT FROM ROW(OLD.specialist_notes,OLD.recommendations,OLD.completed_at) OR (NEW.status='completed' AND OLD.status<>'completed'))) THEN
  next_version=NEW.response_version+1;
  INSERT INTO referral_response_revisions(id,facility_id,referral_id,patient_id,version,operation,status,to_service,priority,specialist_notes,recommendations,completed_at,imported_legacy)
  VALUES(gen_random_uuid(),NEW.facility_id,NEW.id,NEW.patient_id,next_version,'legacy_observed',NEW.status,NEW.to_service,NEW.priority,NEW.specialist_notes,NEW.recommendations,NEW.completed_at,true);
  UPDATE referrals SET response_version=next_version WHERE id=NEW.id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER referral_response_import_observation AFTER INSERT OR UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION referral_response_observe_import();
CREATE FUNCTION referral_response_root_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r referrals;
BEGIN
 SELECT * INTO r FROM referrals WHERE id=NEW.id;
 IF r.response_version IS DISTINCT FROM (SELECT coalesce(max(version),0) FROM referral_response_revisions WHERE facility_id=r.facility_id AND referral_id=r.id) THEN RAISE EXCEPTION 'referral_response_root_inconsistent'; END IF;
 IF r.response_version=0 THEN
  IF r.specialist_notes IS NOT NULL OR r.recommendations IS NOT NULL OR r.completed_at IS NOT NULL OR r.status='completed' THEN RAISE EXCEPTION 'referral_response_root_inconsistent'; END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM referral_response_revisions v WHERE v.facility_id=r.facility_id AND v.referral_id=r.id AND v.patient_id=r.patient_id AND v.version=r.response_version AND v.specialist_notes IS NOT DISTINCT FROM r.specialist_notes AND v.recommendations IS NOT DISTINCT FROM r.recommendations AND v.completed_at IS NOT DISTINCT FROM r.completed_at) THEN RAISE EXCEPTION 'referral_response_root_inconsistent';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER referral_response_root_consistent AFTER INSERT OR UPDATE ON referrals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION referral_response_root_consistency();
