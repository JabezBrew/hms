//! Placement/routing metadata must agree before a runtime can start or roll back.
use super::{
    committed_checksum, ADMISSION_MOVES_BREAKING_EPOCH, REFERRAL_RESPONSES_BREAKING_EPOCH,
};
use sqlx::{Postgres, Transaction};

pub(super) async fn committed_epoch(
    tx: &mut Transaction<'_, Postgres>,
    migration_history_exists: bool,
    previous_epoch: i64,
) -> anyhow::Result<i64> {
    let (any_layout, complete_layout): (bool, bool) = sqlx::query_as(
        r#"
        WITH relations AS (
          SELECT to_regclass('public.admission_cases') AS cases,
                 to_regclass('public.nursing_tasks') AS tasks,
                 to_regclass('public.admission_placements') AS placements,
                 to_regclass('public.admission_moves') AS moves,
                 to_regclass('public.admission_move_commands') AS commands,
                 to_regclass('public.nursing_task_routes') AS routes
        ), required_columns AS (
          SELECT cases AS relation, name FROM relations,
            unnest(ARRAY['placement_revision','placement_history_partial','placement_known_from']) name
          UNION ALL
          SELECT tasks, name FROM relations,
            unnest(ARRAY['service_ward_id','route_version']) name
          UNION ALL
          SELECT placements, name FROM relations,
            unnest(ARRAY['id','facility_id','admission_case_id','patient_id','ward_id','bed_id',
              'placement_revision','started_at','ended_at','origin','legacy_unknown_prefix',
              'opening_move_id','closing_move_id','closing_discharge_case_id','close_kind']) name
          UNION ALL
          SELECT moves, name FROM relations,
            unnest(ARRAY['id','facility_id','admission_case_id','patient_id','placement_revision',
              'actor_user_id','actor_display_name','moved_at','source_ward_id','source_bed_id',
              'destination_ward_id','destination_bed_id','reason',
              'source_cleaning_minutes','source_cleaning_due_at',
              'routed_task_count','cleared_assignee_count','reviewed_task_ids','detail']) name
          UNION ALL
          SELECT commands, name FROM relations,
            unnest(ARRAY['facility_id','request_key_hash','actor_user_id','patient_id',
              'admission_case_id','payload_digest','result_id','receipt','recorded_at']) name
          UNION ALL
          SELECT routes, name FROM relations,
            unnest(ARRAY['id','facility_id','task_id','admission_case_id','patient_id','move_id',
              'route_version','origin_ward_id','from_service_ward_id','to_service_ward_id',
              'from_assigned_to_user_id','to_assigned_to_user_id',
              'routed_by_user_id','routed_at']) name
        ), required_types AS (
          SELECT cases AS relation, 'placement_revision' AS name, 'int8'::regtype AS kind,
                 true AS required FROM relations
          UNION ALL SELECT cases,'placement_history_partial','bool'::regtype,true FROM relations
          UNION ALL SELECT cases,'placement_known_from','timestamptz'::regtype,false FROM relations
          UNION ALL SELECT tasks,'service_ward_id','uuid'::regtype,true FROM relations
          UNION ALL SELECT tasks,'route_version','int8'::regtype,true FROM relations
          UNION ALL SELECT moves,'reviewed_task_ids','uuid[]'::regtype,true FROM relations
          UNION ALL SELECT moves,'actor_display_name','text'::regtype,true FROM relations
          UNION ALL SELECT moves,'source_cleaning_minutes','int4'::regtype,true FROM relations
          UNION ALL SELECT moves,'source_cleaning_due_at','timestamptz'::regtype,true FROM relations
          UNION ALL SELECT moves,'detail','jsonb'::regtype,true FROM relations
          UNION ALL SELECT commands,'request_key_hash','bytea'::regtype,true FROM relations
          UNION ALL SELECT commands,'payload_digest','bytea'::regtype,true FROM relations
          UNION ALL SELECT commands,'recorded_at','timestamptz'::regtype,true FROM relations
          UNION ALL SELECT commands,'result_id','uuid'::regtype,false FROM relations
          UNION ALL SELECT commands,'receipt','jsonb'::regtype,false FROM relations
        ), required_triggers AS (
          SELECT cases AS relation, name, deferred FROM relations,
            (VALUES ('admission_placement_root_guard',false),
                    ('admission_placement_import_observation',false),
                    ('admission_placement_consistent',true)) guard(name,deferred)
          UNION ALL
          SELECT placements,name,false FROM relations,
            unnest(ARRAY['admission_placement_interval_scope',
                         'admission_placement_interval_guard']) name
          UNION ALL
          SELECT moves,name,deferred FROM relations,
            (VALUES ('admission_move_immutable',false),('admission_move_scope',false),
                    ('admission_move_complete',true)) guard(name,deferred)
          UNION ALL
          SELECT commands,name,deferred FROM relations,
            (VALUES ('admission_move_command_immutable',false),
                    ('admission_move_command_complete',true)) guard(name,deferred)
          UNION ALL
          SELECT tasks,name,deferred FROM relations,
            (VALUES ('nursing_task_route_initialize',false),('nursing_task_route_identity',false),
                    ('nursing_task_route_consistent',true)) guard(name,deferred)
          UNION ALL
          SELECT routes,name,false FROM relations,
            unnest(ARRAY['nursing_task_route_immutable','nursing_task_route_scope']) name
        ), required_indexes AS (
          SELECT cases AS relation, 'admission_move_current_bed_owner_idx' AS name,
                 true AS is_unique, true AS is_partial,
                 ARRAY['facility_id','bed_id']::text[] AS keys FROM relations
          UNION ALL SELECT placements,'admission_placements_case_revision_key',true,false,
            ARRAY['admission_case_id','placement_revision'] FROM relations
          UNION ALL SELECT placements,'admission_placements_one_open_case_idx',true,true,
            ARRAY['facility_id','admission_case_id'] FROM relations
          UNION ALL SELECT placements,'admission_placements_one_open_bed_idx',true,true,
            ARRAY['facility_id','bed_id'] FROM relations
          UNION ALL SELECT moves,'admission_moves_case_revision_key',true,false,
            ARRAY['admission_case_id','placement_revision'] FROM relations
          UNION ALL SELECT moves,'admission_moves_history_idx',false,false,
            ARRAY['facility_id','admission_case_id','placement_revision'] FROM relations
          UNION ALL SELECT routes,'nursing_task_routes_task_version_key',true,false,
            ARRAY['task_id','route_version'] FROM relations
          UNION ALL SELECT routes,'nursing_task_routes_move_task_key',true,false,
            ARRAY['move_id','task_id'] FROM relations
          UNION ALL SELECT tasks,'nursing_tasks_service_due_idx',false,false,
            ARRAY['facility_id','service_ward_id','status','due_at','id'] FROM relations
          UNION ALL SELECT tasks,'nursing_tasks_open_case_route_idx',false,false,
            ARRAY['facility_id','admission_case_id','status','id'] FROM relations
        )
        SELECT placements IS NOT NULL OR moves IS NOT NULL OR commands IS NOT NULL
                 OR routes IS NOT NULL OR EXISTS(
                   SELECT 1 FROM pg_attribute a WHERE a.attrelid=cases
                     AND a.attname='placement_revision' AND NOT a.attisdropped)
                 OR EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=tasks
                     AND a.attname='service_ward_id' AND NOT a.attisdropped),
               placements IS NOT NULL AND moves IS NOT NULL AND commands IS NOT NULL
                 AND routes IS NOT NULL
                 AND NOT EXISTS(SELECT 1 FROM required_columns r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.relation
                     AND a.attname=r.name AND NOT a.attisdropped))
                 AND NOT EXISTS(SELECT 1 FROM required_types r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.relation
                     AND a.attname=r.name AND a.atttypid=r.kind AND NOT a.attisdropped
                     AND (NOT r.required OR a.attnotnull)))
                 AND NOT EXISTS(SELECT 1 FROM required_triggers r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_trigger g WHERE g.tgrelid=r.relation
                     AND g.tgname=r.name AND g.tgenabled IN ('O','A')
                     AND (NOT r.deferred OR (g.tgdeferrable AND g.tginitdeferred))))
                 AND NOT EXISTS(SELECT 1 FROM required_indexes r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
                   WHERE i.indrelid=r.relation AND c.relname=r.name
                     AND i.indisvalid AND i.indisready
                     AND i.indisunique=r.is_unique
                     AND (i.indpred IS NOT NULL)=r.is_partial
                     AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality)
                       FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ordinality)
                       JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
                       WHERE k.ordinality<=i.indnkeyatts)=r.keys))
        FROM relations
        "#,
    )
    .fetch_one(&mut **tx)
    .await?;
    let applied: Option<(bool, Vec<u8>)> = if migration_history_exists {
        sqlx::query_as("SELECT success,checksum FROM public._sqlx_migrations WHERE version=$1")
            .bind(ADMISSION_MOVES_BREAKING_EPOCH)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };
    match (applied, any_layout, complete_layout) {
        (None, false, false) => Ok(previous_epoch),
        (Some((true, checksum)), true, true)
            if previous_epoch == REFERRAL_RESPONSES_BREAKING_EPOCH
                && committed_checksum(ADMISSION_MOVES_BREAKING_EPOCH, &checksum) =>
        {
            Ok(ADMISSION_MOVES_BREAKING_EPOCH)
        }
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    }
}
