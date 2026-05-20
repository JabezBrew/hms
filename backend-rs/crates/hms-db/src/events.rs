use hms_events::DomainEventKind;
use serde_json::Value;
use uuid::Uuid;

use crate::PgPool;

#[derive(Clone, Debug)]
pub struct NewDomainEvent {
    pub id: Uuid,
    pub kind: DomainEventKind,
    pub aggregate_type: String,
    pub aggregate_id: Option<Uuid>,
    pub facility_id: Option<Uuid>,
    pub payload: Value,
}

pub async fn insert_domain_event(pool: &PgPool, event: &NewDomainEvent) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO domain_events (
            id,
            event_type,
            aggregate_type,
            aggregate_id,
            facility_id,
            payload
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(event.id)
    .bind(event.kind.as_str())
    .bind(&event.aggregate_type)
    .bind(event.aggregate_id)
    .bind(event.facility_id)
    .bind(&event.payload)
    .execute(pool)
    .await?;

    Ok(())
}
