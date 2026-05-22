use hms_events::{DomainEventKind, RealtimeDeltaEnvelope};
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

impl NewDomainEvent {
    pub fn with_realtime_delta(mut self, delta: &RealtimeDeltaEnvelope) -> anyhow::Result<Self> {
        delta.validate()?;
        let delta_payload = serde_json::to_value(delta)?;
        let mut payload = match self.payload {
            Value::Object(object) => object,
            Value::Null => serde_json::Map::new(),
            other => {
                let mut object = serde_json::Map::new();
                object.insert("data".to_owned(), other);
                object
            }
        };
        payload.insert("realtime_delta".to_owned(), delta_payload);
        self.payload = Value::Object(payload);
        Ok(self)
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, Utc};

    #[test]
    fn realtime_delta_payload_is_embedded_under_safe_key() {
        let facility_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let entity_id = Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap();
        let occurred_at = DateTime::parse_from_rfc3339("2026-05-22T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let delta = RealtimeDeltaEnvelope::try_new(
            "dashboard.projection_freshness",
            facility_id,
            "dashboard_projection",
            entity_id,
            7,
            ["generated_at"],
            occurred_at,
        )
        .unwrap();

        let event = NewDomainEvent {
            id: Uuid::new_v4(),
            kind: DomainEventKind::PatientChronicleUpdated,
            aggregate_type: "dashboard_projection".to_owned(),
            aggregate_id: Some(entity_id),
            facility_id: Some(facility_id),
            payload: serde_json::json!({ "source": "test" }),
        }
        .with_realtime_delta(&delta)
        .unwrap();

        assert_eq!(event.payload["source"], "test");
        assert_eq!(
            event.payload["realtime_delta"]["event_type"],
            "dashboard.projection_freshness"
        );
        assert!(!event.payload.to_string().contains("patient_mrn"));
    }
}
