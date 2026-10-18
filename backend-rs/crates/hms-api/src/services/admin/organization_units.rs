use super::*;
use hms_db::admin::organization_units::{self as db, OrganizationUnitError as E};
use hms_domain::organization_units::*;

impl AdminService {
    pub async fn command_org_unit(
        &self,
        ctx: &hms_access::RequestContext,
        input: OrganizationUnitReviewedInput,
    ) -> Result<ObjectResponse<OrganizationUnitCommandReceipt>, ApiError> {
        require_admin_access(ctx, self.facility_id())?;
        let actor = crate::services::auth_factor::privileged_actor(ctx)?;
        Ok(object(
            db::execute(self.pool(), actor, input)
                .await
                .map_err(|e| error(e, true))?,
        ))
    }
    pub async fn org_unit_receipt(
        &self,
        ctx: &hms_access::RequestContext,
        key: Uuid,
    ) -> Result<ObjectResponse<OrganizationUnitCommandReceipt>, ApiError> {
        require_admin_access(ctx, self.facility_id())?;
        let actor = crate::services::auth_factor::privileged_actor(ctx)?;
        Ok(object(
            db::receipt(self.pool(), actor, key)
                .await
                .map_err(|e| error(e, false))?,
        ))
    }
}
fn error(e: anyhow::Error, write: bool) -> ApiError {
    if crate::services::auth_factor::is_authority_error(&e) {
        return crate::services::auth_factor::error(e);
    }
    if let Some(e) = e.downcast_ref::<E>() {
        return match e {
        E::Invalid=>ApiError::bad_request("invalid_organization_unit_command","Review the supported organization fields, non-empty request reference and current version."),
        E::NotFound=>ApiError::not_found("organization_unit_not_found","The organization unit or original command was not found."),
        E::VersionConflict=>ApiError::conflict("organization_unit_version_conflict","The organization unit changed. Review its current version."),
        E::RequestConflict=>ApiError::conflict("organization_unit_request_conflict","This request reference belongs to another reviewed organization command."),
        E::ReferenceUnavailable=>ApiError::conflict("organization_unit_parent_unavailable","The exact recorded parent must be active in this facility."),
        E::HasChildren=>ApiError::conflict("organization_unit_has_children","This unit has recorded child units, including inactive children, and its active state cannot be changed."),
        E::HasPositions=>ApiError::conflict("organization_unit_has_positions","This unit has recorded authority positions, including inactive positions, and its active state cannot be changed."),
        E::HasScopeGrants=>ApiError::conflict("organization_unit_has_scope_grants","This unit has recorded organization authority grants, including historical grants, and its active state cannot be changed."),
        E::Busy=>ApiError::conflict("organization_unit_busy","The reviewed unit or request is currently in use. Keep the same request and refresh its original receipt."),
    };
    }
    if e.downcast_ref::<sqlx::Error>()
        .and_then(sqlx::Error::as_database_error)
        .is_some_and(|d| d.is_unique_violation())
    {
        return ApiError::conflict(
            "organization_unit_code_conflict",
            "This organization code is already recorded in the facility.",
        );
    }
    if write {
        ApiError::conflict("organization_unit_write_unconfirmed","The organization change could not be confirmed. Keep the unchanged request and review its original receipt before another change.")
    } else {
        ApiError::conflict(
            "organization_unit_receipt_failed",
            "The original organization command could not be loaded.",
        )
    }
}
