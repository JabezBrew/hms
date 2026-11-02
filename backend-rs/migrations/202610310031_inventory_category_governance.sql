-- Breaking epoch031: governed current category metadata and direct-parent publication.
-- Old rows retain exact identity/text/lifecycle and unknown provenance.
ALTER TABLE inventory_categories
 ADD COLUMN description text,
 ADD COLUMN parent_id uuid REFERENCES inventory_categories(id) ON DELETE RESTRICT,
 ADD COLUMN version bigint NOT NULL DEFAULT 1 CONSTRAINT inventory_category_version_positive CHECK(version>0),
 ADD COLUMN catalog_changed_at timestamptz,
 ADD COLUMN created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN updated_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX inventory_category_administration_page_idx ON inventory_categories(facility_id,created_at DESC,id DESC);
CREATE INDEX inventory_category_item_reference_idx ON inventory_items(category_id);
CREATE INDEX inventory_category_child_reference_idx ON inventory_categories(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX inventory_category_search_idx ON inventory_categories USING gin((code||' '||name) gin_trgm_ops);

-- Category UUID uniqueness is global; a facility-only gate cannot fence a
-- pending foreign-facility insertion of the canonical provisioning identity.
CREATE FUNCTION inventory_category_identity_gate(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE lock_key bigint;
BEGIN
 lock_key:=('x'||substr(encode(sha256(convert_to('hms.inventory-category.identity.v1','UTF8')||uuid_send(target)),'hex'),1,16))::bit(64)::bigint;
 IF NOT pg_try_advisory_xact_lock(lock_key) THEN RAISE EXCEPTION 'inventory_category_busy' USING ERRCODE='55P03';END IF;
END $$;
CREATE FUNCTION inventory_category_graph_gate(facility uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE lock_key bigint;
BEGIN
 lock_key:=('x'||substr(encode(sha256(convert_to('hms.inventory-category.graph.v1','UTF8')||uuid_send(facility)),'hex'),1,16))::bit(64)::bigint;
 IF NOT pg_try_advisory_xact_lock(lock_key) THEN RAISE EXCEPTION 'inventory_category_busy' USING ERRCODE='55P03';END IF;
END $$;
-- One facility gate serializes every category writer. Traverse the complete proposed
-- chain before locking its sorted, bounded rows. The 65th observed hop refuses.
CREATE FUNCTION inventory_category_parent_proof(facility uuid,subject uuid,parent uuid,expected bigint DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cursor_id uuid:=parent; next_id uuid; source_facility uuid; source_active boolean; source_version bigint;
 visited uuid[]:=ARRAY[subject]; retained uuid[]:=ARRAY[]::uuid[]; target uuid; hops integer:=0;
BEGIN
 PERFORM inventory_category_graph_gate(facility);
 WHILE cursor_id IS NOT NULL LOOP
  hops:=hops+1;
  IF hops>64 OR cursor_id=ANY(visited) THEN RAISE EXCEPTION 'inventory_category_parent_unavailable';END IF;
  SELECT facility_id,parent_id,is_active,version INTO source_facility,next_id,source_active,source_version FROM inventory_categories WHERE id=cursor_id;
  IF NOT FOUND OR source_facility<>facility OR(hops=1 AND(NOT source_active OR(expected IS NOT NULL AND source_version<>expected))) THEN RAISE EXCEPTION 'inventory_category_parent_unavailable';END IF;
  visited:=array_append(visited,cursor_id);retained:=array_append(retained,cursor_id);cursor_id:=next_id;
 END LOOP;
 FOR target IN SELECT unnest(retained) ORDER BY 1 LOOP
  PERFORM id FROM inventory_categories WHERE id=target AND facility_id=facility FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_category_parent_unavailable';END IF;
 END LOOP;
END $$;
CREATE FUNCTION inventory_category_has_item_reference(target uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$SELECT EXISTS(SELECT 1 FROM inventory_items WHERE category_id=target)$$;
CREATE FUNCTION inventory_category_has_child_reference(target uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$SELECT EXISTS(SELECT 1 FROM inventory_categories WHERE parent_id=target)$$;
CREATE FUNCTION inventory_category_text_valid(value text,max_chars integer,max_bytes integer,multiline boolean DEFAULT false) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT value IS NOT NULL AND octet_length(value)<=max_bytes AND(max_chars IS NULL OR char_length(value) BETWEEN 1 AND max_chars)
 AND NOT EXISTS(SELECT 1 FROM regexp_split_to_table(value,'') c WHERE c<>'' AND(ascii(c)<32 OR ascii(c) BETWEEN 127 AND 159) AND NOT(multiline AND ascii(c) IN(9,10,13)))
$$;
CREATE FUNCTION inventory_category_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'inventory_category_identity_immutable';END IF;
 IF TG_OP='INSERT' THEN PERFORM inventory_category_identity_gate(NEW.id);END IF;
 PERFORM inventory_category_graph_gate(NEW.facility_id);
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NOT inventory_category_text_valid(NEW.code,120,480) OR NOT inventory_category_text_valid(NEW.name,100,400)
  OR(NEW.description IS NOT NULL AND NOT inventory_category_text_valid(NEW.description,NULL,8000,true)) THEN RAISE EXCEPTION 'inventory_category_invalid';END IF;
  PERFORM inventory_category_parent_proof(NEW.facility_id,NEW.id,NEW.parent_id);
 ELSE
  IF ROW(NEW.id,NEW.facility_id,NEW.code,NEW.created_at,NEW.created_by_user_id) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.code,OLD.created_at,OLD.created_by_user_id) THEN RAISE EXCEPTION 'inventory_category_identity_immutable';END IF;
  IF ROW(NEW.name,NEW.description,NEW.parent_id,NEW.is_active) IS NOT DISTINCT FROM ROW(OLD.name,OLD.description,OLD.parent_id,OLD.is_active) THEN
   IF ROW(NEW.version,NEW.catalog_changed_at,NEW.updated_by_user_id) IS DISTINCT FROM ROW(OLD.version,OLD.catalog_changed_at,OLD.updated_by_user_id) THEN RAISE EXCEPTION 'inventory_category_noop_immutable';END IF;
   RETURN NEW;
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.catalog_changed_at IS NULL OR(OLD.catalog_changed_at IS NOT NULL AND NEW.catalog_changed_at<OLD.catalog_changed_at) THEN RAISE EXCEPTION 'inventory_category_version_invalid';END IF;
  IF NEW.name IS DISTINCT FROM OLD.name AND NOT inventory_category_text_valid(NEW.name,100,400) THEN RAISE EXCEPTION 'inventory_category_invalid';END IF;
  IF NEW.description IS DISTINCT FROM OLD.description AND NEW.description IS NOT NULL AND NOT inventory_category_text_valid(NEW.description,NULL,8000,true) THEN RAISE EXCEPTION 'inventory_category_invalid';END IF;
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id OR(NEW.is_active AND NOT OLD.is_active) THEN PERFORM inventory_category_parent_proof(NEW.facility_id,NEW.id,NEW.parent_id);END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
   IF inventory_category_has_item_reference(OLD.id) THEN RAISE EXCEPTION 'inventory_category_item_reference';END IF;
   IF inventory_category_has_child_reference(OLD.id) THEN RAISE EXCEPTION 'inventory_category_child_reference';END IF;
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM inventory_categories WHERE facility_id=NEW.facility_id AND code=NEW.code AND id<>NEW.id) THEN RAISE EXCEPTION 'inventory_category_code_conflict';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_category_identity BEFORE INSERT OR UPDATE OR DELETE ON inventory_categories FOR EACH ROW EXECUTE FUNCTION inventory_category_identity_guard();
CREATE TABLE inventory_category_commands(
 id uuid NOT NULL UNIQUE,
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 category_id uuid NOT NULL REFERENCES inventory_categories(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN('create','correct','retire','reactivate')),
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),recorded_at timestamptz NOT NULL,
 PRIMARY KEY(facility_id,request_key_hash)
);
CREATE INDEX inventory_category_commands_history_idx ON inventory_category_commands(facility_id,category_id,recorded_at DESC,id DESC);
CREATE FUNCTION inventory_category_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'inventory_category_command_immutable';END IF;
 IF NOT EXISTS(SELECT 1 FROM inventory_categories WHERE id=NEW.category_id AND facility_id=NEW.facility_id)
 OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND facility_id=NEW.facility_id)
 OR NEW.receipt->>'recorded_by_user_id' IS DISTINCT FROM NEW.actor_user_id::text
 OR NEW.receipt->'category'->>'id' IS DISTINCT FROM NEW.category_id::text
 OR NEW.receipt->'reviewed_input'->>'action' IS DISTINCT FROM NEW.action
 OR NEW.receipt->'reviewed_input'->>'client_request_id' IS DISTINCT FROM NEW.receipt->>'client_request_id'
 OR NEW.receipt->>'input_digest' IS DISTINCT FROM encode(NEW.payload_digest,'hex')
 OR sha256(uuid_send((NEW.receipt->>'client_request_id')::uuid)) IS DISTINCT FROM NEW.request_key_hash
 OR(NEW.receipt->>'recorded_at')::timestamptz IS DISTINCT FROM NEW.recorded_at
 OR(NEW.action<>'create' AND NEW.receipt->'reviewed_input'->>'category_id' IS DISTINCT FROM NEW.category_id::text)
 OR(CASE WHEN NEW.action='create' THEN jsonb_typeof(NEW.receipt->'before') IS DISTINCT FROM 'null' ELSE jsonb_typeof(NEW.receipt->'before') IS DISTINCT FROM 'object' END)
 THEN RAISE EXCEPTION 'inventory_category_command_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_category_command_immutable BEFORE INSERT OR UPDATE OR DELETE ON inventory_category_commands FOR EACH ROW EXECUTE FUNCTION inventory_category_command_guard();
-- Mandatory one-time repair, independent of optional API/worker rebuild toggles.
-- O(producer-backed item documents); no orphan repair or hot-path fanout promise.
UPDATE search_documents d SET search_text=concat_ws(' ',i.code,i.name,i.item_type,i.unit,c.name),
 metadata=jsonb_set(d.metadata,'{category}',coalesce(to_jsonb(c.name),'null'::jsonb),true)
FROM inventory_items i LEFT JOIN inventory_categories c ON c.id=i.category_id AND c.facility_id=i.facility_id
WHERE d.resource_type='inventory' AND d.metadata->>'source_table'='inventory_items'
 AND d.resource_id=i.id AND d.facility_id=i.facility_id;

CREATE INDEX inventory_category_audit_command_idx ON audit_events(facility_id,(metadata->>'command_id')) WHERE resource_type='inventory_category';
CREATE FUNCTION inventory_category_command_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_row inventory_categories%ROWTYPE; after_row jsonb:=NEW.receipt->'category'; before_row jsonb:=NEW.receipt->'before'; intent jsonb:=NEW.receipt->'reviewed_input'; changed boolean:=(NEW.receipt->>'changed')::boolean; expected_parent jsonb;
BEGIN
 SELECT * INTO current_row FROM inventory_categories WHERE id=NEW.category_id AND facility_id=NEW.facility_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'inventory_category_command_incomplete';END IF;
 SELECT jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'version',p.version,'is_active',p.is_active) INTO expected_parent FROM inventory_categories p WHERE p.id=current_row.parent_id AND p.facility_id=current_row.facility_id;
 IF ROW(after_row->>'code',after_row->>'name',after_row->>'description',(after_row->>'parent_id')::uuid,(after_row->>'is_active')::boolean,(after_row->>'version')::bigint,(after_row->>'catalog_changed_at')::timestamptz,(after_row->>'created_at')::timestamptz,(after_row->>'created_by_user_id')::uuid,(after_row->>'updated_by_user_id')::uuid)
 IS DISTINCT FROM ROW(current_row.code,current_row.name,current_row.description,current_row.parent_id,current_row.is_active,current_row.version,current_row.catalog_changed_at,current_row.created_at,current_row.created_by_user_id,current_row.updated_by_user_id)
 OR after_row->'parent' IS DISTINCT FROM coalesce(expected_parent,'null'::jsonb)
 OR changed IS NULL
 OR NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.facility_id=NEW.facility_id AND a.actor_user_id=NEW.actor_user_id AND a.resource_type='inventory_category' AND a.resource_id=NEW.category_id AND a.event_type='inventory.category.'||NEW.action AND a.metadata->>'command_id'=NEW.id::text AND(a.metadata->>'version')::bigint=current_row.version AND(a.metadata->>'changed')::boolean=changed)
 THEN RAISE EXCEPTION 'inventory_category_command_incomplete';END IF;
 IF NEW.action='create' THEN
  IF NOT changed OR current_row.version<>1 OR NOT current_row.is_active OR current_row.created_at<>NEW.recorded_at OR current_row.catalog_changed_at<>NEW.recorded_at OR current_row.created_by_user_id IS DISTINCT FROM NEW.actor_user_id OR current_row.updated_by_user_id IS DISTINCT FROM NEW.actor_user_id
  OR ROW(intent->>'code',intent->>'name',intent->>'description',(intent->'parent'->>'parent_id')::uuid) IS DISTINCT FROM ROW(current_row.code,current_row.name,current_row.description,current_row.parent_id) THEN RAISE EXCEPTION 'inventory_category_command_incomplete';END IF;
 ELSE
  IF ROW(before_row->>'id',before_row->>'code',(before_row->>'created_at')::timestamptz,(before_row->>'created_by_user_id')::uuid,(before_row->>'version')::bigint) IS DISTINCT FROM ROW(current_row.id::text,current_row.code,current_row.created_at,current_row.created_by_user_id,(intent->>'expected_version')::bigint)
  OR current_row.version<>(before_row->>'version')::bigint+(CASE WHEN changed THEN 1 ELSE 0 END)
  OR changed IS DISTINCT FROM(ROW(before_row->>'name',before_row->>'description',before_row->>'parent_id',(before_row->>'is_active')::boolean) IS DISTINCT FROM ROW(after_row->>'name',after_row->>'description',after_row->>'parent_id',current_row.is_active))
  OR(changed AND(current_row.catalog_changed_at<>NEW.recorded_at OR current_row.updated_by_user_id IS DISTINCT FROM NEW.actor_user_id))
  OR(NOT changed AND ROW((before_row->>'catalog_changed_at')::timestamptz,(before_row->>'updated_by_user_id')::uuid) IS DISTINCT FROM ROW(current_row.catalog_changed_at,current_row.updated_by_user_id))
  THEN RAISE EXCEPTION 'inventory_category_command_incomplete';END IF;
  IF NEW.action='correct' THEN
   IF ROW(intent->>'name',intent->>'description') IS DISTINCT FROM ROW(current_row.name,current_row.description) OR NOT inventory_category_text_valid(intent->>'reason',1000,4000)
   OR before_row->'is_active' IS DISTINCT FROM after_row->'is_active'
   OR (CASE intent->'parent_change'->>'action' WHEN 'retain' THEN before_row->'parent_id' IS DISTINCT FROM after_row->'parent_id' WHEN 'clear' THEN current_row.parent_id IS NOT NULL WHEN 'set' THEN (intent->'parent_change'->>'parent_id')::uuid IS DISTINCT FROM current_row.parent_id ELSE true END)
   THEN RAISE EXCEPTION 'inventory_category_command_incomplete';END IF;
  ELSE
   IF current_row.is_active<>(NEW.action='reactivate') OR ROW(before_row->>'name',before_row->>'description',before_row->>'parent_id') IS DISTINCT FROM ROW(after_row->>'name',after_row->>'description',after_row->>'parent_id') THEN RAISE EXCEPTION 'inventory_category_command_incomplete';END IF;
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER inventory_category_command_complete AFTER INSERT ON inventory_category_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_category_command_complete_guard();
