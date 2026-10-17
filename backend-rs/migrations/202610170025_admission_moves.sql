-- Breaking runtime epoch025. Older placement/task producers are incompatible.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM admission_cases c
        LEFT JOIN patients p ON p.id=c.patient_id AND p.facility_id=c.facility_id
        LEFT JOIN wards w ON w.id=c.ward_id AND w.facility_id=c.facility_id
        LEFT JOIN beds b ON b.id=c.bed_id AND b.facility_id=c.facility_id AND b.ward_id=c.ward_id
        WHERE p.id IS NULL OR w.id IS NULL
           OR (c.bed_id IS NOT NULL AND c.status IN ('ready_for_activation','admitted','discharge_pending')
               AND b.id IS NULL)
    ) OR EXISTS (
        SELECT 1 FROM admission_cases
        WHERE bed_id IS NOT NULL AND status IN ('ready_for_activation','admitted','discharge_pending')
        GROUP BY facility_id,bed_id HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'admission_placement_legacy_inconsistent';
    END IF;
END $$;
ALTER TABLE admission_cases ADD COLUMN placement_revision bigint NOT NULL DEFAULT 0 CHECK(placement_revision>=0),
ADD COLUMN placement_history_partial boolean NOT NULL DEFAULT false,
ADD COLUMN placement_known_from timestamptz;
CREATE UNIQUE INDEX admission_move_current_bed_owner_idx ON admission_cases(facility_id,
bed_id) WHERE bed_id IS NOT NULL AND status IN('ready_for_activation',
'admitted',
'discharge_pending');
CREATE TABLE admission_placements(
id uuid PRIMARY KEY,
facility_id uuid NOT NULL,
admission_case_id uuid NOT NULL,
patient_id uuid NOT NULL,
ward_id uuid NOT NULL REFERENCES wards(id),
bed_id uuid NOT NULL REFERENCES beds(id),
placement_revision bigint NOT NULL CHECK(placement_revision>0),
started_at timestamptz NOT NULL,
ended_at timestamptz,
origin text NOT NULL CHECK(origin IN('activation',
'move',
'legacy_current_observation')),
legacy_unknown_prefix boolean NOT NULL,
opening_move_id uuid,
closing_move_id uuid,
closing_discharge_case_id uuid REFERENCES discharge_cases(id),
close_kind text CHECK(close_kind IN('move',
'discharge')),
 FOREIGN KEY(facility_id,admission_case_id,patient_id) REFERENCES admission_cases(facility_id,id,patient_id),
 CONSTRAINT admission_placements_case_revision_key UNIQUE(admission_case_id,placement_revision),UNIQUE(facility_id,id),
 CHECK(legacy_unknown_prefix=(origin='legacy_current_observation')),CHECK((origin='move')=(opening_move_id IS NOT NULL)),CHECK(ended_at IS NULL OR ended_at>=started_at),
CHECK(((ended_at IS NULL AND close_kind IS NULL AND closing_move_id IS NULL AND closing_discharge_case_id IS NULL) OR (ended_at IS NOT NULL AND ((close_kind='move' AND closing_move_id IS NOT NULL AND closing_discharge_case_id IS NULL) OR (close_kind='discharge' AND closing_discharge_case_id IS NOT NULL AND closing_move_id IS NULL)))) IS TRUE)
);
CREATE UNIQUE INDEX admission_placements_one_open_case_idx ON admission_placements(facility_id,admission_case_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX admission_placements_one_open_bed_idx ON admission_placements(facility_id,bed_id) WHERE ended_at IS NULL;
CREATE INDEX admission_placements_ward_time_idx ON admission_placements(facility_id,ward_id,started_at,ended_at);
CREATE TABLE admission_moves(
id uuid PRIMARY KEY,
facility_id uuid NOT NULL,
admission_case_id uuid NOT NULL,
patient_id uuid NOT NULL,
placement_revision bigint NOT NULL CHECK(placement_revision>0),
actor_user_id uuid NOT NULL REFERENCES users(id),
actor_display_name text NOT NULL,
moved_at timestamptz NOT NULL,
source_ward_id uuid NOT NULL REFERENCES wards(id),
source_bed_id uuid NOT NULL REFERENCES beds(id),
destination_ward_id uuid NOT NULL REFERENCES wards(id),
destination_bed_id uuid NOT NULL REFERENCES beds(id),
reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
source_cleaning_minutes integer NOT NULL CHECK(source_cleaning_minutes>=0),
source_cleaning_due_at timestamptz NOT NULL,
routed_task_count integer NOT NULL CHECK(routed_task_count BETWEEN 0 AND 500),
cleared_assignee_count integer NOT NULL CHECK(cleared_assignee_count BETWEEN 0 AND routed_task_count),
reviewed_task_ids uuid[] NOT NULL CHECK(cardinality(reviewed_task_ids)<=500),
detail jsonb NOT NULL,
FOREIGN KEY(facility_id,
admission_case_id,
patient_id) REFERENCES admission_cases(facility_id,
id,
patient_id),
UNIQUE(facility_id,
id),
CONSTRAINT admission_moves_case_revision_key UNIQUE(admission_case_id,
placement_revision),
CHECK(source_bed_id<>destination_bed_id),
CHECK(cardinality(reviewed_task_ids)=routed_task_count)
);
CREATE INDEX admission_moves_history_idx ON admission_moves(facility_id,admission_case_id,placement_revision DESC);
CREATE INDEX admission_moves_source_time_idx ON admission_moves(facility_id,source_ward_id,moved_at,id);
CREATE INDEX admission_moves_destination_time_idx ON admission_moves(facility_id,destination_ward_id,moved_at,id);
CREATE INDEX beds_move_candidates_idx ON beds(facility_id,status,created_at,id);
ALTER TABLE admission_placements ADD FOREIGN KEY(facility_id,
opening_move_id) REFERENCES admission_moves(facility_id,
id) DEFERRABLE INITIALLY DEFERRED,
ADD FOREIGN KEY(facility_id,
closing_move_id) REFERENCES admission_moves(facility_id,
id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE admission_move_commands(
facility_id uuid NOT NULL REFERENCES facilities(id),
request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
patient_id uuid NOT NULL,
admission_case_id uuid NOT NULL,
actor_user_id uuid NOT NULL REFERENCES users(id),
payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
result_id uuid,
receipt jsonb,
recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
PRIMARY KEY(facility_id,
request_key_hash),
FOREIGN KEY(facility_id,
admission_case_id,
patient_id) REFERENCES admission_cases(facility_id,
id,
patient_id),
FOREIGN KEY(facility_id,
result_id) REFERENCES admission_moves(facility_id,
id)
);
ALTER TABLE nursing_tasks ADD COLUMN service_ward_id uuid REFERENCES wards(id),ADD COLUMN route_version bigint NOT NULL DEFAULT 0 CHECK(route_version>=0);
UPDATE nursing_tasks SET service_ward_id=ward_id;
ALTER TABLE nursing_tasks ALTER COLUMN service_ward_id SET NOT NULL;
CREATE UNIQUE INDEX nursing_tasks_facility_identity_idx ON nursing_tasks(facility_id,id);
CREATE INDEX nursing_tasks_service_due_idx ON nursing_tasks(facility_id,service_ward_id,status,due_at,id);
CREATE INDEX nursing_tasks_open_case_route_idx ON nursing_tasks(facility_id,admission_case_id,status,id);
CREATE TABLE nursing_task_routes(
id uuid PRIMARY KEY,
facility_id uuid NOT NULL,
task_id uuid NOT NULL,
admission_case_id uuid NOT NULL,
patient_id uuid NOT NULL,
move_id uuid NOT NULL,
route_version bigint NOT NULL CHECK(route_version>0),
origin_ward_id uuid NOT NULL REFERENCES wards(id),
from_service_ward_id uuid NOT NULL REFERENCES wards(id),
to_service_ward_id uuid NOT NULL REFERENCES wards(id),
from_assigned_to_user_id uuid REFERENCES users(id),
to_assigned_to_user_id uuid CHECK(to_assigned_to_user_id IS NULL),
routed_by_user_id uuid NOT NULL REFERENCES users(id),
routed_at timestamptz NOT NULL,
FOREIGN KEY(facility_id,
task_id) REFERENCES nursing_tasks(facility_id,
id),
FOREIGN KEY(facility_id,
move_id) REFERENCES admission_moves(facility_id,
id),
FOREIGN KEY(facility_id,
admission_case_id,
patient_id) REFERENCES admission_cases(facility_id,
id,
patient_id),
CONSTRAINT nursing_task_routes_task_version_key UNIQUE(task_id,
route_version),
 CONSTRAINT nursing_task_routes_move_task_key UNIQUE(move_id,task_id)
);
-- Rollout facts are observations, never inferred original admission attribution.
WITH point AS MATERIALIZED(SELECT clock_timestamp() at) UPDATE admission_cases SET placement_history_partial=true,
placement_known_from=point.at FROM point WHERE status IN('admitted',
'discharge_pending',
'discharged');
UPDATE admission_cases SET placement_revision=1 WHERE bed_id IS NOT NULL AND status IN('ready_for_activation','admitted','discharge_pending');
INSERT INTO admission_placements(id,
facility_id,
admission_case_id,
patient_id,
ward_id,
bed_id,
placement_revision,
started_at,
origin,
legacy_unknown_prefix) SELECT gen_random_uuid(),
facility_id,
id,
patient_id,
ward_id,
bed_id,
placement_revision,
placement_known_from,
'legacy_current_observation',
true FROM admission_cases WHERE bed_id IS NOT NULL AND status IN('admitted',
'discharge_pending');
CREATE FUNCTION admission_placement_root_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id,NEW.facility_id,NEW.patient_id) IS DISTINCT FROM ROW(OLD.id,OLD.facility_id,OLD.patient_id)
       OR NEW.placement_revision < OLD.placement_revision
       OR NEW.placement_revision > OLD.placement_revision + 1 THEN
        RAISE EXCEPTION 'admission_placement_identity_invalid';
    END IF;
    IF ROW(NEW.ward_id,NEW.bed_id) IS DISTINCT FROM ROW(OLD.ward_id,OLD.bed_id)
       AND NEW.placement_revision <> OLD.placement_revision + 1 THEN
        RAISE EXCEPTION 'admission_placement_revision_required';
    END IF;
    -- The first observation/activation may set coverage once; subsequent changes
    -- cannot erase a legacy unknown prefix or move its observation boundary.
    IF OLD.placement_known_from IS NOT NULL
       AND ROW(NEW.placement_known_from,NEW.placement_history_partial)
           IS DISTINCT FROM ROW(OLD.placement_known_from,OLD.placement_history_partial)
       OR OLD.placement_known_from IS NULL AND NEW.placement_known_from IS NULL
          AND NEW.placement_history_partial IS DISTINCT FROM OLD.placement_history_partial
       OR OLD.placement_history_partial AND NOT NEW.placement_history_partial THEN
        RAISE EXCEPTION 'admission_placement_coverage_immutable';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER admission_placement_root_guard BEFORE UPDATE ON admission_cases FOR EACH ROW EXECUTE FUNCTION admission_placement_root_guard_fn();
CREATE FUNCTION admission_placement_interval_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
       OR (to_jsonb(NEW) - 'ended_at' - 'close_kind' - 'closing_move_id' - 'closing_discharge_case_id')
          IS DISTINCT FROM
          (to_jsonb(OLD) - 'ended_at' - 'close_kind' - 'closing_move_id' - 'closing_discharge_case_id') THEN
        RAISE EXCEPTION 'admission_placement_interval_immutable';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER admission_placement_interval_guard BEFORE UPDATE OR DELETE ON admission_placements FOR EACH ROW EXECUTE FUNCTION admission_placement_interval_guard_fn();
CREATE FUNCTION admission_placement_interval_scope_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM admission_cases a
        JOIN beds b ON b.id = NEW.bed_id AND b.facility_id = a.facility_id AND b.ward_id = NEW.ward_id
        JOIN wards w ON w.id = b.ward_id AND w.facility_id = a.facility_id
        WHERE a.id = NEW.admission_case_id AND a.facility_id = NEW.facility_id AND a.patient_id = NEW.patient_id
    ) THEN
        RAISE EXCEPTION 'admission_placement_scope_invalid';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER admission_placement_interval_scope BEFORE INSERT ON admission_placements FOR EACH ROW EXECUTE FUNCTION admission_placement_interval_scope_fn();
CREATE FUNCTION admission_placement_import_observation_fn() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    point timestamptz := clock_timestamp();
BEGIN
    IF NEW.placement_revision = 0 AND NEW.status IN ('admitted','discharge_pending','discharged') THEN
        UPDATE admission_cases
        SET placement_history_partial = true,
            placement_known_from = point,
            placement_revision = CASE WHEN NEW.bed_id IS NOT NULL AND NEW.status <> 'discharged' THEN 1 ELSE 0 END
        WHERE id = NEW.id;
        IF NEW.bed_id IS NOT NULL AND NEW.status <> 'discharged' THEN
            INSERT INTO admission_placements (
                id,facility_id,admission_case_id,patient_id,ward_id,bed_id,
                placement_revision,started_at,origin,legacy_unknown_prefix
            ) VALUES (
                gen_random_uuid(),NEW.facility_id,NEW.id,NEW.patient_id,NEW.ward_id,NEW.bed_id,
                1,point,'legacy_current_observation',true
            );
        END IF;
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER admission_placement_import_observation AFTER INSERT ON admission_cases FOR EACH ROW EXECUTE FUNCTION admission_placement_import_observation_fn();
CREATE FUNCTION admission_placement_consistent_fn() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    current_case admission_cases%ROWTYPE;
BEGIN
    SELECT * INTO current_case FROM admission_cases WHERE id = NEW.id;
    IF current_case.status IN ('admitted','discharge_pending') AND current_case.bed_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM admission_placements p
            WHERE p.facility_id = current_case.facility_id AND p.admission_case_id = current_case.id
              AND p.patient_id = current_case.patient_id AND p.ward_id = current_case.ward_id
              AND p.bed_id = current_case.bed_id AND p.placement_revision = current_case.placement_revision
              AND p.ended_at IS NULL
        ) THEN
            RAISE EXCEPTION 'admission_placement_evidence_incomplete';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM admission_placements p
                  WHERE p.admission_case_id = current_case.id AND p.ended_at IS NULL) THEN
        RAISE EXCEPTION 'admission_placement_closure_incomplete';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IN ('admitted','discharge_pending')
       AND NEW.status IN ('admitted','discharge_pending')
       AND ROW(NEW.ward_id,NEW.bed_id) IS DISTINCT FROM ROW(OLD.ward_id,OLD.bed_id)
       AND NOT EXISTS (
           SELECT 1 FROM admission_moves m
           WHERE m.facility_id = NEW.facility_id AND m.admission_case_id = NEW.id
             AND m.patient_id = NEW.patient_id AND m.placement_revision = NEW.placement_revision
             AND m.source_ward_id = OLD.ward_id AND m.source_bed_id = OLD.bed_id
             AND m.destination_ward_id = NEW.ward_id AND m.destination_bed_id = NEW.bed_id
             AND m.moved_at = NEW.updated_at
       ) THEN
        RAISE EXCEPTION 'admission_placement_move_required';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER admission_placement_consistent AFTER INSERT OR UPDATE ON admission_cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION admission_placement_consistent_fn();
CREATE FUNCTION admission_move_immutable_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'admission_move_immutable'; END $$;
CREATE TRIGGER admission_move_immutable BEFORE UPDATE OR DELETE ON admission_moves FOR EACH ROW EXECUTE FUNCTION admission_move_immutable_fn();
CREATE TRIGGER nursing_task_route_immutable BEFORE UPDATE OR DELETE ON nursing_task_routes FOR EACH ROW EXECUTE FUNCTION admission_move_immutable_fn();
CREATE FUNCTION admission_move_scope_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = NEW.actor_user_id AND facility_id = NEW.facility_id
    ) OR NOT EXISTS (
        SELECT 1 FROM beds b JOIN wards w ON w.id=b.ward_id AND w.facility_id=b.facility_id
        WHERE b.id = NEW.source_bed_id AND b.facility_id = NEW.facility_id AND b.ward_id = NEW.source_ward_id
    ) OR NOT EXISTS (
        SELECT 1 FROM beds b JOIN wards w ON w.id=b.ward_id AND w.facility_id=b.facility_id
        WHERE b.id = NEW.destination_bed_id AND b.facility_id = NEW.facility_id AND b.ward_id = NEW.destination_ward_id
    ) OR NOT (
        jsonb_typeof(NEW.detail) = 'object'
        AND NEW.detail->>'id' = NEW.id::text
        AND NEW.detail->>'patient_id' = NEW.patient_id::text
        AND NEW.detail->>'admission_case_id' = NEW.admission_case_id::text
        AND NEW.detail->>'recorded_by_user_id' = NEW.actor_user_id::text
        AND NEW.detail->>'recorded_by_display_name' = NEW.actor_display_name
        AND NEW.detail->>'placement_revision' = NEW.placement_revision::text
        AND (NEW.detail->>'moved_at')::timestamptz = NEW.moved_at
        AND NEW.detail->>'reason' = NEW.reason
        AND NEW.detail->>'task_policy' = 'route_all_clear_assignees'
        AND NEW.detail->'source'->>'ward_id' = NEW.source_ward_id::text
        AND NEW.detail->'source'->>'bed_id' = NEW.source_bed_id::text
        AND NEW.detail->'destination'->>'ward_id' = NEW.destination_ward_id::text
        AND NEW.detail->'destination'->>'bed_id' = NEW.destination_bed_id::text
        AND NEW.detail->'source_placement'->'labels' = NEW.detail->'source'
        AND NEW.detail->'source_placement'->>'placement_revision' = (NEW.placement_revision-1)::text
        AND NEW.detail->'destination_placement'->'labels' = NEW.detail->'destination'
        AND NEW.detail->'destination_placement'->>'placement_revision' = NEW.placement_revision::text
        AND NEW.detail->'destination_placement'->>'origin' = 'move'
        AND NEW.detail->'destination_placement'->'legacy_unknown_prefix' = 'false'::jsonb
        AND (NEW.detail->'destination_placement'->>'started_at')::timestamptz = NEW.moved_at
        AND NEW.detail->'task_result'->>'open_task_count' = NEW.routed_task_count::text
        AND NEW.detail->'task_result'->>'routed_task_count' = NEW.routed_task_count::text
        AND NEW.detail->'task_result'->>'cleared_assignee_count' = NEW.cleared_assignee_count::text
        AND NEW.detail->>'routed_task_count' = NEW.routed_task_count::text
        AND NEW.detail->>'cleared_assignee_count' = NEW.cleared_assignee_count::text
        AND NEW.detail->'source_bed_release'->>'status' = 'cleaning'
        AND NEW.detail->'source_bed_release'->>'cleaning_minutes' = NEW.source_cleaning_minutes::text
        AND (NEW.detail->'source_bed_release'->>'cleaning_due_at')::timestamptz = NEW.source_cleaning_due_at
        AND NEW.source_cleaning_due_at = NEW.moved_at + make_interval(mins => NEW.source_cleaning_minutes)
    ) IS TRUE THEN
        RAISE EXCEPTION 'admission_move_scope_invalid';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER admission_move_scope BEFORE INSERT ON admission_moves FOR EACH ROW EXECUTE FUNCTION admission_move_scope_fn();
CREATE FUNCTION nursing_task_route_initialize_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.service_ward_id := COALESCE(NEW.service_ward_id,NEW.ward_id);
    IF NEW.service_ward_id <> NEW.ward_id OR NEW.route_version <> 0 THEN
        RAISE EXCEPTION 'nursing_task_initial_route_invalid';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER nursing_task_route_initialize BEFORE INSERT ON nursing_tasks FOR EACH ROW EXECUTE FUNCTION nursing_task_route_initialize_fn();
CREATE FUNCTION nursing_task_route_identity_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id,NEW.facility_id,NEW.admission_case_id,NEW.patient_id,NEW.ward_id,
           NEW.task_type,NEW.title,NEW.instruction,NEW.created_by_user_id,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id,OLD.facility_id,OLD.admission_case_id,OLD.patient_id,OLD.ward_id,
           OLD.task_type,OLD.title,OLD.instruction,OLD.created_by_user_id,OLD.created_at) THEN
        RAISE EXCEPTION 'nursing_task_origin_immutable';
    END IF;
    IF ROW(NEW.service_ward_id,NEW.assigned_to_user_id,NEW.route_version)
       IS DISTINCT FROM ROW(OLD.service_ward_id,OLD.assigned_to_user_id,OLD.route_version)
       AND (OLD.status <> 'open' OR NEW.status <> 'open'
            OR NEW.route_version <> OLD.route_version + 1 OR NEW.assigned_to_user_id IS NOT NULL) THEN
        RAISE EXCEPTION 'nursing_task_route_invalid';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER nursing_task_route_identity BEFORE UPDATE ON nursing_tasks FOR EACH ROW EXECUTE FUNCTION nursing_task_route_identity_fn();
CREATE FUNCTION nursing_task_route_scope_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM admission_moves m
        JOIN nursing_tasks t ON t.id = NEW.task_id AND t.facility_id = m.facility_id
        JOIN wards origin ON origin.id = t.ward_id AND origin.facility_id = t.facility_id
        WHERE m.id = NEW.move_id AND m.facility_id = NEW.facility_id
          AND m.admission_case_id = NEW.admission_case_id AND m.patient_id = NEW.patient_id
          AND t.admission_case_id = NEW.admission_case_id AND t.patient_id = NEW.patient_id
          AND t.ward_id = NEW.origin_ward_id AND NEW.from_service_ward_id = m.source_ward_id
          AND NEW.to_service_ward_id = m.destination_ward_id
          AND NEW.routed_by_user_id = m.actor_user_id AND NEW.routed_at = m.moved_at
          AND NEW.task_id = ANY(m.reviewed_task_ids)
    ) THEN
        RAISE EXCEPTION 'nursing_task_route_scope_invalid';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER nursing_task_route_scope BEFORE INSERT ON nursing_task_routes FOR EACH ROW EXECUTE FUNCTION nursing_task_route_scope_fn();
CREATE FUNCTION nursing_task_route_consistent_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.service_ward_id,NEW.assigned_to_user_id,NEW.route_version)
       IS DISTINCT FROM ROW(OLD.service_ward_id,OLD.assigned_to_user_id,OLD.route_version)
       AND NOT EXISTS (
           SELECT 1 FROM nursing_task_routes e
           WHERE e.facility_id = NEW.facility_id AND e.task_id = NEW.id
             AND e.route_version = NEW.route_version AND e.admission_case_id = NEW.admission_case_id
             AND e.patient_id = NEW.patient_id AND e.origin_ward_id = NEW.ward_id
             AND e.from_service_ward_id = OLD.service_ward_id AND e.to_service_ward_id = NEW.service_ward_id
             AND e.from_assigned_to_user_id IS NOT DISTINCT FROM OLD.assigned_to_user_id
             AND e.to_assigned_to_user_id IS NOT DISTINCT FROM NEW.assigned_to_user_id
       ) THEN
        RAISE EXCEPTION 'nursing_task_route_evidence_required';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER nursing_task_route_consistent AFTER UPDATE ON nursing_tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nursing_task_route_consistent_fn();
CREATE FUNCTION admission_move_complete_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT count(*) FROM nursing_task_routes e WHERE e.move_id = NEW.id) <> NEW.routed_task_count
       OR (SELECT count(*) FROM nursing_task_routes e WHERE e.move_id = NEW.id
           AND e.from_assigned_to_user_id IS NOT NULL) <> NEW.cleared_assignee_count
       OR (SELECT count(DISTINCT id) FROM unnest(NEW.reviewed_task_ids) id) <> NEW.routed_task_count
       OR EXISTS (
           SELECT 1 FROM unnest(NEW.reviewed_task_ids) AS reviewed(task_id)
           WHERE NOT EXISTS (SELECT 1 FROM nursing_task_routes e
                             WHERE e.move_id = NEW.id AND e.task_id = reviewed.task_id)
       ) OR EXISTS (
           SELECT 1 FROM nursing_tasks t
           WHERE t.facility_id = NEW.facility_id AND t.admission_case_id = NEW.admission_case_id
             AND t.status = 'open'
             AND (t.patient_id <> NEW.patient_id OR NOT (t.id = ANY(NEW.reviewed_task_ids))
                  OR t.service_ward_id <> NEW.destination_ward_id OR t.assigned_to_user_id IS NOT NULL)
       ) OR NOT EXISTS (
           SELECT 1 FROM admission_placements p
           WHERE p.facility_id = NEW.facility_id AND p.admission_case_id = NEW.admission_case_id
             AND p.patient_id = NEW.patient_id AND p.ward_id = NEW.source_ward_id
             AND p.bed_id = NEW.source_bed_id AND p.placement_revision = NEW.placement_revision - 1
             AND p.ended_at = NEW.moved_at AND p.close_kind = 'move' AND p.closing_move_id = NEW.id
             AND p.id::text = NEW.detail->'source_placement'->>'id'
             AND p.started_at = (NEW.detail->'source_placement'->>'started_at')::timestamptz
             AND p.origin = NEW.detail->'source_placement'->>'origin'
             AND p.legacy_unknown_prefix = (NEW.detail->'source_placement'->>'legacy_unknown_prefix')::boolean
       ) OR NOT EXISTS (
           SELECT 1 FROM admission_placements p
           WHERE p.facility_id = NEW.facility_id AND p.admission_case_id = NEW.admission_case_id
             AND p.patient_id = NEW.patient_id AND p.placement_revision = NEW.placement_revision
             AND p.ward_id = NEW.destination_ward_id AND p.bed_id = NEW.destination_bed_id
             AND p.started_at = NEW.moved_at AND p.opening_move_id = NEW.id
             AND p.id::text = NEW.detail->'destination_placement'->>'id' AND p.origin = 'move'
             AND NOT p.legacy_unknown_prefix
       ) OR NOT EXISTS (
           SELECT 1 FROM admission_cases a
           WHERE a.facility_id = NEW.facility_id AND a.id = NEW.admission_case_id
             AND a.patient_id = NEW.patient_id AND a.ward_id = NEW.destination_ward_id
             AND a.bed_id = NEW.destination_bed_id AND a.placement_revision = NEW.placement_revision
             AND a.status IN ('admitted','discharge_pending')
             AND a.encounter_id IS NOT DISTINCT FROM (NEW.detail->'episode'->>'encounter_id')::uuid
             AND a.visit_id IS NOT DISTINCT FROM (NEW.detail->'episode'->>'visit_id')::uuid
             AND a.admitted_at = (NEW.detail->'episode'->>'admitted_at')::timestamptz
             AND a.status = NEW.detail->'episode'->>'status'
             AND a.placement_history_partial = (NEW.detail->>'placement_history_partial')::boolean
       ) THEN
        RAISE EXCEPTION 'admission_move_evidence_incomplete';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER admission_move_complete AFTER INSERT ON admission_moves DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION admission_move_complete_fn();
CREATE FUNCTION admission_move_command_immutable_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.receipt IS NOT NULL OR NEW.receipt IS NULL OR NEW.result_id IS NULL
       OR (to_jsonb(NEW) - 'receipt' - 'result_id')
          IS DISTINCT FROM (to_jsonb(OLD) - 'receipt' - 'result_id') THEN
        RAISE EXCEPTION 'admission_move_command_immutable';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER admission_move_command_immutable BEFORE UPDATE OR DELETE ON admission_move_commands FOR EACH ROW EXECUTE FUNCTION admission_move_command_immutable_fn();
CREATE FUNCTION admission_move_command_complete_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM admission_move_commands c
        WHERE c.facility_id = NEW.facility_id AND c.request_key_hash = NEW.request_key_hash
          AND (c.receipt IS NULL OR c.result_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM admission_moves m
              WHERE m.facility_id = c.facility_id AND m.id = c.result_id
                AND m.patient_id = c.patient_id AND m.admission_case_id = c.admission_case_id
                AND m.actor_user_id = c.actor_user_id AND m.moved_at = c.recorded_at
                AND jsonb_typeof(c.receipt) = 'object'
                AND c.receipt - ARRAY['client_request_id','replayed','recorded_at','reviewed_input','movement'] = '{}'::jsonb
                AND c.receipt->'movement' = m.detail
                AND c.receipt->'replayed' = 'false'::jsonb
                AND (c.receipt->>'recorded_at')::timestamptz = c.recorded_at
                AND c.receipt->>'client_request_id' IS NOT NULL
                AND (c.receipt->>'client_request_id')::uuid <> '00000000-0000-0000-0000-000000000000'::uuid
                AND c.request_key_hash = sha256(uuid_send((c.receipt->>'client_request_id')::uuid))
                AND jsonb_typeof(c.receipt->'reviewed_input') = 'object'
                AND (c.receipt->'reviewed_input') - ARRAY['client_request_id','expected_placement_token','destination_bed_id','expected_destination_token','expected_task_membership_token','task_policy','reason'] = '{}'::jsonb
                AND c.receipt->'reviewed_input'->>'client_request_id' = c.receipt->>'client_request_id'
                AND c.receipt->'reviewed_input'->>'destination_bed_id' = m.destination_bed_id::text
                AND c.receipt->'reviewed_input'->>'reason' = m.reason
                AND c.receipt->'reviewed_input'->>'task_policy' = 'route_all_clear_assignees'
                AND c.receipt->'reviewed_input'->>'expected_placement_token' ~ '^[0-9a-fA-F]{64}$'
                AND c.receipt->'reviewed_input'->>'expected_destination_token' ~ '^[0-9a-fA-F]{64}$'
                AND c.receipt->'reviewed_input'->>'expected_task_membership_token' ~ '^[0-9a-fA-F]{64}$'
          ))
    ) THEN
        RAISE EXCEPTION 'admission_move_command_incomplete';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER admission_move_command_complete AFTER INSERT ON admission_move_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION admission_move_command_complete_fn();
