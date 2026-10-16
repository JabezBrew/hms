use super::common;
use crate::{
    cursor_list,
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use chrono::{DateTime, Utc};
use hms_db::ward::{patient_handover as repo, WardCursor};
use hms_domain::{auth::PatientDataVisibility, deployment::PermissionCode, patient_handover::*};
use uuid::Uuid;

async fn patient(s: &AppState, ctx: &hms_access::RequestContext, id: Uuid) -> Result<(), ApiError> {
    common::require_patient_workflow_access(
        ctx,
        s.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let p = common::load_patient_for_access(s, ctx, id).await?;
    hms_access::require_patient_access(ctx, &p, PatientDataVisibility::FullClinical).map_err(
        |_| {
            ApiError::forbidden(
                "patient_access_denied",
                "Full clinical access is required to review a patient handover.",
            )
        },
    )?;
    Ok(())
}
async fn scope(s: &AppState, ctx: &hms_access::RequestContext, id: Uuid) -> Result<Uuid, ApiError> {
    common::require_patient_workflow_access(
        ctx,
        s.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let (p, _, w) = repo::context(s.db_pool(), s.facility_id(), id)
        .await
        .map_err(error)?
        .ok_or_else(not_found)?;
    patient(s, ctx, p).await?;
    ward(s, ctx, w).await?;
    Ok(p)
}
async fn admission_scope(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    p: Uuid,
    a: Uuid,
) -> Result<(), ApiError> {
    let a = common::load_admission_for_access(s, ctx, a).await?;
    if a.patient_id != p {
        return Err(ApiError::bad_request(
            "handover_context_mismatch",
            "The patient and admission must refer to the same care context.",
        ));
    }
    Ok(())
}
fn actor(ctx: &hms_access::RequestContext, deadline: DateTime<Utc>) -> repo::HandoverActor {
    repo::HandoverActor {
        facility_id: ctx.facility_id,
        user_id: ctx.user_id,
        request_id: Some(ctx.request_id.clone()),
        session_id: ctx.session_id,
        session_version: ctx.session_version,
        permission_version: ctx.permission_version,
        active_profile: ctx.active_profile,
        can_view_all_wards: super::staff_assignments::can_view_all_ward_board(ctx, ctx.facility_id),
        valid_until: if ctx.offsite == hms_access::OffsiteState::OffsiteFreshReauth {
            deadline.min(ctx.reauth.required_after)
        } else {
            deadline
        },
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
            "invalid_handover_cursor",
            "Use a valid handover page cursor.",
        )
    })
}
fn not_found() -> ApiError {
    ApiError::not_found(
        "patient_handover_not_found",
        "The patient handover or saved result was not found.",
    )
}
pub fn error(e: anyhow::Error) -> ApiError {
    use repo::HandoverError as E;
    if let Some(kind) = e.downcast_ref::<E>() {
        return match kind{
 E::WardAccessDenied=>ward_denied(),
 E::NotFound=>not_found(), E::InvalidRequest=>ApiError::bad_request("invalid_patient_handover","Review the required bounded narrative, request reference and reason."),
 E::InvalidContext=>ApiError::conflict("handover_context_changed","Create a handover only for the patient's current active admission and ward."),
 E::InvalidRecipient=>ApiError::conflict("handover_recipient_changed","Choose a current nurse from the admission's ward or leave the intended recipient unrecorded."),
 E::NotAuthor=>ApiError::forbidden("handover_author_required","Only the original author can amend or void this handover."),
 E::RevisionChanged=>ApiError::conflict("handover_revision_changed","The handover changed. Reload its current revision before reviewing another change."),
 E::Voided=>ApiError::conflict("handover_voided","This handover was voided. Its original evidence remains available in history."),
 E::RequestConflict=>ApiError::conflict("handover_request_conflict","This request reference belongs to another command. Review the original saved result."),
 E::AuthorizationExpired=>ApiError::forbidden("handover_authorization_expired","Current authorization is required to record this change. Sign in and review current access."),
 };
    }
    ApiError::conflict("patient_handover_write_unconfirmed","The handover change may already be saved. Check its original request reference before making another change, or retry the unchanged request.")
}
pub async fn list(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    q: PatientHandoverListQuery,
    deadline: DateTime<Utc>,
) -> Result<ListResponse<PatientHandoverListItem>, ApiError> {
    patient(s, ctx, q.patient_id).await?;
    if let Some(a) = q.admission_case_id {
        admission_scope(s, ctx, q.patient_id, a).await?;
    }
    let all = super::staff_assignments::can_view_all_ward_board(ctx, s.facility_id());
    if !all
        && !repo::has_patient_scope(
            s.db_pool(),
            s.facility_id(),
            ctx.user_id,
            q.patient_id,
            q.admission_case_id,
        )
        .await
        .map_err(error)?
    {
        return Err(ward_denied());
    }
    let p = page(q.cursor.as_deref(), q.limit)?;
    let size = p.limit;
    let limit = p.fetch_limit();
    let rows = repo::list_authorized(s.db_pool(), actor(ctx, deadline), &q, p.cursor, limit)
        .await
        .map_err(error)?;
    Ok(cursor_list::page_response(rows, size, |r| {
        cursor_list::encode_cursor(r.created_at, r.id)
    }))
}
pub async fn get(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
    deadline: DateTime<Utc>,
) -> Result<ObjectResponse<PatientHandoverDetail>, ApiError> {
    scope(s, ctx, id).await?;
    Ok(object(
        repo::detail_for_user(s.db_pool(), actor(ctx, deadline), id)
            .await
            .map_err(error)?,
    ))
}
pub async fn history(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
    q: PatientHandoverHistoryQuery,
    deadline: DateTime<Utc>,
) -> Result<ListResponse<PatientHandoverHistoryItem>, ApiError> {
    scope(s, ctx, id).await?;
    let p = page(q.cursor.as_deref(), q.limit)?;
    let size = p.limit;
    let limit = p.fetch_limit();
    let rows = repo::history_for_user(s.db_pool(), actor(ctx, deadline), id, p.cursor, limit)
        .await
        .map_err(error)?;
    Ok(cursor_list::page_response(rows, size, |r| {
        cursor_list::encode_cursor(r.recorded_at, r.id)
    }))
}
pub async fn revision(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
    r: Uuid,
    deadline: DateTime<Utc>,
) -> Result<ObjectResponse<PatientHandoverRevision>, ApiError> {
    scope(s, ctx, id).await?;
    Ok(object(
        repo::revision_for_user(s.db_pool(), actor(ctx, deadline), id, r)
            .await
            .map_err(error)?,
    ))
}
pub async fn recipients(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    q: HandoverRecipientQuery,
    deadline: DateTime<Utc>,
) -> Result<ListResponse<HandoverRecipient>, ApiError> {
    patient(s, ctx, q.patient_id).await?;
    admission_scope(s, ctx, q.patient_id, q.admission_case_id).await?;
    if let Some(id) = q.handover_id {
        let tuple = repo::context(s.db_pool(), s.facility_id(), id)
            .await
            .map_err(error)?
            .ok_or_else(not_found)?;
        if (tuple.0, tuple.1) != (q.patient_id, q.admission_case_id) {
            return Err(ApiError::bad_request(
                "handover_context_mismatch",
                "The handover and admission must refer to the same patient context.",
            ));
        }
    }
    let required_ward = if let Some(id) = q.handover_id {
        repo::context(s.db_pool(), s.facility_id(), id)
            .await
            .map_err(error)?
            .ok_or_else(not_found)?
            .2
    } else {
        common::load_admission_for_access(s, ctx, q.admission_case_id)
            .await?
            .ward_id
    };
    ward(s, ctx, required_ward).await?;
    let p = page(q.cursor.as_deref(), q.limit)?;
    let size = p.limit;
    let limit = p.fetch_limit();
    let rows = repo::recipients_authorized(
        s.db_pool(),
        actor(ctx, deadline),
        q.patient_id,
        q.admission_case_id,
        q.handover_id,
        p.cursor,
        limit,
    )
    .await
    .map_err(error)?;
    Ok(cursor_list::page_response(rows, size, |r| {
        cursor_list::encode_cursor(r.assigned_at, r.id)
    }))
}
pub async fn receipt(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    key: Uuid,
    p: Uuid,
    deadline: DateTime<Utc>,
) -> Result<ObjectResponse<PatientHandoverReceipt>, ApiError> {
    patient(s, ctx, p).await?;
    let (_, _, w) = repo::receipt_context(s.db_pool(), s.facility_id(), p, ctx.user_id, key)
        .await
        .map_err(error)?
        .ok_or_else(not_found)?;
    ward(s, ctx, w).await?;
    Ok(object(
        repo::receipt_for_user(s.db_pool(), actor(ctx, deadline), p, key)
            .await
            .map_err(error)?
            .ok_or_else(not_found)?,
    ))
}
pub async fn create(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    q: CreatePatientHandoverRequest,
    deadline: DateTime<Utc>,
) -> Result<ObjectResponse<PatientHandoverReceipt>, ApiError> {
    patient(s, ctx, q.patient_id).await?;
    admission_scope(s, ctx, q.patient_id, q.admission_case_id).await?;
    Ok(object(
        repo::create(s.db_pool(), actor(ctx, deadline), q)
            .await
            .map_err(error)?,
    ))
}
pub async fn amend(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
    q: AmendPatientHandoverRequest,
    deadline: DateTime<Utc>,
) -> Result<ObjectResponse<PatientHandoverReceipt>, ApiError> {
    scope(s, ctx, id).await?;
    Ok(object(
        repo::amend(s.db_pool(), actor(ctx, deadline), id, q)
            .await
            .map_err(error)?,
    ))
}
pub async fn void(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
    q: VoidPatientHandoverRequest,
    deadline: DateTime<Utc>,
) -> Result<ObjectResponse<PatientHandoverReceipt>, ApiError> {
    scope(s, ctx, id).await?;
    Ok(object(
        repo::void(s.db_pool(), actor(ctx, deadline), id, q)
            .await
            .map_err(error)?,
    ))
}

fn ward_denied() -> ApiError {
    ApiError::forbidden(
        "handover_ward_scope_denied",
        "Current assignment to the handover ward or explicit all-ward authority is required.",
    )
}
async fn ward(s: &AppState, ctx: &hms_access::RequestContext, id: Uuid) -> Result<(), ApiError> {
    if super::staff_assignments::can_view_all_ward_board(ctx, s.facility_id()) {
        return Ok(());
    }
    if hms_db::ward::user_has_active_ward_assignment(s.db_pool(), s.facility_id(), ctx.user_id, id)
        .await
        .map_err(error)?
    {
        Ok(())
    } else {
        Err(ward_denied())
    }
}
