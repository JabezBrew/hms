-- Breaking epoch027: organization topology is immutable; maintenance is governed.
ALTER TABLE organization_units ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version>0);
CREATE INDEX organization_children_reference_idx ON organization_units(parent_unit_id) WHERE parent_unit_id IS NOT NULL;
CREATE INDEX organization_positions_reference_idx ON positions(org_unit_id);
CREATE INDEX organization_permission_scope_reference_idx ON permission_assignments(scope_id,facility_id) WHERE scope_type='organization_unit';
CREATE TABLE organization_unit_commands (
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 unit_id uuid NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN('create','rename','retire','reactivate')),
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(facility_id,request_key_hash)
);
CREATE INDEX organization_unit_commands_unit_idx ON organization_unit_commands(facility_id,unit_id,recorded_at);
CREATE FUNCTION organization_unit_identity_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'organization_unit_identity_immutable'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.facility_id,NEW.code,NEW.unit_type,NEW.parent_unit_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.code,OLD.unit_type,OLD.parent_unit_id,OLD.created_at)
   THEN RAISE EXCEPTION 'organization_unit_identity_immutable'; END IF;
  IF ROW(NEW.name,NEW.is_active) IS NOT DISTINCT FROM ROW(OLD.name,OLD.is_active) THEN
   IF ROW(NEW.version,NEW.updated_at) IS DISTINCT FROM ROW(OLD.version,OLD.updated_at) THEN RAISE EXCEPTION 'organization_unit_noop_immutable'; END IF;
   RETURN NEW;
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'organization_unit_version_invalid'; END IF;
  IF OLD.is_active IS DISTINCT FROM NEW.is_active AND (
   EXISTS(SELECT 1 FROM organization_units WHERE parent_unit_id=OLD.id)
   OR EXISTS(SELECT 1 FROM positions WHERE org_unit_id=OLD.id)
   OR EXISTS(SELECT 1 FROM permission_assignments WHERE scope_type='organization_unit' AND scope_id=OLD.id))
   THEN RAISE EXCEPTION 'organization_unit_referenced'; END IF;
 END IF;
 IF NEW.parent_unit_id IS NOT NULL AND (TG_OP='INSERT' OR (NEW.is_active AND NOT OLD.is_active)) THEN
  PERFORM id FROM organization_units WHERE id=NEW.parent_unit_id AND facility_id=NEW.facility_id AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization_unit_parent_unavailable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER organization_unit_identity_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON organization_units FOR EACH ROW EXECUTE FUNCTION organization_unit_identity_lifecycle_guard();
-- Every reference producer shares the same unit gate with retirement. Existing
-- historical references may be revoked/closed but never permit retirement.
CREATE FUNCTION organization_unit_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='positions' THEN
  IF TG_OP='UPDATE' AND ROW(NEW.facility_id,NEW.org_unit_id) IS NOT DISTINCT FROM ROW(OLD.facility_id,OLD.org_unit_id) THEN RETURN NEW; END IF;
  target:=NEW.org_unit_id;
 ELSE
  IF NEW.scope_type<>'organization_unit' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.facility_id,NEW.scope_type,NEW.scope_id) IS NOT DISTINCT FROM ROW(OLD.facility_id,OLD.scope_type,OLD.scope_id) THEN RETURN NEW; END IF;
  target:=NEW.scope_id;
 END IF;
 PERFORM id FROM organization_units WHERE id=target AND facility_id=NEW.facility_id AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'organization_unit_reference_unavailable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER organization_position_unit_reference BEFORE INSERT OR UPDATE ON positions FOR EACH ROW EXECUTE FUNCTION organization_unit_reference_guard();
CREATE TRIGGER organization_permission_unit_reference BEFORE INSERT OR UPDATE ON permission_assignments FOR EACH ROW EXECUTE FUNCTION organization_unit_reference_guard();
CREATE FUNCTION organization_unit_command_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'organization_unit_command_immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM organization_units WHERE id=NEW.unit_id AND facility_id=NEW.facility_id)
 OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND facility_id=NEW.facility_id)
 OR NEW.receipt->>'recorded_by_user_id' IS DISTINCT FROM NEW.actor_user_id::text
 OR NEW.receipt->'unit'->>'id' IS DISTINCT FROM NEW.unit_id::text
 OR NEW.receipt->'reviewed_input'->>'action' IS DISTINCT FROM NEW.action
 OR NEW.receipt->'reviewed_input'->>'client_request_id' IS DISTINCT FROM NEW.receipt->>'client_request_id'
 OR NEW.receipt->>'input_digest' IS DISTINCT FROM encode(NEW.payload_digest,'hex')
 OR sha256(uuid_send((NEW.receipt->>'client_request_id')::uuid)) IS DISTINCT FROM NEW.request_key_hash
 OR (NEW.receipt->>'recorded_at')::timestamptz IS DISTINCT FROM NEW.recorded_at
 THEN RAISE EXCEPTION 'organization_unit_command_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER organization_unit_command_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_unit_commands FOR EACH ROW EXECUTE FUNCTION organization_unit_command_immutable_guard();
