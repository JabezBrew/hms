-- Breaking epoch028: governed unused-location maintenance; operational history is preserved.
ALTER TABLE storage_locations ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version>0), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX storage_location_administration_page_idx ON storage_locations(facility_id,created_at DESC,id DESC);
CREATE INDEX storage_location_batch_location_id_reference_idx ON stock_batches(location_id);
CREATE INDEX storage_location_movement_location_id_reference_idx ON stock_movements(location_id);
CREATE INDEX storage_location_transfer_from_location_id_reference_idx ON stock_transfers(from_location_id);
CREATE INDEX storage_location_transfer_to_location_id_reference_idx ON stock_transfers(to_location_id);
CREATE INDEX storage_location_requisition_requesting_reference_idx ON stock_requisitions(requesting_location_id);
CREATE INDEX storage_location_requisition_fulfilling_reference_idx ON stock_requisitions(fulfilling_location_id);
CREATE INDEX storage_location_controlled_location_id_reference_idx ON controlled_substance_register(location_id);
CREATE INDEX storage_location_dispense_location_id_reference_idx ON pharmacy_dispenses(location_id);
CREATE INDEX storage_location_standing_requesting_location_id_reference_idx ON inventory_standing_orders(requesting_location_id);
CREATE INDEX storage_location_check_location_id_reference_idx ON stock_check_queue(location_id);
CREATE INDEX storage_location_fulfillment_dispensing_reference_idx ON pharmacy_fulfillments(dispensing_location_id);
CREATE INDEX storage_location_template_requesting_location_id_reference_idx ON inventory_standing_order_templates(requesting_location_id);
CREATE INDEX storage_location_template_fulfilling_location_id_reference_idx ON inventory_standing_order_templates(fulfilling_location_id);
CREATE FUNCTION storage_location_has_operational_history(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM stock_batches WHERE location_id=target) OR EXISTS(SELECT 1 FROM stock_movements WHERE location_id=target) OR EXISTS(SELECT 1 FROM stock_transfers WHERE from_location_id=target) OR EXISTS(SELECT 1 FROM stock_transfers WHERE to_location_id=target) OR EXISTS(SELECT 1 FROM stock_requisitions WHERE requesting_location_id=target) OR EXISTS(SELECT 1 FROM stock_requisitions WHERE fulfilling_location_id=target) OR EXISTS(SELECT 1 FROM controlled_substance_register WHERE location_id=target) OR EXISTS(SELECT 1 FROM pharmacy_dispenses WHERE location_id=target) OR EXISTS(SELECT 1 FROM inventory_standing_orders WHERE requesting_location_id=target) OR EXISTS(SELECT 1 FROM stock_check_queue WHERE location_id=target) OR EXISTS(SELECT 1 FROM pharmacy_fulfillments WHERE dispensing_location_id=target) OR EXISTS(SELECT 1 FROM inventory_standing_order_templates WHERE requesting_location_id=target) OR EXISTS(SELECT 1 FROM inventory_standing_order_templates WHERE fulfilling_location_id=target);
$$;
CREATE TABLE storage_location_commands (
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN('create','rename','retire','reactivate')),
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(facility_id,request_key_hash)
);
CREATE INDEX storage_location_commands_location_idx ON storage_location_commands(facility_id,location_id,recorded_at);
CREATE FUNCTION storage_location_identity_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'storage_location_identity_immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.location_type NOT IN('store','pharmacy','ward','warehouse','department') OR NEW.temperature_zone NOT IN('ambient','cold','frozen','controlled') THEN RAISE EXCEPTION 'storage_location_invalid'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.facility_id,NEW.code,NEW.location_type,NEW.temperature_zone,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.code,OLD.location_type,OLD.temperature_zone,OLD.created_at) THEN RAISE EXCEPTION 'storage_location_identity_immutable'; END IF;
  IF ROW(NEW.name,NEW.is_active) IS NOT DISTINCT FROM ROW(OLD.name,OLD.is_active) THEN
   IF ROW(NEW.version,NEW.updated_at) IS DISTINCT FROM ROW(OLD.version,OLD.updated_at) THEN RAISE EXCEPTION 'storage_location_noop_immutable'; END IF;
   RETURN NEW;
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'storage_location_version_invalid'; END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND storage_location_has_operational_history(OLD.id) THEN RAISE EXCEPTION 'storage_location_operational_history'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER storage_location_identity_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON storage_locations FOR EACH ROW EXECUTE FUNCTION storage_location_identity_lifecycle_guard();
-- Only new/changed operational references need active local parent proof.
-- A historical unchanged link may still be closed or have status recorded.
CREATE FUNCTION storage_location_operational_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE column_name text; targets uuid[]:=ARRAY[]::uuid[]; target uuid; current_row jsonb:=to_jsonb(NEW); prior_row jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN prior_row:=to_jsonb(OLD); END IF;
 FOREACH column_name IN ARRAY TG_ARGV LOOP
  target:=(current_row->>column_name)::uuid;
  IF target IS NOT NULL AND (TG_OP='INSERT' OR ROW(current_row->>'facility_id',current_row->>column_name) IS DISTINCT FROM ROW(prior_row->>'facility_id',prior_row->>column_name)) THEN targets:=array_append(targets,target); END IF;
 END LOOP;
 FOR target IN SELECT DISTINCT unnest(targets) ORDER BY 1 LOOP
  PERFORM id FROM storage_locations WHERE id=target AND facility_id=NEW.facility_id AND is_active FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'storage_location_reference_unavailable'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER storage_location_batch_reference BEFORE INSERT OR UPDATE ON stock_batches FOR EACH ROW EXECUTE FUNCTION storage_location_operational_reference_guard('location_id');
CREATE TRIGGER storage_location_movement_reference BEFORE INSERT OR UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION storage_location_operational_reference_guard('location_id');
CREATE TRIGGER storage_location_transfer_reference BEFORE INSERT OR UPDATE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION storage_location_operational_reference_guard('from_location_id','to_location_id');
CREATE TRIGGER storage_location_requisition_reference BEFORE INSERT OR UPDATE ON stock_requisitions FOR EACH ROW EXECUTE FUNCTION storage_location_operational_reference_guard('requesting_location_id','fulfilling_location_id');
CREATE TRIGGER storage_location_controlled_reference BEFORE INSERT OR UPDATE ON controlled_substance_register FOR EACH ROW EXECUTE FUNCTION storage_location_operational_reference_guard('location_id');
CREATE TRIGGER storage_location_dispense_reference BEFORE INSERT OR UPDATE ON pharmacy_dispenses FOR EACH ROW EXECUTE FUNCTION storage_location_operational_reference_guard('location_id');
CREATE TRIGGER storage_location_standing_reference BEFORE INSERT OR UPDATE ON inventory_standing_orders FOR EACH ROW EXECUTE FUNCTION storage_location_operational_reference_guard('requesting_location_id');
CREATE TRIGGER storage_location_check_reference BEFORE INSERT OR UPDATE ON stock_check_queue FOR EACH ROW EXECUTE FUNCTION storage_location_operational_reference_guard('location_id');
CREATE TRIGGER storage_location_fulfillment_reference BEFORE INSERT OR UPDATE ON pharmacy_fulfillments FOR EACH ROW EXECUTE FUNCTION storage_location_operational_reference_guard('dispensing_location_id');
CREATE TRIGGER storage_location_template_reference BEFORE INSERT OR UPDATE ON inventory_standing_order_templates FOR EACH ROW EXECUTE FUNCTION storage_location_operational_reference_guard('requesting_location_id','fulfilling_location_id');
CREATE FUNCTION storage_location_command_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'storage_location_command_immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage_locations WHERE id=NEW.location_id AND facility_id=NEW.facility_id)
 OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND facility_id=NEW.facility_id)
 OR NEW.receipt->>'recorded_by_user_id' IS DISTINCT FROM NEW.actor_user_id::text
 OR NEW.receipt->'location'->>'id' IS DISTINCT FROM NEW.location_id::text
 OR NEW.receipt->'reviewed_input'->>'action' IS DISTINCT FROM NEW.action
 OR NEW.receipt->'reviewed_input'->>'client_request_id' IS DISTINCT FROM NEW.receipt->>'client_request_id'
 OR NEW.receipt->>'input_digest' IS DISTINCT FROM encode(NEW.payload_digest,'hex')
 OR sha256(uuid_send((NEW.receipt->>'client_request_id')::uuid)) IS DISTINCT FROM NEW.request_key_hash
 OR (NEW.receipt->>'recorded_at')::timestamptz IS DISTINCT FROM NEW.recorded_at THEN RAISE EXCEPTION 'storage_location_command_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER storage_location_command_immutable BEFORE INSERT OR UPDATE OR DELETE ON storage_location_commands FOR EACH ROW EXECUTE FUNCTION storage_location_command_immutable_guard();
