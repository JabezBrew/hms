use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt;
use uuid::Uuid;

const UNSAFE_METADATA_TOKENS: &[&str] = &[
    "patient",
    "mrn",
    "medical_record",
    "name",
    "note",
    "diagnosis",
    "clinical_text",
    "free_text",
    "address",
    "phone",
    "email",
    "birth",
    "dob",
    "prescription",
    "medication",
];

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DomainEventKind {
    AuthRefreshReuseDetected,
    PasswordResetRequested,
    PasswordResetCompleted,
    StaffAccountSetupRequested,
    PatientRegistered,
    PatientChronicleUpdated,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RealtimeDeltaEnvelope {
    pub event_type: String,
    pub facility_id: Uuid,
    pub entity_type: String,
    pub entity_id: Uuid,
    pub version: i64,
    pub changed_fields: Vec<String>,
    pub occurred_at: DateTime<Utc>,
}

impl RealtimeDeltaEnvelope {
    pub fn try_new<I, S>(
        event_type: impl Into<String>,
        facility_id: Uuid,
        entity_type: impl Into<String>,
        entity_id: Uuid,
        version: i64,
        changed_fields: I,
        occurred_at: DateTime<Utc>,
    ) -> Result<Self, RealtimeMetadataError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let envelope = Self {
            event_type: event_type.into(),
            facility_id,
            entity_type: entity_type.into(),
            entity_id,
            version,
            changed_fields: changed_fields
                .into_iter()
                .map(|field| field.as_ref().trim().to_owned())
                .filter(|field| !field.is_empty())
                .collect(),
            occurred_at,
        };
        envelope.validate()?;
        Ok(envelope)
    }

    pub fn validate(&self) -> Result<(), RealtimeMetadataError> {
        validate_metadata_token("event_type", &self.event_type)?;
        validate_metadata_token("entity_type", &self.entity_type)?;
        if self.version < 0 {
            return Err(RealtimeMetadataError::NegativeVersion);
        }
        if self.changed_fields.is_empty() {
            return Err(RealtimeMetadataError::EmptyChangedFields);
        }
        for field in &self.changed_fields {
            validate_metadata_token("changed_fields", field)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RealtimeMetadataError {
    EmptyToken { field: &'static str },
    UnsafeToken { field: &'static str, value: String },
    InvalidToken { field: &'static str, value: String },
    NegativeVersion,
    EmptyChangedFields,
}

impl fmt::Display for RealtimeMetadataError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyToken { field } => write!(formatter, "{field} must not be empty"),
            Self::UnsafeToken { field, value } => {
                write!(
                    formatter,
                    "{field} contains unsafe realtime metadata: {value}"
                )
            }
            Self::InvalidToken { field, value } => {
                write!(
                    formatter,
                    "{field} is not a safe realtime metadata token: {value}"
                )
            }
            Self::NegativeVersion => {
                write!(formatter, "realtime delta version must be non-negative")
            }
            Self::EmptyChangedFields => {
                write!(formatter, "realtime delta changed_fields must not be empty")
            }
        }
    }
}

impl Error for RealtimeMetadataError {}

fn validate_metadata_token(field: &'static str, value: &str) -> Result<(), RealtimeMetadataError> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(RealtimeMetadataError::EmptyToken { field });
    }
    if !normalized.chars().all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || matches!(character, '_' | '.' | '-')
    }) {
        return Err(RealtimeMetadataError::InvalidToken {
            field,
            value: value.to_owned(),
        });
    }
    let lowered = normalized.to_ascii_lowercase();
    if UNSAFE_METADATA_TOKENS
        .iter()
        .any(|token| lowered.contains(token))
    {
        return Err(RealtimeMetadataError::UnsafeToken {
            field,
            value: value.to_owned(),
        });
    }
    Ok(())
}

impl DomainEventKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AuthRefreshReuseDetected => "auth.refresh_reuse_detected",
            Self::PasswordResetRequested => "auth.password_reset_requested",
            Self::PasswordResetCompleted => "auth.password_reset_completed",
            Self::StaffAccountSetupRequested => "admin.staff_account_setup_requested",
            Self::PatientRegistered => "patients.registered",
            Self::PatientChronicleUpdated => "patients.chronicle_updated",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    RefreshDashboardSnapshot,
    RefreshPatientChronicle,
    DispatchNotification,
}

impl JobKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::RefreshDashboardSnapshot => "dashboard.refresh_snapshot",
            Self::RefreshPatientChronicle => "patients.refresh_chronicle",
            Self::DispatchNotification => "notifications.dispatch",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn realtime_delta_serializes_phi_safe_contract() {
        let facility_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let entity_id = Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap();
        let occurred_at = DateTime::parse_from_rfc3339("2026-05-22T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let delta = RealtimeDeltaEnvelope::try_new(
            "ward_board.task_state_changed",
            facility_id,
            "ward_board_task",
            entity_id,
            42,
            ["status", "completed_at"],
            occurred_at,
        )
        .unwrap();

        let value = serde_json::to_value(delta).unwrap();
        assert_eq!(value["event_type"], "ward_board.task_state_changed");
        assert_eq!(value["facility_id"], facility_id.to_string());
        assert_eq!(value["entity_type"], "ward_board_task");
        assert_eq!(value["entity_id"], entity_id.to_string());
        assert_eq!(value["version"], 42);
        assert_eq!(
            value["changed_fields"],
            serde_json::json!(["status", "completed_at"])
        );
        assert_eq!(value["occurred_at"], "2026-05-22T12:00:00Z");
    }

    #[test]
    fn realtime_delta_rejects_patient_identifiers_and_free_text_metadata() {
        let facility_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let entity_id = Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap();
        let occurred_at = Utc::now();

        let patient_event = RealtimeDeltaEnvelope::try_new(
            "patient.name_changed",
            facility_id,
            "patient",
            entity_id,
            1,
            ["status"],
            occurred_at,
        );
        assert!(matches!(
            patient_event,
            Err(RealtimeMetadataError::UnsafeToken {
                field: "event_type",
                ..
            })
        ));

        let unsafe_field = RealtimeDeltaEnvelope::try_new(
            "ward_board.task_state_changed",
            facility_id,
            "ward_board_task",
            entity_id,
            1,
            ["patient_mrn"],
            occurred_at,
        );
        assert!(matches!(
            unsafe_field,
            Err(RealtimeMetadataError::UnsafeToken {
                field: "changed_fields",
                ..
            })
        ));
    }
}
