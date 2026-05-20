use sqlx::{Postgres, Transaction};

use crate::PgPool;

pub async fn begin(pool: &PgPool) -> anyhow::Result<Transaction<'_, Postgres>> {
    Ok(pool.begin().await?)
}
