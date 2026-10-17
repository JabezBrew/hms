//! Read-only deployment compatibility metadata. Never returns database identity.
use crate::PgPool;
use sqlx::{migrate::Migrate, Acquire};

pub const TREATMENT_WINDOWS_BREAKING_EPOCH: i64 = 202610170023;
/// Earlier runtimes expose protected response bodies and bypass governed writes.
pub const REFERRAL_RESPONSES_BREAKING_EPOCH: i64 = 202610170024;
pub const REQUIRED_RUNTIME_SCHEMA_EPOCH: i64 = REFERRAL_RESPONSES_BREAKING_EPOCH;

/// This once-per-process startup gate is separate from cheap health probes.
pub async fn require_runtime_schema(pool: &PgPool) -> anyhow::Result<()> {
    match tokio::time::timeout(
        std::time::Duration::from_secs(8),
        committed_breaking_epoch(pool),
    )
    .await
    {
        Ok(Ok(epoch)) if epoch == REQUIRED_RUNTIME_SCHEMA_EPOCH => Ok(()),
        _ => anyhow::bail!("Database schema does not meet this runtime's required schema."),
    }
}

/// Only explicitly reviewed breaking migrations advance this epoch. A missing,
/// failed or incoherent migration record must not permit an unsafe rollback.
pub async fn committed_breaking_epoch(pool: &PgPool) -> anyhow::Result<i64> {
    // SQLx uses a session advisory lock. Close the dedicated connection on every
    // path, including cancellation, so no lock can escape back into the pool.
    let mut connection = pool.acquire().await?;
    connection.close_on_drop();
    let mut tx = connection.begin().await?;
    sqlx::query("SET TRANSACTION READ ONLY")
        .execute(&mut *tx)
        .await?;
    sqlx::query("SET LOCAL statement_timeout='3000ms'")
        .execute(&mut *tx)
        .await?;
    sqlx::query("SET LOCAL lock_timeout='1000ms'")
        .execute(&mut *tx)
        .await?;
    sqlx::query("SET LOCAL idle_in_transaction_session_timeout='5000ms'")
        .execute(&mut *tx)
        .await?;
    Migrate::lock(&mut *tx).await?;
    let (history, layout): (bool, bool) = sqlx::query_as("SELECT to_regclass('public._sqlx_migrations') IS NOT NULL,to_regclass('public.medication_course_stops') IS NOT NULL")
        .fetch_one(&mut *tx).await?;
    let applied: Option<(bool, Vec<u8>)> = if history {
        sqlx::query_as("SELECT success,checksum FROM public._sqlx_migrations WHERE version=$1")
            .bind(TREATMENT_WINDOWS_BREAKING_EPOCH)
            .fetch_optional(&mut *tx)
            .await?
    } else {
        None
    };
    let treatment_epoch = match (applied, layout) {
        (Some((true, checksum)), true)
            if committed_checksum(TREATMENT_WINDOWS_BREAKING_EPOCH, &checksum) =>
        {
            TREATMENT_WINDOWS_BREAKING_EPOCH
        }
        (None, false) => 0,
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    };
    let (any_referral_layout, complete_referral_layout): (bool, bool) = sqlx::query_as(
        r#"
        WITH layout AS (
          SELECT to_regclass('public.referral_response_revisions') AS revisions,
                 to_regclass('public.referral_response_commands') AS commands,
                 to_regclass('public.referrals') AS root
        ), checks AS (
          SELECT revisions IS NOT NULL AS revision_table,
                 commands IS NOT NULL AS command_table,
                 EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=root
                   AND attname='response_version' AND NOT attisdropped) AS root_column,
                 EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=root
                   AND attname='response_version' AND atttypid='int8'::regtype
                   AND attnotnull AND NOT attisdropped) AS typed_root_column,
                 NOT EXISTS(SELECT 1 FROM unnest(ARRAY[
                   'id','facility_id','referral_id','patient_id','version','operation','status',
                   'to_service','priority','specialist_notes','recommendations','amendment_reason',
                   'completed_at','recorded_by_user_id','recorded_by_display_name',
                   'recorded_at','imported_legacy']) required(name)
                   WHERE NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=revisions
                     AND attname=required.name AND NOT attisdropped)) AS revision_columns,
                 NOT EXISTS(SELECT 1 FROM unnest(ARRAY[
                   'facility_id','request_key_hash','patient_id','referral_id','actor_user_id',
                   'operation','payload_digest','result_id','receipt','recorded_at']) required(name)
                   WHERE NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=commands
                     AND attname=required.name AND NOT attisdropped)) AS command_columns,
                 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=revisions
                   AND tgname='referral_response_revision_immutable' AND tgenabled IN ('O','A')) AS revision_immutable,
                 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=revisions
                   AND tgname='referral_response_revision_scope' AND tgenabled IN ('O','A')) AS revision_scope,
                 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=commands
                   AND tgname='referral_response_command_immutable' AND tgenabled IN ('O','A')) AS command_immutable,
                 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=commands
                   AND tgname='referral_response_command_complete' AND tgenabled IN ('O','A')
                   AND tgdeferrable AND tginitdeferred) AS command_complete,
                 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=root
                   AND tgname='referral_response_root_identity_immutable' AND tgenabled IN ('O','A')) AS root_identity,
                 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=root
                   AND tgname='referral_response_import_observation' AND tgenabled IN ('O','A')) AS import_observation,
                 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=root
                   AND tgname='referral_response_root_consistent' AND tgenabled IN ('O','A')
                   AND tgdeferrable AND tginitdeferred) AS root_consistent
          FROM layout
        )
        SELECT revision_table OR command_table OR root_column OR root_identity,
               revision_table AND command_table AND typed_root_column AND revision_columns
               AND command_columns AND revision_immutable AND revision_scope
               AND command_immutable AND command_complete AND root_identity
               AND import_observation AND root_consistent
        FROM checks
        "#,
    )
    .fetch_one(&mut *tx)
    .await?;
    let referral_migration: Option<(bool, Vec<u8>)> = if history {
        sqlx::query_as("SELECT success,checksum FROM public._sqlx_migrations WHERE version=$1")
            .bind(REFERRAL_RESPONSES_BREAKING_EPOCH)
            .fetch_optional(&mut *tx)
            .await?
    } else {
        None
    };
    let epoch = match (
        referral_migration,
        any_referral_layout,
        complete_referral_layout,
    ) {
        (None, false, false) => treatment_epoch,
        (Some((true, checksum)), true, true)
            if treatment_epoch == TREATMENT_WINDOWS_BREAKING_EPOCH
                && committed_checksum(REFERRAL_RESPONSES_BREAKING_EPOCH, &checksum) =>
        {
            REFERRAL_RESPONSES_BREAKING_EPOCH
        }
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    };
    Migrate::unlock(&mut *tx).await?;
    tx.commit().await?;
    Ok(epoch)
}

fn committed_checksum(version: i64, actual: &[u8]) -> bool {
    crate::migrate::MIGRATOR
        .iter()
        .find(|migration| migration.version == version)
        .is_some_and(|migration| migration.checksum.as_ref() == actual)
}
