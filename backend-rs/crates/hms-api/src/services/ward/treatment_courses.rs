//! Generated-course orchestration. Persistence owns current authority and lifecycle.
use super::common;
use crate::{
    cursor_list,
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use chrono::{DateTime, Utc};
use hms_db::{
    clinical::{
        medication_access::{MedicationAccessError, MedicationActor},
        prescription_courses::PrescriptionActor,
    },
    ward::{treatment_courses as repo, WardCursor},
};
use hms_domain::{
    auth::PatientDataVisibility,
    deployment::{FeatureKey, PermissionCode},
    treatment_courses::*,
};
use uuid::Uuid;

async fn preflight(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    patient: Uuid,
) -> Result<(), ApiError> {
    common::require_patient_workflow_access(
        ctx,
        s.facility_id(),
        PermissionCode::ClinicalDocumentationView,
    )?;
    for feature in [
        FeatureKey::Patients,
        FeatureKey::Encounters,
        FeatureKey::Nursing,
    ] {
        hms_access::require_feature(ctx, feature).map_err(|_| {
            ApiError::forbidden(
                "feature_disabled",
                "The medication-course workflow is not enabled.",
            )
        })?;
    }
    let p = common::load_patient_for_access(s, ctx, patient).await?;
    hms_access::require_patient_access(ctx, &p, PatientDataVisibility::FullClinical).map_err(
        |_| {
            ApiError::forbidden(
                "patient_access_denied",
                "Full clinical access is required to review medication courses.",
            )
        },
    )?;
    Ok(())
}
fn actor(ctx: &hms_access::RequestContext, deadline: DateTime<Utc>) -> MedicationActor {
    MedicationActor {
        identity: PrescriptionActor {
            facility_id: ctx.facility_id,
            user_id: ctx.user_id,
            request_id: Some(ctx.request_id.clone()),
            authorization: Some(
                crate::services::clinical::prescription_courses::authorization(ctx, deadline),
            ),
        },
        can_view_all_wards: super::staff_assignments::can_view_all_ward_board(ctx, ctx.facility_id),
        resolved_network_policy_version: ctx.resolved_network_policy_version,
    }
}
fn page(
    cursor: Option<&str>,
    limit: Option<u8>,
) -> Result<cursor_list::CursorPage<WardCursor>, ApiError> {
    cursor_list::page_request(cursor, limit, 25, 100, |occurred_at, id| WardCursor {
        occurred_at,
        id,
    })
    .map_err(|_| {
        ApiError::bad_request(
            "invalid_treatment_course_cursor",
            "Use a valid medication-course page cursor.",
        )
    })
}
fn error(value: anyhow::Error, write: bool) -> ApiError {
    if let Some(e) = value.downcast_ref::<MedicationAccessError>() {
        return match e {
            MedicationAccessError::FeatureDisabled => ApiError::forbidden(
                "feature_disabled",
                "The medication workflow is not enabled.",
            ),
            MedicationAccessError::PatientDenied => ApiError::forbidden(
                "patient_access_denied",
                "Current full clinical access is required.",
            ),
            MedicationAccessError::WardDenied => ApiError::forbidden(
                "ward_access_denied",
                "Current authority for the selected admission ward is required.",
            ),
            MedicationAccessError::ContextChanged => ApiError::conflict(
                "treatment_course_context_changed",
                "Review the selected admission and its current care context.",
            ),
            MedicationAccessError::AuthorityExpired => ApiError::forbidden(
                "treatment_course_authorization_expired",
                "Current authorization is required. Sign in and review access before continuing.",
            ),
        };
    }
    if let Some(e) = value.downcast_ref::<repo::TreatmentCourseError>() {
        return match e {
            repo::TreatmentCourseError::NotFound => ApiError::not_found(e.code(), e.message()),
            repo::TreatmentCourseError::InvalidInput => {
                ApiError::bad_request(e.code(), e.message())
            }
            repo::TreatmentCourseError::PermissionDenied => {
                ApiError::forbidden(e.code(), e.message())
            }
            _ => ApiError::conflict(e.code(), e.message()),
        };
    }
    if value.is::<hms_db::clinical::stock_basis::StockBasisError>()
        || value.is::<hms_db::clinical::prescription_courses::PrescriptionCourseError>()
    {
        return crate::services::clinical::prescription_courses::write_error(value);
    }
    if write {
        ApiError::conflict("treatment_course_write_unconfirmed","The change may already be saved. Review its original request reference before another change or explicitly retry the unchanged command.")
    } else {
        ApiError::conflict("treatment_course_unavailable","Medication-course evidence could not be loaded. Try again when current access is available.")
    }
}
pub async fn context(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    p: Uuid,
    a: Uuid,
    d: DateTime<Utc>,
) -> Result<ObjectResponse<TreatmentCoursesContext>, ApiError> {
    preflight(s, ctx, p).await?;
    let mut result = repo::treatment_courses_context(s.db_pool(), actor(ctx, d), p, a)
        .await
        .map_err(|e| error(e, false))?;
    if hms_access::require_offsite_write_allowed(ctx).is_err() {
        result.can_manage_courses = false;
        result.management_unavailable_reason =
            Some(TreatmentUnavailableReason::NetworkWriteUnavailable);
    }
    Ok(object(result))
}
pub async fn list(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    p: Uuid,
    a: Uuid,
    q: TreatmentCourseListQuery,
    d: DateTime<Utc>,
) -> Result<ListResponse<TreatmentCourseListItem>, ApiError> {
    preflight(s, ctx, p).await?;
    let page = page(q.cursor.as_deref(), q.limit)?;
    let size = page.limit;
    let fetch = page.fetch_limit();
    let rows =
        repo::list_treatment_courses(s.db_pool(), actor(ctx, d), p, a, q, page.cursor, fetch)
            .await
            .map_err(|e| error(e, false))?;
    Ok(cursor_list::page_response(rows, size, |r| {
        cursor_list::encode_cursor(r.created_at, r.id)
    }))
}
pub async fn detail(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    p: Uuid,
    a: Uuid,
    c: Uuid,
    d: DateTime<Utc>,
) -> Result<ObjectResponse<TreatmentCourseDetail>, ApiError> {
    preflight(s, ctx, p).await?;
    let mut result = repo::get_treatment_course(s.db_pool(), actor(ctx, d), p, a, c)
        .await
        .map_err(|e| error(e, false))?;
    if hms_access::require_offsite_write_allowed(ctx).is_err() {
        result.can_stop_course = false;
        result.can_request_schedule_window = false;
        result.stop_unavailable_reason = Some(TreatmentUnavailableReason::NetworkWriteUnavailable);
        result.window_unavailable_reason =
            Some(TreatmentUnavailableReason::NetworkWriteUnavailable);
    }
    Ok(object(result))
}
pub async fn doses(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    p: Uuid,
    a: Uuid,
    c: Uuid,
    q: TreatmentCourseDoseQuery,
    d: DateTime<Utc>,
) -> Result<ListResponse<TreatmentCourseDose>, ApiError> {
    preflight(s, ctx, p).await?;
    if q.scheduled_from
        .zip(q.scheduled_before)
        .is_some_and(|(from, before)| from >= before)
    {
        return Err(ApiError::bad_request(
            "invalid_treatment_course_range",
            "The dose range must end after it starts.",
        ));
    }
    let page = page(q.cursor.as_deref(), q.limit)?;
    let size = page.limit;
    let fetch = page.fetch_limit();
    let rows = repo::list_treatment_course_doses(
        s.db_pool(),
        actor(ctx, d),
        p,
        a,
        c,
        q,
        page.cursor,
        fetch,
    )
    .await
    .map_err(|e| error(e, false))?;
    Ok(cursor_list::page_response(rows, size, |r| {
        cursor_list::encode_cursor(r.scheduled_at, r.id)
    }))
}
pub async fn supply(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    p: Uuid,
    a: Uuid,
    c: Uuid,
    q: TreatmentCourseSupplyQuery,
    d: DateTime<Utc>,
) -> Result<ListResponse<TreatmentCourseSupplyWindow>, ApiError> {
    preflight(s, ctx, p).await?;
    let page = page(q.cursor.as_deref(), q.limit)?;
    let size = page.limit;
    let fetch = page.fetch_limit();
    let rows = repo::list_treatment_course_supply(
        s.db_pool(),
        actor(ctx, d),
        p,
        a,
        c,
        q,
        page.cursor,
        fetch,
    )
    .await
    .map_err(|e| error(e, false))?;
    Ok(cursor_list::page_response(rows, size, |r| {
        cursor_list::encode_cursor(r.created_at, r.id)
    }))
}
// Exact actor-bound replay requires current rich-read access. Persistence checks
// current management authority before every new command, after replay lookup.
pub async fn stop(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    p: Uuid,
    a: Uuid,
    c: Uuid,
    input: StopTreatmentCourseRequest,
    d: DateTime<Utc>,
) -> Result<ObjectResponse<TreatmentCourseReceipt>, ApiError> {
    preflight(s, ctx, p).await?;
    hms_access::require_offsite_write_allowed(ctx)?;
    let receipt = repo::stop_treatment_course(s.db_pool(), actor(ctx, d), p, a, c, input)
        .await
        .map_err(|e| error(e, true))?;
    s.invalidate_patient_chronicle_cache();
    Ok(object(receipt))
}
pub async fn window(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    p: Uuid,
    a: Uuid,
    c: Uuid,
    input: CreateTreatmentSupplyWindowRequest,
    d: DateTime<Utc>,
) -> Result<ObjectResponse<TreatmentCourseReceipt>, ApiError> {
    preflight(s, ctx, p).await?;
    hms_access::require_offsite_write_allowed(ctx)?;
    let receipt = repo::create_treatment_supply_window(s.db_pool(), actor(ctx, d), p, a, c, input)
        .await
        .map_err(|e| error(e, true))?;
    s.invalidate_patient_chronicle_cache();
    Ok(object(receipt))
}
pub async fn receipt(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    p: Uuid,
    a: Uuid,
    c: Uuid,
    key: Uuid,
    d: DateTime<Utc>,
) -> Result<ObjectResponse<TreatmentCourseReceipt>, ApiError> {
    preflight(s, ctx, p).await?;
    Ok(object(
        repo::get_treatment_course_request(s.db_pool(), actor(ctx, d), p, a, c, key)
            .await
            .map_err(|e| error(e, false))?,
    ))
}
