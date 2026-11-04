-- Breaking epoch032: governed supplier metadata, retained references and own projections.
-- Existing identity/contact/lifecycle/timestamps remain exact; provenance is unknown.
ALTER TABLE inventory_suppliers
 ADD COLUMN address text,
 ADD COLUMN version bigint NOT NULL DEFAULT 1 CONSTRAINT inventory_supplier_version_positive CHECK(version>0),
 ADD COLUMN catalog_changed_at timestamptz,
 ADD COLUMN created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN updated_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX inventory_supplier_administration_page_idx ON inventory_suppliers(facility_id,created_at,id);
CREATE INDEX inventory_supplier_item_reference_idx ON inventory_items(primary_supplier_id) WHERE primary_supplier_id IS NOT NULL;
CREATE INDEX inventory_suppliers_phone_search_trgm_idx ON inventory_suppliers USING gin(phone gin_trgm_ops);
CREATE INDEX inventory_suppliers_email_search_trgm_idx ON inventory_suppliers USING gin(email gin_trgm_ops);
ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_primary_supplier_id_fkey;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_primary_supplier_id_fkey FOREIGN KEY(primary_supplier_id) REFERENCES inventory_suppliers(id) ON DELETE RESTRICT;

-- UUID reservation is global; code reservation uses exact facility/code identity.
CREATE FUNCTION inventory_supplier_identity_gate(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE lock_key bigint;
BEGIN
 lock_key:=('x'||substr(encode(sha256(convert_to('hms.inventory-supplier.identity.v1','UTF8')||uuid_send(target)),'hex'),1,16))::bit(64)::bigint;
 IF NOT pg_try_advisory_xact_lock(lock_key) THEN RAISE EXCEPTION 'inventory_supplier_busy' USING ERRCODE='55P03';END IF;
END $$;
CREATE FUNCTION inventory_supplier_code_gate(facility uuid,code_value text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE lock_key bigint;
BEGIN
 lock_key:=('x'||substr(encode(sha256(convert_to('hms.inventory-supplier.code.v1','UTF8')||uuid_send(facility)||convert_to(code_value,'UTF8')),'hex'),1,16))::bit(64)::bigint;
 IF NOT pg_try_advisory_xact_lock(lock_key) THEN RAISE EXCEPTION 'inventory_supplier_busy' USING ERRCODE='55P03';END IF;
END $$;
CREATE FUNCTION inventory_supplier_publication_gate(facility uuid,target uuid,code_value text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM inventory_supplier_identity_gate(target);
 PERFORM inventory_supplier_code_gate(facility,code_value);
END $$;
CREATE FUNCTION inventory_supplier_has_item_reference(target uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM inventory_items WHERE primary_supplier_id=target)
$$;
CREATE FUNCTION inventory_supplier_text_valid(value text,min_chars integer,max_chars integer,max_bytes integer,multiline boolean DEFAULT false) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT value IS NOT NULL AND octet_length(value)<=max_bytes AND char_length(value) BETWEEN min_chars AND max_chars
 AND NOT EXISTS(SELECT 1 FROM regexp_split_to_table(value,'') c WHERE c<>'' AND(ascii(c)<32 OR ascii(c) BETWEEN 127 AND 159) AND NOT(multiline AND ascii(c) IN(9,10,13)))
$$;
CREATE FUNCTION inventory_supplier_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'inventory_supplier_identity_immutable';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM inventory_supplier_publication_gate(NEW.facility_id,NEW.id,NEW.code);
  IF NEW.version<>1 OR NOT inventory_supplier_text_valid(NEW.code,1,120,480) OR NOT inventory_supplier_text_valid(NEW.name,1,100,400)
  OR(NEW.contact_name IS NOT NULL AND NOT inventory_supplier_text_valid(NEW.contact_name,0,100,400))
  OR(NEW.phone IS NOT NULL AND NOT inventory_supplier_text_valid(NEW.phone,0,20,80))
  OR(NEW.email IS NOT NULL AND NOT inventory_supplier_text_valid(NEW.email,0,254,1016))
  OR(NEW.address IS NOT NULL AND NOT inventory_supplier_text_valid(NEW.address,0,8000,8000,true))
  THEN RAISE EXCEPTION 'inventory_supplier_invalid';END IF;
 ELSE
  IF ROW(NEW.id,NEW.facility_id,NEW.code,NEW.created_at,NEW.created_by_user_id) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.code,OLD.created_at,OLD.created_by_user_id)
  THEN RAISE EXCEPTION 'inventory_supplier_identity_immutable';END IF;
  IF ROW(NEW.name,NEW.contact_name,NEW.phone,NEW.email,NEW.address,NEW.is_active) IS NOT DISTINCT FROM ROW(OLD.name,OLD.contact_name,OLD.phone,OLD.email,OLD.address,OLD.is_active) THEN
   IF ROW(NEW.version,NEW.catalog_changed_at,NEW.updated_at,NEW.updated_by_user_id) IS DISTINCT FROM ROW(OLD.version,OLD.catalog_changed_at,OLD.updated_at,OLD.updated_by_user_id)
   THEN RAISE EXCEPTION 'inventory_supplier_noop_immutable';END IF;
   RETURN NEW;
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.catalog_changed_at IS NULL OR NEW.updated_at IS DISTINCT FROM NEW.catalog_changed_at
  OR(OLD.catalog_changed_at IS NOT NULL AND NEW.catalog_changed_at<OLD.catalog_changed_at)
  THEN RAISE EXCEPTION 'inventory_supplier_version_invalid';END IF;
  IF NEW.name IS DISTINCT FROM OLD.name AND NOT inventory_supplier_text_valid(NEW.name,1,100,400) THEN RAISE EXCEPTION 'inventory_supplier_invalid';END IF;
  IF NEW.contact_name IS DISTINCT FROM OLD.contact_name AND NEW.contact_name IS NOT NULL AND NOT inventory_supplier_text_valid(NEW.contact_name,0,100,400) THEN RAISE EXCEPTION 'inventory_supplier_invalid';END IF;
  IF NEW.phone IS DISTINCT FROM OLD.phone AND NEW.phone IS NOT NULL AND NOT inventory_supplier_text_valid(NEW.phone,0,20,80) THEN RAISE EXCEPTION 'inventory_supplier_invalid';END IF;
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL AND NOT inventory_supplier_text_valid(NEW.email,0,254,1016) THEN RAISE EXCEPTION 'inventory_supplier_invalid';END IF;
  IF NEW.address IS DISTINCT FROM OLD.address AND NEW.address IS NOT NULL AND NOT inventory_supplier_text_valid(NEW.address,0,8000,8000,true) THEN RAISE EXCEPTION 'inventory_supplier_invalid';END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND inventory_supplier_has_item_reference(OLD.id) THEN RAISE EXCEPTION 'inventory_supplier_item_reference';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM inventory_suppliers WHERE facility_id=NEW.facility_id AND code=NEW.code AND id<>NEW.id) THEN RAISE EXCEPTION 'inventory_supplier_code_conflict';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_supplier_identity BEFORE INSERT OR UPDATE OR DELETE ON inventory_suppliers FOR EACH ROW EXECUTE FUNCTION inventory_supplier_identity_guard();

-- Every newly chosen non-NULL supplier is local and active, retained FOR SHARE.
-- Unchanged historical pointers and explicit NULL do not invent fresh eligibility.
CREATE FUNCTION inventory_item_supplier_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE retained uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.primary_supplier_id IS NOT DISTINCT FROM OLD.primary_supplier_id THEN RETURN NEW;END IF;
 END IF;
 IF NEW.primary_supplier_id IS NULL THEN RETURN NEW;END IF;
 SELECT id INTO retained FROM inventory_suppliers WHERE id=NEW.primary_supplier_id AND facility_id=NEW.facility_id AND is_active FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'inventory_supplier_source_unavailable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_item_supplier_source BEFORE INSERT OR UPDATE OF primary_supplier_id,facility_id ON inventory_items FOR EACH ROW EXECUTE FUNCTION inventory_item_supplier_source_guard();

CREATE TABLE inventory_supplier_commands(
 id uuid NOT NULL UNIQUE,
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 supplier_id uuid NOT NULL REFERENCES inventory_suppliers(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN('create','correct','retire','reactivate')),
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(facility_id,request_key_hash)
);
CREATE INDEX inventory_supplier_commands_history_idx ON inventory_supplier_commands(facility_id,supplier_id,recorded_at DESC,id DESC);
CREATE INDEX inventory_supplier_audit_command_idx ON audit_events(facility_id,(metadata->>'command_id')) WHERE resource_type='inventory_supplier';
CREATE FUNCTION inventory_supplier_snapshot_valid(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(value)='object' THEN
 value ?& ARRAY['id','code','name','contact_name','phone','email','address','is_active','version','catalog_changed_at','created_at','updated_at','created_by_user_id','updated_by_user_id']
 AND(SELECT count(*) FROM jsonb_object_keys(value))=14
 AND jsonb_typeof(value->'id')='string' AND jsonb_typeof(value->'code')='string' AND jsonb_typeof(value->'name')='string'
 AND jsonb_typeof(value->'is_active')='boolean' AND jsonb_typeof(value->'version')='number'
 AND jsonb_typeof(value->'created_at')='string' AND jsonb_typeof(value->'updated_at')='string'
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['contact_name','phone','email','address','catalog_changed_at','created_by_user_id','updated_by_user_id']) AS keys(key) WHERE jsonb_typeof(value->key) NOT IN('string','null'))
 ELSE false END
$$;
CREATE FUNCTION inventory_supplier_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'inventory_supplier_command_immutable';END IF;
 IF NOT(NEW.receipt ?& ARRAY['client_request_id','input_digest','reviewed_input','recorded_by_user_id','supplier','changed','recorded_at','before'])
 OR(SELECT count(*) FROM jsonb_object_keys(NEW.receipt))<>8
 OR NOT inventory_supplier_snapshot_valid(NEW.receipt->'supplier')
 OR(NEW.action<>'create' AND NOT inventory_supplier_snapshot_valid(NEW.receipt->'before'))
 OR(CASE NEW.action
 WHEN 'create' THEN NOT((NEW.receipt->'reviewed_input') ?& ARRAY['action','client_request_id','code','name','contact_name','phone','email','address']) OR(SELECT count(*) FROM jsonb_object_keys(NEW.receipt->'reviewed_input'))<>8
 WHEN 'correct' THEN NOT((NEW.receipt->'reviewed_input') ?& ARRAY['action','client_request_id','supplier_id','expected_version','name','contact_name','phone','email','address','reason']) OR(SELECT count(*) FROM jsonb_object_keys(NEW.receipt->'reviewed_input'))<>10
 ELSE NOT((NEW.receipt->'reviewed_input') ?& ARRAY['action','client_request_id','supplier_id','expected_version']) OR(SELECT count(*) FROM jsonb_object_keys(NEW.receipt->'reviewed_input'))<>4 END)
 OR NOT EXISTS(SELECT 1 FROM inventory_suppliers WHERE id=NEW.supplier_id AND facility_id=NEW.facility_id)
 OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND facility_id=NEW.facility_id)
 OR NEW.receipt->>'recorded_by_user_id' IS DISTINCT FROM NEW.actor_user_id::text
 OR NEW.receipt->'supplier'->>'id' IS DISTINCT FROM NEW.supplier_id::text
 OR NEW.receipt->'reviewed_input'->>'action' IS DISTINCT FROM NEW.action
 OR NEW.receipt->'reviewed_input'->>'client_request_id' IS DISTINCT FROM NEW.receipt->>'client_request_id'
 OR NEW.receipt->>'input_digest' IS DISTINCT FROM encode(NEW.payload_digest,'hex')
 OR sha256(uuid_send((NEW.receipt->>'client_request_id')::uuid)) IS DISTINCT FROM NEW.request_key_hash
 OR(NEW.receipt->>'recorded_at')::timestamptz IS DISTINCT FROM NEW.recorded_at
 OR(NEW.action<>'create' AND NEW.receipt->'reviewed_input'->>'supplier_id' IS DISTINCT FROM NEW.supplier_id::text)
 OR(CASE WHEN NEW.action='create' THEN jsonb_typeof(NEW.receipt->'before') IS DISTINCT FROM 'null' ELSE jsonb_typeof(NEW.receipt->'before') IS DISTINCT FROM 'object' END)
 THEN RAISE EXCEPTION 'inventory_supplier_command_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_supplier_command_immutable BEFORE INSERT OR UPDATE OR DELETE ON inventory_supplier_commands FOR EACH ROW EXECUTE FUNCTION inventory_supplier_command_guard();

CREATE FUNCTION inventory_supplier_command_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_row inventory_suppliers%ROWTYPE; after_row jsonb:=NEW.receipt->'supplier'; before_row jsonb:=NEW.receipt->'before'; intent jsonb:=NEW.receipt->'reviewed_input'; changed boolean:=(NEW.receipt->>'changed')::boolean;
BEGIN
 SELECT * INTO current_row FROM inventory_suppliers WHERE id=NEW.supplier_id AND facility_id=NEW.facility_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'inventory_supplier_command_incomplete';END IF;
 IF ROW(after_row->>'code',after_row->>'name',after_row->>'contact_name',after_row->>'phone',after_row->>'email',after_row->>'address',(after_row->>'is_active')::boolean,(after_row->>'version')::bigint,(after_row->>'catalog_changed_at')::timestamptz,(after_row->>'created_at')::timestamptz,(after_row->>'updated_at')::timestamptz,(after_row->>'created_by_user_id')::uuid,(after_row->>'updated_by_user_id')::uuid)
 IS DISTINCT FROM ROW(current_row.code,current_row.name,current_row.contact_name,current_row.phone,current_row.email,current_row.address,current_row.is_active,current_row.version,current_row.catalog_changed_at,current_row.created_at,current_row.updated_at,current_row.created_by_user_id,current_row.updated_by_user_id)
 OR changed IS NULL
 OR NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.facility_id=NEW.facility_id AND a.actor_user_id=NEW.actor_user_id AND a.resource_type='inventory_supplier' AND a.resource_id=NEW.supplier_id AND a.event_type='inventory.supplier.'||NEW.action AND a.metadata->>'command_id'=NEW.id::text AND(a.metadata->>'version')::bigint=current_row.version AND(a.metadata->>'changed')::boolean=changed)
 THEN RAISE EXCEPTION 'inventory_supplier_command_incomplete';END IF;
 IF NEW.action='create' THEN
  IF NOT changed OR current_row.version<>1 OR NOT current_row.is_active OR current_row.created_at IS DISTINCT FROM NEW.recorded_at OR current_row.updated_at IS DISTINCT FROM NEW.recorded_at OR current_row.catalog_changed_at IS DISTINCT FROM NEW.recorded_at
  OR current_row.created_by_user_id IS DISTINCT FROM NEW.actor_user_id OR current_row.updated_by_user_id IS DISTINCT FROM NEW.actor_user_id
  OR ROW(intent->>'code',intent->>'name',intent->>'contact_name',intent->>'phone',intent->>'email',intent->>'address') IS DISTINCT FROM ROW(current_row.code,current_row.name,current_row.contact_name,current_row.phone,current_row.email,current_row.address)
  THEN RAISE EXCEPTION 'inventory_supplier_command_incomplete';END IF;
 ELSE
  IF (intent->>'expected_version')::bigint IS NULL OR (before_row->>'version')::bigint IS NULL
  OR ROW(before_row->>'id',before_row->>'code',(before_row->>'created_at')::timestamptz,(before_row->>'created_by_user_id')::uuid,(before_row->>'version')::bigint)
  IS DISTINCT FROM ROW(current_row.id::text,current_row.code,current_row.created_at,current_row.created_by_user_id,(intent->>'expected_version')::bigint)
  OR current_row.version<>(before_row->>'version')::bigint+(CASE WHEN changed THEN 1 ELSE 0 END)
  OR changed IS DISTINCT FROM(ROW(before_row->>'name',before_row->>'contact_name',before_row->>'phone',before_row->>'email',before_row->>'address',(before_row->>'is_active')::boolean) IS DISTINCT FROM ROW(after_row->>'name',after_row->>'contact_name',after_row->>'phone',after_row->>'email',after_row->>'address',current_row.is_active))
  OR(changed AND(current_row.catalog_changed_at IS DISTINCT FROM NEW.recorded_at OR current_row.updated_at IS DISTINCT FROM NEW.recorded_at OR current_row.updated_by_user_id IS DISTINCT FROM NEW.actor_user_id))
  OR(NOT changed AND ROW((before_row->>'catalog_changed_at')::timestamptz,(before_row->>'updated_at')::timestamptz,(before_row->>'updated_by_user_id')::uuid) IS DISTINCT FROM ROW(current_row.catalog_changed_at,current_row.updated_at,current_row.updated_by_user_id))
  THEN RAISE EXCEPTION 'inventory_supplier_command_incomplete';END IF;
  IF NEW.action='correct' THEN
   IF ROW(intent->>'name',intent->>'contact_name',intent->>'phone',intent->>'email',intent->>'address') IS DISTINCT FROM ROW(current_row.name,current_row.contact_name,current_row.phone,current_row.email,current_row.address)
   OR NOT inventory_supplier_text_valid(intent->>'reason',1,1000,4000)
   OR before_row->'is_active' IS DISTINCT FROM after_row->'is_active'
   THEN RAISE EXCEPTION 'inventory_supplier_command_incomplete';END IF;
  ELSE
   IF inventory_supplier_has_item_reference(current_row.id) THEN RAISE EXCEPTION 'inventory_supplier_item_reference';END IF;
   IF current_row.is_active<>(NEW.action='reactivate')
   OR ROW(before_row->>'name',before_row->>'contact_name',before_row->>'phone',before_row->>'email',before_row->>'address') IS DISTINCT FROM ROW(after_row->>'name',after_row->>'contact_name',after_row->>'phone',after_row->>'email',after_row->>'address')
   THEN RAISE EXCEPTION 'inventory_supplier_command_incomplete';END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER inventory_supplier_command_complete AFTER INSERT ON inventory_supplier_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_supplier_command_complete_guard();

-- One exact supplier document only. Keep document identity and unrelated JSON;
-- source ownership collisions refuse rather than overwrite another family.
CREATE FUNCTION inventory_supplier_refresh_search(facility uuid,target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE source inventory_suppliers%ROWTYPE; existing search_documents%ROWTYPE; affected bigint; owner text;
 previous_lock text:=current_setting('lock_timeout'); previous_statement text:=current_setting('statement_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 PERFORM set_config('statement_timeout','1000ms',true);
 SELECT * INTO source FROM inventory_suppliers WHERE id=target AND facility_id=facility FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'inventory_supplier_source_unavailable';END IF;
 SELECT * INTO existing FROM search_documents WHERE facility_id=facility AND resource_type='inventory' AND resource_id=target FOR UPDATE NOWAIT;
 IF FOUND AND existing.metadata->>'source_table' IS DISTINCT FROM 'inventory_suppliers' THEN RAISE EXCEPTION 'inventory_supplier_projection_conflict';END IF;
 INSERT INTO search_documents(id,facility_id,resource_type,resource_id,patient_id,patient_code,patient_name,patient_date_of_birth,title,subtitle,route_path,status_label,feature_key,permission_code,requires_patient_demographics,search_text,rank_boost,source_updated_at,occurred_at,metadata,is_active,indexed_at)
 VALUES(gen_random_uuid(),facility,'inventory',target,NULL,NULL,NULL,NULL,source.name,'Supplier '||source.code,'/inventory/suppliers/'||source.id::text,CASE WHEN source.is_active THEN 'active' ELSE 'inactive' END,'inventory','inventory.view',true,concat_ws(' ',source.code,source.name,source.contact_name,source.phone,source.email),40,source.updated_at,source.created_at,jsonb_build_object('source_table','inventory_suppliers','code',source.code),source.is_active,clock_timestamp())
 ON CONFLICT(facility_id,resource_type,resource_id) DO UPDATE SET
 patient_id=NULL,patient_code=NULL,patient_name=NULL,patient_date_of_birth=NULL,
 title=EXCLUDED.title,subtitle=EXCLUDED.subtitle,route_path=EXCLUDED.route_path,status_label=EXCLUDED.status_label,
 feature_key=EXCLUDED.feature_key,permission_code=EXCLUDED.permission_code,requires_patient_demographics=true,
 search_text=EXCLUDED.search_text,rank_boost=EXCLUDED.rank_boost,source_updated_at=EXCLUDED.source_updated_at,
 occurred_at=EXCLUDED.occurred_at,metadata=search_documents.metadata||EXCLUDED.metadata,is_active=EXCLUDED.is_active,indexed_at=clock_timestamp()
 WHERE search_documents.metadata->>'source_table'='inventory_suppliers'
 AND ROW(search_documents.patient_id,search_documents.patient_code,search_documents.patient_name,search_documents.patient_date_of_birth,search_documents.title,search_documents.subtitle,search_documents.route_path,search_documents.status_label,search_documents.feature_key,search_documents.permission_code,search_documents.requires_patient_demographics,search_documents.search_text,search_documents.rank_boost,search_documents.source_updated_at,search_documents.occurred_at,search_documents.metadata,search_documents.is_active)
 IS DISTINCT FROM ROW(EXCLUDED.patient_id,EXCLUDED.patient_code,EXCLUDED.patient_name,EXCLUDED.patient_date_of_birth,EXCLUDED.title,EXCLUDED.subtitle,EXCLUDED.route_path,EXCLUDED.status_label,EXCLUDED.feature_key,EXCLUDED.permission_code,true,EXCLUDED.search_text,EXCLUDED.rank_boost,EXCLUDED.source_updated_at,EXCLUDED.occurred_at,search_documents.metadata||EXCLUDED.metadata,EXCLUDED.is_active);
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=0 THEN
  SELECT metadata->>'source_table' INTO owner FROM search_documents WHERE facility_id=facility AND resource_type='inventory' AND resource_id=target;
  IF owner IS DISTINCT FROM 'inventory_suppliers' THEN RAISE EXCEPTION 'inventory_supplier_projection_conflict';END IF;
 END IF;
 PERFORM set_config('lock_timeout',previous_lock,true);
 PERFORM set_config('statement_timeout',previous_statement,true);
END $$;
CREATE FUNCTION inventory_supplier_search_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.name,NEW.contact_name,NEW.phone,NEW.email,NEW.address,NEW.is_active) IS NOT DISTINCT FROM ROW(OLD.name,OLD.contact_name,OLD.phone,OLD.email,OLD.address,OLD.is_active) THEN RETURN NEW;END IF;
 END IF;
 PERFORM inventory_supplier_refresh_search(NEW.facility_id,NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_supplier_search AFTER INSERT OR UPDATE ON inventory_suppliers FOR EACH ROW EXECUTE FUNCTION inventory_supplier_search_guard();

-- Mandatory scoped repair with both optional rebuild toggles off. This is
-- quiescent O(supplier documents), not an item/order fanout or orphan rewrite.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM inventory_suppliers s JOIN search_documents d ON d.facility_id=s.facility_id AND d.resource_id=s.id AND d.resource_type='inventory' WHERE d.metadata->>'source_table' IS DISTINCT FROM 'inventory_suppliers')
 THEN RAISE EXCEPTION 'inventory_supplier_projection_conflict';END IF;
END $$;
UPDATE search_documents d SET patient_id=NULL,patient_code=NULL,patient_name=NULL,patient_date_of_birth=NULL,
 title=s.name,subtitle='Supplier '||s.code,route_path='/inventory/suppliers/'||s.id::text,
 status_label=CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END,
 feature_key='inventory',permission_code='inventory.view',requires_patient_demographics=true,
 search_text=concat_ws(' ',s.code,s.name,s.contact_name,s.phone,s.email),rank_boost=40,
 source_updated_at=s.updated_at,occurred_at=s.created_at,metadata=d.metadata||jsonb_build_object('source_table','inventory_suppliers','code',s.code),is_active=s.is_active,indexed_at=clock_timestamp()
FROM inventory_suppliers s
WHERE d.facility_id=s.facility_id AND d.resource_id=s.id AND d.resource_type='inventory' AND d.metadata->>'source_table'='inventory_suppliers'
AND ROW(d.patient_id,d.patient_code,d.patient_name,d.patient_date_of_birth,d.title,d.subtitle,d.route_path,d.status_label,d.feature_key,d.permission_code,d.requires_patient_demographics,d.search_text,d.rank_boost,d.source_updated_at,d.occurred_at,d.metadata,d.is_active)
IS DISTINCT FROM ROW(NULL::uuid,NULL::text,NULL::text,NULL::date,s.name,'Supplier '||s.code,'/inventory/suppliers/'||s.id::text,CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END,'inventory','inventory.view',true,concat_ws(' ',s.code,s.name,s.contact_name,s.phone,s.email),40,s.updated_at,s.created_at,d.metadata||jsonb_build_object('source_table','inventory_suppliers','code',s.code),s.is_active);
