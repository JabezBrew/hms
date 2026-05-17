use chrono::{DateTime, Utc};
use hms_db::admin::{
    AdminCursor, AuditEventFilters, NewAuthorityAppointment, NewPermissionAssignment,
    NewPractitionerProfile, NewStaffAccount,
};
use hms_domain::admin::{
    AdminListQuery, AuditEventListItem, AuditEventListQuery, AuthorityAppointmentListItem,
    CreateAuthorityAppointmentRequest, CreateDelegationRequest, CreatePermissionAssignmentRequest,
    CreateStaffRequest, DelegationListItem, FeatureEntitlementListItem,
    PermissionAssignmentListItem, PractitionerListItem, PractitionerListQuery, StaffDirectoryItem,
    StaffListItem, StaffListQuery, UpdateFeatureEntitlementRequest, UpdateStaffRequest,
    UpsertPractitionerProfileRequest,
};
use hms_domain::deployment::{FeatureKey, PermissionCode};
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::passwords::hash_password;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const MAX_CODE_LEN: usize = 48;
const MAX_NAME_LEN: usize = 160;
const MAX_TEXT_LEN: usize = 240;
const MAX_EMAIL_LEN: usize = 254;

#[derive(Clone)]
pub struct AdminService {
    state: AppState,
}

impl AdminService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_authority_appointments(
        &self,
        ctx: &hms_access::RequestContext,
        query: AdminListQuery,
    ) -> Result<ListResponse<AuthorityAppointmentListItem>, ApiError> {
        require_admin_access(ctx, self.facility_id())?;
        let page = page_request(query)?;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::admin::list_authority_appointments(
            self.pool(),
            self.facility_id(),
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "authority_appointment_list_failed",
                "Authority appointments could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_authority_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateAuthorityAppointmentRequest,
    ) -> Result<ObjectResponse<AuthorityAppointmentListItem>, ApiError> {
        require_high_risk_admin_access(
            ctx,
            self.facility_id(),
            PermissionCode::AdminAuthorityManage,
        )?;
        validate_text(&payload.appointment_type, MAX_CODE_LEN, "appointment_type")?;
        validate_time_window(payload.starts_at, payload.ends_at)?;
        let appointment = hms_db::admin::create_authority_appointment(
            self.pool(),
            NewAuthorityAppointment {
                facility_id: self.facility_id(),
                position_id: payload.position_id,
                user_id: payload.user_id,
                appointed_by_user_id: ctx.user_id,
                appointment_type: payload.appointment_type,
                starts_at: payload.starts_at.unwrap_or_else(Utc::now),
                ends_at: payload.ends_at,
            },
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "authority_appointment_create_failed",
                "Authority appointment could not be saved.",
            )
        })?;
        Ok(object(appointment))
    }

    pub async fn list_permission_assignments(
        &self,
        ctx: &hms_access::RequestContext,
        query: AdminListQuery,
    ) -> Result<ListResponse<PermissionAssignmentListItem>, ApiError> {
        require_admin_access(ctx, self.facility_id())?;
        let page = page_request(query)?;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::admin::list_permission_assignments(
            self.pool(),
            self.facility_id(),
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "permission_assignment_list_failed",
                "Permission assignments could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_permission_assignment(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreatePermissionAssignmentRequest,
    ) -> Result<ObjectResponse<PermissionAssignmentListItem>, ApiError> {
        require_high_risk_admin_access(
            ctx,
            self.facility_id(),
            PermissionCode::AdminAuthorityManage,
        )?;
        validate_text(&payload.scope_type, MAX_CODE_LEN, "scope_type")?;
        validate_text(&payload.reason_code, MAX_CODE_LEN, "reason_code")?;
        validate_time_window(payload.starts_at, payload.ends_at)?;
        ensure_supported_permissions(&self.state, &[payload.permission_code]).await?;
        let assignment = hms_db::admin::create_permission_assignment(
            self.pool(),
            NewPermissionAssignment {
                facility_id: self.facility_id(),
                grantee_user_id: payload.grantee_user_id,
                permission_code: payload.permission_code,
                scope_type: payload.scope_type,
                scope_id: payload.scope_id,
                granted_by_user_id: ctx.user_id,
                starts_at: payload.starts_at.unwrap_or_else(Utc::now),
                ends_at: payload.ends_at,
                reason_code: payload.reason_code,
            },
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "permission_assignment_create_failed",
                "Permission assignment could not be saved.",
            )
        })?;
        Ok(object(assignment))
    }

    pub async fn list_feature_entitlements(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ListResponse<FeatureEntitlementListItem>, ApiError> {
        require_feature_entitlement_access(ctx, self.facility_id())?;
        let rows = hms_db::admin::list_feature_entitlements(self.pool(), self.facility_id())
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "feature_entitlement_list_failed",
                    "Feature entitlements could not be loaded.",
                )
            })?;
        Ok(list(
            rows,
            PageInfo {
                next_cursor: None,
                has_next: false,
                limit: DEFAULT_LIMIT,
            },
        ))
    }

    pub async fn update_feature_entitlement(
        &self,
        ctx: &hms_access::RequestContext,
        key: FeatureKey,
        payload: UpdateFeatureEntitlementRequest,
    ) -> Result<ObjectResponse<FeatureEntitlementListItem>, ApiError> {
        require_high_risk_admin_access(
            ctx,
            self.facility_id(),
            PermissionCode::AdminFeatureEntitlementsManage,
        )?;
        let entitlement = hms_db::admin::update_feature_entitlement(
            self.pool(),
            self.facility_id(),
            key,
            payload.enabled,
            ctx.user_id,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "feature_entitlement_update_failed",
                "Feature entitlement could not be updated.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("feature_not_found", "Feature was not found."))?;
        Ok(object(entitlement))
    }

    pub async fn delete_feature_entitlement(
        &self,
        ctx: &hms_access::RequestContext,
        key: FeatureKey,
    ) -> Result<ObjectResponse<FeatureEntitlementListItem>, ApiError> {
        require_high_risk_admin_access(
            ctx,
            self.facility_id(),
            PermissionCode::AdminFeatureEntitlementsManage,
        )?;
        let entitlement = hms_db::admin::delete_feature_entitlement(
            self.pool(),
            self.facility_id(),
            key,
            ctx.user_id,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "feature_entitlement_delete_failed",
                "Feature entitlement override could not be removed.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("feature_not_found", "Feature was not found."))?;
        Ok(object(entitlement))
    }

    pub async fn list_staff(
        &self,
        ctx: &hms_access::RequestContext,
        query: StaffListQuery,
    ) -> Result<ListResponse<StaffListItem>, ApiError> {
        require_staff_access(ctx, self.facility_id())?;
        let search = query.search;
        let is_active = query.is_active;
        let practitioners_only = query.practitioners_only;
        let page = page_request(AdminListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::admin::list_staff_accounts(
            self.pool(),
            self.facility_id(),
            page.cursor,
            fetch_limit,
            search,
            is_active,
            practitioners_only,
        )
        .await
        .map_err(|_| ApiError::conflict("staff_list_failed", "Staff could not be loaded."))?;
        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn list_staff_directory(
        &self,
        ctx: &hms_access::RequestContext,
        query: AdminListQuery,
    ) -> Result<ListResponse<StaffDirectoryItem>, ApiError> {
        require_staff_directory_access(ctx, self.facility_id())?;
        let page = page_request(query)?;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::admin::list_staff_directory(
            self.pool(),
            self.facility_id(),
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "staff_directory_failed",
                "Staff directory could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.created_at, item.user_id)
        }))
    }

    pub async fn create_staff(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateStaffRequest,
    ) -> Result<ObjectResponse<StaffListItem>, ApiError> {
        require_staff_access(ctx, self.facility_id())?;
        validate_staff_payload(&payload)?;
        let password_hash = hash_password(&payload.temporary_password).map_err(|_| {
            ApiError::conflict("staff_create_failed", "Staff account could not be saved.")
        })?;
        let staff = hms_db::admin::create_staff_account(
            self.pool(),
            NewStaffAccount {
                facility_id: self.facility_id(),
                email: payload.email,
                display_name: payload.display_name,
                password_hash,
                employee_id: payload.employee_id,
                department: payload.department,
                position: payload.position,
                hire_date: payload.hire_date,
                created_by_user_id: ctx.user_id,
                practitioner_profile: payload.practitioner_profile.map(practitioner_profile),
            },
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict("staff_create_failed", "Staff account could not be saved.")
        })?;
        Ok(object(staff))
    }

    pub async fn get_staff(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StaffListItem>, ApiError> {
        require_staff_access(ctx, self.facility_id())?;
        let staff = hms_db::admin::get_staff_account(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict("staff_load_failed", "Staff account could not be loaded.")
            })?
            .ok_or_else(|| {
                ApiError::not_found("staff_not_found", "Staff account was not found.")
            })?;
        Ok(object(staff))
    }

    pub async fn update_staff(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdateStaffRequest,
    ) -> Result<ObjectResponse<StaffListItem>, ApiError> {
        require_staff_access(ctx, self.facility_id())?;
        validate_staff_update_payload(&payload)?;
        let staff = hms_db::admin::update_staff_account(
            self.pool(),
            self.facility_id(),
            id,
            payload,
            ctx.user_id,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict("staff_update_failed", "Staff account could not be updated.")
        })?
        .ok_or_else(|| ApiError::not_found("staff_not_found", "Staff account was not found."))?;
        Ok(object(staff))
    }

    pub async fn force_staff_password_reset(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StaffListItem>, ApiError> {
        require_high_risk_admin_access(ctx, self.facility_id(), PermissionCode::AdminStaffManage)?;
        let staff = hms_db::admin::force_staff_password_reset(
            self.pool(),
            self.facility_id(),
            id,
            ctx.user_id,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "staff_reset_failed",
                "Staff password reset could not be forced.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("staff_not_found", "Staff account was not found."))?;
        Ok(object(staff))
    }

    pub async fn deactivate_staff(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StaffListItem>, ApiError> {
        require_high_risk_admin_access(ctx, self.facility_id(), PermissionCode::AdminStaffManage)?;
        let staff = hms_db::admin::deactivate_staff_account(
            self.pool(),
            self.facility_id(),
            id,
            ctx.user_id,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "staff_deactivate_failed",
                "Staff account could not be deactivated.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("staff_not_found", "Staff account was not found."))?;
        Ok(object(staff))
    }

    pub async fn reactivate_staff(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StaffListItem>, ApiError> {
        require_high_risk_admin_access(ctx, self.facility_id(), PermissionCode::AdminStaffManage)?;
        let staff = hms_db::admin::reactivate_staff_account(
            self.pool(),
            self.facility_id(),
            id,
            ctx.user_id,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "staff_reactivate_failed",
                "Staff account could not be reactivated.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("staff_not_found", "Staff account was not found."))?;
        Ok(object(staff))
    }

    pub async fn upsert_staff_practitioner_profile(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpsertPractitionerProfileRequest,
    ) -> Result<ObjectResponse<StaffListItem>, ApiError> {
        require_staff_access(ctx, self.facility_id())?;
        validate_practitioner_profile(&payload)?;
        let staff = hms_db::admin::upsert_practitioner_profile(
            self.pool(),
            self.facility_id(),
            id,
            ctx.user_id,
            practitioner_profile(payload),
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "practitioner_profile_save_failed",
                "Practitioner profile could not be saved.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("staff_not_found", "Staff account was not found."))?;
        Ok(object(staff))
    }

    pub async fn list_practitioners(
        &self,
        ctx: &hms_access::RequestContext,
        query: PractitionerListQuery,
    ) -> Result<ListResponse<PractitionerListItem>, ApiError> {
        require_staff_access(ctx, self.state.facility_id())?;
        let search = query.search;
        let is_active = query.is_active;
        let page = page_request(AdminListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let fetch_limit = page.fetch_limit();
        let rows = self
            .state
            .list_practitioners(page.cursor, fetch_limit, search, is_active)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "practitioner_list_failed",
                    "Practitioners could not be loaded.",
                )
            })?;
        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_practitioner(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<PractitionerListItem>, ApiError> {
        require_staff_access(ctx, self.state.facility_id())?;
        let practitioner = self
            .state
            .get_practitioner(id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "practitioner_load_failed",
                    "Practitioner could not be loaded.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("practitioner_not_found", "Practitioner was not found.")
            })?;
        Ok(object(practitioner))
    }

    pub async fn list_delegations(
        &self,
        ctx: &hms_access::RequestContext,
        query: AdminListQuery,
    ) -> Result<ListResponse<DelegationListItem>, ApiError> {
        require_admin_access(ctx, self.state.facility_id())?;
        let page = page_request(query)?;
        let fetch_limit = page.fetch_limit();
        let rows = self
            .state
            .list_delegations(page.cursor, fetch_limit)
            .await
            .map_err(|_| {
                ApiError::conflict("delegation_list_failed", "Delegations could not be loaded.")
            })?;
        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_delegation(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateDelegationRequest,
    ) -> Result<ObjectResponse<DelegationListItem>, ApiError> {
        require_high_risk_admin_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdminAuthorityManage,
        )?;
        validate_text(&payload.reason, MAX_TEXT_LEN, "reason")?;
        validate_time_window(payload.starts_at, payload.ends_at)?;
        ensure_supported_permissions(&self.state, &[payload.permission_code]).await?;
        let delegation = self
            .state
            .create_delegation(payload, Some(ctx.request_id.clone()))
            .await
            .map_err(|_| {
                ApiError::conflict("delegation_create_failed", "Delegation could not be saved.")
            })?;
        Ok(object(delegation))
    }

    pub async fn list_audit_events(
        &self,
        ctx: &hms_access::RequestContext,
        query: AuditEventListQuery,
    ) -> Result<ListResponse<AuditEventListItem>, ApiError> {
        require_admin_access(ctx, self.state.facility_id())?;
        let filters = AuditEventFilters {
            search: query.search,
            category: query.category,
            action: query.action,
            start_date: query.start_date,
            end_date: query.end_date,
        };
        let page = page_request(AdminListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let fetch_limit = page.fetch_limit();
        let rows = self
            .state
            .list_audit_events(page.cursor, fetch_limit, filters)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "audit_event_list_failed",
                    "Audit events could not be loaded.",
                )
            })?;
        Ok(page_response(rows, page.limit, |item| {
            encode_cursor(item.occurred_at, item.id)
        }))
    }
}

impl AppState {
    pub fn admin_service(&self) -> AdminService {
        AdminService::new(self.clone())
    }
}

fn require_admin_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_admin_authority_access(ctx, facility_id).map_err(ApiError::from)
}

fn require_high_risk_admin_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_feature(ctx, FeatureKey::Admin).map_err(ApiError::from)?;
    hms_access::require_high_risk_facility_permission(ctx, facility_id, permission, Utc::now())
        .map_err(ApiError::from)
}

fn require_feature_entitlement_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_feature_entitlement_access(ctx, facility_id).map_err(|error| match error {
        hms_access::AccessError::AdminAuthorityAccessDenied => ApiError::forbidden(
            "permission_denied",
            "You do not have permission to manage feature entitlements.",
        ),
        other => ApiError::from(other),
    })
}

fn require_staff_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_staff_access(ctx, facility_id).map_err(|error| match error {
        hms_access::AccessError::AdminAuthorityAccessDenied => ApiError::forbidden(
            "permission_denied",
            "You do not have permission to manage staff.",
        ),
        other => ApiError::from(other),
    })
}

fn require_staff_directory_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_staff_directory_access(ctx, facility_id).map_err(|error| match error {
        hms_access::AccessError::MissingPermission => ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view the staff directory.",
        ),
        other => ApiError::from(other),
    })
}

async fn ensure_supported_permissions(
    state: &AppState,
    permissions: &[PermissionCode],
) -> Result<(), ApiError> {
    let supported = state
        .deployment_capabilities()
        .await
        .map_err(|_| ApiError::conflict("capabilities_load_failed", "Capabilities failed."))?
        .permissions;
    if permissions
        .iter()
        .any(|permission| !supported.contains(permission))
    {
        return Err(ApiError::bad_request(
            "unsupported_permission",
            "Permission is not supported by this deployment profile.",
        ));
    }
    Ok(())
}

fn validate_staff_payload(payload: &CreateStaffRequest) -> Result<(), ApiError> {
    validate_email(&payload.email)?;
    validate_text(&payload.display_name, MAX_NAME_LEN, "display_name")?;
    validate_code(&payload.employee_id)?;
    validate_text(&payload.department, MAX_NAME_LEN, "department")?;
    validate_text(&payload.position, MAX_NAME_LEN, "position")?;
    validate_password_policy(&payload.temporary_password)?;
    if let Some(profile) = payload.practitioner_profile.as_ref() {
        validate_practitioner_profile(profile)?;
    }
    Ok(())
}

fn validate_staff_update_payload(payload: &UpdateStaffRequest) -> Result<(), ApiError> {
    if let Some(value) = payload.display_name.as_ref() {
        validate_text(value, MAX_NAME_LEN, "display_name")?;
    }
    if let Some(value) = payload.department.as_ref() {
        validate_text(value, MAX_NAME_LEN, "department")?;
    }
    if let Some(value) = payload.position.as_ref() {
        validate_text(value, MAX_NAME_LEN, "position")?;
    }
    Ok(())
}

fn validate_practitioner_profile(
    payload: &UpsertPractitionerProfileRequest,
) -> Result<(), ApiError> {
    validate_text(&payload.license_number, MAX_CODE_LEN, "license_number")?;
    validate_text(&payload.specialization, MAX_NAME_LEN, "specialization")?;
    validate_text(&payload.qualification, MAX_NAME_LEN, "qualification")?;
    if let Some(value) = payload.fhir_practitioner_id.as_ref() {
        validate_text(value, MAX_TEXT_LEN, "fhir_practitioner_id")?;
    }
    Ok(())
}

fn practitioner_profile(payload: UpsertPractitionerProfileRequest) -> NewPractitionerProfile {
    NewPractitionerProfile {
        license_number: payload.license_number,
        specialization: payload.specialization,
        qualification: payload.qualification,
        fhir_practitioner_id: payload.fhir_practitioner_id,
    }
}

fn validate_code(value: &str) -> Result<(), ApiError> {
    validate_text(value, MAX_CODE_LEN, "code")?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(ApiError::bad_request(
            "invalid_code",
            "Code may only contain letters, numbers, dashes, and underscores.",
        ));
    }
    Ok(())
}

fn validate_email(value: &str) -> Result<(), ApiError> {
    let value = value.trim();
    if value.len() > MAX_EMAIL_LEN
        || !value.contains('@')
        || value.starts_with('@')
        || value.ends_with('@')
    {
        return Err(ApiError::bad_request(
            "invalid_email",
            "Email address is invalid.",
        ));
    }
    Ok(())
}

fn validate_password_policy(value: &str) -> Result<(), ApiError> {
    let meets_policy = value.len() >= 12
        && value.chars().any(char::is_uppercase)
        && value.chars().any(char::is_lowercase)
        && value.chars().any(|character| character.is_ascii_digit())
        && value
            .chars()
            .any(|character| !character.is_ascii_alphanumeric());
    if !meets_policy {
        return Err(ApiError::bad_request(
            "weak_password",
            "Temporary password does not meet policy.",
        ));
    }
    Ok(())
}

fn validate_text(value: &str, max_len: usize, field: &'static str) -> Result<(), ApiError> {
    if value.trim().is_empty() || value.len() > max_len {
        return Err(ApiError::bad_request("invalid_text", field));
    }
    Ok(())
}

fn validate_time_window(
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
) -> Result<(), ApiError> {
    if let (Some(starts_at), Some(ends_at)) = (starts_at, ends_at) {
        if ends_at <= starts_at {
            return Err(ApiError::bad_request(
                "invalid_time_window",
                "End time must be after start time.",
            ));
        }
    }
    Ok(())
}

fn page_request(query: AdminListQuery) -> Result<cursor_list::CursorPage<AdminCursor>, ApiError> {
    Ok(cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| AdminCursor { occurred_at, id },
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
