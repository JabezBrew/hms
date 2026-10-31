-- Breaking epoch030: governed current catalog; legacy dated evidence remains exact.
ALTER TABLE inventory_items ADD COLUMN version bigint NOT NULL DEFAULT 1 CONSTRAINT inventory_item_version_positive CHECK(version>0),ADD COLUMN catalog_changed_at timestamptz;
ALTER TABLE stock_transfers ADD COLUMN requested_unit text;
CREATE INDEX inventory_item_administration_page_idx ON inventory_items(facility_id,created_at DESC,id DESC);
CREATE INDEX inventory_item_legacy_history_page_idx ON inventory_item_catalog_versions(facility_id,item_id,created_at DESC,id DESC);
CREATE INDEX inventory_item_batch_reference_idx ON stock_batches(item_id);
CREATE INDEX inventory_item_movement_reference_idx ON stock_movements(item_id);
CREATE INDEX inventory_item_transfer_reference_idx ON stock_transfers(item_id);
CREATE INDEX inventory_item_controlled_reference_idx ON controlled_substance_register(item_id);
CREATE INDEX inventory_item_dispense_reference_idx ON pharmacy_dispenses(item_id);
CREATE INDEX inventory_item_prescription_reference_idx ON prescriptions(inventory_item_id) WHERE inventory_item_id IS NOT NULL;
CREATE INDEX inventory_item_course_reference_idx ON medication_courses(inventory_item_id) WHERE inventory_item_id IS NOT NULL;
CREATE INDEX inventory_item_fulfillment_reference_idx ON pharmacy_fulfillments(inventory_item_id) WHERE inventory_item_id IS NOT NULL;
CREATE INDEX inventory_item_template_reference_idx ON inventory_standing_order_template_items(item_id);
CREATE INDEX inventory_item_requisition_reference_idx ON stock_requisition_items(item_id);
CREATE FUNCTION inventory_item_has_operational_history(target uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM stock_batches WHERE item_id=target) OR EXISTS(SELECT 1 FROM stock_movements WHERE item_id=target) OR EXISTS(SELECT 1 FROM stock_transfers WHERE item_id=target) OR EXISTS(SELECT 1 FROM controlled_substance_register WHERE item_id=target) OR EXISTS(SELECT 1 FROM pharmacy_dispenses WHERE item_id=target) OR EXISTS(SELECT 1 FROM prescriptions WHERE inventory_item_id=target) OR EXISTS(SELECT 1 FROM medication_courses WHERE inventory_item_id=target) OR EXISTS(SELECT 1 FROM pharmacy_fulfillments WHERE inventory_item_id=target) OR EXISTS(SELECT 1 FROM inventory_standing_order_template_items WHERE item_id=target) OR EXISTS(SELECT 1 FROM stock_requisition_items WHERE item_id=target);
$$;
-- Shared by the command and intrinsic INSERT/code-change guard: never wait on uniqueness.
CREATE FUNCTION inventory_item_reserve_codes(facility uuid,codes text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE value text; lock_key bigint;
BEGIN
 FOR value IN SELECT DISTINCT unnest(codes) ORDER BY 1 LOOP
  lock_key:=('x'||substr(encode(sha256(convert_to('hms.inventory-item.code.v1','UTF8')||uuid_send(facility)||convert_to(value,'UTF8')),'hex'),1,16))::bit(64)::bigint;
  IF NOT pg_try_advisory_xact_lock(lock_key) THEN RAISE EXCEPTION 'inventory_item_busy' USING ERRCODE='55P03'; END IF;
 END LOOP;
END $$;
CREATE TABLE inventory_item_commands(
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN('create','correct','retire','reactivate')),
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(facility_id,request_key_hash)
);
CREATE INDEX inventory_item_commands_item_idx ON inventory_item_commands(facility_id,item_id,recorded_at DESC);
CREATE TABLE inventory_item_catalog_revisions(
 id uuid PRIMARY KEY,
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL,
 reviewed_effective_from date NOT NULL,recorded_at timestamptz NOT NULL,
 before_code text NOT NULL,before_name text NOT NULL,before_unit text NOT NULL,before_version bigint NOT NULL CHECK(before_version>0),
 after_code text NOT NULL,after_name text NOT NULL,after_unit text NOT NULL,after_version bigint NOT NULL CHECK(after_version>0),
 projection_changed boolean NOT NULL,reason_present boolean NOT NULL,
 CONSTRAINT inventory_item_revision_command_unique UNIQUE(facility_id,request_key_hash),
 FOREIGN KEY(facility_id,request_key_hash) REFERENCES inventory_item_commands(facility_id,request_key_hash) ON DELETE RESTRICT,
 CHECK(after_version=before_version+CASE WHEN projection_changed THEN 1 ELSE 0 END),
 CHECK(projection_changed=(ROW(before_code,before_name,before_unit) IS DISTINCT FROM ROW(after_code,after_name,after_unit)))
);
CREATE INDEX inventory_item_correction_history_page_idx ON inventory_item_catalog_revisions(facility_id,item_id,recorded_at DESC,id DESC);
CREATE FUNCTION inventory_item_identity_catalog_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'inventory_item_identity_immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.item_type NOT IN('medication','supply','controlled_substance') OR NEW.controlled<>(NEW.item_type='controlled_substance') THEN RAISE EXCEPTION 'inventory_item_invalid_source'; END IF;
  PERFORM id FROM inventory_categories WHERE id=NEW.category_id AND facility_id=NEW.facility_id AND is_active FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_item_category_unavailable'; END IF;
  PERFORM inventory_item_reserve_codes(NEW.facility_id,ARRAY[NEW.code]);
 ELSE
  IF ROW(NEW.id,NEW.facility_id,NEW.category_id,NEW.item_type,NEW.controlled,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.category_id,OLD.item_type,OLD.controlled,OLD.created_at) THEN RAISE EXCEPTION 'inventory_item_identity_immutable'; END IF;
  IF ROW(NEW.code,NEW.name,NEW.unit,NEW.is_active) IS NOT DISTINCT FROM ROW(OLD.code,OLD.name,OLD.unit,OLD.is_active) THEN
   IF ROW(NEW.version,NEW.catalog_changed_at) IS DISTINCT FROM ROW(OLD.version,OLD.catalog_changed_at) THEN RAISE EXCEPTION 'inventory_item_noop_immutable'; END IF;
   RETURN NEW;
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.catalog_changed_at IS NULL OR(OLD.catalog_changed_at IS NOT NULL AND NEW.catalog_changed_at<OLD.catalog_changed_at) THEN RAISE EXCEPTION 'inventory_item_version_invalid'; END IF;
  IF NEW.unit IS DISTINCT FROM OLD.unit OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
   IF OLD.controlled OR OLD.item_type NOT IN('medication','supply') THEN RAISE EXCEPTION 'inventory_item_controlled_or_unsupported'; END IF;
   IF inventory_item_has_operational_history(OLD.id) THEN RAISE EXCEPTION 'inventory_item_operational_history'; END IF;
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN PERFORM inventory_item_reserve_codes(NEW.facility_id,ARRAY[OLD.code,NEW.code]); END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM inventory_items WHERE facility_id=NEW.facility_id AND code=NEW.code AND id<>NEW.id) THEN RAISE EXCEPTION 'inventory_item_code_conflict'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_item_identity_catalog BEFORE INSERT OR UPDATE OR DELETE ON inventory_items FOR EACH ROW EXECUTE FUNCTION inventory_item_identity_catalog_guard();
-- No new writes into the old interval model; imported past/future rows are untouched.
CREATE FUNCTION inventory_item_legacy_catalog_closed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'inventory_item_legacy_catalog_closed';END $$;
CREATE TRIGGER inventory_item_legacy_catalog_closed BEFORE INSERT OR UPDATE OR DELETE ON inventory_item_catalog_versions FOR EACH ROW EXECUTE FUNCTION inventory_item_legacy_catalog_closed_guard();
CREATE FUNCTION inventory_item_operational_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; previous jsonb; current_row jsonb:=to_jsonb(NEW); source_unit text;
BEGIN
 IF TG_OP='UPDATE' THEN previous:=to_jsonb(OLD);END IF;
 IF TG_TABLE_NAME='stock_transfers' AND TG_OP='UPDATE' AND current_row->>'requested_unit' IS DISTINCT FROM previous->>'requested_unit' THEN RAISE EXCEPTION 'inventory_transfer_unit_immutable'; END IF;
 target:=(current_row->>TG_ARGV[0])::uuid;
 IF target IS NOT NULL AND(TG_OP='INSERT' OR ROW(current_row->>'facility_id',current_row->>TG_ARGV[0]) IS DISTINCT FROM ROW(previous->>'facility_id',previous->>TG_ARGV[0])) THEN
  SELECT unit INTO source_unit FROM inventory_items WHERE id=target AND facility_id=NEW.facility_id AND is_active FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_item_reference_unavailable'; END IF;
  IF TG_TABLE_NAME='stock_transfers' AND(current_row->>'requested_unit' IS NULL OR current_row->>'requested_unit' IS DISTINCT FROM source_unit) THEN RAISE EXCEPTION 'inventory_transfer_unit_review_required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_item_batch_reference BEFORE INSERT OR UPDATE ON stock_batches FOR EACH ROW EXECUTE FUNCTION inventory_item_operational_reference_guard('item_id');
CREATE TRIGGER inventory_item_movement_reference BEFORE INSERT OR UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION inventory_item_operational_reference_guard('item_id');
CREATE TRIGGER inventory_item_transfer_reference BEFORE INSERT OR UPDATE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION inventory_item_operational_reference_guard('item_id');
CREATE TRIGGER inventory_item_controlled_reference BEFORE INSERT OR UPDATE ON controlled_substance_register FOR EACH ROW EXECUTE FUNCTION inventory_item_operational_reference_guard('item_id');
CREATE TRIGGER inventory_item_dispense_reference BEFORE INSERT OR UPDATE ON pharmacy_dispenses FOR EACH ROW EXECUTE FUNCTION inventory_item_operational_reference_guard('item_id');
CREATE TRIGGER inventory_item_prescription_reference BEFORE INSERT OR UPDATE ON prescriptions FOR EACH ROW EXECUTE FUNCTION inventory_item_operational_reference_guard('inventory_item_id');
CREATE TRIGGER inventory_item_course_reference BEFORE INSERT OR UPDATE ON medication_courses FOR EACH ROW EXECUTE FUNCTION inventory_item_operational_reference_guard('inventory_item_id');
CREATE TRIGGER inventory_item_fulfillment_reference BEFORE INSERT OR UPDATE ON pharmacy_fulfillments FOR EACH ROW EXECUTE FUNCTION inventory_item_operational_reference_guard('inventory_item_id');
CREATE TRIGGER inventory_item_template_reference BEFORE INSERT OR UPDATE ON inventory_standing_order_template_items FOR EACH ROW EXECUTE FUNCTION inventory_item_operational_reference_guard('item_id');
CREATE TRIGGER inventory_item_requisition_reference BEFORE INSERT OR UPDATE ON stock_requisition_items FOR EACH ROW EXECUTE FUNCTION inventory_item_operational_reference_guard('item_id');
CREATE FUNCTION inventory_item_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'inventory_item_command_immutable';END IF;
 IF NOT EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.item_id AND facility_id=NEW.facility_id)
 OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND facility_id=NEW.facility_id)
 OR NEW.receipt->>'recorded_by_user_id' IS DISTINCT FROM NEW.actor_user_id::text
 OR NEW.receipt->'item'->>'id' IS DISTINCT FROM NEW.item_id::text
 OR NEW.receipt->'reviewed_input'->>'action' IS DISTINCT FROM NEW.action
 OR NEW.receipt->'reviewed_input'->>'client_request_id' IS DISTINCT FROM NEW.receipt->>'client_request_id'
 OR NEW.receipt->>'input_digest' IS DISTINCT FROM encode(NEW.payload_digest,'hex')
 OR sha256(uuid_send((NEW.receipt->>'client_request_id')::uuid)) IS DISTINCT FROM NEW.request_key_hash
 OR (NEW.receipt->>'recorded_at')::timestamptz IS DISTINCT FROM NEW.recorded_at
 OR(NEW.action<>'create' AND NEW.receipt->'reviewed_input'->>'item_id' IS DISTINCT FROM NEW.item_id::text)
 OR(CASE WHEN NEW.action='correct' THEN jsonb_typeof(NEW.receipt->'correction_revision') IS DISTINCT FROM 'object' ELSE jsonb_typeof(NEW.receipt->'correction_revision') IS DISTINCT FROM 'null' END) THEN RAISE EXCEPTION 'inventory_item_command_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_item_command_immutable BEFORE INSERT OR UPDATE OR DELETE ON inventory_item_commands FOR EACH ROW EXECUTE FUNCTION inventory_item_command_guard();
CREATE FUNCTION inventory_item_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt jsonb; revision jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'inventory_item_revision_immutable';END IF;
 SELECT c.receipt INTO receipt FROM inventory_item_commands c WHERE c.facility_id=NEW.facility_id AND c.request_key_hash=NEW.request_key_hash AND c.item_id=NEW.item_id AND c.action='correct';
 revision:=receipt->'correction_revision';
 IF receipt IS NULL OR(revision->>'id')::uuid IS DISTINCT FROM NEW.id
 OR(revision->>'reviewed_effective_from')::date IS DISTINCT FROM NEW.reviewed_effective_from
 OR(revision->>'recorded_at')::timestamptz IS DISTINCT FROM NEW.recorded_at
 OR(receipt->>'recorded_at')::timestamptz IS DISTINCT FROM NEW.recorded_at
 OR(revision->>'projection_changed')::boolean IS DISTINCT FROM NEW.projection_changed
 OR ROW(revision->'before'->>'code',revision->'before'->>'name',revision->'before'->>'unit',(revision->'before'->>'version')::bigint) IS DISTINCT FROM ROW(NEW.before_code,NEW.before_name,NEW.before_unit,NEW.before_version)
 OR ROW(revision->'after'->>'code',revision->'after'->>'name',revision->'after'->>'unit',(revision->'after'->>'version')::bigint) IS DISTINCT FROM ROW(NEW.after_code,NEW.after_name,NEW.after_unit,NEW.after_version)
 OR NEW.before_version IS DISTINCT FROM(receipt->'reviewed_input'->>'expected_version')::bigint
 OR NEW.after_version IS DISTINCT FROM(receipt->'item'->>'version')::bigint
 OR NEW.projection_changed IS DISTINCT FROM(receipt->>'changed')::boolean THEN RAISE EXCEPTION 'inventory_item_revision_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_item_revision_immutable BEFORE INSERT OR UPDATE OR DELETE ON inventory_item_catalog_revisions FOR EACH ROW EXECUTE FUNCTION inventory_item_revision_guard();
CREATE FUNCTION inventory_item_command_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action='correct' AND NOT EXISTS(SELECT 1 FROM inventory_item_catalog_revisions r WHERE r.facility_id=NEW.facility_id AND r.request_key_hash=NEW.request_key_hash AND r.item_id=NEW.item_id) THEN RAISE EXCEPTION 'inventory_item_command_incomplete';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER inventory_item_command_complete AFTER INSERT ON inventory_item_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_item_command_complete_guard();
