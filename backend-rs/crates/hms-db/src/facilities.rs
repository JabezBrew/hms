use uuid::Uuid;

use crate::PgPool;

pub async fn facility_id_by_code(pool: &PgPool, code: &str) -> anyhow::Result<Option<Uuid>> {
    Ok(sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id
        FROM facilities
        WHERE lower(code) = lower($1)
          AND is_active = TRUE
        "#,
    )
    .bind(code.trim())
    .fetch_optional(pool)
    .await?)
}
