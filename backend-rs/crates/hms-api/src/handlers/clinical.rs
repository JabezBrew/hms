use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::care::CursorListQuery;
use hms_domain::clinical::{
    AllergyListItem, ChangeProblemStatusRequest, ChartEntryListItem, ClinicalNoteDetail,
    ClinicalNoteListItem, ClinicalNoteTemplate, ClinicalNoteTemplateListQuery, ClinicalNoteVersion,
    CreateAllergyRequest, CreateChartEntryRequest, CreateClinicalNoteRequest,
    CreateClinicalNoteTemplateRequest, CreateClinicalNoteVersionRequest, CreatePrescriptionRequest,
    CreateProblemRequest, LaboratoryClinicalContext, PharmacyClinicalContext, PrescriptionListItem,
    ProblemArtifactLinkItem, ProblemArtifactLinkQuery, ProblemArtifactLinkRequest, ProblemListItem,
    UpdateAllergyRequest, UpdateClinicalNoteTemplateRequest, UpdatePrescriptionRequest,
    UpdateProblemRequest,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/clinical/note-templates",
    operation_id = "getClinicalNoteTemplates",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(ClinicalNoteTemplateListQuery),
    responses(
        (status = 200, description = "Clinical note templates", body = ListResponse<ClinicalNoteTemplate>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_note_templates(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<ClinicalNoteTemplateListQuery>,
) -> Result<Json<ListResponse<ClinicalNoteTemplate>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .list_note_templates(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/clinical/note-templates",
    operation_id = "postClinicalNoteTemplates",
    tag = "clinical",
    security(("bearerAuth" = [])),
    request_body = CreateClinicalNoteTemplateRequest,
    responses(
        (status = 200, description = "Clinical note template created", body = ObjectResponse<ClinicalNoteTemplate>),
        (status = 400, description = "Invalid clinical note template", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn create_note_template(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateClinicalNoteTemplateRequest>,
) -> Result<Json<ObjectResponse<ClinicalNoteTemplate>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .create_note_template(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/clinical/note-templates/{id}",
    operation_id = "getClinicalNoteTemplateById",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Clinical note template id")),
    responses(
        (status = 200, description = "Clinical note template detail", body = ObjectResponse<ClinicalNoteTemplate>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Clinical note template not found", body = ApiErrorResponse)
    )
)]
pub async fn get_note_template(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ClinicalNoteTemplate>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .get_note_template(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v2/clinical/note-templates/{id}",
    operation_id = "patchClinicalNoteTemplate",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Clinical note template id")),
    request_body = UpdateClinicalNoteTemplateRequest,
    responses(
        (status = 200, description = "Clinical note template updated", body = ObjectResponse<ClinicalNoteTemplate>),
        (status = 400, description = "Invalid clinical note template", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Clinical note template not found", body = ApiErrorResponse)
    )
)]
pub async fn update_note_template(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateClinicalNoteTemplateRequest>,
) -> Result<Json<ObjectResponse<ClinicalNoteTemplate>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .update_note_template(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v2/clinical/note-templates/{id}",
    operation_id = "deleteClinicalNoteTemplate",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Clinical note template id")),
    responses(
        (status = 200, description = "Clinical note template deactivated", body = ObjectResponse<ClinicalNoteTemplate>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Clinical note template not found", body = ApiErrorResponse)
    )
)]
pub async fn delete_note_template(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ClinicalNoteTemplate>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .delete_note_template(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/{patient_id}/clinical/notes",
    operation_id = "getPatientClinicalNotes",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(
        ("patient_id" = Uuid, Path, description = "Patient id"),
        CursorListQuery
    ),
    responses(
        (status = 200, description = "Patient clinical notes", body = ListResponse<ClinicalNoteListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn list_notes(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<ClinicalNoteListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .list_notes(&user, patient_id, query)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/patients/{patient_id}/clinical/notes",
    operation_id = "postPatientClinicalNotes",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("patient_id" = Uuid, Path, description = "Patient id")),
    request_body = CreateClinicalNoteRequest,
    responses(
        (status = 200, description = "Clinical note created", body = ObjectResponse<ClinicalNoteListItem>),
        (status = 400, description = "Invalid clinical note", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn create_note(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
    Json(payload): Json<CreateClinicalNoteRequest>,
) -> Result<Json<ObjectResponse<ClinicalNoteListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .create_note(&user, patient_id, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/clinical/notes/{note_id}",
    operation_id = "getClinicalNoteById",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("note_id" = Uuid, Path, description = "Clinical note id")),
    responses(
        (status = 200, description = "Clinical note detail", body = ObjectResponse<ClinicalNoteDetail>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Clinical note not found", body = ApiErrorResponse)
    )
)]
pub async fn get_note(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(note_id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ClinicalNoteDetail>>, ApiError> {
    Ok(Json(
        state.clinical_service().get_note(&user, note_id).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/clinical/notes/{note_id}/versions",
    operation_id = "getClinicalNoteVersions",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("note_id" = Uuid, Path, description = "Clinical note id")),
    responses(
        (status = 200, description = "Clinical note versions", body = ListResponse<ClinicalNoteVersion>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Clinical note not found", body = ApiErrorResponse)
    )
)]
pub async fn list_note_versions(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(note_id): Path<Uuid>,
) -> Result<Json<ListResponse<ClinicalNoteVersion>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .list_note_versions(&user, note_id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/clinical/notes/{note_id}/versions",
    operation_id = "postClinicalNoteVersions",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("note_id" = Uuid, Path, description = "Clinical note id")),
    request_body = CreateClinicalNoteVersionRequest,
    responses(
        (status = 200, description = "Clinical note version created", body = ObjectResponse<ClinicalNoteVersion>),
        (status = 400, description = "Invalid clinical note version", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Clinical note not found", body = ApiErrorResponse)
    )
)]
pub async fn create_note_version(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(note_id): Path<Uuid>,
    Json(payload): Json<CreateClinicalNoteVersionRequest>,
) -> Result<Json<ObjectResponse<ClinicalNoteVersion>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .create_note_version(&user, note_id, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/{patient_id}/clinical/problems",
    operation_id = "getPatientProblems",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(
        ("patient_id" = Uuid, Path, description = "Patient id"),
        CursorListQuery
    ),
    responses(
        (status = 200, description = "Patient problems", body = ListResponse<ProblemListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn list_problems(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<ProblemListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .list_problems(&user, patient_id, query)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/patients/{patient_id}/clinical/problems",
    operation_id = "postPatientProblems",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("patient_id" = Uuid, Path, description = "Patient id")),
    request_body = CreateProblemRequest,
    responses(
        (status = 200, description = "Problem created", body = ObjectResponse<ProblemListItem>),
        (status = 400, description = "Invalid problem", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn create_problem(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
    Json(payload): Json<CreateProblemRequest>,
) -> Result<Json<ObjectResponse<ProblemListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .create_problem(&user, patient_id, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/clinical/problems/{id}",
    operation_id = "getClinicalProblemById",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Problem id")),
    responses(
        (status = 200, description = "Problem detail", body = ObjectResponse<ProblemListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Problem not found", body = ApiErrorResponse)
    )
)]
pub async fn get_problem(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ProblemListItem>>, ApiError> {
    Ok(Json(state.clinical_service().get_problem(&user, id).await?))
}

#[utoipa::path(
    patch,
    path = "/api/v2/clinical/problems/{id}",
    operation_id = "patchClinicalProblemById",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Problem id")),
    request_body = UpdateProblemRequest,
    responses(
        (status = 200, description = "Problem updated", body = ObjectResponse<ProblemListItem>),
        (status = 400, description = "Invalid problem update", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Problem not found", body = ApiErrorResponse)
    )
)]
pub async fn update_problem(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateProblemRequest>,
) -> Result<Json<ObjectResponse<ProblemListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .update_problem(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/clinical/problems/{id}/status",
    operation_id = "postClinicalProblemStatus",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Problem id")),
    request_body = ChangeProblemStatusRequest,
    responses(
        (status = 200, description = "Problem status updated", body = ObjectResponse<ProblemListItem>),
        (status = 400, description = "Invalid problem status", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Problem not found", body = ApiErrorResponse)
    )
)]
pub async fn change_problem_status(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<ChangeProblemStatusRequest>,
) -> Result<Json<ObjectResponse<ProblemListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .change_problem_status(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/clinical/problem-links",
    operation_id = "getClinicalProblemLinks",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(ProblemArtifactLinkQuery),
    responses(
        (status = 200, description = "Problem artifact links", body = ListResponse<ProblemArtifactLinkItem>),
        (status = 400, description = "Invalid artifact filter", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse)
    )
)]
pub async fn list_problem_artifact_links(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<ProblemArtifactLinkQuery>,
) -> Result<Json<ListResponse<ProblemArtifactLinkItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .list_problem_artifact_links(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/clinical/problem-links",
    operation_id = "postClinicalProblemLinks",
    tag = "clinical",
    security(("bearerAuth" = [])),
    request_body = ProblemArtifactLinkRequest,
    responses(
        (status = 200, description = "Problem artifact link created", body = ObjectResponse<ProblemArtifactLinkItem>),
        (status = 400, description = "Invalid problem link", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse)
    )
)]
pub async fn create_problem_artifact_link(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<ProblemArtifactLinkRequest>,
) -> Result<Json<ObjectResponse<ProblemArtifactLinkItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .create_problem_artifact_link(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v2/clinical/problem-links/{id}",
    operation_id = "deleteClinicalProblemLink",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Problem link id")),
    responses(
        (status = 200, description = "Problem artifact link deleted", body = ObjectResponse<ProblemArtifactLinkItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Problem link not found", body = ApiErrorResponse)
    )
)]
pub async fn delete_problem_artifact_link(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ProblemArtifactLinkItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .delete_problem_artifact_link(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/{patient_id}/clinical/pharmacy-context",
    operation_id = "getPatientPharmacyClinicalContext",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("patient_id" = Uuid, Path, description = "Patient id")),
    responses(
        (status = 200, description = "Pharmacy clinical context", body = ObjectResponse<PharmacyClinicalContext>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn get_pharmacy_clinical_context(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PharmacyClinicalContext>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .pharmacy_clinical_context(&user, patient_id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/orders/{order_id}/clinical-context",
    operation_id = "getLaboratoryOrderClinicalContext",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("order_id" = Uuid, Path, description = "Laboratory order id")),
    responses(
        (status = 200, description = "Laboratory clinical context", body = ObjectResponse<LaboratoryClinicalContext>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Lab order not found", body = ApiErrorResponse)
    )
)]
pub async fn get_laboratory_clinical_context(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(order_id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LaboratoryClinicalContext>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .laboratory_clinical_context(&user, order_id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/{patient_id}/clinical/allergies",
    operation_id = "getPatientAllergies",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(
        ("patient_id" = Uuid, Path, description = "Patient id"),
        CursorListQuery
    ),
    responses(
        (status = 200, description = "Patient allergies", body = ListResponse<AllergyListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn list_allergies(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<AllergyListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .list_allergies(&user, patient_id, query)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/patients/{patient_id}/clinical/allergies",
    operation_id = "postPatientAllergies",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("patient_id" = Uuid, Path, description = "Patient id")),
    request_body = CreateAllergyRequest,
    responses(
        (status = 200, description = "Allergy created", body = ObjectResponse<AllergyListItem>),
        (status = 400, description = "Invalid allergy", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn create_allergy(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
    Json(payload): Json<CreateAllergyRequest>,
) -> Result<Json<ObjectResponse<AllergyListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .create_allergy(&user, patient_id, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/clinical/allergies/{id}",
    operation_id = "getClinicalAllergyById",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Allergy id")),
    responses(
        (status = 200, description = "Allergy detail", body = ObjectResponse<AllergyListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Allergy not found", body = ApiErrorResponse)
    )
)]
pub async fn get_allergy(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AllergyListItem>>, ApiError> {
    Ok(Json(state.clinical_service().get_allergy(&user, id).await?))
}

#[utoipa::path(
    patch,
    path = "/api/v2/clinical/allergies/{id}",
    operation_id = "patchClinicalAllergy",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Allergy id")),
    request_body = UpdateAllergyRequest,
    responses(
        (status = 200, description = "Allergy updated", body = ObjectResponse<AllergyListItem>),
        (status = 400, description = "Invalid allergy update", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Allergy not found", body = ApiErrorResponse)
    )
)]
pub async fn update_allergy(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateAllergyRequest>,
) -> Result<Json<ObjectResponse<AllergyListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .update_allergy(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v2/clinical/allergies/{id}",
    operation_id = "deleteClinicalAllergy",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Allergy id")),
    responses(
        (status = 200, description = "Allergy deactivated", body = ObjectResponse<AllergyListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Allergy not found", body = ApiErrorResponse)
    )
)]
pub async fn delete_allergy(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AllergyListItem>>, ApiError> {
    Ok(Json(
        state.clinical_service().delete_allergy(&user, id).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/{patient_id}/clinical/prescriptions",
    operation_id = "getPatientPrescriptions",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(
        ("patient_id" = Uuid, Path, description = "Patient id"),
        CursorListQuery
    ),
    responses(
        (status = 200, description = "Patient prescriptions", body = ListResponse<PrescriptionListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn list_prescriptions(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<PrescriptionListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .list_prescriptions(&user, patient_id, query)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/patients/{patient_id}/clinical/prescriptions",
    operation_id = "postPatientPrescriptions",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("patient_id" = Uuid, Path, description = "Patient id")),
    request_body = CreatePrescriptionRequest,
    responses(
        (status = 200, description = "Prescription created", body = ObjectResponse<PrescriptionListItem>),
        (status = 400, description = "Invalid prescription", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn create_prescription(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
    Json(payload): Json<CreatePrescriptionRequest>,
) -> Result<Json<ObjectResponse<PrescriptionListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .create_prescription(&user, patient_id, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/clinical/prescriptions/{id}",
    operation_id = "getClinicalPrescriptionById",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Prescription id")),
    responses(
        (status = 200, description = "Prescription detail", body = ObjectResponse<PrescriptionListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Prescription not found", body = ApiErrorResponse)
    )
)]
pub async fn get_prescription(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PrescriptionListItem>>, ApiError> {
    Ok(Json(
        state.clinical_service().get_prescription(&user, id).await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v2/clinical/prescriptions/{id}",
    operation_id = "patchClinicalPrescription",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Prescription id")),
    request_body = UpdatePrescriptionRequest,
    responses(
        (status = 200, description = "Prescription updated", body = ObjectResponse<PrescriptionListItem>),
        (status = 400, description = "Invalid prescription update", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Prescription not found", body = ApiErrorResponse)
    )
)]
pub async fn update_prescription(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdatePrescriptionRequest>,
) -> Result<Json<ObjectResponse<PrescriptionListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .update_prescription(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/{patient_id}/clinical/chart-entries",
    operation_id = "getPatientChartEntries",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(
        ("patient_id" = Uuid, Path, description = "Patient id"),
        CursorListQuery
    ),
    responses(
        (status = 200, description = "Patient chart entries", body = ListResponse<ChartEntryListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn list_chart_entries(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<ChartEntryListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .list_chart_entries(&user, patient_id, query)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/patients/{patient_id}/clinical/chart-entries",
    operation_id = "postPatientChartEntries",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("patient_id" = Uuid, Path, description = "Patient id")),
    request_body = CreateChartEntryRequest,
    responses(
        (status = 200, description = "Chart entry created", body = ObjectResponse<ChartEntryListItem>),
        (status = 400, description = "Invalid chart entry", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn create_chart_entry(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
    Json(payload): Json<CreateChartEntryRequest>,
) -> Result<Json<ObjectResponse<ChartEntryListItem>>, ApiError> {
    Ok(Json(
        state
            .clinical_service()
            .create_chart_entry(&user, patient_id, payload)
            .await?,
    ))
}
