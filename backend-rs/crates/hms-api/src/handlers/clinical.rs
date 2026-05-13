use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::{require_patient_demographics_access, require_permission};
use hms_db::clinical::ClinicalCursor;
use hms_domain::auth::{AuthUser, PatientDataVisibility};
use hms_domain::care::CursorListQuery;
use hms_domain::clinical::{
    AllergyListItem, ChangeProblemStatusRequest, ChartEntryListItem, ClinicalNoteDetail,
    ClinicalNoteListItem, ClinicalNoteTemplate, ClinicalNoteVersion, CreateAllergyRequest,
    CreateChartEntryRequest, CreateClinicalNoteRequest, CreateClinicalNoteTemplateRequest,
    CreateClinicalNoteVersionRequest, CreatePrescriptionRequest, CreateProblemRequest,
    PrescriptionListItem, ProblemListItem, UpdateAllergyRequest, UpdateClinicalNoteTemplateRequest,
    UpdatePrescriptionRequest, UpdateProblemRequest,
};
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use serde_json::json;
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::AuthenticatedUser;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const MAX_TITLE_LEN: usize = 160;
const MAX_SHORT_TEXT_LEN: usize = 120;
const MAX_NOTE_BODY_LEN: usize = 20_000;

#[utoipa::path(
    get,
    path = "/api/v2/clinical/note-templates",
    operation_id = "getClinicalNoteTemplates",
    tag = "clinical",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Clinical note templates", body = ListResponse<ClinicalNoteTemplate>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_note_templates(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ListResponse<ClinicalNoteTemplate>>, ApiError> {
    require_clinical_list_access(&user, state.facility_id())?;
    let templates = state.list_clinical_note_templates().await.map_err(|_| {
        ApiError::conflict(
            "clinical_template_list_failed",
            "Clinical note templates could not be loaded.",
        )
    })?;

    Ok(Json(list(
        templates,
        PageInfo {
            next_cursor: None,
            has_next: false,
            limit: MAX_LIMIT,
        },
    )))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateClinicalNoteTemplateRequest>,
) -> Result<Json<ObjectResponse<ClinicalNoteTemplate>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let title = normalize_text(payload.title, "title", MAX_TITLE_LEN)?;
    let note_type = normalize_text(payload.note_type, "note_type", MAX_SHORT_TEXT_LEN)?;
    let body_template = normalize_text(payload.body_template, "body_template", MAX_NOTE_BODY_LEN)?;
    let template = state
        .create_clinical_note_template(title, note_type, body_template)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_template_create_failed",
                "Clinical note template could not be saved.",
            )
        })?;

    Ok(Json(object(template)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(mut payload): Json<UpdateClinicalNoteTemplateRequest>,
) -> Result<Json<ObjectResponse<ClinicalNoteTemplate>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    payload.title = normalize_optional_text(payload.title, "title", MAX_TITLE_LEN)?;
    payload.note_type =
        normalize_optional_text(payload.note_type, "note_type", MAX_SHORT_TEXT_LEN)?;
    payload.body_template =
        normalize_optional_text(payload.body_template, "body_template", MAX_NOTE_BODY_LEN)?;
    if payload.title.is_none()
        && payload.note_type.is_none()
        && payload.body_template.is_none()
        && payload.is_active.is_none()
    {
        return Err(validation_error(
            "template",
            "At least one field is required.",
        ));
    }

    let template = state
        .update_clinical_note_template(id, payload)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_template_update_failed",
                "Clinical note template could not be saved.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "clinical_template_not_found",
                "Clinical note template was not found.",
            )
        })?;

    Ok(Json(object(template)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ClinicalNoteTemplate>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let template = state
        .deactivate_clinical_note_template(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_template_delete_failed",
                "Clinical note template could not be deactivated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "clinical_template_not_found",
                "Clinical note template was not found.",
            )
        })?;

    Ok(Json(object(template)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<ClinicalNoteListItem>>, ApiError> {
    require_clinical_list_access(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_clinical_notes(patient_id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_note_list_failed",
                "Clinical notes could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.updated_at, item.id)
    })))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(patient_id): Path<Uuid>,
    Json(payload): Json<CreateClinicalNoteRequest>,
) -> Result<Json<ObjectResponse<ClinicalNoteListItem>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    let note_type = normalize_text(payload.note_type, "note_type", MAX_SHORT_TEXT_LEN)?;
    let title = normalize_text(payload.title, "title", MAX_TITLE_LEN)?;
    let body = normalize_text(payload.body, "body", MAX_NOTE_BODY_LEN)?;
    let note = state
        .create_clinical_note(patient_id, note_type, title, body, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_note_create_failed",
                "Clinical note could not be created.",
            )
        })?;

    Ok(Json(object(note)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(note_id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ClinicalNoteDetail>>, ApiError> {
    let _note_context = load_note_for_access(
        &state,
        &user,
        note_id,
        PermissionCode::ClinicalDocumentationView,
    )
    .await?;
    let note = state
        .get_clinical_note_detail(note_id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_note_load_failed",
                "Clinical note could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("clinical_note_not_found", "Clinical note was not found.")
        })?;

    Ok(Json(object(note)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(note_id): Path<Uuid>,
) -> Result<Json<ListResponse<ClinicalNoteVersion>>, ApiError> {
    let note = load_note_for_access(
        &state,
        &user,
        note_id,
        PermissionCode::ClinicalDocumentationView,
    )
    .await?;
    let versions = state
        .list_clinical_note_versions(note.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_note_version_list_failed",
                "Clinical note versions could not be loaded.",
            )
        })?;

    Ok(Json(list(
        versions,
        PageInfo {
            next_cursor: None,
            has_next: false,
            limit: MAX_LIMIT,
        },
    )))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(note_id): Path<Uuid>,
    Json(payload): Json<CreateClinicalNoteVersionRequest>,
) -> Result<Json<ObjectResponse<ClinicalNoteVersion>>, ApiError> {
    let note = load_note_for_access(
        &state,
        &user,
        note_id,
        PermissionCode::ClinicalDocumentationManage,
    )
    .await?;
    let body = normalize_text(payload.body, "body", MAX_NOTE_BODY_LEN)?;
    let version = state
        .create_clinical_note_version(note.id, body, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_note_version_create_failed",
                "Clinical note version could not be created.",
            )
        })?;

    Ok(Json(object(version)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<ProblemListItem>>, ApiError> {
    require_clinical_list_access(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_problems(patient_id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("problem_list_failed", "Problems could not be loaded."))?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(patient_id): Path<Uuid>,
    Json(payload): Json<CreateProblemRequest>,
) -> Result<Json<ObjectResponse<ProblemListItem>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    let label = normalize_text(payload.label, "label", MAX_TITLE_LEN)?;
    let problem = state
        .create_problem(patient_id, label, payload.onset_date, user.id)
        .await
        .map_err(|_| ApiError::conflict("problem_create_failed", "Problem could not be saved."))?;

    Ok(Json(object(problem)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ProblemListItem>>, ApiError> {
    require_clinical_list_access(&user, state.facility_id())?;
    let problem = state
        .get_problem(id)
        .await
        .map_err(|_| ApiError::conflict("problem_load_failed", "Problem could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("problem_not_found", "Problem was not found."))?;
    let _patient = load_patient_for_access(&state, &user, problem.patient_id).await?;

    Ok(Json(object(problem)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(mut payload): Json<UpdateProblemRequest>,
) -> Result<Json<ObjectResponse<ProblemListItem>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let existing = state
        .get_problem(id)
        .await
        .map_err(|_| ApiError::conflict("problem_load_failed", "Problem could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("problem_not_found", "Problem was not found."))?;
    let _patient = load_patient_for_access(&state, &user, existing.patient_id).await?;
    if let Some(label) = payload.label.take() {
        payload.label = Some(normalize_text(label, "label", MAX_TITLE_LEN)?);
    }
    let problem = state
        .update_problem(id, payload)
        .await
        .map_err(|_| ApiError::conflict("problem_update_failed", "Problem could not be updated."))?
        .ok_or_else(|| ApiError::not_found("problem_not_found", "Problem was not found."))?;

    Ok(Json(object(problem)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<ChangeProblemStatusRequest>,
) -> Result<Json<ObjectResponse<ProblemListItem>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let existing = state
        .get_problem(id)
        .await
        .map_err(|_| ApiError::conflict("problem_load_failed", "Problem could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("problem_not_found", "Problem was not found."))?;
    let _patient = load_patient_for_access(&state, &user, existing.patient_id).await?;
    let problem = state
        .update_problem_status(id, payload.status)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "problem_status_update_failed",
                "Problem status could not be updated.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("problem_not_found", "Problem was not found."))?;

    Ok(Json(object(problem)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<AllergyListItem>>, ApiError> {
    require_clinical_list_access(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_allergies(patient_id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("allergy_list_failed", "Allergies could not be loaded."))?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(patient_id): Path<Uuid>,
    Json(payload): Json<CreateAllergyRequest>,
) -> Result<Json<ObjectResponse<AllergyListItem>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    let substance = normalize_text(payload.substance, "substance", MAX_TITLE_LEN)?;
    let reaction = normalize_optional_text(payload.reaction, "reaction", MAX_TITLE_LEN)?;
    let allergy = state
        .create_allergy(patient_id, substance, reaction, payload.severity, user.id)
        .await
        .map_err(|_| ApiError::conflict("allergy_create_failed", "Allergy could not be saved."))?;

    Ok(Json(object(allergy)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AllergyListItem>>, ApiError> {
    require_action_permission(
        &user,
        state.facility_id(),
        PermissionCode::ClinicalDocumentationView,
    )?;
    let allergy = state
        .get_allergy(id)
        .await
        .map_err(|_| ApiError::conflict("allergy_load_failed", "Allergy could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("allergy_not_found", "Allergy was not found."))?;
    let _patient = load_patient_for_access(&state, &user, allergy.patient_id).await?;

    Ok(Json(object(allergy)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(mut payload): Json<UpdateAllergyRequest>,
) -> Result<Json<ObjectResponse<AllergyListItem>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let current = state
        .get_allergy(id)
        .await
        .map_err(|_| ApiError::conflict("allergy_load_failed", "Allergy could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("allergy_not_found", "Allergy was not found."))?;
    let _patient = load_patient_for_access(&state, &user, current.patient_id).await?;

    payload.substance = normalize_optional_text(payload.substance, "substance", MAX_TITLE_LEN)?;
    payload.reaction = normalize_optional_text(payload.reaction, "reaction", MAX_TITLE_LEN)?;
    if payload.substance.is_none()
        && payload.reaction.is_none()
        && payload.severity.is_none()
        && payload.status.is_none()
    {
        return Err(validation_error(
            "allergy",
            "At least one field is required.",
        ));
    }

    let allergy = state
        .update_allergy(id, payload)
        .await
        .map_err(|_| ApiError::conflict("allergy_update_failed", "Allergy could not be updated."))?
        .ok_or_else(|| ApiError::not_found("allergy_not_found", "Allergy was not found."))?;

    Ok(Json(object(allergy)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AllergyListItem>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let current = state
        .get_allergy(id)
        .await
        .map_err(|_| ApiError::conflict("allergy_load_failed", "Allergy could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("allergy_not_found", "Allergy was not found."))?;
    let _patient = load_patient_for_access(&state, &user, current.patient_id).await?;
    let allergy = state
        .deactivate_allergy(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "allergy_deactivate_failed",
                "Allergy could not be deactivated.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("allergy_not_found", "Allergy was not found."))?;

    Ok(Json(object(allergy)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<PrescriptionListItem>>, ApiError> {
    require_clinical_list_access(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_prescriptions(patient_id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "prescription_list_failed",
                "Prescriptions could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.prescribed_at, item.id)
    })))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(patient_id): Path<Uuid>,
    Json(payload): Json<CreatePrescriptionRequest>,
) -> Result<Json<ObjectResponse<PrescriptionListItem>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    let medication_name =
        normalize_text(payload.medication_name, "medication_name", MAX_TITLE_LEN)?;
    let dose = normalize_text(payload.dose, "dose", MAX_SHORT_TEXT_LEN)?;
    let frequency = normalize_text(payload.frequency, "frequency", MAX_SHORT_TEXT_LEN)?;
    let prescription = state
        .create_prescription(patient_id, medication_name, dose, frequency, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "prescription_create_failed",
                "Prescription could not be saved.",
            )
        })?;

    Ok(Json(object(prescription)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PrescriptionListItem>>, ApiError> {
    require_action_permission(
        &user,
        state.facility_id(),
        PermissionCode::ClinicalDocumentationView,
    )?;
    let prescription = state
        .get_prescription(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "prescription_load_failed",
                "Prescription could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("prescription_not_found", "Prescription was not found.")
        })?;
    let _patient = load_patient_for_access(&state, &user, prescription.patient_id).await?;

    Ok(Json(object(prescription)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(mut payload): Json<UpdatePrescriptionRequest>,
) -> Result<Json<ObjectResponse<PrescriptionListItem>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let current = state
        .get_prescription(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "prescription_load_failed",
                "Prescription could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("prescription_not_found", "Prescription was not found.")
        })?;
    let _patient = load_patient_for_access(&state, &user, current.patient_id).await?;

    payload.medication_name =
        normalize_optional_text(payload.medication_name, "medication_name", MAX_TITLE_LEN)?;
    payload.dose = normalize_optional_text(payload.dose, "dose", MAX_SHORT_TEXT_LEN)?;
    payload.frequency =
        normalize_optional_text(payload.frequency, "frequency", MAX_SHORT_TEXT_LEN)?;
    if payload.medication_name.is_none()
        && payload.dose.is_none()
        && payload.frequency.is_none()
        && payload.status.is_none()
    {
        return Err(validation_error(
            "prescription",
            "At least one field is required.",
        ));
    }

    let prescription = state
        .update_prescription(id, payload)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "prescription_update_failed",
                "Prescription could not be updated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("prescription_not_found", "Prescription was not found.")
        })?;

    Ok(Json(object(prescription)))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<ChartEntryListItem>>, ApiError> {
    require_clinical_list_access(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_chart_entries(patient_id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "chart_entry_list_failed",
                "Chart entries could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.measured_at, item.id)
    })))
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
    AuthenticatedUser(user): AuthenticatedUser,
    Path(patient_id): Path<Uuid>,
    Json(payload): Json<CreateChartEntryRequest>,
) -> Result<Json<ObjectResponse<ChartEntryListItem>>, ApiError> {
    require_clinical_write_access(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    let value = normalize_text(payload.value, "value", MAX_SHORT_TEXT_LEN)?;
    let unit = normalize_optional_text(payload.unit, "unit", MAX_SHORT_TEXT_LEN)?;
    let entry = state
        .create_chart_entry(
            patient_id,
            payload.entry_type,
            payload.measured_at,
            value,
            unit,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "chart_entry_create_failed",
                "Chart entry could not be saved.",
            )
        })?;

    Ok(Json(object(entry)))
}

async fn load_note_for_access(
    state: &AppState,
    user: &AuthUser,
    note_id: Uuid,
    permission: PermissionCode,
) -> Result<hms_db::clinical::NoteContext, ApiError> {
    require_action_permission(user, state.facility_id(), permission)?;
    let note = state
        .get_clinical_note_context(note_id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_note_load_failed",
                "Clinical note could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("clinical_note_not_found", "Clinical note was not found.")
        })?;
    let _patient = load_patient_for_access(state, user, note.patient_id).await?;
    Ok(note)
}

async fn load_patient_for_access(
    state: &AppState,
    user: &AuthUser,
    patient_id: Uuid,
) -> Result<PatientRecord, ApiError> {
    let patient = state
        .get_patient(patient_id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

    require_patient_demographics_access(user, &patient).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient.",
        )
    })?;

    Ok(patient)
}

fn require_clinical_list_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_action_permission(user, facility_id, PermissionCode::ClinicalDocumentationView)?;
    if user
        .patient_visibility
        .contains(&PatientDataVisibility::Demographics)
    {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient clinical documentation.",
        ))
    }
}

fn require_clinical_write_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_action_permission(
        user,
        facility_id,
        PermissionCode::ClinicalDocumentationManage,
    )
}

fn require_action_permission(
    user: &AuthUser,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    require_permission(user, permission)
        .and_then(|_| require_permission(user, PermissionCode::PatientDemographicsView))
        .map_err(|_| {
            ApiError::forbidden(
                "permission_denied",
                "You do not have permission to perform this action.",
            )
        })?;
    if user.facility_id == facility_id {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this action.",
        ))
    }
}

fn page_request(query: CursorListQuery) -> Result<(Option<ClinicalCursor>, u8), ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let cursor = query
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(decode_cursor)
        .transpose()?;
    Ok((cursor, limit))
}

fn page_response<T, F>(mut rows: Vec<T>, page_size: u8, cursor_for: F) -> ListResponse<T>
where
    F: Fn(&T) -> String,
{
    let has_next = rows.len() > page_size as usize;
    if has_next {
        rows.truncate(page_size as usize);
    }
    let next_cursor = if has_next {
        rows.last().map(cursor_for)
    } else {
        None
    };

    list(
        rows,
        PageInfo {
            next_cursor,
            has_next,
            limit: page_size,
        },
    )
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    format!("{}:{}", occurred_at.timestamp_micros(), id)
}

fn decode_cursor(value: &str) -> Result<ClinicalCursor, ApiError> {
    let (micros, id) = value
        .split_once(':')
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let micros = micros
        .parse::<i64>()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let occurred_at = DateTime::<Utc>::from_timestamp_micros(micros)
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let id = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;

    Ok(ClinicalCursor { occurred_at, id })
}

fn normalize_text(value: String, field: &'static str, max_len: usize) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation_error(field, "This field is required."));
    }
    if value.chars().count() > max_len {
        return Err(validation_error(field, "This field is too long."));
    }
    Ok(value.to_owned())
}

fn normalize_optional_text(
    value: Option<String>,
    field: &'static str,
    max_len: usize,
) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > max_len {
        return Err(validation_error(field, "This field is too long."));
    }
    Ok(Some(value.to_owned()))
}

fn validation_error(field: &'static str, message: &'static str) -> ApiError {
    let mut error = ApiError::bad_request(
        "invalid_clinical_documentation",
        "Clinical documentation request is invalid.",
    );
    error.details = json!({ field: [message] });
    error
}
