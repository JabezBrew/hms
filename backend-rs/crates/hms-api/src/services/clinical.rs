use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::clinical::{
    ClinicalCursor, NewAllergy, NewChartEntry, NewClinicalNote, NewClinicalNoteTemplate,
    NewPrescription, NewProblem, NewProblemArtifactLink, NoteContext, UpdateClinicalNoteTemplate,
};
use hms_domain::care::CursorListQuery;
use hms_domain::clinical::{
    AllergyListItem, ChangeProblemStatusRequest, ChartEntryListItem, ClinicalNoteDetail,
    ClinicalNoteListItem, ClinicalNoteTemplate, ClinicalNoteTemplateListQuery, ClinicalNoteVersion,
    CreateAllergyRequest, CreateChartEntryRequest, CreateClinicalNoteRequest,
    CreateClinicalNoteTemplateRequest, CreateClinicalNoteVersionRequest, CreatePrescriptionRequest,
    CreateProblemRequest, LaboratoryClinicalContext, PharmacyClinicalContext, PrescriptionListItem,
    ProblemArtifactKind, ProblemArtifactLinkItem, ProblemArtifactLinkQuery,
    ProblemArtifactLinkRequest, ProblemListItem, UpdateAllergyRequest,
    UpdateClinicalNoteTemplateRequest, UpdatePrescriptionRequest, UpdateProblemRequest,
};
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use serde_json::json;
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const MAX_TITLE_LEN: usize = 160;
const MAX_SHORT_TEXT_LEN: usize = 120;
const MAX_NOTE_BODY_LEN: usize = 20_000;

#[derive(Clone)]
pub struct ClinicalService {
    state: AppState,
}

impl ClinicalService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_note_templates(
        &self,
        ctx: &hms_access::RequestContext,
        query: ClinicalNoteTemplateListQuery,
    ) -> Result<ListResponse<ClinicalNoteTemplate>, ApiError> {
        require_clinical_list_access(ctx, self.facility_id())?;
        let page_size = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        let templates = hms_db::clinical::list_note_templates(
            self.pool(),
            self.facility_id(),
            page_size as i64,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_template_list_failed",
                "Clinical note templates could not be loaded.",
            )
        })?;

        Ok(cursor_list::static_list(templates, page_size))
    }

    pub async fn create_note_template(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateClinicalNoteTemplateRequest,
    ) -> Result<ObjectResponse<ClinicalNoteTemplate>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let title = normalize_text(payload.title, "title", MAX_TITLE_LEN)?;
        let note_type = normalize_text(payload.note_type, "note_type", MAX_SHORT_TEXT_LEN)?;
        let body_template =
            normalize_text(payload.body_template, "body_template", MAX_NOTE_BODY_LEN)?;
        let template = hms_db::clinical::create_note_template(
            self.pool(),
            NewClinicalNoteTemplate {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                title,
                note_type,
                body_template,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_template_create_failed",
                "Clinical note template could not be saved.",
            )
        })?;

        Ok(object(template))
    }

    pub async fn get_note_template(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ClinicalNoteTemplate>, ApiError> {
        require_action_permission(
            ctx,
            self.facility_id(),
            PermissionCode::ClinicalDocumentationView,
        )?;
        let template = hms_db::clinical::get_note_template(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "clinical_template_load_failed",
                    "Clinical note template could not be loaded.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found(
                    "clinical_template_not_found",
                    "Clinical note template was not found.",
                )
            })?;

        Ok(object(template))
    }

    pub async fn update_note_template(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        mut payload: UpdateClinicalNoteTemplateRequest,
    ) -> Result<ObjectResponse<ClinicalNoteTemplate>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
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

        let template = hms_db::clinical::update_note_template(
            self.pool(),
            self.facility_id(),
            id,
            UpdateClinicalNoteTemplate {
                title: payload.title,
                note_type: payload.note_type,
                body_template: payload.body_template,
                is_active: payload.is_active,
            },
        )
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

        Ok(object(template))
    }

    pub async fn delete_note_template(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ClinicalNoteTemplate>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let template =
            hms_db::clinical::deactivate_note_template(self.pool(), self.facility_id(), id)
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

        Ok(object(template))
    }

    pub async fn list_notes(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        query: CursorListQuery,
    ) -> Result<ListResponse<ClinicalNoteListItem>, ApiError> {
        require_clinical_list_access(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        let page = page_request(query)?;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::clinical::list_notes(
            self.pool(),
            self.facility_id(),
            patient_id,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_note_list_failed",
                "Clinical notes could not be loaded.",
            )
        })?;

        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.updated_at, item.id)
        }))
    }

    pub async fn create_note(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        payload: CreateClinicalNoteRequest,
    ) -> Result<ObjectResponse<ClinicalNoteListItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        let note_type = normalize_text(payload.note_type, "note_type", MAX_SHORT_TEXT_LEN)?;
        let title = normalize_text(payload.title, "title", MAX_TITLE_LEN)?;
        let body = normalize_text(payload.body, "body", MAX_NOTE_BODY_LEN)?;
        let note = hms_db::clinical::create_note(
            self.pool(),
            NewClinicalNote {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                note_type,
                title,
                body,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinical_note_create_failed",
                "Clinical note could not be created.",
            )
        })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(note))
    }

    pub async fn get_note(
        &self,
        ctx: &hms_access::RequestContext,
        note_id: Uuid,
    ) -> Result<ObjectResponse<ClinicalNoteDetail>, ApiError> {
        let _note_context = load_note_for_access(
            &self.state,
            ctx,
            note_id,
            PermissionCode::ClinicalDocumentationView,
        )
        .await?;
        let note = hms_db::clinical::get_note_detail(self.pool(), self.facility_id(), note_id)
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

        Ok(object(note))
    }

    pub async fn list_note_versions(
        &self,
        ctx: &hms_access::RequestContext,
        note_id: Uuid,
    ) -> Result<ListResponse<ClinicalNoteVersion>, ApiError> {
        let note = load_note_for_access(
            &self.state,
            ctx,
            note_id,
            PermissionCode::ClinicalDocumentationView,
        )
        .await?;
        let versions = hms_db::clinical::list_note_versions(self.pool(), note.id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "clinical_note_version_list_failed",
                    "Clinical note versions could not be loaded.",
                )
            })?;

        Ok(cursor_list::static_list(versions, MAX_LIMIT))
    }

    pub async fn create_note_version(
        &self,
        ctx: &hms_access::RequestContext,
        note_id: Uuid,
        payload: CreateClinicalNoteVersionRequest,
    ) -> Result<ObjectResponse<ClinicalNoteVersion>, ApiError> {
        let note = load_note_for_access(
            &self.state,
            ctx,
            note_id,
            PermissionCode::ClinicalDocumentationManage,
        )
        .await?;
        let body = normalize_text(payload.body, "body", MAX_NOTE_BODY_LEN)?;
        let version =
            hms_db::clinical::create_note_version(self.pool(), note.id, body, ctx.user_id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "clinical_note_version_create_failed",
                        "Clinical note version could not be created.",
                    )
                })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(version))
    }

    pub async fn list_problems(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        query: CursorListQuery,
    ) -> Result<ListResponse<ProblemListItem>, ApiError> {
        require_clinical_list_access(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        let page = page_request(query)?;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::clinical::list_problems(
            self.pool(),
            self.facility_id(),
            patient_id,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| ApiError::conflict("problem_list_failed", "Problems could not be loaded."))?;

        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_problem(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        payload: CreateProblemRequest,
    ) -> Result<ObjectResponse<ProblemListItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        let label = normalize_text(payload.label, "label", MAX_TITLE_LEN)?;
        let problem = hms_db::clinical::create_problem(
            self.pool(),
            NewProblem {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                label,
                onset_date: payload.onset_date,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| ApiError::conflict("problem_create_failed", "Problem could not be saved."))?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(problem))
    }

    pub async fn get_problem(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ProblemListItem>, ApiError> {
        require_clinical_list_access(ctx, self.facility_id())?;
        Ok(object(load_problem_for_access(&self.state, ctx, id).await?))
    }

    pub async fn update_problem(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        mut payload: UpdateProblemRequest,
    ) -> Result<ObjectResponse<ProblemListItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let _existing = load_problem_for_access(&self.state, ctx, id).await?;
        if let Some(label) = payload.label.take() {
            payload.label = Some(normalize_text(label, "label", MAX_TITLE_LEN)?);
        }
        let problem =
            hms_db::clinical::update_problem(self.pool(), self.facility_id(), id, payload)
                .await
                .map_err(|_| {
                    ApiError::conflict("problem_update_failed", "Problem could not be updated.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found("problem_not_found", "Problem was not found.")
                })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(problem))
    }

    pub async fn change_problem_status(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: ChangeProblemStatusRequest,
    ) -> Result<ObjectResponse<ProblemListItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let _existing = load_problem_for_access(&self.state, ctx, id).await?;
        let problem = hms_db::clinical::update_problem_status(
            self.pool(),
            self.facility_id(),
            id,
            payload.status,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "problem_status_update_failed",
                "Problem status could not be updated.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("problem_not_found", "Problem was not found."))?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(problem))
    }

    pub async fn list_problem_artifact_links(
        &self,
        ctx: &hms_access::RequestContext,
        query: ProblemArtifactLinkQuery,
    ) -> Result<ListResponse<ProblemArtifactLinkItem>, ApiError> {
        require_clinical_list_access(ctx, self.facility_id())?;
        let (artifact_kind, artifact_id) = artifact_filter(query)?;
        let links = hms_db::clinical::list_problem_artifact_links(
            self.pool(),
            self.facility_id(),
            artifact_kind,
            artifact_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "problem_link_list_failed",
                "Problem links could not be loaded.",
            )
        })?;

        Ok(cursor_list::static_list(links, MAX_LIMIT))
    }

    pub async fn create_problem_artifact_link(
        &self,
        ctx: &hms_access::RequestContext,
        payload: ProblemArtifactLinkRequest,
    ) -> Result<ObjectResponse<ProblemArtifactLinkItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let (artifact_kind, artifact_id) = artifact_payload(&payload)?;
        let problem = load_problem_for_access(&self.state, ctx, payload.problem_id).await?;
        let link = hms_db::clinical::create_problem_artifact_link(
            self.pool(),
            NewProblemArtifactLink {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: problem.patient_id,
                problem_id: payload.problem_id,
                artifact_kind,
                artifact_id,
                actor_user_id: ctx.user_id,
                request_id: Some(ctx.request_id.clone()),
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "problem_link_create_failed",
                "Problem link could not be saved.",
            )
        })?
        .ok_or_else(|| {
            ApiError::bad_request(
                "problem_link_patient_mismatch",
                "Problem links must target artifacts for the same patient.",
            )
        })?;

        Ok(object(link))
    }

    pub async fn delete_problem_artifact_link(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ProblemArtifactLinkItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let link = hms_db::clinical::delete_problem_artifact_link(
            self.pool(),
            self.facility_id(),
            id,
            ctx.user_id,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "problem_link_delete_failed",
                "Problem link could not be removed.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("problem_link_not_found", "Problem link was not found.")
        })?;

        Ok(object(link))
    }

    pub async fn pharmacy_clinical_context(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
    ) -> Result<ObjectResponse<PharmacyClinicalContext>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::PharmacyDispense)?;
        let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        let context = hms_db::clinical::pharmacy_clinical_context(
            self.pool(),
            self.facility_id(),
            patient_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "pharmacy_context_failed",
                "Pharmacy clinical context could not be loaded.",
            )
        })?;

        Ok(object(context))
    }

    pub async fn laboratory_clinical_context(
        &self,
        ctx: &hms_access::RequestContext,
        order_id: Uuid,
    ) -> Result<ObjectResponse<LaboratoryClinicalContext>, ApiError> {
        hms_access::require_lab_list_access(ctx, self.facility_id()).map_err(|_| {
            ApiError::forbidden(
                "permission_denied",
                "You do not have permission to view laboratory clinical context.",
            )
        })?;
        let context = hms_db::clinical::laboratory_clinical_context(
            self.pool(),
            self.facility_id(),
            order_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "laboratory_context_failed",
                "Laboratory clinical context could not be loaded.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("lab_order_not_found", "Lab order was not found."))?;
        let _patient = load_patient_for_access(&self.state, ctx, context.patient_id).await?;

        Ok(object(context))
    }

    pub async fn list_allergies(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        query: CursorListQuery,
    ) -> Result<ListResponse<AllergyListItem>, ApiError> {
        require_clinical_list_access(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        let page = page_request(query)?;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::clinical::list_allergies(
            self.pool(),
            self.facility_id(),
            patient_id,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| ApiError::conflict("allergy_list_failed", "Allergies could not be loaded."))?;

        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_allergy(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        payload: CreateAllergyRequest,
    ) -> Result<ObjectResponse<AllergyListItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        let substance = normalize_text(payload.substance, "substance", MAX_TITLE_LEN)?;
        let reaction = normalize_optional_text(payload.reaction, "reaction", MAX_TITLE_LEN)?;
        let allergy = hms_db::clinical::create_allergy(
            self.pool(),
            NewAllergy {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                substance,
                reaction,
                severity: payload.severity,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| ApiError::conflict("allergy_create_failed", "Allergy could not be saved."))?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(allergy))
    }

    pub async fn get_allergy(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<AllergyListItem>, ApiError> {
        require_action_permission(
            ctx,
            self.facility_id(),
            PermissionCode::ClinicalDocumentationView,
        )?;
        Ok(object(load_allergy_for_access(&self.state, ctx, id).await?))
    }

    pub async fn update_allergy(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        mut payload: UpdateAllergyRequest,
    ) -> Result<ObjectResponse<AllergyListItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let _current = load_allergy_for_access(&self.state, ctx, id).await?;

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

        let allergy =
            hms_db::clinical::update_allergy(self.pool(), self.facility_id(), id, payload)
                .await
                .map_err(|_| {
                    ApiError::conflict("allergy_update_failed", "Allergy could not be updated.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found("allergy_not_found", "Allergy was not found.")
                })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(allergy))
    }

    pub async fn delete_allergy(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<AllergyListItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let _current = load_allergy_for_access(&self.state, ctx, id).await?;
        let allergy = hms_db::clinical::deactivate_allergy(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "allergy_deactivate_failed",
                    "Allergy could not be deactivated.",
                )
            })?
            .ok_or_else(|| ApiError::not_found("allergy_not_found", "Allergy was not found."))?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(allergy))
    }

    pub async fn list_prescriptions(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        query: CursorListQuery,
    ) -> Result<ListResponse<PrescriptionListItem>, ApiError> {
        require_clinical_list_access(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        let page = page_request(query)?;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::clinical::list_prescriptions(
            self.pool(),
            self.facility_id(),
            patient_id,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "prescription_list_failed",
                "Prescriptions could not be loaded.",
            )
        })?;

        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.prescribed_at, item.id)
        }))
    }

    pub async fn create_prescription(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        payload: CreatePrescriptionRequest,
    ) -> Result<ObjectResponse<PrescriptionListItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        let medication_name =
            normalize_text(payload.medication_name, "medication_name", MAX_TITLE_LEN)?;
        let dose = normalize_text(payload.dose, "dose", MAX_SHORT_TEXT_LEN)?;
        let frequency = normalize_text(payload.frequency, "frequency", MAX_SHORT_TEXT_LEN)?;
        let prescription = hms_db::clinical::create_prescription(
            self.pool(),
            NewPrescription {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                medication_name,
                dose,
                frequency,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "prescription_create_failed",
                "Prescription could not be saved.",
            )
        })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(prescription))
    }

    pub async fn get_prescription(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<PrescriptionListItem>, ApiError> {
        require_action_permission(
            ctx,
            self.facility_id(),
            PermissionCode::ClinicalDocumentationView,
        )?;
        Ok(object(
            load_prescription_for_access(&self.state, ctx, id).await?,
        ))
    }

    pub async fn update_prescription(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        mut payload: UpdatePrescriptionRequest,
    ) -> Result<ObjectResponse<PrescriptionListItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let _current = load_prescription_for_access(&self.state, ctx, id).await?;

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

        let prescription =
            hms_db::clinical::update_prescription(self.pool(), self.facility_id(), id, payload)
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

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(prescription))
    }

    pub async fn list_chart_entries(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        query: CursorListQuery,
    ) -> Result<ListResponse<ChartEntryListItem>, ApiError> {
        require_clinical_list_access(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        let page = page_request(query)?;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::clinical::list_chart_entries(
            self.pool(),
            self.facility_id(),
            patient_id,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "chart_entry_list_failed",
                "Chart entries could not be loaded.",
            )
        })?;

        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.measured_at, item.id)
        }))
    }

    pub async fn create_chart_entry(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        payload: CreateChartEntryRequest,
    ) -> Result<ObjectResponse<ChartEntryListItem>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        let encounter = if let Some(encounter_id) = payload.encounter_id {
            let encounter =
                hms_db::care::get_encounter(self.pool(), self.facility_id(), encounter_id)
                    .await
                    .map_err(|_| {
                        ApiError::conflict(
                            "encounter_load_failed",
                            "Encounter could not be loaded.",
                        )
                    })?
                    .ok_or_else(|| {
                        ApiError::not_found("encounter_not_found", "Encounter was not found.")
                    })?;
            if encounter.patient_id != patient_id {
                return Err(validation_error(
                    "encounter_id",
                    "Encounter does not belong to this patient.",
                ));
            }
            Some(encounter)
        } else {
            None
        };
        if let Some(visit_id) = payload.visit_id {
            let visit = hms_db::care::get_visit(self.pool(), self.facility_id(), visit_id)
                .await
                .map_err(|_| ApiError::conflict("visit_load_failed", "Visit could not be loaded."))?
                .ok_or_else(|| ApiError::not_found("visit_not_found", "Visit was not found."))?;
            if visit.patient_id != patient_id {
                return Err(validation_error(
                    "visit_id",
                    "Visit does not belong to this patient.",
                ));
            }
            if encounter
                .as_ref()
                .and_then(|encounter| encounter.visit_id)
                .is_some_and(|encounter_visit_id| encounter_visit_id != visit_id)
            {
                return Err(validation_error(
                    "visit_id",
                    "Visit does not belong to the supplied encounter.",
                ));
            }
        }
        let value = normalize_text(payload.value, "value", MAX_SHORT_TEXT_LEN)?;
        let unit = normalize_optional_text(payload.unit, "unit", MAX_SHORT_TEXT_LEN)?;
        let entry = hms_db::clinical::create_chart_entry(
            self.pool(),
            NewChartEntry {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                encounter_id: payload.encounter_id,
                visit_id: payload.visit_id,
                entry_type: payload.entry_type,
                measured_at: payload.measured_at,
                value,
                unit,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "chart_entry_create_failed",
                "Chart entry could not be saved.",
            )
        })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(entry))
    }
}

impl AppState {
    pub fn clinical_service(&self) -> ClinicalService {
        ClinicalService::new(self.clone())
    }
}

async fn load_note_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    note_id: Uuid,
    permission: PermissionCode,
) -> Result<NoteContext, ApiError> {
    require_action_permission(ctx, state.facility_id(), permission)?;
    let note = hms_db::clinical::get_note_context(state.db_pool(), state.facility_id(), note_id)
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
    let _patient = load_patient_for_access(state, ctx, note.patient_id).await?;
    Ok(note)
}

async fn load_patient_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    patient_id: Uuid,
) -> Result<PatientRecord, ApiError> {
    let patient = hms_db::patients::get_patient(state.db_pool(), state.facility_id(), patient_id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

    require_patient_demographics_access(ctx, &patient).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient.",
        )
    })?;

    Ok(patient)
}

async fn load_problem_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
) -> Result<ProblemListItem, ApiError> {
    let problem = hms_db::clinical::get_problem(state.db_pool(), state.facility_id(), id)
        .await
        .map_err(|_| ApiError::conflict("problem_load_failed", "Problem could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("problem_not_found", "Problem was not found."))?;
    let _patient = load_patient_for_access(state, ctx, problem.patient_id).await?;
    Ok(problem)
}

async fn load_allergy_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
) -> Result<AllergyListItem, ApiError> {
    let allergy = hms_db::clinical::get_allergy(state.db_pool(), state.facility_id(), id)
        .await
        .map_err(|_| ApiError::conflict("allergy_load_failed", "Allergy could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("allergy_not_found", "Allergy was not found."))?;
    let _patient = load_patient_for_access(state, ctx, allergy.patient_id).await?;
    Ok(allergy)
}

async fn load_prescription_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
) -> Result<PrescriptionListItem, ApiError> {
    let prescription = hms_db::clinical::get_prescription(state.db_pool(), state.facility_id(), id)
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
    let _patient = load_patient_for_access(state, ctx, prescription.patient_id).await?;
    Ok(prescription)
}

fn require_clinical_list_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_clinical_list_access(ctx, facility_id).map_err(|error| match error {
        hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient clinical documentation.",
        ),
        other => ApiError::from(other),
    })
}

fn require_clinical_write_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_clinical_write_access(ctx, facility_id).map_err(ApiError::from)
}

fn require_action_permission(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(ctx, facility_id, permission).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this action.",
        )
    })
}

fn page_request(
    query: CursorListQuery,
) -> Result<cursor_list::CursorPage<ClinicalCursor>, ApiError> {
    Ok(cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| ClinicalCursor { occurred_at, id },
    )?)
}

fn page_response<T>(
    rows: Vec<T>,
    page_size: u8,
    cursor_for: impl Fn(&T) -> String,
) -> ListResponse<T> {
    cursor_list::page_response(rows, page_size, cursor_for)
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    cursor_list::encode_cursor(occurred_at, id)
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

fn artifact_filter(
    query: ProblemArtifactLinkQuery,
) -> Result<(ProblemArtifactKind, Uuid), ApiError> {
    exactly_one_artifact([
        (
            ProblemArtifactKind::ClinicalNote,
            query.clinical_note_id,
            "clinical_note_id",
        ),
        (
            ProblemArtifactKind::Prescription,
            query.prescription_id,
            "prescription_id",
        ),
        (
            ProblemArtifactKind::LabOrder,
            query.lab_order_id,
            "lab_order_id",
        ),
        (
            ProblemArtifactKind::Encounter,
            query.encounter_id,
            "encounter_id",
        ),
    ])
}

fn artifact_payload(
    payload: &ProblemArtifactLinkRequest,
) -> Result<(ProblemArtifactKind, Uuid), ApiError> {
    exactly_one_artifact([
        (
            ProblemArtifactKind::ClinicalNote,
            payload.clinical_note_id,
            "clinical_note_id",
        ),
        (
            ProblemArtifactKind::Prescription,
            payload.prescription_id,
            "prescription_id",
        ),
        (
            ProblemArtifactKind::LabOrder,
            payload.lab_order_id,
            "lab_order_id",
        ),
        (
            ProblemArtifactKind::Encounter,
            payload.encounter_id,
            "encounter_id",
        ),
    ])
}

fn exactly_one_artifact(
    values: [(ProblemArtifactKind, Option<Uuid>, &'static str); 4],
) -> Result<(ProblemArtifactKind, Uuid), ApiError> {
    let selected: Vec<_> = values
        .into_iter()
        .filter_map(|(kind, id, field)| id.map(|id| (kind, id, field)))
        .collect();
    if selected.len() != 1 {
        return Err(validation_error(
            "artifact",
            "Exactly one artifact identifier is required.",
        ));
    }
    let (kind, id, _) = selected[0];
    Ok((kind, id))
}

fn validation_error(field: &'static str, message: &'static str) -> ApiError {
    let mut error = ApiError::bad_request(
        "invalid_clinical_documentation",
        "Clinical documentation request is invalid.",
    );
    error.details = json!({ field: [message] });
    error
}
