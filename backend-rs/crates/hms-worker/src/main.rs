use std::env;
use std::time::Duration;

use anyhow::{bail, Context};
use tracing::{info, warn};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let database_url = env::var("HMS_DATABASE_URL")
        .map_err(|_| anyhow::anyhow!("HMS_DATABASE_URL is required"))?;
    let max_connections = env::var("HMS_WORKER_DATABASE_MAX_CONNECTIONS")
        .ok()
        .as_deref()
        .map(|value| parse_u32(value, "HMS_WORKER_DATABASE_MAX_CONNECTIONS"))
        .transpose()?
        .unwrap_or(2);
    let poll_interval = env::var("HMS_WORKER_POLL_INTERVAL_SECONDS")
        .ok()
        .as_deref()
        .map(|value| parse_u64(value, "HMS_WORKER_POLL_INTERVAL_SECONDS"))
        .transpose()?
        .unwrap_or(30);

    let pool = hms_db::pool::connect_with_max_connections(&database_url, max_connections).await?;
    check_database_ready(&pool).await?;

    info!(
        max_connections,
        poll_interval_seconds = poll_interval,
        "hms-worker started"
    );

    let mut interval = tokio::time::interval(Duration::from_secs(poll_interval));
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                info!("hms-worker shutdown requested");
                break;
            }
            _ = interval.tick() => {
                if let Err(error) = check_database_ready(&pool).await {
                    warn!(%error, "worker database heartbeat failed");
                }
            }
        }
    }

    Ok(())
}

async fn check_database_ready(pool: &hms_db::PgPool) -> anyhow::Result<()> {
    sqlx::query("SELECT 1")
        .fetch_one(pool)
        .await
        .context("worker database readiness check failed")?;
    Ok(())
}

fn init_tracing() {
    hms_observability::init_json_tracing("hms_worker=info");
}

fn parse_u32(value: &str, name: &str) -> anyhow::Result<u32> {
    let parsed = value
        .trim()
        .parse::<u32>()
        .with_context(|| format!("{name} must be an integer"))?;
    if parsed == 0 {
        bail!("{name} must be greater than zero");
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn database_readiness_check_accepts_postgres_select_one() {
        let database =
            hms_db::test_support::TestDatabase::create().expect("test database is available");
        let pool = hms_db::pool::connect_with_max_connections(database.database_url(), 1)
            .await
            .expect("test database connects");

        check_database_ready(&pool)
            .await
            .expect("readiness query should not fail on Postgres integer typing");
    }
}

fn parse_u64(value: &str, name: &str) -> anyhow::Result<u64> {
    let parsed = value
        .trim()
        .parse::<u64>()
        .with_context(|| format!("{name} must be an integer"))?;
    if parsed == 0 {
        bail!("{name} must be greater than zero");
    }
    Ok(parsed)
}
