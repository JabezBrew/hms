use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DomainEventKind {
    AuthRefreshReuseDetected,
    PasswordResetRequested,
    PasswordResetCompleted,
    PatientRegistered,
    PatientChronicleUpdated,
}

impl DomainEventKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AuthRefreshReuseDetected => "auth.refresh_reuse_detected",
            Self::PasswordResetRequested => "auth.password_reset_requested",
            Self::PasswordResetCompleted => "auth.password_reset_completed",
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
