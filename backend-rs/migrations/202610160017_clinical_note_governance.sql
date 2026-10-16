-- Ordinary template changes remain immediately effective. Existing content is
-- preserved exactly; a missing legacy owner/publisher is never invented.
ALTER TABLE clinical_note_templates
 ADD COLUMN owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN current_revision bigint NOT NULL DEFAULT 1 CHECK(current_revision>0),
 ADD COLUMN current_revision_id uuid,
 ADD CONSTRAINT clinical_note_templates_facility_id_unique UNIQUE(facility_id,id);
CREATE TABLE clinical_note_template_revisions (
 id uuid PRIMARY KEY,
 facility_id uuid NOT NULL,
 template_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),
 title text NOT NULL,
 note_type text NOT NULL CHECK(note_type IN('doctor_note','nursing_note','allied_health_note')),
 body_template text NOT NULL,
 is_active boolean NOT NULL,
 change_summary text CHECK(change_summary IS NULL OR length(change_summary)<=500),
 created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 imported_legacy boolean NOT NULL DEFAULT false,
 CHECK(imported_legacy OR created_by_user_id IS NOT NULL),
 UNIQUE(facility_id,id),
 UNIQUE(template_id,version),
 FOREIGN KEY(facility_id,template_id) REFERENCES clinical_note_templates(facility_id,id) ON DELETE RESTRICT
);
INSERT INTO clinical_note_template_revisions(id,facility_id,template_id,version,title,note_type,body_template,is_active,created_at,imported_legacy)
 SELECT gen_random_uuid(),facility_id,id,1,title,note_type,body_template,is_active,updated_at,true FROM clinical_note_templates;
UPDATE clinical_note_templates t SET current_revision_id=r.id FROM clinical_note_template_revisions r WHERE r.facility_id=t.facility_id AND r.template_id=t.id AND r.version=1;
ALTER TABLE clinical_note_templates ALTER COLUMN current_revision_id SET NOT NULL;
ALTER TABLE clinical_note_templates ADD CONSTRAINT clinical_note_template_current_fk
 FOREIGN KEY(facility_id,current_revision_id) REFERENCES clinical_note_template_revisions(facility_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE clinical_notes ADD COLUMN template_revision_id uuid,
 ADD CONSTRAINT clinical_notes_facility_id_unique UNIQUE(facility_id,id),
 ADD CONSTRAINT clinical_notes_template_revision_fk FOREIGN KEY(facility_id,template_revision_id) REFERENCES clinical_note_template_revisions(facility_id,id) ON DELETE RESTRICT;
ALTER TABLE clinical_note_versions ADD COLUMN facility_id uuid,
 ADD COLUMN edit_reason text CHECK(edit_reason IS NULL OR length(edit_reason)<=500);
UPDATE clinical_note_versions v SET facility_id=n.facility_id FROM clinical_notes n WHERE n.id=v.note_id;
ALTER TABLE clinical_note_versions ALTER COLUMN facility_id SET NOT NULL;
ALTER TABLE clinical_note_versions DROP CONSTRAINT clinical_note_versions_note_id_fkey;
ALTER TABLE clinical_note_versions ADD CONSTRAINT clinical_note_versions_scope_fk FOREIGN KEY(facility_id,note_id) REFERENCES clinical_notes(facility_id,id) ON DELETE RESTRICT;
CREATE TABLE clinical_note_commands (
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 command_kind text NOT NULL CHECK(command_kind IN('record','amend')),
 target_id uuid REFERENCES clinical_notes(id) ON DELETE RESTRICT,
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 result_id uuid REFERENCES clinical_notes(id) ON DELETE RESTRICT,
 receipt jsonb,
 PRIMARY KEY(facility_id,request_key_hash)
);
CREATE TABLE clinical_note_template_commands (
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 command_kind text NOT NULL CHECK(command_kind IN('record','change')),
 target_id uuid REFERENCES clinical_note_templates(id) ON DELETE RESTRICT,
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 result_id uuid REFERENCES clinical_note_templates(id) ON DELETE RESTRICT,
 receipt jsonb,
 PRIMARY KEY(facility_id,request_key_hash)
);
CREATE FUNCTION clinical_note_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'clinical_note_evidence_immutable'; END $$;
CREATE TRIGGER clinical_note_version_immutable BEFORE UPDATE OR DELETE ON clinical_note_versions FOR EACH ROW EXECUTE FUNCTION clinical_note_evidence_immutable();
CREATE TRIGGER clinical_note_template_revision_immutable BEFORE UPDATE OR DELETE ON clinical_note_template_revisions FOR EACH ROW EXECUTE FUNCTION clinical_note_evidence_immutable();
CREATE FUNCTION clinical_note_command_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.receipt IS NOT NULL OR NEW.receipt IS NULL OR NEW.result_id IS NULL OR (to_jsonb(NEW)-'receipt'-'result_id') IS DISTINCT FROM (to_jsonb(OLD)-'receipt'-'result_id') THEN RAISE EXCEPTION 'clinical_note_command_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clinical_note_command_immutable BEFORE UPDATE OR DELETE ON clinical_note_commands FOR EACH ROW EXECUTE FUNCTION clinical_note_command_immutable();
CREATE TRIGGER clinical_note_template_command_immutable BEFORE UPDATE OR DELETE ON clinical_note_template_commands FOR EACH ROW EXECUTE FUNCTION clinical_note_command_immutable();
CREATE FUNCTION clinical_note_command_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE incomplete boolean;
BEGIN
 EXECUTE format('SELECT receipt IS NULL FROM %I WHERE facility_id=$1 AND request_key_hash=$2',TG_TABLE_NAME) INTO incomplete USING NEW.facility_id,NEW.request_key_hash;
 IF incomplete THEN RAISE EXCEPTION 'clinical_note_command_incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER clinical_note_command_complete AFTER INSERT ON clinical_note_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clinical_note_command_complete();
CREATE CONSTRAINT TRIGGER clinical_note_template_command_complete AFTER INSERT ON clinical_note_template_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clinical_note_command_complete();
CREATE INDEX clinical_note_history_scoped_idx ON clinical_note_versions(facility_id,note_id,version DESC);
CREATE INDEX clinical_note_template_cursor_idx ON clinical_note_templates(facility_id,updated_at DESC,id DESC);
CREATE INDEX clinical_note_template_active_cursor_idx ON clinical_note_templates(facility_id,is_active,updated_at DESC,id DESC);
CREATE INDEX clinical_note_template_title_search_idx ON clinical_note_templates USING gin(lower(title) gin_trgm_ops);

-- Internal provisioning/fixture callers may omit this redundant scope column;
-- derive it only from the actual parent, never from caller assertions.
CREATE FUNCTION clinical_note_version_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_facility uuid;
BEGIN
 SELECT facility_id INTO parent_facility FROM clinical_notes WHERE id=NEW.note_id;
 IF parent_facility IS NULL OR (NEW.facility_id IS NOT NULL AND NEW.facility_id<>parent_facility) THEN RAISE EXCEPTION 'clinical_note_version_scope_invalid'; END IF;
 NEW.facility_id=parent_facility;
 IF NEW.created_by_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by_user_id AND facility_id=parent_facility) THEN RAISE EXCEPTION 'clinical_note_version_actor_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clinical_note_version_scope BEFORE INSERT ON clinical_note_versions FOR EACH ROW EXECUTE FUNCTION clinical_note_version_scope();

-- Trusted baseline/import writers predate the redundant pointer. Preserve their
-- exact snapshot as explicitly unattributed imported evidence. Public commands
-- always provide an owner and allocate their own revision in the transaction.
CREATE FUNCTION clinical_note_template_import_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.current_revision_id IS NULL THEN
  IF NEW.owner_user_id IS NOT NULL THEN RAISE EXCEPTION 'clinical_note_template_revision_required'; END IF;
  NEW.current_revision_id=gen_random_uuid();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clinical_note_template_import_pointer BEFORE INSERT ON clinical_note_templates FOR EACH ROW EXECUTE FUNCTION clinical_note_template_import_pointer();
CREATE FUNCTION clinical_note_template_import_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.owner_user_id IS NULL THEN
  INSERT INTO clinical_note_template_revisions(id,facility_id,template_id,version,title,note_type,body_template,is_active,created_at,imported_legacy)
   VALUES(NEW.current_revision_id,NEW.facility_id,NEW.id,NEW.current_revision,NEW.title,NEW.note_type,NEW.body_template,NEW.is_active,NEW.updated_at,true);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clinical_note_template_import_snapshot AFTER INSERT ON clinical_note_templates FOR EACH ROW EXECUTE FUNCTION clinical_note_template_import_snapshot();

CREATE FUNCTION clinical_note_template_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id,NEW.facility_id,NEW.owner_user_id) IS DISTINCT FROM (OLD.id,OLD.facility_id,OLD.owner_user_id) THEN RAISE EXCEPTION 'clinical_note_template_identity_immutable'; END IF;
 IF NEW.owner_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.owner_user_id AND facility_id=NEW.facility_id) THEN RAISE EXCEPTION 'clinical_note_template_owner_scope_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clinical_note_template_identity BEFORE INSERT OR UPDATE ON clinical_note_templates FOR EACH ROW EXECUTE FUNCTION clinical_note_template_identity();
CREATE FUNCTION clinical_note_template_current_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM clinical_note_templates t JOIN clinical_note_template_revisions r ON r.facility_id=t.facility_id AND r.id=t.current_revision_id AND r.template_id=t.id AND r.version=t.current_revision AND r.title=t.title AND r.note_type=t.note_type AND r.body_template=t.body_template AND r.is_active=t.is_active WHERE t.id=NEW.id) THEN RAISE EXCEPTION 'clinical_note_template_current_inconsistent'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER clinical_note_template_current_consistent AFTER INSERT OR UPDATE ON clinical_note_templates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clinical_note_template_current_consistent();
CREATE FUNCTION clinical_note_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.facility_id,NEW.patient_id,NEW.encounter_id,NEW.note_type,NEW.title,NEW.created_by_user_id,NEW.template_revision_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.facility_id,OLD.patient_id,OLD.encounter_id,OLD.note_type,OLD.title,OLD.created_by_user_id,OLD.template_revision_id,OLD.created_at) THEN RAISE EXCEPTION 'clinical_note_identity_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clinical_note_identity_immutable BEFORE UPDATE ON clinical_notes FOR EACH ROW EXECUTE FUNCTION clinical_note_identity_immutable();
