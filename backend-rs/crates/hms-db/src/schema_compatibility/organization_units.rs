//! Governed organization maintenance requires its complete retained layout.
use super::{
    committed_checksum, ORGANIZATION_UNITS_BREAKING_EPOCH, REFERRAL_CONSULTATIONS_BREAKING_EPOCH,
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
          SELECT to_regclass('public.organization_units') AS units,
                 to_regclass('public.organization_unit_commands') AS commands,
                 to_regclass('public.positions') AS positions,
                 to_regclass('public.permission_assignments') AS permissions
        ), required_columns AS (
          SELECT units AS relation,'version' AS name,'int8'::regtype AS kind,
                 true AS required FROM relations
          UNION ALL SELECT commands,name,kind::regtype,true FROM relations,
            (VALUES ('facility_id','uuid'),('request_key_hash','bytea'),
                    ('actor_user_id','uuid'),('unit_id','uuid'),('action','text'),
                    ('payload_digest','bytea'),('receipt','jsonb'),
                    ('recorded_at','timestamptz')) col(name,kind)
        ), required_triggers AS (
          SELECT units AS relation,'organization_unit_identity_lifecycle' AS name,
                 'public.organization_unit_identity_lifecycle_guard()' AS guard_function,
                 31 AS kind FROM relations
          UNION ALL SELECT positions,'organization_position_unit_reference',
            'public.organization_unit_reference_guard()',23 FROM relations
          UNION ALL SELECT permissions,'organization_permission_unit_reference',
            'public.organization_unit_reference_guard()',23 FROM relations
          UNION ALL SELECT commands,'organization_unit_command_immutable',
            'public.organization_unit_command_immutable_guard()',31 FROM relations
        ), required_indexes AS (
          SELECT commands AS relation,'organization_unit_commands_pkey' AS name,
                 true AS is_unique,ARRAY['facility_id','request_key_hash']::text[] AS keys,
                 NULL::text AS predicate FROM relations
          UNION ALL SELECT commands,'organization_unit_commands_unit_idx',false,
            ARRAY['facility_id','unit_id','recorded_at'],NULL::text FROM relations
          UNION ALL SELECT units,'organization_units_facility_parent_idx',false,
            ARRAY['facility_id','parent_unit_id'],NULL::text FROM relations
          UNION ALL SELECT positions,'positions_facility_unit_idx',false,
            ARRAY['facility_id','org_unit_id'],NULL::text FROM relations
          UNION ALL SELECT units,'organization_children_reference_idx',false,
            ARRAY['parent_unit_id'],'(parent_unit_id IS NOT NULL)' FROM relations
          UNION ALL SELECT positions,'organization_positions_reference_idx',false,
            ARRAY['org_unit_id'],NULL::text FROM relations
          UNION ALL SELECT permissions,'organization_permission_scope_reference_idx',false,
            ARRAY['scope_id','facility_id'],
            '(scope_type = ''organization_unit''::text)' FROM relations
        )
        SELECT commands IS NOT NULL
                 OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=units
                   AND attname='version' AND NOT attisdropped)
                 OR EXISTS(SELECT 1 FROM required_triggers r JOIN pg_trigger g
                   ON g.tgrelid=r.relation AND g.tgname=r.name),
               units IS NOT NULL AND commands IS NOT NULL
                 AND NOT EXISTS(SELECT 1 FROM required_columns r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.relation
                     AND a.attname=r.name AND a.atttypid=r.kind
                     AND a.attnotnull=r.required AND NOT a.attisdropped))
                 AND NOT EXISTS(SELECT 1 FROM required_triggers r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_trigger g WHERE g.tgrelid=r.relation
                     AND g.tgname=r.name AND g.tgenabled IN ('O','A')
                     AND g.tgtype=r.kind AND NOT g.tgdeferrable
                     AND NOT g.tginitdeferred
                     AND g.tgfoid=to_regprocedure(r.guard_function)))
                 AND NOT EXISTS(SELECT 1 FROM required_indexes r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
                   WHERE i.indrelid=r.relation AND c.relname=r.name
                     AND i.indisvalid AND i.indisready AND i.indisunique=r.is_unique
                     AND pg_get_expr(i.indpred,i.indrelid) IS NOT DISTINCT FROM r.predicate
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
            .bind(ORGANIZATION_UNITS_BREAKING_EPOCH)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };
    match (applied, any_layout, complete_layout) {
        (None, false, false) => Ok(previous_epoch),
        (Some((true, checksum)), true, true)
            if previous_epoch == REFERRAL_CONSULTATIONS_BREAKING_EPOCH
                && committed_checksum(ORGANIZATION_UNITS_BREAKING_EPOCH, &checksum) =>
        {
            Ok(ORGANIZATION_UNITS_BREAKING_EPOCH)
        }
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    }
}
