use super::*;
use hms_db::clinical::{note_records as notes, note_templates as templates};
use hms_domain::clinical_notes::*;

fn actor(ctx: &hms_access::RequestContext, deadline: DateTime<Utc>) -> notes::NoteActor {
    notes::NoteActor {
        facility_id: ctx.facility_id,
        user_id: ctx.user_id,
        request_id: Some(ctx.request_id.clone()),
        authorization: super::prescription_courses::authorization(ctx, deadline),
        can_manage: hms_access::require_clinical_write_access(ctx, ctx.facility_id).is_ok(),
        override_ownership: hms_access::require_admin_authority_access(ctx, ctx.facility_id)
            .is_ok(),
    }
}
fn read(ctx: &hms_access::RequestContext, facility: Uuid) -> Result<(), ApiError> {
    require_clinical_list_access(ctx, facility)
}
async fn patient(s: &AppState, ctx: &hms_access::RequestContext, id: Uuid) -> Result<(), ApiError> {
    visibility::full(ctx)?;
    let _ = load_patient_for_access(s, ctx, id).await?;
    Ok(())
}
async fn scope(s: &AppState, ctx: &hms_access::RequestContext, id: Uuid) -> Result<(), ApiError> {
    read(ctx, s.facility_id())?;
    visibility::full(ctx)?;
    let p = notes::context(s.db_pool(), s.facility_id(), id)
        .await
        .map_err(error)?
        .ok_or_else(not_found)?;
    patient(s, ctx, p).await
}
fn not_found() -> ApiError {
    ApiError::not_found(
        "clinical_note_not_found",
        "The clinical note, template or saved request was not found.",
    )
}
pub(crate) fn error(e: anyhow::Error) -> ApiError {
    if let Some(error) = ApiError::network_publication(&e) {
        return error;
    }
    use notes::NoteError as E;
    if let Some(kind) = e.downcast_ref::<E>() {
        return match kind{
        E::NotFound=>not_found(),
        E::InvalidInput=>ApiError::bad_request("invalid_clinical_note_command","Review the supported note fields, selected template sections and bounded text."),
        E::SourceChanged=>ApiError::conflict("clinical_note_source_changed","The note or template changed. Reload its current version before reviewing another change."),
        E::AuthorRequired=>ApiError::forbidden("clinical_note_author_required","Only the original author or an explicitly authorized administrator may change this record."),
        E::TemplateUnavailable=>ApiError::conflict("clinical_note_template_unavailable","Choose an active facility template revision before recording this note."),
        E::ContextChanged=>ApiError::conflict("clinical_note_context_changed","The selected care context changed. Review the current encounter before recording a note."),
        E::RequestConflict=>ApiError::conflict("clinical_note_request_conflict","This request reference belongs to another command. Review its original saved result."),
        E::AuthorizationExpired=>ApiError::forbidden("clinical_note_authorization_expired","Current clinical authorization is required. Sign in and review current access."),
    };
    }
    ApiError::conflict("clinical_note_write_unconfirmed","This change may already be saved. Review the original request reference before making another change, or retry the unchanged request.")
}
pub fn legacy_command_required() -> ApiError {
    ApiError::conflict("clinical_note_command_required","Use the current note workspace with a stable request reference, reviewed source version and amendment reason. Note history is available through the bounded history endpoint.")
}
impl ClinicalService {
    pub async fn record_note(
        &self,
        ctx: &hms_access::RequestContext,
        p: Uuid,
        input: RecordClinicalNoteRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<ClinicalNoteCommandReceipt>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        patient(&self.state, ctx, p).await?;
        let result = notes::record(self.pool(), actor(ctx, deadline), p, input)
            .await
            .map_err(error)?;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(result))
    }
    pub async fn amend_note(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        input: AmendClinicalNoteRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<ClinicalNoteCommandReceipt>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        scope(&self.state, ctx, id).await?;
        let result = notes::amend(self.pool(), actor(ctx, deadline), id, input)
            .await
            .map_err(error)?;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(result))
    }
    pub async fn note_detail(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<ClinicalNoteRecordDetail>, ApiError> {
        scope(&self.state, ctx, id).await?;
        Ok(object(
            notes::get(self.pool(), actor(ctx, deadline), id)
                .await
                .map_err(error)?,
        ))
    }
    pub async fn note_history(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        q: ClinicalNoteHistoryQuery,
        deadline: DateTime<Utc>,
    ) -> Result<ListResponse<ClinicalNoteHistoryItem>, ApiError> {
        scope(&self.state, ctx, id).await?;
        let before = q
            .cursor
            .as_deref()
            .map(|v| {
                v.strip_prefix("v:")
                    .and_then(|v| v.parse::<i64>().ok())
                    .filter(|v| *v > 0)
                    .ok_or_else(|| {
                        ApiError::bad_request(
                            "invalid_note_history_cursor",
                            "Use a valid note history page cursor.",
                        )
                    })
            })
            .transpose()?;
        let limit = q.limit.unwrap_or(25).clamp(1, 100);
        let rows = notes::history(
            self.pool(),
            actor(ctx, deadline),
            id,
            before,
            i64::from(limit) + 1,
        )
        .await
        .map_err(error)?;
        Ok(cursor_list::page_response(rows, limit, |r| {
            format!("v:{}", r.version)
        }))
    }
    pub async fn note_version(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        version: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<ClinicalNoteVersionDetail>, ApiError> {
        scope(&self.state, ctx, id).await?;
        Ok(object(
            notes::get_version(self.pool(), actor(ctx, deadline), id, version)
                .await
                .map_err(error)?,
        ))
    }
    pub async fn note_receipt(
        &self,
        ctx: &hms_access::RequestContext,
        p: Uuid,
        key: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<ClinicalNoteCommandReceipt>, ApiError> {
        read(ctx, self.facility_id())?;
        patient(&self.state, ctx, p).await?;
        Ok(object(
            notes::receipt(self.pool(), actor(ctx, deadline), p, key)
                .await
                .map_err(error)?,
        ))
    }
    pub async fn governed_templates(
        &self,
        ctx: &hms_access::RequestContext,
        q: GovernedNoteTemplateQuery,
        deadline: DateTime<Utc>,
    ) -> Result<ListResponse<GovernedNoteTemplateItem>, ApiError> {
        read(ctx, self.facility_id())?;
        let page =
            cursor_list::page_request(q.cursor.as_deref(), q.limit, 25, 100, |at, id| (at, id))?;
        let rows = templates::list(
            self.pool(),
            actor(ctx, deadline),
            q,
            page.cursor,
            page.fetch_limit(),
        )
        .await
        .map_err(error)?;
        Ok(cursor_list::page_response(rows, page.limit, |r| {
            cursor_list::encode_cursor(r.updated_at, r.id)
        }))
    }
    pub async fn governed_template(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<GovernedNoteTemplateDetail>, ApiError> {
        read(ctx, self.facility_id())?;
        Ok(object(
            templates::get(self.pool(), actor(ctx, deadline), id)
                .await
                .map_err(error)?,
        ))
    }
    pub async fn record_template(
        &self,
        ctx: &hms_access::RequestContext,
        input: RecordNoteTemplateRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<NoteTemplateCommandReceipt>, ApiError> {
        require_template_write_access(ctx, self.facility_id())?;
        Ok(object(
            templates::record(self.pool(), actor(ctx, deadline), input)
                .await
                .map_err(error)?,
        ))
    }
    pub async fn change_template(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        input: ChangeNoteTemplateRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<NoteTemplateCommandReceipt>, ApiError> {
        require_template_write_access(ctx, self.facility_id())?;
        Ok(object(
            templates::change(self.pool(), actor(ctx, deadline), id, input)
                .await
                .map_err(error)?,
        ))
    }
    pub async fn template_receipt(
        &self,
        ctx: &hms_access::RequestContext,
        key: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<NoteTemplateCommandReceipt>, ApiError> {
        read(ctx, self.facility_id())?;
        Ok(object(
            templates::receipt(self.pool(), actor(ctx, deadline), key)
                .await
                .map_err(error)?,
        ))
    }
}
