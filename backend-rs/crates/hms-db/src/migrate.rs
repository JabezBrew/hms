use sqlx::migrate::Migrator;

use crate::PgPool;

pub static MIGRATOR: Migrator = sqlx::migrate!("../../migrations");

pub async fn run(pool: &PgPool) -> anyhow::Result<()> {
    MIGRATOR.run(pool).await?;
    Ok(())
}
