//! Reviewed immediate placement changes keep the canonical admission episode.
mod access;
mod commands;
mod placement;
mod reads;
use crate::clinical::prescription_courses::PrescriptionAuthorization;
use crate::{codec, PgPool};
use chrono::{DateTime, Utc};
pub use commands::move_admission;
use hms_domain::ward_moves::*;
use hms_observability::observe_db_query;
pub(crate) use placement::{close_discharge_tx, open_activation_tx};
pub use reads::{context, destinations, detail, history, receipt};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;
type Tx<'a> = Transaction<'a, Postgres>;
#[derive(Clone)]
pub struct AdmissionMoveActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: Option<String>,
    pub authorization: PrescriptionAuthorization,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MoveError {
    InvalidInput,
    Unavailable,
    NotFound,
    SourceChanged,
    DestinationChanged,
    TasksChanged,
    RequestConflict,
    Busy,
    TaskLimit,
}
impl std::fmt::Display for MoveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "invalid_admission_move",
            Self::Unavailable => "admission_move_unavailable",
            Self::NotFound => "admission_move_not_found",
            Self::SourceChanged => "admission_move_source_changed",
            Self::DestinationChanged => "admission_move_destination_changed",
            Self::TasksChanged => "admission_move_tasks_changed",
            Self::RequestConflict => "admission_move_request_conflict",
            Self::Busy => "admission_move_busy",
            Self::TaskLimit => "admission_move_task_limit",
        })
    }
}
impl std::error::Error for MoveError {}
fn hash(value: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(value.as_ref()).to_vec()
}
fn token(value: &impl serde::Serialize) -> anyhow::Result<String> {
    Ok(hash(serde_json::to_vec(value)?)
        .iter()
        .map(|v| format!("{v:02x}"))
        .collect())
}
fn lock_error(error: sqlx::Error) -> anyhow::Error {
    if error
        .as_database_error()
        .is_some_and(|e| e.code().as_deref() == Some("55P03"))
    {
        MoveError::Busy.into()
    } else {
        error.into()
    }
}
fn route_error(error: anyhow::Error) -> anyhow::Error {
    use super::task_routing::RoutingError;
    match error.downcast_ref::<RoutingError>() {
        Some(RoutingError::Busy) => MoveError::Busy.into(),
        Some(RoutingError::TooMany) => MoveError::TaskLimit.into(),
        Some(RoutingError::SourceChanged) => MoveError::TasksChanged.into(),
        Some(RoutingError::InvalidScope) => MoveError::SourceChanged.into(),
        None => error,
    }
}
#[derive(Clone, FromRow)]
struct Root {
    id: Uuid,
    patient_id: Uuid,
    ward_id: Uuid,
    ward_name: String,
    ward_status: String,
    ward_updated_at: DateTime<Utc>,
    bed_updated_at: Option<DateTime<Utc>>,
    section_updated_at: Option<DateTime<Utc>>,
    bed_id: Option<Uuid>,
    bed_code: Option<String>,
    bed_status: Option<String>,
    section_id: Option<Uuid>,
    section_name: Option<String>,
    section_status: Option<String>,
    encounter_id: Option<Uuid>,
    visit_id: Option<Uuid>,
    status: String,
    admitted_at: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
    placement_revision: i64,
    placement_history_partial: bool,
    placement_known_from: Option<DateTime<Utc>>,
    cleaning_minutes: i32,
}
impl Root {
    fn source_token(&self) -> anyhow::Result<String> {
        token(&serde_json::json!([
            self.id,
            self.patient_id,
            self.ward_id,
            self.bed_id,
            self.status,
            self.admitted_at,
            self.encounter_id,
            self.visit_id,
            self.updated_at,
            self.placement_revision,
            self.bed_status,
            self.section_id,
            self.section_status,
            self.ward_status,
            self.cleaning_minutes,
            self.ward_name,
            self.bed_code,
            self.section_name,
            self.ward_updated_at,
            self.bed_updated_at,
            self.section_updated_at
        ]))
    }
    fn labels(&self) -> anyhow::Result<AdmissionPlacementLabels> {
        Ok(AdmissionPlacementLabels {
            ward_id: self.ward_id,
            ward_name: self.ward_name.clone(),
            bed_id: self.bed_id.ok_or(MoveError::SourceChanged)?,
            bed_code: self.bed_code.clone().ok_or(MoveError::SourceChanged)?,
            section_id: self.section_id,
            section_name: self.section_name.clone(),
        })
    }
    fn active(&self) -> bool {
        matches!(self.status.as_str(), "admitted" | "discharge_pending")
    }
    fn consistent(&self) -> bool {
        self.active()
            && self.admitted_at.is_some()
            && self.bed_id.is_some()
            && self.bed_code.is_some()
            && self.bed_status.as_deref() == Some("occupied")
            // Operational inactivity cannot trap an already placed patient.
            // The scoped joins must still find its actual section, if any.
            && (self.section_id.is_none() || self.section_status.is_some())
            && self.cleaning_minutes >= 0
    }
}
const ROOT_SELECT:&str="SELECT a.id,a.patient_id,a.ward_id,w.name AS ward_name,w.status AS ward_status,w.updated_at AS ward_updated_at,b.updated_at AS bed_updated_at,s.updated_at AS section_updated_at,a.bed_id,b.bed_code,b.status AS bed_status,b.section_id,s.name AS section_name,s.status AS section_status,a.encounter_id,a.visit_id,a.status,a.admitted_at,a.updated_at,a.placement_revision,a.placement_history_partial,a.placement_known_from,COALESCE(w.bed_cleaning_minutes_override,60) AS cleaning_minutes FROM admission_cases a JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id LEFT JOIN beds b ON b.id=a.bed_id AND b.facility_id=a.facility_id AND b.ward_id=a.ward_id LEFT JOIN ward_sections s ON s.id=b.section_id AND s.facility_id=a.facility_id AND s.ward_id=a.ward_id WHERE a.facility_id=$1 AND a.id=$2 AND a.patient_id=$3";
async fn root(
    tx: &mut Tx<'_>,
    actor: &AdmissionMoveActor,
    patient: Uuid,
    case: Uuid,
    lock: Option<bool>,
) -> anyhow::Result<Root> {
    let sql = format!(
        "{ROOT_SELECT}{}",
        match lock {
            Some(true) => " FOR UPDATE OF a NOWAIT",
            Some(false) => " FOR SHARE OF a NOWAIT",
            None => "",
        }
    );
    observe_db_query(
        "ward.moves.root",
        sqlx::query_as(&sql)
            .bind(actor.facility_id)
            .bind(case)
            .bind(patient)
            .fetch_optional(&mut **tx),
    )
    .await
    .map_err(lock_error)?
    .ok_or_else(|| MoveError::NotFound.into())
}
