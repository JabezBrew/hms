//! Canonical generated medication courses, admission-local decisions and exact windows.
mod commands;
mod pages;
mod policy;
mod read;
mod requests;
mod rows;
mod schedule;

use crate::clinical::medication_access as access;
use crate::{codec, PgPool};
use chrono::{DateTime, Utc};
pub use commands::{create_treatment_supply_window, stop_treatment_course};
use hms_domain::treatment_courses::*;
pub use pages::{list_treatment_course_doses, list_treatment_course_supply};
pub use read::{get_treatment_course, list_treatment_courses, treatment_courses_context};
pub use requests::get_treatment_course_request;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

use super::WardCursor;
pub use crate::clinical::medication_access::MedicationActor as TreatmentActor;
type Tx<'a> = Transaction<'a, Postgres>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TreatmentCourseError {
    NotFound,
    InvalidInput,
    PermissionDenied,
    SnapshotChanged,
    ContextChanged,
    Terminal,
    SourceChanged,
    WindowInvalid,
    WindowElapsed,
    WindowUnsupported,
    RequestConflict,
    ReviewRequired,
}
impl TreatmentCourseError {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotFound => "treatment_course_not_found",
            Self::InvalidInput => "invalid_treatment_course_request",
            Self::PermissionDenied => "permission_denied",
            Self::SnapshotChanged => "treatment_course_snapshot_changed",
            Self::ContextChanged => "treatment_course_context_changed",
            Self::Terminal => "treatment_course_terminal",
            Self::SourceChanged => "treatment_course_source_changed",
            Self::WindowInvalid => "treatment_course_window_invalid",
            Self::WindowElapsed => "treatment_course_window_elapsed",
            Self::WindowUnsupported => "treatment_course_window_unsupported",
            Self::RequestConflict => "treatment_course_request_conflict",
            Self::ReviewRequired => "treatment_course_review_required",
        }
    }
    pub fn message(self) -> &'static str {
        match self {
            Self::NotFound => "The selected medication course or request was not found.",
            Self::InvalidInput => "Review the complete medication-course request.",
            Self::PermissionDenied => "Current prescribing authority is required to change this admission course.",
            Self::SnapshotChanged => "The medication course changed. Reload and review it before continuing.",
            Self::ContextChanged => "The selected admission context changed. Reload and review it before continuing.",
            Self::Terminal => "This admission course is closed. Its existing evidence is retained.",
            Self::SourceChanged => "The source prescription changed. Review the existing prescribing workflow.",
            Self::WindowInvalid => "Review a contiguous future window of at most 31 days and 512 doses within the prescription bounds.",
            Self::WindowElapsed => "The existing schedule boundary has elapsed. Review prescribing rather than backfilling past doses.",
            Self::WindowUnsupported => "This regimen cannot use scheduled-window expansion. Review its dedicated prescribing workflow.",
            Self::RequestConflict => "This request identity already belongs to a different reviewed command.",
            Self::ReviewRequired => "This course contains unsupported or inconsistent historical evidence. Review prescribing before continuing.",
        }
    }
}
impl std::fmt::Display for TreatmentCourseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}
impl std::error::Error for TreatmentCourseError {}

#[derive(Clone, Copy)]
struct Scope {
    patient: Uuid,
    admission: Uuid,
    course: Uuid,
}
fn hash(value: &impl serde::Serialize) -> anyhow::Result<String> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value)?)))
}
fn request_hash(actor: &TreatmentActor, id: Uuid) -> anyhow::Result<String> {
    hash(&json!([
        "treatment-course-request-v1",
        actor.identity.facility_id,
        actor.identity.user_id,
        id
    ]))
}
fn token_valid(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
