use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgDatabaseError;
use sqlx::{Error, FromRow, PgPool};

const DEFAULT_PG_STAT_STATEMENTS_LIMIT: i64 = 20;

pub const PG_STAT_STATEMENTS_AGGREGATE_SQL: &str = r#"
SELECT queryid,
       calls,
       total_exec_time,
       mean_exec_time,
       rows
FROM pg_stat_statements
WHERE queryid IS NOT NULL
ORDER BY total_exec_time DESC
LIMIT $1
"#;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PgStatStatementsConfig {
    pub enabled: bool,
    pub limit: i64,
}

impl Default for PgStatStatementsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            limit: DEFAULT_PG_STAT_STATEMENTS_LIMIT,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PgStatStatementsAvailability {
    Available,
    ExtensionUnavailable,
    PermissionDenied,
    NotConfigured,
}

impl PgStatStatementsAvailability {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::ExtensionUnavailable => "extension_unavailable",
            Self::PermissionDenied => "permission_denied",
            Self::NotConfigured => "not_configured",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PgStatStatementsSnapshot {
    pub availability: PgStatStatementsAvailability,
    pub statements: Vec<PgStatStatementAggregate>,
}

impl PgStatStatementsSnapshot {
    fn unavailable(availability: PgStatStatementsAvailability) -> Self {
        Self {
            availability,
            statements: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PgStatStatementAggregate {
    pub fingerprint_id: String,
    pub calls: i64,
    pub total_exec_ms: f64,
    pub mean_exec_ms: f64,
    pub rows: i64,
}

#[derive(FromRow)]
struct PgStatStatementAggregateRow {
    queryid: i64,
    calls: i64,
    total_exec_time: f64,
    mean_exec_time: f64,
    rows: i64,
}

pub async fn pg_stat_statement_aggregates(pool: &PgPool) -> PgStatStatementsSnapshot {
    pg_stat_statement_aggregates_with_config(pool, PgStatStatementsConfig::default()).await
}

pub async fn pg_stat_statement_aggregates_with_config(
    pool: &PgPool,
    config: PgStatStatementsConfig,
) -> PgStatStatementsSnapshot {
    if !config.enabled {
        return PgStatStatementsSnapshot::unavailable(PgStatStatementsAvailability::NotConfigured);
    }

    let extension_available = match sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements')",
    )
    .fetch_one(pool)
    .await
    {
        Ok(available) => available,
        Err(error) => {
            return PgStatStatementsSnapshot::unavailable(availability_from_sqlx_error(&error));
        }
    };

    if !extension_available {
        return PgStatStatementsSnapshot::unavailable(
            PgStatStatementsAvailability::ExtensionUnavailable,
        );
    }

    match sqlx::query_as::<_, PgStatStatementAggregateRow>(PG_STAT_STATEMENTS_AGGREGATE_SQL)
        .bind(config.limit.clamp(1, 100))
        .fetch_all(pool)
        .await
    {
        Ok(rows) => PgStatStatementsSnapshot {
            availability: PgStatStatementsAvailability::Available,
            statements: rows
                .into_iter()
                .map(PgStatStatementAggregate::from)
                .collect(),
        },
        Err(error) => PgStatStatementsSnapshot::unavailable(availability_from_sqlx_error(&error)),
    }
}

impl From<PgStatStatementAggregateRow> for PgStatStatementAggregate {
    fn from(row: PgStatStatementAggregateRow) -> Self {
        Self {
            fingerprint_id: fingerprint_id(row.queryid),
            calls: row.calls,
            total_exec_ms: row.total_exec_time,
            mean_exec_ms: row.mean_exec_time,
            rows: row.rows,
        }
    }
}

fn fingerprint_id(queryid: i64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"hms-pg-stat-statements-queryid-v1");
    hasher.update(queryid.to_be_bytes());
    format!("pgq_{}", URL_SAFE_NO_PAD.encode(hasher.finalize()))
}

fn availability_from_sqlx_error(error: &Error) -> PgStatStatementsAvailability {
    let Some(db_error) = error.as_database_error() else {
        return PgStatStatementsAvailability::ExtensionUnavailable;
    };
    let Some(pg_error) = db_error.try_downcast_ref::<PgDatabaseError>() else {
        return PgStatStatementsAvailability::ExtensionUnavailable;
    };

    pg_stat_statements_availability_for_sqlstate(Some(pg_error.code()))
}

#[doc(hidden)]
pub fn pg_stat_statements_availability_for_sqlstate(
    sqlstate: Option<&str>,
) -> PgStatStatementsAvailability {
    match sqlstate {
        Some("42501") => PgStatStatementsAvailability::PermissionDenied,
        Some("42P01" | "55000" | "58P01") => PgStatStatementsAvailability::ExtensionUnavailable,
        _ => PgStatStatementsAvailability::ExtensionUnavailable,
    }
}
