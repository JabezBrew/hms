-- Epoch029: scheduling defaults and exact new publication proof; booked care is retained.
ALTER TABLE appointment_types ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version>0);
CREATE INDEX appointment_type_administration_page_idx ON appointment_types(facility_id,created_at DESC,id DESC);
CREATE INDEX appointment_type_template_allowed_reference_idx ON clinic_session_template_appointment_types(appointment_type_id,clinic_session_template_id);
CREATE INDEX appointment_type_active_template_owner_idx ON clinic_session_templates(facility_id,owner_id) WHERE owner_type='service' AND is_active;
CREATE TABLE appointment_type_commands (
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 type_id uuid NOT NULL REFERENCES appointment_types(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN('create','metadata','retire','reactivate')),
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(facility_id,request_key_hash)
);
CREATE INDEX appointment_type_commands_type_idx ON appointment_type_commands(facility_id,type_id,recorded_at);

-- A full ISO-week cycle finds the next possible occurrence without expanding
-- open-ended calendars. UTC matches the canonical generated-session producer.
-- VOLATILE is deliberate: post-lock callers need a fresh query snapshot.
CREATE FUNCTION appointment_type_has_future_generator(facility uuid,target uuid,point timestamptz) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 WITH candidates(id) AS (
  SELECT id FROM clinic_session_templates WHERE facility_id=facility AND owner_type='service' AND owner_id=target AND is_active
  UNION ALL
  SELECT clinic_session_template_id FROM clinic_session_template_appointment_types WHERE appointment_type_id=target
 )
 SELECT EXISTS(
  SELECT 1 FROM candidates c JOIN clinic_session_templates t ON t.id=c.id
  CROSS JOIN LATERAL(SELECT GREATEST(t.starts_on,(point AT TIME ZONE 'UTC')::date+
    CASE WHEN t.end_time<=(point AT TIME ZONE 'UTC')::time THEN 1 ELSE 0 END) base) b
  CROSS JOIN LATERAL generate_series(0,6) offsets(day_offset)
  WHERE t.facility_id=facility AND t.is_active
    AND (t.ends_on IS NULL OR b.base+offsets.day_offset<=t.ends_on)
    AND EXTRACT(ISODOW FROM b.base+offsets.day_offset)::smallint=ANY(t.weekdays)
    AND (b.base+offsets.day_offset+t.end_time)>(point AT TIME ZONE 'UTC')
 );
$$;
CREATE FUNCTION appointment_type_require_active(facility uuid,targets uuid[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 FOR target IN SELECT DISTINCT unnest(targets) ORDER BY 1 LOOP
  IF target IS NULL THEN CONTINUE; END IF;
  PERFORM id FROM appointment_types WHERE id=target AND facility_id=facility AND is_active FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_type_reference_unavailable'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION appointment_type_identity_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'appointment_type_identity_immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 THEN RAISE EXCEPTION 'appointment_type_version_invalid'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.facility_id,NEW.code,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.code,OLD.created_at) THEN RAISE EXCEPTION 'appointment_type_identity_immutable'; END IF;
  IF ROW(NEW.name,NEW.default_duration_minutes,NEW.is_active) IS NOT DISTINCT FROM ROW(OLD.name,OLD.default_duration_minutes,OLD.is_active) THEN
   IF ROW(NEW.version,NEW.updated_at) IS DISTINCT FROM ROW(OLD.version,OLD.updated_at) THEN RAISE EXCEPTION 'appointment_type_noop_immutable'; END IF;
   RETURN NEW;
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'appointment_type_version_invalid'; END IF;
  IF OLD.is_active AND NOT NEW.is_active AND appointment_type_has_future_generator(OLD.facility_id,OLD.id,clock_timestamp()) THEN RAISE EXCEPTION 'appointment_type_future_generator'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appointment_type_identity_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON appointment_types FOR EACH ROW EXECUTE FUNCTION appointment_type_identity_lifecycle_guard();

-- Keep the complete allowed-type source owned while generation or booking
-- retains its parent. Membership writers lock old/new parents in UUID order.
-- A cascade may already have deleted its own parent; deleting that child remains valid.
CREATE FUNCTION appointment_type_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_row jsonb; prior_row jsonb; parents uuid[]:=ARRAY[]::uuid[]; target uuid; new_parent uuid; parent_facility uuid;
BEGIN
 IF TG_OP='DELETE' THEN current_row:=to_jsonb(OLD); ELSE current_row:=to_jsonb(NEW); END IF;
 IF TG_OP='UPDATE' THEN
  prior_row:=to_jsonb(OLD);
  IF ROW(current_row->>'facility_id',current_row->>TG_ARGV[0],current_row->>'appointment_type_id') IS NOT DISTINCT FROM ROW(prior_row->>'facility_id',prior_row->>TG_ARGV[0],prior_row->>'appointment_type_id') THEN RETURN NEW; END IF;
  parents:=array_append(parents,(prior_row->>TG_ARGV[0])::uuid);
 END IF;
 new_parent:=(current_row->>TG_ARGV[0])::uuid;
 parents:=array_append(parents,new_parent);
 FOR target IN SELECT DISTINCT unnest(parents) ORDER BY 1 LOOP
  IF target IS NULL THEN CONTINUE; END IF;
  IF TG_TABLE_NAME='clinic_session_appointment_types' THEN
   SELECT facility_id INTO parent_facility FROM clinic_sessions WHERE id=target FOR UPDATE NOWAIT;
  ELSE
   SELECT facility_id INTO parent_facility FROM clinic_session_templates WHERE id=target FOR UPDATE NOWAIT;
  END IF;
  IF NOT FOUND THEN
   IF TG_OP='DELETE' THEN CONTINUE; END IF;
   RAISE EXCEPTION 'appointment_type_parent_unavailable';
  END IF;
  IF TG_OP<>'DELETE' AND target=new_parent AND parent_facility IS DISTINCT FROM (current_row->>'facility_id')::uuid THEN RAISE EXCEPTION 'appointment_type_parent_unavailable'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appointment_type_session_allowed_membership BEFORE INSERT OR UPDATE OR DELETE ON clinic_session_appointment_types FOR EACH ROW EXECUTE FUNCTION appointment_type_membership_guard('clinic_session_id');
CREATE TRIGGER appointment_type_template_allowed_membership BEFORE INSERT OR UPDATE OR DELETE ON clinic_session_template_appointment_types FOR EACH ROW EXECUTE FUNCTION appointment_type_membership_guard('clinic_session_template_id');

-- Exact new/changed links require live local types. An unchanged historical
-- appointment link remains usable for arrival, rescheduling and closure.
CREATE FUNCTION appointment_type_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_row jsonb:=to_jsonb(NEW); prior_row jsonb; target uuid; targets uuid[]:=ARRAY[]::uuid[]; session_id uuid; owner uuid; owner_kind text; parent_facility uuid;
BEGIN
 IF TG_OP='UPDATE' THEN prior_row:=to_jsonb(OLD); END IF;
 target:=(current_row->>TG_ARGV[0])::uuid;
 IF TG_OP='INSERT' OR ROW(current_row->>'facility_id',current_row->>TG_ARGV[0],current_row->>TG_ARGV[1]) IS DISTINCT FROM ROW(prior_row->>'facility_id',prior_row->>TG_ARGV[0],prior_row->>TG_ARGV[1]) THEN targets:=array_append(targets,target); END IF;
 IF TG_TABLE_NAME='appointments' AND (TG_OP='INSERT' OR ROW(current_row->>'facility_id',current_row->>'clinic_session_id') IS DISTINCT FROM ROW(prior_row->>'facility_id',prior_row->>'clinic_session_id')) THEN
  session_id:=(current_row->>'clinic_session_id')::uuid;
  IF session_id IS NOT NULL THEN
   SELECT s.facility_id,s.owner_type,s.owner_id INTO parent_facility,owner_kind,owner FROM clinic_sessions s WHERE s.id=session_id;
   IF NOT FOUND OR parent_facility<>NEW.facility_id THEN RAISE EXCEPTION 'appointment_type_reference_unavailable'; END IF;
   IF owner_kind='facility' AND owner IS NOT NULL AND owner<>NEW.facility_id THEN RAISE EXCEPTION 'appointment_type_reference_unavailable'; END IF;
   IF EXISTS(SELECT 1 FROM clinic_session_appointment_types allowed LEFT JOIN appointment_types typ ON typ.id=allowed.appointment_type_id WHERE allowed.clinic_session_id=session_id AND (allowed.facility_id<>NEW.facility_id OR typ.facility_id IS DISTINCT FROM NEW.facility_id)) THEN RAISE EXCEPTION 'appointment_type_reference_unavailable'; END IF;
   IF owner_kind='service' THEN
    IF owner IS NULL THEN RAISE EXCEPTION 'appointment_type_reference_unavailable'; END IF;
    targets:=array_append(targets,owner);
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME IN('clinic_session_appointment_types','clinic_session_template_appointment_types') THEN
  IF TG_TABLE_NAME='clinic_session_appointment_types' THEN
   SELECT facility_id INTO parent_facility FROM clinic_sessions WHERE id=NEW.clinic_session_id;
  ELSE
   SELECT facility_id INTO parent_facility FROM clinic_session_templates WHERE id=NEW.clinic_session_template_id;
  END IF;
  IF NOT FOUND OR parent_facility<>NEW.facility_id THEN RAISE EXCEPTION 'appointment_type_reference_unavailable'; END IF;
 END IF;
 PERFORM appointment_type_require_active(NEW.facility_id,targets);
 RETURN NEW;
END $$;
CREATE TRIGGER appointment_type_appointment_reference BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION appointment_type_reference_guard('appointment_type_id');
CREATE TRIGGER appointment_type_series_reference BEFORE INSERT OR UPDATE ON appointment_series FOR EACH ROW EXECUTE FUNCTION appointment_type_reference_guard('service_id');
CREATE TRIGGER appointment_type_session_allowed_reference BEFORE INSERT OR UPDATE ON clinic_session_appointment_types FOR EACH ROW EXECUTE FUNCTION appointment_type_reference_guard('appointment_type_id','clinic_session_id');
CREATE TRIGGER appointment_type_template_allowed_reference BEFORE INSERT OR UPDATE ON clinic_session_template_appointment_types FOR EACH ROW EXECUTE FUNCTION appointment_type_reference_guard('appointment_type_id','clinic_session_template_id');

CREATE FUNCTION appointment_type_session_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE targets uuid[]:=ARRAY[]::uuid[]; publishing boolean;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.facility_id) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id) THEN RAISE EXCEPTION 'appointment_type_parent_identity_immutable'; END IF;
 IF TG_OP='INSERT' THEN publishing:=true;
 ELSIF TG_TABLE_NAME='clinic_sessions' THEN
  publishing:=ROW(NEW.owner_type,NEW.owner_id,NEW.starts_at,NEW.ends_at,NEW.mode,NEW.slot_minutes,NEW.capacity,NEW.allow_overbooking,NEW.overbook_limit) IS DISTINCT FROM ROW(OLD.owner_type,OLD.owner_id,OLD.starts_at,OLD.ends_at,OLD.mode,OLD.slot_minutes,OLD.capacity,OLD.allow_overbooking,OLD.overbook_limit) OR (NEW.is_active AND NOT OLD.is_active);
 ELSE
  publishing:=ROW(NEW.owner_type,NEW.owner_id,NEW.starts_on,NEW.ends_on,NEW.weekdays,NEW.start_time,NEW.end_time,NEW.mode,NEW.slot_minutes,NEW.capacity,NEW.allow_overbooking,NEW.overbook_limit) IS DISTINCT FROM ROW(OLD.owner_type,OLD.owner_id,OLD.starts_on,OLD.ends_on,OLD.weekdays,OLD.start_time,OLD.end_time,OLD.mode,OLD.slot_minutes,OLD.capacity,OLD.allow_overbooking,OLD.overbook_limit) OR (NEW.is_active AND NOT OLD.is_active);
 END IF;
 IF publishing THEN
  IF NEW.owner_type='service' THEN
   IF NEW.owner_id IS NULL THEN RAISE EXCEPTION 'appointment_type_reference_unavailable'; END IF;
   targets:=array_append(targets,NEW.owner_id);
  END IF;
  IF TG_OP='UPDATE' THEN
   IF TG_TABLE_NAME='clinic_sessions' THEN
    SELECT targets||COALESCE(array_agg(appointment_type_id),ARRAY[]::uuid[]) INTO targets FROM clinic_session_appointment_types WHERE clinic_session_id=NEW.id;
   ELSE
    SELECT targets||COALESCE(array_agg(appointment_type_id),ARRAY[]::uuid[]) INTO targets FROM clinic_session_template_appointment_types WHERE clinic_session_template_id=NEW.id;
   END IF;
  END IF;
  PERFORM appointment_type_require_active(NEW.facility_id,targets);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appointment_type_session_owner_reference BEFORE INSERT OR UPDATE ON clinic_sessions FOR EACH ROW EXECUTE FUNCTION appointment_type_session_owner_guard();
CREATE TRIGGER appointment_type_template_owner_reference BEFORE INSERT OR UPDATE ON clinic_session_templates FOR EACH ROW EXECUTE FUNCTION appointment_type_session_owner_guard();

CREATE FUNCTION appointment_type_command_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'appointment_type_command_immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM appointment_types WHERE id=NEW.type_id AND facility_id=NEW.facility_id)
 OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND facility_id=NEW.facility_id)
 OR NEW.receipt->>'recorded_by_user_id' IS DISTINCT FROM NEW.actor_user_id::text
 OR NEW.receipt->'service'->>'id' IS DISTINCT FROM NEW.type_id::text
 OR NEW.receipt->'reviewed_input'->>'action' IS DISTINCT FROM NEW.action
 OR NEW.receipt->'reviewed_input'->>'client_request_id' IS DISTINCT FROM NEW.receipt->>'client_request_id'
 OR NEW.receipt->>'input_digest' IS DISTINCT FROM encode(NEW.payload_digest,'hex')
 OR sha256(uuid_send((NEW.receipt->>'client_request_id')::uuid)) IS DISTINCT FROM NEW.request_key_hash
 OR (NEW.receipt->>'recorded_at')::timestamptz IS DISTINCT FROM NEW.recorded_at THEN RAISE EXCEPTION 'appointment_type_command_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appointment_type_command_immutable BEFORE INSERT OR UPDATE OR DELETE ON appointment_type_commands FOR EACH ROW EXECUTE FUNCTION appointment_type_command_immutable_guard();
