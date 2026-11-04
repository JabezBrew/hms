//! Ordinary, no-patient catalog administration and original availability commands.
use crate::clinical::{medication_access, prescription_courses};
use crate::{codec, laboratory::LabCursor, PgPool};
use chrono::{DateTime, Utc};
use hms_domain::deployment::{FeatureKey, PermissionCode};
use hms_domain::laboratory_catalog::*;
use sqlx::{FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

mod commands;
mod reads;
pub use commands::{command, receipt};
pub use reads::{detail, history, list};
type Tx<'a> = Transaction<'a, Postgres>;

#[derive(Clone)]
pub struct LabCatalogActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: String,
    pub authorization: prescription_courses::PrescriptionAuthorization,
}

#[derive(Clone, Debug, Default)]
pub struct LabCatalogFilters {
    pub search: Option<String>,
    pub category: Option<String>,
    pub is_active: Option<bool>,
    pub is_system_default: Option<bool>,
    pub is_facility_modified: Option<bool>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LabCatalogError {
    Invalid,
    NotFound,
    VersionConflict,
    RequestConflict,
    Authority,
    Busy,
    ProjectionConflict,
    OrderUnavailable,
    VersionExhausted,
}
impl std::fmt::Display for LabCatalogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Current laboratory catalog review is required.")
    }
}
impl std::error::Error for LabCatalogError {}

pub fn database_error(error: &sqlx::Error) -> Option<LabCatalogError> {
    let database = error.as_database_error()?;
    if matches!(database.code().as_deref(), Some("55P03" | "57014")) {
        return Some(LabCatalogError::Busy);
    }
    match database.message() {
        "laboratory_catalog_projection_conflict" => Some(LabCatalogError::ProjectionConflict),
        "laboratory_order_source_unavailable" => Some(LabCatalogError::OrderUnavailable),
        "laboratory_catalog_version_exhausted" => Some(LabCatalogError::VersionExhausted),
        "laboratory_catalog_invalid"
        | "laboratory_catalog_identity_immutable"
        | "laboratory_catalog_version_invalid"
        | "laboratory_catalog_noop_immutable" => Some(LabCatalogError::Invalid),
        _ => None,
    }
}
pub(crate) fn sql_error(error: sqlx::Error) -> anyhow::Error {
    database_error(&error)
        .map(Into::into)
        .unwrap_or_else(|| error.into())
}
fn repository_error(error: anyhow::Error) -> anyhow::Error {
    if let Some(database) = error.downcast_ref::<sqlx::Error>() {
        if let Some(kind) = database_error(database) {
            return kind.into();
        }
    }
    error
}
fn table(kind: LabCatalogKind) -> &'static str {
    match kind {
        LabCatalogKind::Test => "lab_tests",
        LabCatalogKind::Panel => "lab_panels",
    }
}
fn kind_text(kind: LabCatalogKind) -> &'static str {
    match kind {
        LabCatalogKind::Test => "test",
        LabCatalogKind::Panel => "panel",
    }
}
pub(crate) async fn budget(tx: &mut Tx<'_>) -> anyhow::Result<()> {
    sqlx::query("SELECT set_config('lock_timeout','100ms',true),set_config('statement_timeout','1000ms',true)")
        .execute(&mut **tx).await?;
    Ok(())
}
async fn authority(
    tx: &mut Tx<'_>,
    actor: &mut LabCatalogActor,
    fresh: bool,
) -> anyhow::Result<prescription_courses::PrescriptionActor> {
    if fresh
        && (!actor.authorization.ordinary_reauth_required
            || actor.authorization.original_password_verified_at.is_none())
    {
        return Err(LabCatalogError::Authority.into());
    }
    if fresh {
        let original = actor
            .authorization
            .original_password_verified_at
            .ok_or(LabCatalogError::Authority)?;
        let deadline = original
            .checked_add_signed(chrono::Duration::minutes(15))
            .ok_or(LabCatalogError::Authority)?;
        actor.authorization.valid_until = actor.authorization.valid_until.min(deadline);
    }
    let mut proof = prescription_courses::PrescriptionActor {
        facility_id: actor.facility_id,
        user_id: actor.user_id,
        request_id: Some(actor.request_id.clone()),
        authorization: Some(actor.authorization.clone()),
    };
    prescription_courses::verify_actor(tx, &mut proof)
        .await
        .map_err(authority_error)?;
    actor.authorization = proof
        .authorization
        .clone()
        .ok_or(LabCatalogError::Authority)?;
    medication_access::require_current_features_tx(
        tx,
        actor.facility_id,
        actor.authorization.active_profile,
        &[FeatureKey::Laboratory],
    )
    .await
    .map_err(authority_error)?;
    let permission = codec::encode(PermissionCode::LaboratoryCatalogManage)?;
    let (allowed, boundary): (bool, Option<DateTime<Utc>>) = hms_observability::observe_db_query(
        "laboratory.catalog.authority",
        sqlx::query_as(
            r#"
        WITH point AS MATERIALIZED (SELECT clock_timestamp() AS at), effective AS (
          SELECT permission_code FROM user_permissions WHERE user_id=$2
          UNION SELECT p.permission_code FROM permission_assignments p CROSS JOIN point n
            WHERE p.facility_id=$1 AND p.grantee_user_id=$2 AND p.scope_type='facility'
              AND p.scope_id IS NULL AND p.status='active' AND p.starts_at<=n.at
              AND (p.ends_at IS NULL OR p.ends_at>n.at)
          UNION SELECT d.permission_code FROM delegations d CROSS JOIN point n
            WHERE d.facility_id=$1 AND d.delegate_user_id=$2 AND d.status='active'
              AND d.starts_at<=n.at AND (d.ends_at IS NULL OR d.ends_at>n.at)
        )
        SELECT EXISTS(SELECT 1 FROM effective WHERE permission_code=$3)
          AND EXISTS(SELECT 1 FROM user_features WHERE user_id=$2 AND feature_key='laboratory'),
          (SELECT min(boundary) FROM user_authority_boundaries b
            CROSS JOIN LATERAL(VALUES(b.starts_at),(b.ends_at)) boundaries(boundary)
            CROSS JOIN point n WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
        "#,
        )
        .bind(actor.facility_id)
        .bind(actor.user_id)
        .bind(permission)
        .fetch_one(&mut **tx),
    )
    .await?;
    if !allowed {
        return Err(LabCatalogError::Authority.into());
    }
    if let Some(boundary) = boundary {
        actor.authorization.valid_until = actor.authorization.valid_until.min(boundary);
    }
    proof.authorization = Some(actor.authorization.clone());
    prescription_courses::check_authorization(tx, &proof)
        .await
        .map_err(authority_error)?;
    Ok(proof)
}
fn authority_error(error: anyhow::Error) -> anyhow::Error {
    if error.is::<prescription_courses::PrescriptionCourseError>()
        || error.is::<medication_access::MedicationAccessError>()
    {
        LabCatalogError::Authority.into()
    } else {
        error
    }
}
fn search(value: Option<&str>) -> anyhow::Result<Option<String>> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    if value.is_some_and(|value| value.len() > 160 || value.chars().any(char::is_control)) {
        return Err(LabCatalogError::Invalid.into());
    }
    Ok(value.map(|value| {
        format!(
            "%{}%",
            value
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        )
    }))
}
