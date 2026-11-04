-- Breaking epoch033. A concurrency baseline is not a historical definition revision.
ALTER TABLE lab_tests
 ADD COLUMN version bigint NOT NULL DEFAULT 1 CONSTRAINT laboratory_test_version_positive CHECK(version>0),
 ADD COLUMN catalog_changed_at timestamptz,
 ADD COLUMN catalog_changed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE lab_panels
 ADD COLUMN version bigint NOT NULL DEFAULT 1 CONSTRAINT laboratory_panel_version_positive CHECK(version>0),
 ADD COLUMN catalog_changed_at timestamptz,
 ADD COLUMN catalog_changed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN membership_generation bigint NOT NULL DEFAULT 0 CONSTRAINT laboratory_panel_membership_generation_nonnegative CHECK(membership_generation>=0);
CREATE INDEX laboratory_test_administration_page_idx ON lab_tests(facility_id,created_at,id);
CREATE INDEX laboratory_panel_administration_page_idx ON lab_panels(facility_id,created_at,id);

CREATE FUNCTION laboratory_catalog_identity_gate(kind text,target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE gate bigint;
BEGIN
 IF kind NOT IN('test','panel') THEN RAISE EXCEPTION 'laboratory_catalog_invalid';END IF;
 gate:=('x'||substr(encode(sha256(convert_to('hms.lab-catalog.identity.v1:'||kind,'UTF8')||uuid_send(target)),'hex'),1,16))::bit(64)::bigint;
 IF NOT pg_try_advisory_xact_lock(gate) THEN RAISE EXCEPTION 'laboratory_catalog_busy' USING ERRCODE='55P03';END IF;
END $$;
CREATE FUNCTION laboratory_catalog_code_gate(kind text,facility uuid,code_value text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE gate bigint;
BEGIN
 IF kind NOT IN('test','panel') THEN RAISE EXCEPTION 'laboratory_catalog_invalid';END IF;
 gate:=('x'||substr(encode(sha256(convert_to('hms.lab-catalog.code.v1:'||kind,'UTF8')||uuid_send(facility)||convert_to(code_value,'UTF8')),'hex'),1,16))::bit(64)::bigint;
 IF NOT pg_try_advisory_xact_lock(gate) THEN RAISE EXCEPTION 'laboratory_catalog_busy' USING ERRCODE='55P03';END IF;
END $$;
CREATE FUNCTION laboratory_catalog_request_gate(facility uuid,target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE gate bigint;
BEGIN
 gate:=('x'||substr(encode(sha256(convert_to('hms.lab-catalog.request.v1','UTF8')||uuid_send(facility)||uuid_send(target)),'hex'),1,16))::bit(64)::bigint;
 IF NOT pg_try_advisory_xact_lock(gate) THEN RAISE EXCEPTION 'laboratory_catalog_busy' USING ERRCODE='55P03';END IF;
END $$;
CREATE FUNCTION laboratory_catalog_panel_gates(targets uuid[],shared boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target uuid;gate bigint;obtained boolean;
BEGIN
 FOR target IN SELECT DISTINCT id FROM unnest(targets) AS source(id) ORDER BY id LOOP
  IF target IS NULL THEN RAISE EXCEPTION 'laboratory_catalog_invalid';END IF;
  gate:=('x'||substr(encode(sha256(convert_to('hms.lab-catalog.panel-membership.v1','UTF8')||uuid_send(target)),'hex'),1,16))::bit(64)::bigint;
  IF shared THEN obtained:=pg_try_advisory_xact_lock_shared(gate);ELSE obtained:=pg_try_advisory_xact_lock(gate);END IF;
  IF NOT obtained THEN RAISE EXCEPTION 'laboratory_catalog_busy' USING ERRCODE='55P03';END IF;
 END LOOP;
END $$;

CREATE FUNCTION laboratory_catalog_definition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;material boolean;definition_changed boolean;
BEGIN
 kind:=CASE WHEN TG_TABLE_NAME='lab_tests' THEN 'test' ELSE 'panel' END;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'laboratory_catalog_identity_immutable';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.id='00000000-0000-0000-0000-000000000000' OR NEW.version<>1
    OR NEW.catalog_changed_at IS NOT NULL OR NEW.catalog_changed_by_user_id IS NOT NULL
  THEN RAISE EXCEPTION 'laboratory_catalog_invalid';END IF;
  PERFORM laboratory_catalog_identity_gate(kind,NEW.id);
  PERFORM laboratory_catalog_code_gate(kind,NEW.facility_id,NEW.code);
  IF kind='panel' THEN
   IF NEW.membership_generation<>0 THEN RAISE EXCEPTION 'laboratory_catalog_invalid';END IF;
   PERFORM laboratory_catalog_panel_gates(ARRAY[NEW.id],false);
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.facility_id,NEW.code,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.code,OLD.created_at)
 THEN RAISE EXCEPTION 'laboratory_catalog_identity_immutable';END IF;
 IF kind='panel' THEN
  PERFORM laboratory_catalog_panel_gates(ARRAY[NEW.id],false);
  IF NEW.membership_generation IS DISTINCT FROM OLD.membership_generation THEN
   IF OLD.membership_generation=9223372036854775807 THEN RAISE EXCEPTION 'laboratory_catalog_version_exhausted';END IF;
   IF NEW.membership_generation<>OLD.membership_generation+1 THEN RAISE EXCEPTION 'laboratory_catalog_version_invalid';END IF;
  END IF;
 END IF;
 material:=(to_jsonb(NEW)-ARRAY['updated_at','version','catalog_changed_at','catalog_changed_by_user_id'])
   IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['updated_at','version','catalog_changed_at','catalog_changed_by_user_id']);
 IF NOT material THEN
  IF ROW(NEW.version,NEW.updated_at,NEW.catalog_changed_at,NEW.catalog_changed_by_user_id)
    IS DISTINCT FROM ROW(OLD.version,OLD.updated_at,OLD.catalog_changed_at,OLD.catalog_changed_by_user_id)
  THEN RAISE EXCEPTION 'laboratory_catalog_noop_immutable';END IF;
  RETURN NEW;
 END IF;
 IF OLD.version=9223372036854775807 THEN RAISE EXCEPTION 'laboratory_catalog_version_exhausted';END IF;
 IF NEW.version<>OLD.version+1 OR NEW.catalog_changed_at IS NULL OR NOT isfinite(NEW.catalog_changed_at)
  OR NEW.updated_at IS DISTINCT FROM NEW.catalog_changed_at OR NEW.catalog_changed_at>clock_timestamp()
  OR(OLD.catalog_changed_at IS NOT NULL AND NEW.catalog_changed_at<OLD.catalog_changed_at)
 THEN RAISE EXCEPTION 'laboratory_catalog_version_invalid';END IF;
 definition_changed:=(to_jsonb(NEW)-ARRAY['updated_at','version','catalog_changed_at','catalog_changed_by_user_id','is_active'])
  IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['updated_at','version','catalog_changed_at','catalog_changed_by_user_id','is_active']);
 -- Trusted definition maintenance is not an authenticated public definition command.
 IF definition_changed THEN NEW.catalog_changed_by_user_id:=NULL;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER laboratory_test_definition BEFORE INSERT OR UPDATE OR DELETE ON lab_tests
 FOR EACH ROW EXECUTE FUNCTION laboratory_catalog_definition_guard();
CREATE TRIGGER laboratory_panel_definition BEFORE INSERT OR UPDATE OR DELETE ON lab_panels
 FOR EACH ROW EXECUTE FUNCTION laboratory_catalog_definition_guard();

CREATE FUNCTION laboratory_catalog_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parents uuid[];parent uuid;parent_facility uuid;test uuid;retained uuid;
BEGIN
 IF TG_OP='INSERT' THEN parents:=ARRAY[NEW.panel_id];
 ELSIF TG_OP='DELETE' THEN parents:=ARRAY[OLD.panel_id];
 ELSE parents:=ARRAY[OLD.panel_id,NEW.panel_id];END IF;
 PERFORM laboratory_catalog_panel_gates(parents,false);
 FOR parent IN SELECT DISTINCT id FROM unnest(parents) AS source(id) ORDER BY id LOOP
  PERFORM id FROM lab_panels WHERE id=parent FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'laboratory_order_source_unavailable';END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.panel_id,NEW.test_id) IS NOT DISTINCT FROM ROW(OLD.panel_id,OLD.test_id) THEN RETURN NEW;END IF;
 -- Parent exclusive gates serialize even an existing ON CONFLICT no-op with DELETE.
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM lab_panel_tests WHERE panel_id=NEW.panel_id AND test_id=NEW.test_id;
  IF FOUND THEN RETURN NEW;END IF;
 END IF;
 SELECT facility_id INTO parent_facility FROM lab_panels WHERE id=NEW.panel_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'laboratory_order_source_unavailable';END IF;
 SELECT id INTO retained FROM lab_tests WHERE id=NEW.test_id AND facility_id=parent_facility AND is_active FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'laboratory_order_source_unavailable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER laboratory_panel_membership BEFORE INSERT OR UPDATE OR DELETE ON lab_panel_tests
 FOR EACH ROW EXECUTE FUNCTION laboratory_catalog_membership_guard();

CREATE FUNCTION laboratory_catalog_membership_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parents uuid[];parent uuid;point timestamptz;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.panel_id,NEW.test_id) IS NOT DISTINCT FROM ROW(OLD.panel_id,OLD.test_id) THEN RETURN NEW;END IF;
 IF TG_OP='INSERT' THEN parents:=ARRAY[NEW.panel_id];
 ELSIF TG_OP='DELETE' THEN parents:=ARRAY[OLD.panel_id];
 ELSE parents:=ARRAY[OLD.panel_id,NEW.panel_id];END IF;
 FOR parent IN SELECT DISTINCT id FROM unnest(parents) AS source(id) ORDER BY id LOOP
  point:=clock_timestamp();
  UPDATE lab_panels SET membership_generation=membership_generation+1,version=version+1,
   catalog_changed_at=point,updated_at=point,catalog_changed_by_user_id=NULL WHERE id=parent;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER laboratory_panel_membership_changed AFTER INSERT OR UPDATE OR DELETE ON lab_panel_tests
 FOR EACH ROW EXECUTE FUNCTION laboratory_catalog_membership_changed();

CREATE FUNCTION laboratory_order_test_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE facility uuid;retained uuid;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.order_id,NEW.test_id) IS NOT DISTINCT FROM ROW(OLD.order_id,OLD.test_id) THEN RETURN NEW;END IF;
 -- Parent first avoids inversion against an order's cascading trusted DELETE.
 SELECT facility_id INTO facility FROM lab_orders WHERE id=NEW.order_id FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'laboratory_order_source_unavailable';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM lab_order_tests WHERE order_id=NEW.order_id AND test_id=NEW.test_id FOR KEY SHARE NOWAIT;
  IF FOUND THEN RETURN NEW;END IF;
 END IF;
 SELECT id INTO retained FROM lab_tests WHERE id=NEW.test_id AND facility_id=facility AND is_active FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'laboratory_order_source_unavailable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER laboratory_order_test_source BEFORE INSERT OR UPDATE ON lab_order_tests
 FOR EACH ROW EXECUTE FUNCTION laboratory_order_test_source_guard();

CREATE TABLE laboratory_catalog_commands(
 id uuid NOT NULL UNIQUE,
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 subject_kind text NOT NULL CHECK(subject_kind IN('test','panel')),
 subject_id uuid NOT NULL,
 test_id uuid REFERENCES lab_tests(id) ON DELETE RESTRICT,
 panel_id uuid REFERENCES lab_panels(id) ON DELETE RESTRICT,
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(facility_id,request_key_hash),
 CONSTRAINT laboratory_catalog_command_subject CHECK(
  (subject_kind='test' AND test_id=subject_id AND test_id IS NOT NULL AND panel_id IS NULL)
  OR(subject_kind='panel' AND panel_id=subject_id AND panel_id IS NOT NULL AND test_id IS NULL))
);
CREATE INDEX laboratory_catalog_commands_history_idx ON laboratory_catalog_commands(facility_id,subject_kind,subject_id,recorded_at DESC,id DESC);
CREATE INDEX laboratory_catalog_audit_command_idx ON audit_events(facility_id,(metadata->>'command_id')) WHERE resource_type='laboratory_catalog';

CREATE FUNCTION laboratory_catalog_receipt_valid(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(CASE WHEN jsonb_typeof(value)='object' THEN
  value ?& ARRAY['command_id','client_request_id','input_digest','reviewed_input','subject','recorded_at','recorded_by_user_id','changed']
  AND(SELECT count(*) FROM jsonb_object_keys(value))=8
  AND jsonb_typeof(value->'changed')='boolean'
  AND value->>'command_id'~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND value->>'client_request_id'~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND value->>'input_digest'~'^[0-9a-f]{64}$'
  AND jsonb_typeof(value->'recorded_at')='string'
  AND jsonb_typeof(value->'recorded_by_user_id')='string'
  AND jsonb_typeof(value->'reviewed_input')='object'
  AND(value->'reviewed_input') ?& ARRAY['action','subject_kind','subject_id','client_request_id','expected_version','is_active','reason']
  AND(SELECT count(*) FROM jsonb_object_keys(value->'reviewed_input'))=7
  AND value->'reviewed_input'->>'action'='set_availability'
  AND jsonb_typeof(value->'reviewed_input'->'is_active')='boolean'
  AND jsonb_typeof(value->'reviewed_input'->'reason')='string'
  AND char_length(value->'reviewed_input'->>'reason') BETWEEN 1 AND 1000
  AND octet_length(value->'reviewed_input'->>'reason')<=4000
  AND(value->'reviewed_input'->>'reason')!~'[[:cntrl:]]'
  AND value->'reviewed_input'->>'subject_kind' IN('test','panel')
  AND value->'reviewed_input'->>'subject_id'<>'00000000-0000-0000-0000-000000000000'
  AND value->>'client_request_id'<>'00000000-0000-0000-0000-000000000000'
  AND(value->'reviewed_input'->>'expected_version')~'^[1-9][0-9]*$'
  AND jsonb_typeof(value->'subject')='object' AND(value->'subject') ?& ARRAY['kind','definition','ordering']
  AND(SELECT count(*) FROM jsonb_object_keys(value->'subject'))=3
  AND value->'subject'->>'kind'=value->'reviewed_input'->>'subject_kind'
  AND value->'subject'->'definition'->>'id'=value->'reviewed_input'->>'subject_id'
  AND jsonb_typeof(value->'subject'->'definition')='object'
  AND(value->'subject'->'definition') ?& ARRAY['id','code','name','is_active','is_system_default','is_facility_modified','created_at','updated_at','version','catalog_changed_at','catalog_changed_by_user_id']
  AND(SELECT count(*) FROM jsonb_object_keys(value->'subject'->'definition'))=CASE WHEN value->'subject'->>'kind'='test' THEN 14 ELSE 12 END
  AND((value->'subject'->>'kind'='test' AND(value->'subject'->'definition') ?& ARRAY['category','specimen_type','result_unit'])
   OR(value->'subject'->>'kind'='panel' AND(value->'subject'->'definition') ? 'test_count'))
  AND jsonb_typeof(value->'subject'->'definition'->'is_active')='boolean'
  AND value->'subject'->'definition'->'is_active'=value->'reviewed_input'->'is_active'
  AND jsonb_typeof(value->'subject'->'definition'->'code')='string'
  AND jsonb_typeof(value->'subject'->'definition'->'name')='string'
  AND jsonb_typeof(value->'subject'->'definition'->'is_system_default')='boolean'
  AND jsonb_typeof(value->'subject'->'definition'->'is_facility_modified')='boolean'
  AND(value->'subject'->'definition'->>'version')~'^[1-9][0-9]*$'
  AND jsonb_typeof(value->'subject'->'ordering')='object'
  AND(value->'subject'->'ordering') ?& ARRAY['is_orderable','blocked_by']
  AND(SELECT count(*) FROM jsonb_object_keys(value->'subject'->'ordering'))=2
  AND jsonb_typeof(value->'subject'->'ordering'->'is_orderable')='boolean'
  AND((value->'subject'->'ordering'->'is_orderable'='true'::jsonb AND value->'subject'->'ordering'->'blocked_by'='null'::jsonb)
   OR(value->'subject'->'ordering'->'is_orderable'='false'::jsonb AND value->'subject'->'ordering'->>'blocked_by' IN('inactive','empty_panel','unavailable_members')))
  AND CASE WHEN(value->'reviewed_input'->>'expected_version')~'^[1-9][0-9]{0,18}$'
     AND(value->'subject'->'definition'->>'version')~'^[1-9][0-9]{0,18}$'
   THEN(value->'subject'->'definition'->>'version')::numeric<=9223372036854775807
    AND(value->'subject'->'definition'->>'version')::numeric=(value->'reviewed_input'->>'expected_version')::numeric
      +CASE WHEN value->'changed'='true'::jsonb THEN 1 ELSE 0 END
   ELSE false END
  AND(value->'changed'='false'::jsonb OR(value->'subject'->'definition'->>'catalog_changed_at'=value->>'recorded_at'
   AND value->'subject'->'definition'->>'catalog_changed_by_user_id'=value->>'recorded_by_user_id'))
 ELSE false END,false)
$$;
CREATE FUNCTION laboratory_catalog_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_facility uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'laboratory_catalog_command_immutable';END IF;
 IF laboratory_catalog_receipt_valid(NEW.receipt) IS NOT TRUE THEN RAISE EXCEPTION 'laboratory_catalog_invalid';END IF;
 IF NEW.subject_kind='test' THEN SELECT facility_id INTO source_facility FROM lab_tests WHERE id=NEW.subject_id;
 ELSE SELECT facility_id INTO source_facility FROM lab_panels WHERE id=NEW.subject_id;END IF;
 IF source_facility IS DISTINCT FROM NEW.facility_id
  OR NEW.id IS DISTINCT FROM(NEW.receipt->>'command_id')::uuid
  OR NEW.actor_user_id IS DISTINCT FROM(NEW.receipt->>'recorded_by_user_id')::uuid
  OR NEW.recorded_at IS DISTINCT FROM(NEW.receipt->>'recorded_at')::timestamptz
  OR NEW.subject_kind IS DISTINCT FROM NEW.receipt->'reviewed_input'->>'subject_kind'
  OR NEW.subject_id IS DISTINCT FROM(NEW.receipt->'reviewed_input'->>'subject_id')::uuid
  OR NEW.request_key_hash IS DISTINCT FROM sha256(uuid_send((NEW.receipt->>'client_request_id')::uuid))
  OR NEW.receipt->>'client_request_id' IS DISTINCT FROM NEW.receipt->'reviewed_input'->>'client_request_id'
  OR encode(NEW.payload_digest,'hex') IS DISTINCT FROM NEW.receipt->>'input_digest'
  OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND facility_id=NEW.facility_id)
 THEN RAISE EXCEPTION 'laboratory_catalog_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER laboratory_catalog_command_immutable BEFORE INSERT OR UPDATE OR DELETE ON laboratory_catalog_commands
 FOR EACH ROW EXECUTE FUNCTION laboratory_catalog_command_guard();
CREATE FUNCTION laboratory_catalog_command_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF(SELECT count(*) FROM audit_events a WHERE a.facility_id=NEW.facility_id
  AND a.resource_type='laboratory_catalog' AND a.resource_id=NEW.subject_id
  AND a.actor_user_id=NEW.actor_user_id AND a.event_type='laboratory.catalog.set_availability'
  AND a.metadata->>'command_id'=NEW.id::text
  AND(a.metadata->>'version')::bigint=(NEW.receipt->'subject'->'definition'->>'version')::bigint
  AND(a.metadata->>'changed')::boolean=(NEW.receipt->>'changed')::boolean)<>1
 THEN RAISE EXCEPTION 'laboratory_catalog_command_incomplete';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER laboratory_catalog_command_complete AFTER INSERT ON laboratory_catalog_commands
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION laboratory_catalog_command_complete_guard();

CREATE FUNCTION laboratory_catalog_refresh_document(facility uuid,kind text,target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE source record;existing search_documents%ROWTYPE;source_table text;extra jsonb;affected bigint;owner text;
 previous_lock text:=current_setting('lock_timeout');previous_statement text:=current_setting('statement_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 PERFORM set_config('statement_timeout','1000ms',true);
 IF kind='test' THEN
  SELECT r.id,r.code,r.name,r.is_active,r.version,r.created_at,r.updated_at,r.specimen_type,r.result_unit
   INTO source FROM lab_tests r WHERE r.facility_id=facility AND r.id=target FOR SHARE NOWAIT;
  source_table:='lab_tests';
 ELSIF kind='panel' THEN
  SELECT r.id,r.code,r.name,r.is_active,r.version,r.created_at,r.updated_at,NULL::text specimen_type,NULL::text result_unit
   INTO source FROM lab_panels r WHERE r.facility_id=facility AND r.id=target FOR SHARE NOWAIT;
  source_table:='lab_panels';
 ELSE RAISE EXCEPTION 'laboratory_catalog_invalid';END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'laboratory_order_source_unavailable';END IF;
 extra:=jsonb_build_object('source_table',source_table,'code',source.code,'catalog_version',source.version);
 IF kind='test' THEN extra:=extra||jsonb_build_object('specimen_type',source.specimen_type);END IF;
 SELECT * INTO existing FROM search_documents WHERE facility_id=facility AND resource_type='laboratory' AND resource_id=target FOR UPDATE NOWAIT;
 IF FOUND AND existing.metadata->>'source_table' IS DISTINCT FROM source_table THEN RAISE EXCEPTION 'laboratory_catalog_projection_conflict';END IF;
 INSERT INTO search_documents(id,facility_id,resource_type,resource_id,patient_id,patient_code,patient_name,patient_date_of_birth,title,subtitle,route_path,status_label,feature_key,permission_code,requires_patient_demographics,search_text,rank_boost,source_updated_at,occurred_at,metadata,is_active,indexed_at)
 VALUES(gen_random_uuid(),facility,'laboratory',target,NULL,NULL,NULL,NULL,source.name,
  CASE WHEN kind='test' THEN 'Lab test ' ELSE 'Lab panel ' END||source.code,
  '/laboratory/catalog?tab='||CASE WHEN kind='test' THEN 'tests&test=' ELSE 'panels&panel=' END||source.id::text,
  CASE WHEN source.is_active THEN 'active' ELSE 'inactive' END,'laboratory','laboratory.order.manage',true,
  concat_ws(' ',source.code,source.name,source.specimen_type,source.result_unit),45,
  source.updated_at,source.updated_at,extra,source.is_active,clock_timestamp())
 ON CONFLICT(facility_id,resource_type,resource_id) DO UPDATE SET
  patient_id=NULL,patient_code=NULL,patient_name=NULL,patient_date_of_birth=NULL,
  title=EXCLUDED.title,subtitle=EXCLUDED.subtitle,route_path=EXCLUDED.route_path,status_label=EXCLUDED.status_label,
  feature_key=EXCLUDED.feature_key,permission_code=EXCLUDED.permission_code,requires_patient_demographics=true,
  search_text=EXCLUDED.search_text,rank_boost=EXCLUDED.rank_boost,source_updated_at=EXCLUDED.source_updated_at,
  occurred_at=EXCLUDED.occurred_at,metadata=search_documents.metadata||EXCLUDED.metadata,
  is_active=EXCLUDED.is_active,indexed_at=clock_timestamp()
 WHERE search_documents.metadata->>'source_table'=source_table
  AND ROW(search_documents.patient_id,search_documents.patient_code,search_documents.patient_name,search_documents.patient_date_of_birth,
   search_documents.title,search_documents.subtitle,search_documents.route_path,search_documents.status_label,
   search_documents.feature_key,search_documents.permission_code,search_documents.requires_patient_demographics,
   search_documents.search_text,search_documents.rank_boost,search_documents.source_updated_at,
   search_documents.occurred_at,search_documents.metadata,search_documents.is_active)
  IS DISTINCT FROM ROW(EXCLUDED.patient_id,EXCLUDED.patient_code,EXCLUDED.patient_name,EXCLUDED.patient_date_of_birth,
   EXCLUDED.title,EXCLUDED.subtitle,EXCLUDED.route_path,EXCLUDED.status_label,EXCLUDED.feature_key,EXCLUDED.permission_code,true,
   EXCLUDED.search_text,EXCLUDED.rank_boost,EXCLUDED.source_updated_at,EXCLUDED.occurred_at,
   search_documents.metadata||EXCLUDED.metadata,EXCLUDED.is_active);
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=0 THEN
  SELECT metadata->>'source_table' INTO owner FROM search_documents WHERE facility_id=facility AND resource_type='laboratory' AND resource_id=target;
  IF owner IS DISTINCT FROM source_table THEN RAISE EXCEPTION 'laboratory_catalog_projection_conflict';END IF;
 END IF;
 PERFORM set_config('lock_timeout',previous_lock,true);
 PERFORM set_config('statement_timeout',previous_statement,true);
END $$;
CREATE FUNCTION laboratory_catalog_search_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW;END IF;
 PERFORM laboratory_catalog_refresh_document(NEW.facility_id,CASE WHEN TG_TABLE_NAME='lab_tests' THEN 'test' ELSE 'panel' END,NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER laboratory_test_search AFTER INSERT OR UPDATE ON lab_tests FOR EACH ROW EXECUTE FUNCTION laboratory_catalog_search_guard();
CREATE TRIGGER laboratory_panel_search AFTER INSERT OR UPDATE ON lab_panels FOR EACH ROW EXECUTE FUNCTION laboratory_catalog_search_guard();

-- Mandatory quiescent catalog-only repair. No order/result document fanout.
DO $$ DECLARE source record;
BEGIN
 FOR source IN SELECT facility_id,'test'::text kind,id FROM lab_tests
  UNION ALL SELECT facility_id,'panel'::text,id FROM lab_panels LOOP
  PERFORM laboratory_catalog_refresh_document(source.facility_id,source.kind,source.id);
 END LOOP;
END $$;
