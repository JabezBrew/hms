//! Consultation identity and command evidence must survive runtime replacement.
use super::{
    committed_checksum, ADMISSION_MOVES_BREAKING_EPOCH, REFERRAL_CONSULTATIONS_BREAKING_EPOCH,
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
          SELECT to_regclass('public.referral_consultation_starts') AS starts,
                 to_regclass('public.referral_consultation_start_commands') AS commands,
                 to_regclass('public.encounters') AS encounters,
                 to_regclass('public.admission_cases') AS cases
        ), required_columns AS (
          SELECT starts AS relation, name, kind::regtype AS kind, required FROM relations,
            (VALUES ('id','uuid',true),('facility_id','uuid',true),
                    ('patient_id','uuid',true),('referral_id','uuid',true),
                    ('encounter_id','uuid',true),('visit_id','uuid',false),
                    ('admission_case_id','uuid',false),('actor_user_id','uuid',true),
                    ('practitioner_profile_id','uuid',true),('source_mode','text',true),
                    ('recorded_at','timestamptz',true),('detail','jsonb',true)) col(name,kind,required)
          UNION ALL
          SELECT commands,name,kind::regtype,required FROM relations,
            (VALUES ('facility_id','uuid',true),('request_key_hash','bytea',true),
                    ('patient_id','uuid',true),('referral_id','uuid',true),
                    ('actor_user_id','uuid',true),('payload_digest','bytea',true),
                    ('result_id','uuid',false),('receipt','jsonb',false),
                    ('recorded_at','timestamptz',true)) col(name,kind,required)
        ), required_triggers AS (
          SELECT starts AS relation,name,deferred FROM relations,
            (VALUES ('referral_consultation_start_scope',false),
                    ('referral_consultation_start_immutable',false),
                    ('referral_consultation_start_complete',true)) guard(name,deferred)
          UNION ALL
          SELECT commands,name,deferred FROM relations,
            (VALUES ('referral_consultation_command_immutable',false),
                    ('referral_consultation_command_complete',true)) guard(name,deferred)
          UNION ALL SELECT encounters,'encounter_care_identity',false FROM relations
          UNION ALL SELECT cases,'admission_encounter_binding',false FROM relations
        ), required_indexes AS (
          SELECT starts AS relation,'referral_consultation_starts_pkey' AS name,
                 true AS is_unique,ARRAY['id']::text[] AS keys FROM relations
          UNION ALL SELECT starts,'referral_consultation_starts_facility_id_id_key',true,
            ARRAY['facility_id','id'] FROM relations
          UNION ALL SELECT starts,'referral_consultation_starts_facility_id_referral_id_key',true,
            ARRAY['facility_id','referral_id'] FROM relations
          UNION ALL SELECT starts,'referral_consultation_encounter_idx',false,
            ARRAY['facility_id','encounter_id'] FROM relations
          UNION ALL SELECT starts,'referral_consultation_patient_actor_idx',false,
            ARRAY['facility_id','patient_id','actor_user_id'] FROM relations
          UNION ALL SELECT commands,'referral_consultation_start_commands_pkey',true,
            ARRAY['facility_id','request_key_hash'] FROM relations
          UNION ALL SELECT commands,'referral_consultation_start_commands_facility_id_result_id_key',true,
            ARRAY['facility_id','result_id'] FROM relations
        )
        SELECT starts IS NOT NULL OR commands IS NOT NULL
                 OR EXISTS(SELECT 1 FROM required_triggers r JOIN pg_trigger g
                   ON g.tgrelid=r.relation AND g.tgname=r.name),
               starts IS NOT NULL AND commands IS NOT NULL
                 AND NOT EXISTS(SELECT 1 FROM required_columns r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.relation
                     AND a.attname=r.name AND a.atttypid=r.kind
                     AND a.attnotnull=r.required AND NOT a.attisdropped))
                 AND NOT EXISTS(SELECT 1 FROM required_triggers r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_trigger g WHERE g.tgrelid=r.relation
                     AND g.tgname=r.name AND g.tgenabled IN ('O','A')
                     AND g.tgdeferrable=r.deferred AND g.tginitdeferred=r.deferred))
                 AND NOT EXISTS(SELECT 1 FROM required_indexes r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
                   WHERE i.indrelid=r.relation AND c.relname=r.name
                     AND i.indisvalid AND i.indisready AND i.indisunique=r.is_unique
                     AND i.indpred IS NULL
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
            .bind(REFERRAL_CONSULTATIONS_BREAKING_EPOCH)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };
    match (applied, any_layout, complete_layout) {
        (None, false, false) => Ok(previous_epoch),
        (Some((true, checksum)), true, true)
            if previous_epoch == ADMISSION_MOVES_BREAKING_EPOCH
                && committed_checksum(REFERRAL_CONSULTATIONS_BREAKING_EPOCH, &checksum) =>
        {
            Ok(REFERRAL_CONSULTATIONS_BREAKING_EPOCH)
        }
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    }
}
