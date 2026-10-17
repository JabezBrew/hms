use std::env;
use std::net::SocketAddr;
use std::time::Duration;

use anyhow::{bail, Context};
use axum::extract::State;
use axum::http::header::CONTENT_TYPE;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use hms_db::dashboard::{DashboardProjectionJobClaim, DashboardProjectionRefreshFailure};
use sqlx::Row;
use tokio::net::TcpListener;
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
    let job_batch_size = env::var("HMS_WORKER_JOB_BATCH_SIZE")
        .ok()
        .as_deref()
        .map(|value| parse_usize(value, "HMS_WORKER_JOB_BATCH_SIZE"))
        .transpose()?
        .unwrap_or(5);
    let metrics_addr = env::var("HMS_WORKER_METRICS_LISTEN_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8081".to_owned())
        .parse::<SocketAddr>()
        .context("HMS_WORKER_METRICS_LISTEN_ADDR must be a socket address")?;

    let pool = hms_db::pool::connect_with_max_connections(&database_url, max_connections).await?;
    let worker_id = worker_id();
    refresh_worker_metrics(&pool).await?;
    spawn_metrics_server(metrics_addr, pool.clone());

    info!(
        max_connections,
        poll_interval_seconds = poll_interval,
        job_batch_size,
        metrics_addr = %metrics_addr,
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
                if let Err(error) =
                    process_dashboard_projection_jobs(&pool, &worker_id, job_batch_size).await
                {
                    warn!(error_class = safe_error_class(&error), "dashboard projection job processing failed");
                }
                if let Err(error)=hms_db::auth::assurance::cleanup_ephemeral_auth(&pool,100).await {warn!(error_class=safe_error_class(&error),"expired authentication state cleanup failed");}
                if let Err(error) = refresh_worker_metrics(&pool).await {
                    warn!(error_class = safe_error_class(&error), "worker metrics refresh failed");
                }
            }
        }
    }

    Ok(())
}

async fn process_dashboard_projection_jobs(
    pool: &hms_db::PgPool,
    worker_id: &str,
    batch_limit: usize,
) -> anyhow::Result<u64> {
    let mut processed = 0;
    for _ in 0..batch_limit {
        let Some(claim) =
            hms_db::dashboard::lock_next_dashboard_projection_refresh_job(pool, worker_id).await?
        else {
            break;
        };
        let DashboardProjectionJobClaim::Ready(job) = claim else {
            processed += 1;
            warn!("dashboard projection job rejected");
            continue;
        };
        // PostgreSQL bounds statements/locks inside the repository transaction;
        // this outer deadline also bounds client-side work and pool acquisition.
        let refresh = tokio::time::timeout(
            Duration::from_secs(60),
            hms_db::dashboard::refresh_dashboard_projection_for_job(pool, &job),
        )
        .await;
        match refresh {
            Ok(Ok(true)) => {}
            Ok(Ok(false)) => warn!("dashboard projection refresh skipped after claim loss"),
            Ok(Err(error)) => {
                hms_db::dashboard::fail_dashboard_projection_refresh_job(
                    pool,
                    &job,
                    DashboardProjectionRefreshFailure::RefreshFailed,
                )
                .await?;
                warn!(
                    error_class = safe_error_class(&error),
                    "dashboard projection refresh job failed"
                );
            }
            Err(_) => {
                hms_db::dashboard::fail_dashboard_projection_refresh_job(
                    pool,
                    &job,
                    DashboardProjectionRefreshFailure::TimedOut,
                )
                .await?;
                warn!("dashboard projection refresh job timed out");
            }
        }
        processed += 1;
    }
    Ok(processed)
}

async fn check_database_ready(pool: &hms_db::PgPool) -> anyhow::Result<()> {
    sqlx::query("SELECT 1")
        .fetch_one(pool)
        .await
        .context("worker database readiness check failed")?;
    Ok(())
}

async fn refresh_worker_metrics(pool: &hms_db::PgPool) -> anyhow::Result<()> {
    hms_observability::set_gauge("hms_worker_up", 1.0, &[]);
    let database_ready = check_database_ready(pool).await.is_ok();
    hms_observability::set_gauge(
        "hms_worker_database_ready",
        if database_ready { 1.0 } else { 0.0 },
        &[],
    );

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .context("system clock is before unix epoch")?
        .as_secs_f64();
    hms_observability::set_gauge("hms_worker_last_heartbeat_timestamp_seconds", now, &[]);

    for status in ["queued", "running", "completed", "failed"] {
        hms_observability::set_gauge("hms_worker_job_queue_depth", 0.0, &[("status", status)]);
    }

    if database_ready {
        for row in sqlx::query("SELECT status, COUNT(*)::bigint AS count FROM jobs GROUP BY status")
            .fetch_all(pool)
            .await
            .context("worker job queue depth query failed")?
        {
            let status: String = row.try_get("status")?;
            let count: i64 = row.try_get("count")?;
            hms_observability::set_gauge(
                "hms_worker_job_queue_depth",
                count as f64,
                &[("status", status.as_str())],
            );
        }
    }

    Ok(())
}

fn spawn_metrics_server(addr: SocketAddr, pool: hms_db::PgPool) {
    tokio::spawn(async move {
        let app = Router::new()
            .route("/metrics", get(worker_metrics))
            .route("/health/ready", get(worker_health_ready))
            .with_state(pool);
        let listener = match TcpListener::bind(addr).await {
            Ok(listener) => listener,
            Err(error) => {
                warn!(%error, %addr, "worker metrics listener failed to bind");
                return;
            }
        };
        if let Err(error) = axum::serve(listener, app).await {
            warn!(%error, "worker metrics server stopped");
        }
    });
}

async fn worker_metrics(State(pool): State<hms_db::PgPool>) -> impl IntoResponse {
    if let Err(error) = refresh_worker_metrics(&pool).await {
        warn!(
            error_class = safe_error_class(&error),
            "worker metrics refresh failed"
        );
    }
    (
        [(CONTENT_TYPE, "text/plain; version=0.0.4")],
        hms_observability::prometheus_metrics(),
    )
}

async fn worker_health_ready(State(pool): State<hms_db::PgPool>) -> impl IntoResponse {
    match check_database_ready(&pool).await {
        Ok(()) => StatusCode::OK,
        Err(error) => {
            warn!(
                error_class = safe_error_class(&error),
                "worker readiness check failed"
            );
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}

fn init_tracing() {
    hms_observability::init_json_tracing("hms_worker=info");
}

fn worker_id() -> String {
    format!("hms-worker-{}", std::process::id())
}

fn safe_error_class(error: &anyhow::Error) -> &'static str {
    match error.downcast_ref::<sqlx::Error>() {
        Some(sqlx::Error::PoolTimedOut) => "database_pool_timeout",
        Some(sqlx::Error::PoolClosed) => "database_pool_closed",
        Some(sqlx::Error::Io(_) | sqlx::Error::Tls(_)) => "database_connection_failed",
        Some(_) => "database_operation_failed",
        None => "worker_operation_failed",
    }
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

fn parse_usize(value: &str, name: &str) -> anyhow::Result<usize> {
    let parsed = value
        .trim()
        .parse::<usize>()
        .with_context(|| format!("{name} must be an integer"))?;
    if parsed == 0 {
        bail!("{name} must be greater than zero");
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use hms_db::provision::{provision_baseline, BaselineProvisioning};
    use hms_domain::deployment::DeploymentProfile;

    #[test]
    fn worker_error_diagnostics_never_echo_arbitrary_error_text() {
        let sensitive_error = anyhow::anyhow!("synthetic-sensitive-value: raw payload");
        assert_eq!(
            safe_error_class(&sensitive_error),
            "worker_operation_failed"
        );
        let database_error = anyhow::Error::new(sqlx::Error::Protocol(
            "synthetic-sensitive-value: database detail".to_owned(),
        ));
        assert_eq!(
            safe_error_class(&database_error),
            "database_operation_failed"
        );
        assert_eq!(
            safe_error_class(&anyhow::Error::new(sqlx::Error::PoolTimedOut)),
            "database_pool_timeout"
        );
    }

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

    #[tokio::test]
    async fn dashboard_projection_job_refreshes_snapshot_and_completes() {
        let database =
            hms_db::test_support::TestDatabase::create().expect("test database is available");
        let pool = hms_db::pool::connect_with_max_connections(database.database_url(), 1)
            .await
            .expect("test database connects");

        hms_db::migrate::run(&pool).await.expect("migrations apply");
        provision_baseline(
            &pool,
            &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
        )
        .await
        .expect("baseline provisions");
        let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
            .await
            .expect("facility query succeeds")
            .expect("facility exists");
        hms_db::dashboard::queue_dashboard_projection_refresh(
            &pool,
            facility_id,
            DeploymentProfile::Hospital,
        )
        .await
        .expect("projection refresh queues");

        let processed = process_dashboard_projection_jobs(&pool, "worker-test", 5)
            .await
            .expect("dashboard projection job processes");

        assert_eq!(processed, 1);
        let snapshot_count: i64 = sqlx::query_scalar(
            "SELECT count(*)::bigint FROM dashboard_snapshots WHERE facility_id = $1",
        )
        .bind(facility_id)
        .fetch_one(&pool)
        .await
        .expect("dashboard projection count loads");
        assert_eq!(snapshot_count, 1);
        let status: String = sqlx::query_scalar(
            "SELECT status FROM jobs WHERE kind = $1 AND payload ->> 'facility_id' = $2",
        )
        .bind(hms_db::dashboard::DASHBOARD_REFRESH_JOB_KIND)
        .bind(facility_id.to_string())
        .fetch_one(&pool)
        .await
        .expect("dashboard projection job status loads");
        assert_eq!(status, "completed");
    }

    #[tokio::test]
    async fn rejected_payload_does_not_stop_valid_jobs_in_the_same_batch() {
        let db = hms_db::test_support::TestDb::hospital()
            .await
            .expect("test database provisions");
        sqlx::query(
            "INSERT INTO jobs (id, kind, payload, available_at)
             VALUES (gen_random_uuid(), $1, $2, now() - INTERVAL '1 second')",
        )
        .bind(hms_db::dashboard::DASHBOARD_REFRESH_JOB_KIND)
        .bind(serde_json::json!({ "deployment_profile": "synthetic-sensitive-value" }))
        .execute(db.pool())
        .await
        .expect("poison job inserts ahead of valid work");
        hms_db::dashboard::queue_dashboard_projection_refresh(
            db.pool(),
            db.facility_id(),
            DeploymentProfile::Hospital,
        )
        .await
        .expect("valid projection queues");

        let processed = process_dashboard_projection_jobs(db.pool(), "worker-test", 5)
            .await
            .expect("worker continues after malformed payload");
        assert_eq!(processed, 2);
        let states: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT status, last_error FROM jobs WHERE kind = $1 ORDER BY created_at, id",
        )
        .bind(hms_db::dashboard::DASHBOARD_REFRESH_JOB_KIND)
        .fetch_all(db.pool())
        .await
        .expect("job states load");
        assert_eq!(
            states,
            vec![
                (
                    "failed".to_owned(),
                    Some("invalid_dashboard_projection_payload".to_owned())
                ),
                ("completed".to_owned(), None),
            ]
        );
        let snapshot_count: i64 = sqlx::query_scalar(
            "SELECT count(*)::bigint FROM dashboard_snapshots WHERE facility_id = $1",
        )
        .bind(db.facility_id())
        .fetch_one(db.pool())
        .await
        .expect("dashboard projection loads");
        assert_eq!(snapshot_count, 1);
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
