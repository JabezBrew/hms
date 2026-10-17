use crate::{
    cursor_list,
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use chrono::{DateTime, Utc};
use hms_db::ward::admission_advisories::{
    self as db, AdvisoryActor, AdvisoryCaseCursor, AdvisoryError,
};
use hms_domain::{
    admission_advisories::*, auth::PatientDataVisibility, deployment::PermissionCode,
};
use uuid::Uuid;

#[derive(Clone)]
pub struct AdmissionAdvisoriesService {
    state: AppState,
}
impl AdmissionAdvisoriesService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }
    async fn actor(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
    ) -> Result<AdvisoryActor, ApiError> {
        let facility = self.state.facility_id();
        super::common::require_patient_workflow_access(
            ctx,
            facility,
            PermissionCode::AdmissionManage,
        )?;
        hms_access::require_chronicle_read_access(ctx, facility).map_err(ApiError::from)?;
        if !ctx.has_patient_visibility(PatientDataVisibility::FullClinical) {
            return Err(ApiError::forbidden(
                "admission_advisory_access_denied",
                "Full clinical record access is required for admission follow-up.",
            ));
        }
        let record = super::common::load_patient_for_access(&self.state, ctx, patient).await?;
        let evidence = hms_db::auth::clinical_patient_access_evidence(
            self.state.db_pool(),
            facility,
            ctx.user_id,
            patient,
            Utc::now(),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_advisory_read_failed",
                "Current clinical access could not be checked.",
            )
        })?;
        if evidence.workflow_reason.is_none() {
            return Err(ApiError::forbidden(
                "admission_advisory_access_denied",
                "A current clinical relationship is required for this admission follow-up.",
            ));
        }
        let decision =
            hms_access::evaluate_clinical_patient_access(ctx, &record, &evidence, Utc::now())
                .map_err(|_| {
                    ApiError::forbidden(
                        "admission_advisory_access_denied",
                        "Current clinical access is required for this admission follow-up.",
                    )
                })?;
        Ok(AdvisoryActor {
            facility_id: facility,
            user_id: ctx.user_id,
            request_id: Some(ctx.request_id.clone()),
            authorization: hms_db::clinical::prescription_courses::PrescriptionAuthorization {
                resolved_network_policy_version: ctx.resolved_network_policy_version,
                session_id: ctx.session_id,
                session_version: ctx.session_version,
                permission_version: ctx.permission_version,
                active_profile: ctx.active_profile,
                valid_until: if ctx.offsite == hms_access::OffsiteState::OffsiteFreshReauth {
                    deadline.min(ctx.reauth.required_after)
                } else {
                    deadline
                },
            },
            can_write: !decision.read_only,
            can_view_all_wards: super::can_view_all_ward_board(ctx, facility),
        })
    }
    pub async fn cases(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        q: AdmissionAdvisoryCaseQuery,
    ) -> Result<ListResponse<AdmissionAdvisoryCase>, ApiError> {
        let actor = self.actor(ctx, deadline, patient).await?;
        let page =
            cursor_list::page_request(q.cursor.as_deref(), q.limit, 25, 100, |created_at, id| {
                AdvisoryCaseCursor { created_at, id }
            })?;
        let fetch_limit = page.fetch_limit();
        let rows = db::list_cases(
            self.state.db_pool(),
            actor,
            patient,
            q,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|e| map_error(e, false))?;
        Ok(cursor_list::page_response(rows, page.limit, |r| {
            cursor_list::encode_cursor(r.created_at, r.admission_case_id)
        }))
    }
    pub async fn context(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        case_id: Uuid,
    ) -> Result<ObjectResponse<AdmissionAdvisoryContext>, ApiError> {
        let actor = self.actor(ctx, deadline, patient).await?;
        Ok(object(
            db::context(self.state.db_pool(), actor, patient, case_id)
                .await
                .map_err(|e| map_error(e, false))?,
        ))
    }
    pub async fn get(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        case_id: Uuid,
        id: Uuid,
    ) -> Result<ObjectResponse<AdmissionAdvisoryDetail>, ApiError> {
        let actor = self.actor(ctx, deadline, patient).await?;
        Ok(object(
            db::get(self.state.db_pool(), actor, patient, case_id, id)
                .await
                .map_err(|e| map_error(e, false))?,
        ))
    }
    pub async fn create(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        case_id: Uuid,
        input: CreateAdmissionAdvisoryRequest,
    ) -> Result<ObjectResponse<AdmissionAdvisoryReceipt>, ApiError> {
        let actor = self.actor(ctx, deadline, patient).await?;
        let result = db::create(self.state.db_pool(), actor, patient, case_id, input).await;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(result.map_err(|e| map_error(e, true))?))
    }
    pub async fn decide(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        case_id: Uuid,
        id: Uuid,
        input: DecideAdmissionAdvisoryRequest,
    ) -> Result<ObjectResponse<AdmissionAdvisoryReceipt>, ApiError> {
        let actor = self.actor(ctx, deadline, patient).await?;
        let result = db::decide(self.state.db_pool(), actor, patient, case_id, id, input).await;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(result.map_err(|e| map_error(e, true))?))
    }
    pub async fn receipt(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        case_id: Uuid,
        key: Uuid,
    ) -> Result<ObjectResponse<AdmissionAdvisoryReceipt>, ApiError> {
        let actor = self.actor(ctx, deadline, patient).await?;
        Ok(object(
            db::receipt(self.state.db_pool(), actor, patient, case_id, key)
                .await
                .map_err(|e| map_error(e, false))?,
        ))
    }
}
pub(super) fn map_error(error: anyhow::Error, write: bool) -> ApiError {
    if let Some(error) = ApiError::network_publication(&error) {
        return error;
    }
    if error.root_cause().to_string() == "discharge blockers are still open" {
        return ApiError::conflict(
            "discharge_blockers_open",
            "Complete or explicitly resolve the existing discharge blockers before discharge.",
        );
    }
    if let Some(e) = error.downcast_ref::<AdvisoryError>() {
        return match e {
        AdvisoryError::NotFound=>ApiError::not_found("admission_advisory_not_found","The admission follow-up or original request was not found in this scope."),
        AdvisoryError::InvalidInput=>ApiError::bad_request("invalid_admission_advisory","Review the supported type, note, decision and original request reference."),
        AdvisoryError::AuthorityExpired=>ApiError::forbidden("admission_advisory_authorization_expired","Current authorization is required before continuing."),
        AdvisoryError::FeatureDisabled=>ApiError::forbidden("feature_disabled","A required admission follow-up feature is disabled."),
        AdvisoryError::PatientDenied=>ApiError::forbidden("admission_advisory_access_denied","Current full clinical access and an ordinary care relationship are required."),
        AdvisoryError::WardDenied=>ApiError::forbidden("admission_advisory_ward_denied","Current authority for this admission's ward is required."),
        AdvisoryError::ContextChanged=>ApiError::conflict("admission_advisory_context_changed","The selected admission or ward changed. Review its current context."),
        AdvisoryError::VersionChanged=>ApiError::conflict("admission_advisory_version_changed","This follow-up changed. Reload its saved evidence."),
        AdvisoryError::TypeExists=>ApiError::conflict("admission_advisory_type_exists","This admission already has that type of follow-up. Review its existing evidence."),
        AdvisoryError::Terminal=>ApiError::conflict("admission_advisory_terminal","This follow-up already has a terminal decision. Its original evidence is preserved."),
        AdvisoryError::RequestConflict=>ApiError::conflict("admission_advisory_request_conflict","This reference belongs to another command. Review the original result."),
    };
    }
    if error
        .downcast_ref::<hms_db::clinical::prescription_courses::PrescriptionCourseError>()
        .is_some()
    {
        return ApiError::forbidden(
            "admission_advisory_authorization_expired",
            "Current authorization is required before continuing.",
        );
    }
    if write {
        ApiError::conflict("admission_advisory_write_unconfirmed","This change may already be saved. Keep the exact request reference and review or retry that same command.")
    } else {
        ApiError::conflict(
            "admission_advisory_read_failed",
            "The complete protected admission follow-up could not be loaded.",
        )
    }
}

pub(super) fn closure_actor(
    ctx: &hms_access::RequestContext,
    facility: Uuid,
    deadline: DateTime<Utc>,
) -> db::AdmissionClosureActor {
    db::AdmissionClosureActor {
        facility_id: facility,
        user_id: ctx.user_id,
        request_id: Some(ctx.request_id.clone()),
        authorization: hms_db::clinical::prescription_courses::PrescriptionAuthorization {
            resolved_network_policy_version: ctx.resolved_network_policy_version,
            session_id: ctx.session_id,
            session_version: ctx.session_version,
            permission_version: ctx.permission_version,
            active_profile: ctx.active_profile,
            valid_until: if ctx.offsite == hms_access::OffsiteState::OffsiteFreshReauth {
                deadline.min(ctx.reauth.required_after)
            } else {
                deadline
            },
        },
    }
}
