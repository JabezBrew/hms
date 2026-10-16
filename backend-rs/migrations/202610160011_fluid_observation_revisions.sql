-- Original paired values and recording evidence remain in their original rows.
ALTER TABLE fluid_balance_entries
    ADD COLUMN root_entry_id uuid,
    ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
    ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object');
CREATE TABLE fluid_observation_roots (
    id uuid PRIMARY KEY REFERENCES fluid_balance_entries(id) ON DELETE CASCADE,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    current_entry_id uuid REFERENCES fluid_balance_entries(id) ON DELETE SET NULL,
    revision bigint NOT NULL CHECK(revision>0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    recorded_at timestamptz,
    intake_ml integer NOT NULL DEFAULT 0 CHECK(intake_ml>=0),
    output_ml integer NOT NULL DEFAULT 0 CHECK(output_ml>=0),
    UNIQUE(facility_id,id)
);
ALTER TABLE fluid_balance_entries ADD CONSTRAINT fluid_entry_root_fk
    FOREIGN KEY(root_entry_id) REFERENCES fluid_observation_roots(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX fluid_entry_revision_idx ON fluid_balance_entries(facility_id,root_entry_id,revision) WHERE root_entry_id IS NOT NULL;
CREATE INDEX fluid_entry_root_history_idx ON fluid_balance_entries(facility_id,root_entry_id,created_at DESC,id DESC);
CREATE INDEX fluid_roots_current_idx ON fluid_observation_roots(facility_id,current_entry_id) WHERE current_entry_id IS NOT NULL;
CREATE INDEX fluid_roots_admission_activity_idx ON fluid_observation_roots(facility_id,admission_case_id,updated_at DESC,id DESC);
CREATE TABLE fluid_observation_actions (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    root_entry_id uuid NOT NULL REFERENCES fluid_observation_roots(id) ON DELETE CASCADE,
    entry_id uuid NOT NULL UNIQUE REFERENCES fluid_balance_entries(id) ON DELETE CASCADE,
    replacement_entry_id uuid REFERENCES fluid_balance_entries(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK(kind IN ('corrected','voided')),
    reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
    actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK((kind='corrected')=(replacement_entry_id IS NOT NULL))
);
CREATE INDEX fluid_actions_root_idx ON fluid_observation_actions(facility_id,root_entry_id,recorded_at DESC,id DESC);
CREATE TABLE fluid_write_commands (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    client_request_id uuid NOT NULL,
    actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    kind text NOT NULL,
    digest bytea NOT NULL,
    result_id uuid,
    result_entry_id uuid,
    result_version bigint,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(facility_id,client_request_id)
);
CREATE TABLE fluid_effective_daily_totals (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    date date NOT NULL,
    entry_count bigint NOT NULL CHECK(entry_count>=0),
    intake_ml bigint NOT NULL CHECK(intake_ml>=0),
    output_ml bigint NOT NULL CHECK(output_ml>=0),
    PRIMARY KEY(facility_id,admission_case_id,date)
);
CREATE INDEX fluid_daily_patient_idx ON fluid_effective_daily_totals(facility_id,patient_id,date,admission_case_id);
CREATE TABLE fluid_rule_settings (
    facility_id uuid PRIMARY KEY REFERENCES facilities(id) ON DELETE RESTRICT,
    version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
    values jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz,
    updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE fluid_rule_versions (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    version bigint NOT NULL CHECK(version>0),
    values jsonb NOT NULL,
    reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
    actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(facility_id,version)
);
INSERT INTO fluid_observation_roots(id,facility_id,patient_id,admission_case_id,current_entry_id,revision,recorded_at,intake_ml,output_ml,updated_at)
SELECT e.id,e.facility_id,e.patient_id,e.admission_case_id,e.id,1,e.recorded_at,e.intake_ml,e.output_ml,e.created_at FROM fluid_balance_entries e
JOIN patients p ON p.id=e.patient_id AND p.facility_id=e.facility_id
JOIN admission_cases a ON a.id=e.admission_case_id AND a.facility_id=e.facility_id AND a.patient_id=e.patient_id;
INSERT INTO fluid_effective_daily_totals(facility_id,patient_id,admission_case_id,date,entry_count,intake_ml,output_ml)
SELECT facility_id,patient_id,admission_case_id,(recorded_at AT TIME ZONE 'UTC')::date,count(*),sum(intake_ml)::bigint,sum(output_ml)::bigint
FROM fluid_observation_roots GROUP BY facility_id,patient_id,admission_case_id,(recorded_at AT TIME ZONE 'UTC')::date;

-- Projection maintenance also covers old API/import/demo insertion paths. New
-- correction operations append rows and change only the root's current pointer.
CREATE FUNCTION fluid_root_project_daily() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_day date; new_day date; scope_facility uuid; scope_patient uuid; scope_admission uuid; bucket date;
BEGIN
    IF TG_OP<>'INSERT' THEN
        scope_facility:=OLD.facility_id; scope_patient:=OLD.patient_id; scope_admission:=OLD.admission_case_id;
        IF OLD.current_entry_id IS NOT NULL THEN old_day:=(OLD.recorded_at AT TIME ZONE 'UTC')::date; END IF;
    END IF;
    IF TG_OP<>'DELETE' THEN
        scope_facility:=NEW.facility_id; scope_patient:=NEW.patient_id; scope_admission:=NEW.admission_case_id;
        IF NEW.current_entry_id IS NOT NULL THEN new_day:=(NEW.recorded_at AT TIME ZONE 'UTC')::date; END IF;
    END IF;
    IF TG_OP='UPDATE' AND OLD.current_entry_id IS NOT DISTINCT FROM NEW.current_entry_id
        AND OLD.recorded_at IS NOT DISTINCT FROM NEW.recorded_at AND OLD.intake_ml=NEW.intake_ml AND OLD.output_ml=NEW.output_ml THEN RETURN NEW; END IF;
    IF TG_OP='DELETE' THEN
        IF old_day IS NOT NULL THEN
            UPDATE fluid_effective_daily_totals SET entry_count=entry_count-1,intake_ml=intake_ml-OLD.intake_ml,output_ml=output_ml-OLD.output_ml
            WHERE facility_id=scope_facility AND admission_case_id=scope_admission AND date=old_day;
        END IF;
        RETURN OLD;
    END IF;
    -- A correction can move days. Always acquire their counters in date order.
    FOR bucket IN SELECT DISTINCT d FROM unnest(ARRAY[old_day,new_day]) d WHERE d IS NOT NULL ORDER BY d LOOP
        INSERT INTO fluid_effective_daily_totals(facility_id,patient_id,admission_case_id,date,entry_count,intake_ml,output_ml)
        VALUES(scope_facility,scope_patient,scope_admission,bucket,0,0,0) ON CONFLICT DO NOTHING;
    END LOOP;
    PERFORM 1 FROM fluid_effective_daily_totals WHERE facility_id=scope_facility AND admission_case_id=scope_admission AND date=ANY(ARRAY[old_day,new_day]) ORDER BY date FOR UPDATE;
    IF old_day IS NOT NULL THEN UPDATE fluid_effective_daily_totals SET entry_count=entry_count-1,intake_ml=intake_ml-OLD.intake_ml,output_ml=output_ml-OLD.output_ml WHERE facility_id=scope_facility AND admission_case_id=scope_admission AND date=old_day; END IF;
    IF new_day IS NOT NULL THEN UPDATE fluid_effective_daily_totals SET entry_count=entry_count+1,intake_ml=intake_ml+NEW.intake_ml,output_ml=output_ml+NEW.output_ml WHERE facility_id=scope_facility AND admission_case_id=scope_admission AND date=new_day; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER fluid_root_daily_projection AFTER INSERT OR UPDATE OR DELETE ON fluid_observation_roots FOR EACH ROW EXECUTE FUNCTION fluid_root_project_daily();
CREATE FUNCTION fluid_entry_projection_compatibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        IF NOT EXISTS(SELECT 1 FROM admission_cases a JOIN patients p ON p.id=a.patient_id AND p.facility_id=a.facility_id WHERE a.id=NEW.admission_case_id AND a.facility_id=NEW.facility_id AND a.patient_id=NEW.patient_id) THEN RAISE EXCEPTION 'fluid observation scope mismatch'; END IF;
        IF NEW.root_entry_id IS NULL THEN
            INSERT INTO fluid_observation_roots(id,facility_id,patient_id,admission_case_id,current_entry_id,revision,recorded_at,intake_ml,output_ml)
            VALUES(NEW.id,NEW.facility_id,NEW.patient_id,NEW.admission_case_id,NEW.id,1,NEW.recorded_at,NEW.intake_ml,NEW.output_ml);
        END IF;
        RETURN NEW;
    ELSIF TG_OP='UPDATE' THEN
        UPDATE fluid_observation_roots SET updated_at=clock_timestamp(),recorded_at=NEW.recorded_at,intake_ml=NEW.intake_ml,output_ml=NEW.output_ml
        WHERE facility_id=NEW.facility_id AND current_entry_id=NEW.id;
        RETURN NEW;
    ELSE
        DELETE FROM fluid_observation_roots WHERE facility_id=OLD.facility_id AND id=COALESCE(OLD.root_entry_id,OLD.id) AND current_entry_id IS NULL;
        RETURN OLD;
    END IF;
END $$;
CREATE TRIGGER fluid_entry_projection_insert_update AFTER INSERT OR UPDATE ON fluid_balance_entries FOR EACH ROW EXECUTE FUNCTION fluid_entry_projection_compatibility();
CREATE TRIGGER fluid_entry_projection_delete AFTER DELETE ON fluid_balance_entries FOR EACH ROW EXECUTE FUNCTION fluid_entry_projection_compatibility();

-- This projection joins one indexed daily counter per admission. It never scans
-- historical observations and is evaluated before board filtering/pagination.
CREATE VIEW fluid_admission_monitoring AS
WITH assessed AS (
 SELECT activity.updated_at AS last_activity_at,a.facility_id,a.id AS admission_case_id,COALESCE(d.entry_count,0) AS entry_count,
 s.version,
 COALESCE((s.values->>'enable_intake_alerts')::boolean,false) AS intake_enabled,
 COALESCE((s.values->>'enable_output_alerts')::boolean,false) AS output_enabled,
 COALESCE((s.values->>'enable_balance_alerts')::boolean,false) AS balance_enabled,
 COALESCE(d.intake_ml,0) AS intake_ml,COALESCE(d.output_ml,0) AS output_ml,
 COALESCE((s.values->>'min_daily_intake_target')::integer,1500) AS intake_target,
 COALESCE((s.values->>'max_daily_output_threshold')::integer,3000) AS output_threshold,
 COALESCE((s.values->>'negative_balance_alert_threshold')::integer,-500) AS negative_threshold,
 COALESCE((s.values->>'positive_balance_alert_threshold')::integer,2000) AS positive_threshold
 FROM admission_cases a
 LEFT JOIN LATERAL (SELECT r.updated_at FROM fluid_observation_roots r WHERE r.facility_id=a.facility_id AND r.admission_case_id=a.id ORDER BY r.updated_at DESC,r.id DESC LIMIT 1) activity ON true
 LEFT JOIN fluid_effective_daily_totals d ON d.facility_id=a.facility_id AND d.admission_case_id=a.id AND d.patient_id=a.patient_id AND d.date=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
 LEFT JOIN fluid_rule_settings s ON s.facility_id=a.facility_id AND s.version>0
), flags AS (
 SELECT *,version IS NOT NULL AND entry_count>0 AS assessable,
 intake_enabled AND intake_ml<intake_target AS low_intake,
 output_enabled AND output_ml>output_threshold AS high_output,
 balance_enabled AND intake_ml-output_ml<negative_threshold AS negative_balance,
 balance_enabled AND intake_ml-output_ml>positive_threshold AS positive_balance FROM assessed
)
SELECT facility_id,admission_case_id,last_activity_at,
 CASE WHEN NOT assessable THEN 0 ELSE low_intake::int+high_output::int+negative_balance::int+positive_balance::int END::bigint AS condition_count,
 CASE WHEN assessable AND negative_balance THEN 1 ELSE 0 END::bigint AS critical_count,
 CASE WHEN version IS NULL THEN 'unconfigured' WHEN NOT(intake_enabled OR output_enabled OR balance_enabled) THEN 'disabled' WHEN entry_count=0 THEN 'no_data' ELSE 'assessed' END::text AS assessment_status
FROM flags;
