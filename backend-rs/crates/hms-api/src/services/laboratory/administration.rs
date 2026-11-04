//! Current no-patient catalog administration and original availability commands.
use chrono::{DateTime, Utc};
use hms_access::RequestContext;
use hms_db::laboratory_catalog::{self as db, LabCatalogActor, LabCatalogError};
use hms_domain::laboratory_catalog::*;
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct LaboratoryCatalogAdministrationService {
    state: AppState,
}

impl LaboratoryCatalogAdministrationService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    fn read_actor(&self, ctx: &RequestContext) -> Result<LabCatalogActor, ApiError> {
        require_access(ctx, self.state.facility_id())?;
        let deadline = ctx.authorization_deadline.ok_or_else(authority_required)?;
        Ok(LabCatalogActor {
            facility_id: self.state.facility_id(),
            user_id: ctx.user_id,
            request_id: ctx.request_id.clone(),
            authorization: crate::services::clinical::prescription_courses::authorization(
                ctx, deadline,
            ),
        })
    }

    fn write_actor(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
    ) -> Result<LabCatalogActor, ApiError> {
        require_access(ctx, self.state.facility_id())?;
        if !ctx.reauth_is_fresh_at(Utc::now()) {
            return Err(ApiError::forbidden(
                "reauth_required",
                "Confirm current credentials before maintaining laboratory availability.",
            ));
        }
        let deadline = deadline
            .min(ctx.authorization_deadline.ok_or_else(authority_required)?)
            .min(ctx.reauth.required_after);
        Ok(LabCatalogActor {
            facility_id: self.state.facility_id(),
            user_id: ctx.user_id,
            request_id: ctx.request_id.clone(),
            authorization: crate::services::clinical::prescription_courses::ordinary_authorization(
                ctx, deadline,
            )?,
        })
    }

    pub async fn list_tests(
        &self,
        ctx: &RequestContext,
        input: LaboratoryTestAdministrationQuery,
    ) -> Result<ListResponse<LaboratoryCatalogAdministrationListItem>, ApiError> {
        self.list(
            ctx,
            LabCatalogKind::Test,
            input.cursor,
            input.limit,
            db::LabCatalogFilters {
                search: input.search,
                category: input.category,
                is_active: input.is_active,
                is_system_default: input.is_system_default,
                is_facility_modified: input.is_facility_modified,
            },
        )
        .await
    }

    pub async fn list_panels(
        &self,
        ctx: &RequestContext,
        input: LaboratoryPanelAdministrationQuery,
    ) -> Result<ListResponse<LaboratoryCatalogAdministrationListItem>, ApiError> {
        self.list(
            ctx,
            LabCatalogKind::Panel,
            input.cursor,
            input.limit,
            db::LabCatalogFilters {
                search: input.search,
                category: None,
                is_active: input.is_active,
                is_system_default: input.is_system_default,
                is_facility_modified: input.is_facility_modified,
            },
        )
        .await
    }

    async fn list(
        &self,
        ctx: &RequestContext,
        kind: LabCatalogKind,
        cursor: Option<String>,
        limit: Option<u8>,
        filters: db::LabCatalogFilters,
    ) -> Result<ListResponse<LaboratoryCatalogAdministrationListItem>, ApiError> {
        let actor = self.read_actor(ctx)?;
        bounded_search(filters.search.as_deref())?;
        let (cursor, limit) = page_request(cursor, limit)?;
        let rows = db::list(
            self.state.db_pool(),
            actor,
            kind,
            cursor,
            i64::from(limit) + 1,
            filters,
        )
        .await
        .map_err(|error| repository_error(error, false))?;
        Ok(common::page_response(rows, limit, |row| {
            common::encode_cursor(row.created_at, row.id)
        }))
    }

    pub async fn detail(
        &self,
        ctx: &RequestContext,
        kind: LabCatalogKind,
        id: Uuid,
    ) -> Result<ObjectResponse<LaboratoryCatalogAdministration>, ApiError> {
        let actor = self.read_actor(ctx)?;
        require_id(id)?;
        let detail = db::detail(self.state.db_pool(), actor, kind, id)
            .await
            .map_err(|error| repository_error(error, false))?
            .ok_or_else(not_found)?;
        Ok(object(detail))
    }

    pub async fn history(
        &self,
        ctx: &RequestContext,
        kind: LabCatalogKind,
        id: Uuid,
        input: LaboratoryCatalogHistoryQuery,
    ) -> Result<ListResponse<LaboratoryCatalogHistoryItem>, ApiError> {
        let actor = self.read_actor(ctx)?;
        require_id(id)?;
        let (cursor, limit) = page_request(input.cursor, input.limit)?;
        let rows = db::history(
            self.state.db_pool(),
            actor,
            kind,
            id,
            cursor,
            i64::from(limit) + 1,
        )
        .await
        .map_err(|error| repository_error(error, false))?
        .ok_or_else(not_found)?;
        Ok(common::page_response(rows, limit, |row| {
            common::encode_cursor(row.recorded_at, row.id)
        }))
    }

    pub async fn command(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
        mut input: LaboratoryCatalogReviewedInput,
    ) -> Result<ObjectResponse<LaboratoryCatalogCommandReceipt>, ApiError> {
        let actor = self.write_actor(ctx, deadline)?;
        require_id(input.client_request_id)?;
        require_id(input.subject_id)?;
        input.reason = input.reason.trim().to_owned();
        if input.expected_version < 1
            || input.reason.is_empty()
            || input.reason.len() > 4000
            || input.reason.chars().count() > 1000
            || input.reason.chars().any(char::is_control)
        {
            return Err(invalid());
        }
        Ok(object(
            db::command(self.state.db_pool(), actor, input)
                .await
                .map_err(|error| repository_error(error, true))?,
        ))
    }

    pub async fn receipt(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
        key: Uuid,
    ) -> Result<ObjectResponse<LaboratoryCatalogCommandReceipt>, ApiError> {
        let actor = self.write_actor(ctx, deadline)?;
        require_id(key)?;
        Ok(object(
            db::receipt(self.state.db_pool(), actor, key)
                .await
                .map_err(|error| repository_error(error, false))?
                .ok_or_else(not_found)?,
        ))
    }
}

fn require_access(ctx: &RequestContext, facility: Uuid) -> Result<(), ApiError> {
    hms_access::require_laboratory_catalog_access(ctx, facility).map_err(|_| authority_required())
}

fn authority_required() -> ApiError {
    ApiError::forbidden(
        "laboratory_catalog_authority_required",
        "Current laboratory catalog authority, feature and session proof are required.",
    )
}

fn not_found() -> ApiError {
    ApiError::not_found(
        "laboratory_catalog_not_found",
        "The exact laboratory definition or original command was not found.",
    )
}

fn invalid() -> ApiError {
    ApiError::bad_request(
        "invalid_laboratory_catalog_request",
        "Review the supported fields, request reference and current version.",
    )
}

fn require_id(id: Uuid) -> Result<(), ApiError> {
    if id.is_nil() {
        Err(invalid())
    } else {
        Ok(())
    }
}

fn bounded_search(value: Option<&str>) -> Result<(), ApiError> {
    if value.is_some_and(|value| {
        let value = value.trim();
        value.len() > 160 || value.chars().any(char::is_control)
    }) {
        Err(invalid())
    } else {
        Ok(())
    }
}

fn page_request(
    cursor: Option<String>,
    limit: Option<u8>,
) -> Result<(Option<hms_db::laboratory::LabCursor>, u8), ApiError> {
    if limit.is_some_and(|limit| !(1..=100).contains(&limit)) {
        return Err(invalid());
    }
    common::page_request(cursor, limit)
}

pub(super) fn repository_error(error: anyhow::Error, write: bool) -> ApiError {
    if let Some(kind) = error.downcast_ref::<LabCatalogError>() {
        return match kind {
            LabCatalogError::Invalid => invalid(),
            LabCatalogError::NotFound => not_found(),
            LabCatalogError::VersionConflict => ApiError::conflict(
                "laboratory_catalog_version_conflict",
                "This definition changed. Refresh and review its current version.",
            ),
            LabCatalogError::RequestConflict => ApiError::conflict(
                "laboratory_catalog_request_conflict",
                "This request reference belongs to another reviewed catalog command.",
            ),
            LabCatalogError::Authority => authority_required(),
            LabCatalogError::Busy => ApiError::conflict(
                "laboratory_catalog_busy",
                "This definition or request is in use. Review before another change.",
            ),
            LabCatalogError::ProjectionConflict => ApiError::conflict(
                "laboratory_catalog_projection_conflict",
                "The catalog search projection requires review before this change can be published.",
            ),
            LabCatalogError::OrderUnavailable => ApiError::conflict(
                "lab_order_catalog_unavailable",
                "Review every selected test and the complete membership of each panel.",
            ),
            LabCatalogError::VersionExhausted => ApiError::conflict(
                "laboratory_catalog_version_exhausted",
                "This definition requires maintenance before another change.",
            ),
        };
    }
    if error.is::<hms_db::clinical::prescription_courses::PrescriptionCourseError>()
        || error.is::<hms_db::clinical::medication_access::MedicationAccessError>()
        || error.is::<hms_db::network::NetworkPublicationError>()
    {
        return authority_required();
    }
    if let Some(database) = error.downcast_ref::<sqlx::Error>() {
        if let Some(kind) = db::database_error(database) {
            return repository_error(kind.into(), write);
        }
    }
    if write {
        ApiError::conflict(
            "laboratory_catalog_write_unconfirmed",
            "The change could not be confirmed. Keep the unchanged request and review its original result.",
        )
    } else {
        ApiError::conflict(
            "laboratory_catalog_read_failed",
            "The current definition or original result could not be loaded.",
        )
    }
}
