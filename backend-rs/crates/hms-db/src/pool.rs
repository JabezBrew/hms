use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
pub use sqlx::PgPool;

pub async fn connect(database_url: &str) -> anyhow::Result<PgPool> {
    connect_with_max_connections(database_url, 10).await
}

pub async fn connect_with_max_connections(
    database_url: &str,
    max_connections: u32,
) -> anyhow::Result<PgPool> {
    Ok(PgPoolOptions::new()
        .max_connections(max_connections.max(1))
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await?)
}
