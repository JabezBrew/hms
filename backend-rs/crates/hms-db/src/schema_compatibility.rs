//! Read-only deployment compatibility metadata. Never returns database identity.
use crate::PgPool;
use sqlx::{migrate::Migrate, Acquire};

pub const TREATMENT_WINDOWS_BREAKING_EPOCH: i64 = 202610170023;

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
    let applied: Option<bool> = if history {
        sqlx::query_scalar("SELECT success FROM public._sqlx_migrations WHERE version=$1")
            .bind(TREATMENT_WINDOWS_BREAKING_EPOCH)
            .fetch_optional(&mut *tx)
            .await?
    } else {
        None
    };
    let epoch = match (applied, layout) {
        (Some(true), true) => TREATMENT_WINDOWS_BREAKING_EPOCH,
        (None, false) => 0,
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    };
    Migrate::unlock(&mut *tx).await?;
    tx.commit().await?;
    Ok(epoch)
}
