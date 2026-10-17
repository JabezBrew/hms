use crate::{
    error::{ApiError, ApiErrorResponse},
    extractors::NetworkContext,
    response::ObjectResponse,
    services::referral_consultations::{invalid, ReferralConsultationsService},
    state::AppState,
};
use axum::{
    extract::{
        rejection::{JsonRejection, PathRejection, QueryRejection},
        Path, Query, State,
    },
    Json,
};
use hms_domain::referral_consultations::*;
use uuid::Uuid;
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/referrals/{referral_id}/consultation",operation_id="getReferralConsultationContext",tag="referrals",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("referral_id"=Uuid,Path),ReferralConsultationContextQuery),responses((status=200,body=ObjectResponse<ReferralConsultationContext>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn context(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid)>, PathRejection>,
    q: Result<Query<ReferralConsultationContextQuery>, QueryRejection>,
) -> Result<Json<ObjectResponse<ReferralConsultationContext>>, ApiError> {
    let Path((patient, referral)) = p.map_err(|_| invalid())?;
    let Query(q) = q.map_err(|_| invalid())?;
    Ok(Json(
        ReferralConsultationsService::new(s)
            .context(&n.context, n.authorization_deadline, patient, referral, q)
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/patients/{patient_id}/referrals/{referral_id}/consultation/start",operation_id="startReferralConsultation",tag="referrals",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("referral_id"=Uuid,Path)),request_body=ReferralConsultationStartRequest,responses((status=200,body=ObjectResponse<ReferralConsultationStartReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn start(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid)>, PathRejection>,
    input: Result<Json<ReferralConsultationStartRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<ReferralConsultationStartReceipt>>, ApiError> {
    let Path((patient, referral)) = p.map_err(|_| invalid())?;
    let Json(input) = input.map_err(|_| invalid())?;
    Ok(Json(
        ReferralConsultationsService::new(s)
            .start(
                &n.context,
                n.authorization_deadline,
                patient,
                referral,
                input,
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/referrals/{referral_id}/consultation/requests/{request_id}",operation_id="getReferralConsultationRequestReceipt",tag="referrals",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("referral_id"=Uuid,Path),("request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<ReferralConsultationStartReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn receipt(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<Json<ObjectResponse<ReferralConsultationStartReceipt>>, ApiError> {
    let Path((patient, referral, key)) = p.map_err(|_| invalid())?;
    Ok(Json(
        ReferralConsultationsService::new(s)
            .receipt(&n.context, n.authorization_deadline, patient, referral, key)
            .await?,
    ))
}
