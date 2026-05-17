use std::sync::Arc;

use anyhow::{Context, Result};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use chrono::{DateTime, NaiveDate, Utc};
use hms_db::admin::{
    AdminCursor, AuditEventFilters, NewAuthorityAppointment, NewCommittee, NewDelegation,
    NewOrganizationUnit, NewPermissionAssignment, NewPosition, NewPositionTemplate,
    NewPractitionerProfile, NewStaffAccount,
};
use hms_db::auth::{NewRefreshSession, UserAccount, UserSessionRow};
use hms_db::billing::{
    BillingCursor, CashSessionFilters, ClaimContext, InvoiceContext, NewCashSession, NewClaim,
    NewInvoice, NewNhisBatch, NewPayment, NewRemittanceImport,
};
use hms_db::clinical::{
    ClinicalCursor, NewAllergy, NewChartEntry, NewClinicalNote, NewClinicalNoteTemplate,
    NewPrescription, NewProblem, NoteContext, UpdateClinicalNoteTemplate,
};
use hms_db::inventory::{
    InventoryCursor, NewControlledCount, NewControlledMovement, NewGoodsReceivedNote,
    NewPharmacyDispense, NewPurchaseOrder, NewStockBatch, NewStockRequisition, NewStockTransfer,
};
use hms_db::laboratory::{
    LabCursor, LabResultListFilters, NewLabResult, NewSpecimen, OrderContext, ResultContext,
    SpecimenContext,
};
use hms_db::provision::{generate_secret_token, hash_refresh_token, BaselineProvisioning};
use hms_db::search::{OmniSearchFilters, OmniSearchResult};
use hms_db::ward::{
    AdmissionContext, BedUpdate, NewAdmission, NewAdmissionCase, NewBed, NewFluidBalanceEntry,
    NewHandoff, NewMedicationAdministration, NewMonitoringEvent, NewNursingAlert, NewNursingTask,
    NewPatientVitals, NewTreatmentSheet, NewWard, NewWardSection, NewWardStockRequest, WardCursor,
    WardSectionUpdate, WardUpdate,
};
use hms_domain::admin::{
    AuditEventListItem, AuthorityAppointmentListItem, CommitteeListItem,
    CreateAuthorityAppointmentRequest, CreateCommitteeRequest, CreateDelegationRequest,
    CreateOrganizationUnitRequest, CreatePermissionAssignmentRequest, CreatePositionRequest,
    CreatePositionTemplateRequest, CreateStaffRequest, DelegationListItem,
    FeatureEntitlementListItem, OrgUnitType, OrganizationUnitListItem,
    PermissionAssignmentListItem, PositionListItem, PositionTemplateListItem, PractitionerListItem,
    StaffDirectoryItem, StaffListItem, UpdateStaffRequest, UpsertPractitionerProfileRequest,
};
use hms_domain::auth::{ActiveAuthority, AuthUser, UpdateAuthProfileRequest};
use hms_domain::billing::{
    BillingDashboardSummary, BillingRuleListItem, CashDrawerListItem, CashSessionListItem,
    ClaimListItem, CloseCashSessionRequest, InvoiceListItem, NhisBatchExport, NhisBatchListItem,
    PaymentListItem, PaymentMethod, ReceiptListItem, RemittanceImportListItem, ServiceCatalogItem,
    ServicePriceListItem,
};
use hms_domain::capabilities::{deployment_capabilities_from_features, DeploymentCapabilities};
use hms_domain::clinical::{
    AllergyListItem, AllergySeverity, ChartEntryListItem, ChartEntryType, ClinicalNoteDetail,
    ClinicalNoteListItem, ClinicalNoteTemplate, ClinicalNoteVersion, PatientChronicleSummary,
    PrescriptionListItem, ProblemListItem, ProblemStatus, UpdateAllergyRequest,
    UpdateClinicalNoteTemplateRequest, UpdatePrescriptionRequest, UpdateProblemRequest,
};
use hms_domain::deployment::FeatureKey;
use hms_domain::inventory::{
    ControlledMovementType, ControlledSubstanceBalanceValidation,
    ControlledSubstanceRegisterEntryItem, ControlledSubstanceRegisterItem,
    GoodsReceivedNoteListItem, InventoryCategoryListItem, InventoryDashboardSummary,
    InventoryItemListItem, InventoryItemStockLocationItem, PharmacyDispenseListItem,
    PurchaseOrderListItem, StockBatchListItem, StockMovementListItem, StockRequisitionListItem,
    StockTransferListItem, StorageLocationListItem, StorageLocationStockItem, SupplierListItem,
};
use hms_domain::laboratory::{LabResultListItem, SpecimenListItem};
use hms_domain::patients::PatientRecord;
use hms_domain::search::SearchResourceType;
use hms_domain::ward::{
    AdmissionCaseListItem, BedListItem, DischargeCaseListItem, FluidBalanceListItem,
    HandoffListItem, MedicationAdministrationListItem, MonitoringEventKind,
    MonitoringEventListItem, NursingAlertListItem, NursingAlertSeverity, NursingTaskListItem,
    NursingTaskType, PatientVitalsListItem, TreatmentSheetListItem, WardBoardItem, WardListItem,
    WardSectionListItem, WardStockRequestListItem,
};
use hms_events::DomainEventKind;
use password_hash::SaltString;
use rand_core::OsRng;
use tracing::warn;
use uuid::Uuid;

use crate::auth::{issue_access_token, verify_access_token, AccessClaims};
use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

struct AppStateInner {
    config: Config,
    started_at: DateTime<Utc>,
    facility_id: Uuid,
    pool: hms_db::PgPool,
}

#[derive(Clone, Debug)]
pub struct LoginOutcome {
    pub access_token: String,
    pub refresh_token: String,
    pub csrf_token: String,
    pub session_id: Uuid,
    pub user: AuthUser,
}

#[derive(Clone, Debug)]
pub struct PasswordResetRequestOutcome {
    pub accepted: bool,
    pub debug_token: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChangePasswordOutcome {
    Changed,
    UserNotFound,
    InvalidCurrentPassword,
    WeakPassword,
    PasswordReused,
}

impl AppState {
    pub async fn new(config: Config) -> Result<Self> {
        let started_at = Utc::now();
        let pool = hms_db::pool::connect_with_max_connections(
            &config.database_url,
            config.database_max_connections,
        )
        .await
        .context("failed to connect to Postgres")?;

        if config.auto_migrate {
            hms_db::migrate::run(&pool)
                .await
                .context("failed to run database migrations")?;
        }

        if config.provision_baseline {
            hms_db::provision::provision_baseline(
                &pool,
                &BaselineProvisioning::hms_local_with_facility_code(
                    config.deployment_profile,
                    config.facility_code.clone(),
                ),
            )
            .await
            .context("failed to provision baseline HMS data")?;
        }

        let facility_id = hms_db::facilities::facility_id_by_code(&pool, &config.facility_code)
            .await?
            .with_context(|| format!("facility {} is not provisioned", config.facility_code))?;

        if config.search_index_rebuild_on_start {
            hms_db::search::rebuild_search_index_for_facility(&pool, facility_id)
                .await
                .context("failed to rebuild OmniSearch index")?;
        }

        Ok(Self {
            inner: Arc::new(AppStateInner {
                config,
                started_at,
                facility_id,
                pool,
            }),
        })
    }

    pub fn started_at(&self) -> DateTime<Utc> {
        self.inner.started_at
    }

    pub fn postgres_pool_size(&self) -> u32 {
        self.inner.pool.size()
    }

    pub fn postgres_pool_idle(&self) -> usize {
        self.inner.pool.num_idle()
    }

    pub(crate) fn db_pool(&self) -> &hms_db::PgPool {
        &self.inner.pool
    }

    pub fn facility_id(&self) -> Uuid {
        self.inner.facility_id
    }

    pub fn cookie_secure(&self) -> bool {
        self.inner.config.cookie_secure
    }

    pub async fn omni_search(
        &self,
        user: &AuthUser,
        query: Option<String>,
        types: Vec<SearchResourceType>,
        limit_per_group: i64,
    ) -> Result<OmniSearchResult> {
        hms_db::search::omni_search(
            &self.inner.pool,
            OmniSearchFilters {
                facility_id: self.inner.facility_id,
                user_id: user.id,
                query,
                types,
                limit_per_group,
                permission_codes: user.permissions.clone(),
                feature_keys: user.features.clone(),
                patient_visibility: user.patient_visibility.clone(),
            },
        )
        .await
    }

    pub fn verify_access_token(
        &self,
        token: &str,
    ) -> Result<AccessClaims, jsonwebtoken::errors::Error> {
        verify_access_token(&self.inner.config.jwt_secret, token)
    }

    pub async fn auth_user(&self, user_id: Uuid) -> Result<Option<AuthUser>> {
        Ok(hms_db::auth::user_by_id(&self.inner.pool, user_id)
            .await?
            .map(|user| user.to_auth_user()))
    }

    pub async fn active_authorities_for_user(&self, user_id: Uuid) -> Result<Vec<ActiveAuthority>> {
        hms_db::admin::active_authorities_for_user(&self.inner.pool, self.facility_id(), user_id)
            .await
    }

    pub async fn update_auth_profile(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
        payload: UpdateAuthProfileRequest,
    ) -> Result<Option<AuthUser>> {
        Ok(
            hms_db::auth::update_user_profile(&self.inner.pool, facility_id, user_id, payload)
                .await?
                .map(|user| user.to_auth_user()),
        )
    }

    pub async fn login(
        &self,
        email: &str,
        password: &str,
        facility_code: &str,
        device_label: Option<&str>,
    ) -> Result<Option<LoginOutcome>> {
        if !self
            .inner
            .config
            .facility_code
            .eq_ignore_ascii_case(facility_code.trim())
        {
            return Ok(None);
        }

        let user = hms_db::auth::user_by_email_and_facility(
            &self.inner.pool,
            email.trim(),
            facility_code.trim(),
        )
        .await?;
        let Some(user) = user else {
            return Ok(None);
        };

        if !verify_password(&user.password_hash, password) {
            return Ok(None);
        }

        self.issue_session_for_user(&user, None, None, device_label)
            .await
    }

    pub async fn refresh(
        &self,
        refresh_token: &str,
        csrf_token: &str,
    ) -> Result<Option<LoginOutcome>> {
        let token_hash = hash_refresh_token(refresh_token);
        let csrf_token_hash = hash_refresh_token(csrf_token);
        let old_session =
            hms_db::auth::refresh_session_by_token_hash(&self.inner.pool, &token_hash).await?;
        let Some(old_session) = old_session else {
            return Ok(None);
        };

        if old_session.revoked_at.is_some() {
            let _ = hms_db::auth::revoke_refresh_session_family(
                &self.inner.pool,
                old_session.session_family_id,
                "refresh_token_reuse_detected",
            )
            .await?;
            warn!(
                session_family_id = %old_session.session_family_id,
                "revoked refresh-session family after refresh token reuse"
            );
            return Ok(None);
        }
        if old_session.expires_at <= Utc::now() {
            return Ok(None);
        }
        if old_session.csrf_token_hash != csrf_token_hash {
            return Ok(None);
        }

        let user = hms_db::auth::user_by_id(&self.inner.pool, old_session.user_id).await?;
        let Some(user) = user else {
            return Ok(None);
        };

        if user.facility_id != old_session.facility_id
            || user.session_version != old_session.session_version
            || user.permission_version != old_session.permission_version_at_issue
        {
            return Ok(None);
        }

        let revoked = hms_db::auth::revoke_refresh_session(
            &self.inner.pool,
            &token_hash,
            &csrf_token_hash,
            "rotated",
        )
        .await?;
        if !revoked {
            return Ok(None);
        }

        self.issue_session_for_user(
            &user,
            Some(old_session.session_family_id),
            Some(old_session.session_id),
            old_session.device_label.as_deref(),
        )
        .await
    }

    pub async fn logout(&self, refresh_token: &str, csrf_token: &str) -> Result<()> {
        let token_hash = hash_refresh_token(refresh_token);
        let csrf_token_hash = hash_refresh_token(csrf_token);
        let _ = hms_db::auth::revoke_refresh_session(
            &self.inner.pool,
            &token_hash,
            &csrf_token_hash,
            "logout",
        )
        .await?;
        Ok(())
    }

    pub async fn request_password_reset(
        &self,
        email: &str,
        facility_code: &str,
    ) -> Result<PasswordResetRequestOutcome> {
        if !self
            .inner
            .config
            .facility_code
            .eq_ignore_ascii_case(facility_code.trim())
        {
            return Ok(PasswordResetRequestOutcome {
                accepted: true,
                debug_token: None,
            });
        }

        let Some(user) = hms_db::auth::user_by_email_and_facility(
            &self.inner.pool,
            email.trim(),
            facility_code.trim(),
        )
        .await?
        else {
            return Ok(PasswordResetRequestOutcome {
                accepted: true,
                debug_token: None,
            });
        };

        let raw_token = generate_secret_token();
        let expires_at = Utc::now() + chrono::Duration::minutes(30);
        hms_db::auth::insert_password_reset_token(
            &self.inner.pool,
            &hms_db::auth::NewPasswordResetToken {
                token_hash: hash_refresh_token(&raw_token),
                user_id: user.id,
                facility_id: user.facility_id,
                expires_at,
            },
        )
        .await?;
        hms_db::events::insert_domain_event(
            &self.inner.pool,
            &hms_db::events::NewDomainEvent {
                id: Uuid::new_v4(),
                kind: DomainEventKind::PasswordResetRequested,
                aggregate_type: "user".to_owned(),
                aggregate_id: Some(user.id),
                facility_id: Some(user.facility_id),
                payload: serde_json::json!({}),
            },
        )
        .await?;

        Ok(PasswordResetRequestOutcome {
            accepted: true,
            debug_token: (self.inner.config.environment == "test").then_some(raw_token),
        })
    }

    pub async fn complete_password_reset(&self, token: &str, new_password: &str) -> Result<bool> {
        if !password_meets_policy(new_password) {
            return Ok(false);
        }

        let token_hash = hash_refresh_token(token);
        let Some(reset_token) =
            hms_db::auth::password_reset_token_by_hash(&self.inner.pool, &token_hash).await?
        else {
            return Ok(false);
        };

        if reset_token.used_at.is_some()
            || reset_token.expires_at <= Utc::now()
            || reset_token.facility_id != self.facility_id()
        {
            return Ok(false);
        }

        let previous_hashes =
            hms_db::auth::password_hashes_for_user(&self.inner.pool, reset_token.user_id, 5)
                .await?;
        if previous_hashes
            .iter()
            .any(|hash| verify_password(hash, new_password))
        {
            return Ok(false);
        }

        let new_password_hash = hash_password(new_password)?;
        let completed = hms_db::auth::complete_password_reset(
            &self.inner.pool,
            &token_hash,
            reset_token.user_id,
            &new_password_hash,
        )
        .await?;

        if completed {
            hms_db::events::insert_domain_event(
                &self.inner.pool,
                &hms_db::events::NewDomainEvent {
                    id: Uuid::new_v4(),
                    kind: DomainEventKind::PasswordResetCompleted,
                    aggregate_type: "user".to_owned(),
                    aggregate_id: Some(reset_token.user_id),
                    facility_id: Some(reset_token.facility_id),
                    payload: serde_json::json!({}),
                },
            )
            .await?;
        }

        Ok(completed)
    }

    pub async fn change_password(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
        current_password: &str,
        new_password: &str,
    ) -> Result<ChangePasswordOutcome> {
        if facility_id != self.facility_id() {
            return Ok(ChangePasswordOutcome::UserNotFound);
        }
        if !password_meets_policy(new_password) {
            return Ok(ChangePasswordOutcome::WeakPassword);
        }

        let Some(user) = hms_db::auth::user_by_id(&self.inner.pool, user_id).await? else {
            return Ok(ChangePasswordOutcome::UserNotFound);
        };
        if user.facility_id != facility_id {
            return Ok(ChangePasswordOutcome::UserNotFound);
        }
        if !verify_password(&user.password_hash, current_password) {
            return Ok(ChangePasswordOutcome::InvalidCurrentPassword);
        }

        let previous_hashes =
            hms_db::auth::password_hashes_for_user(&self.inner.pool, user_id, 5).await?;
        if previous_hashes
            .iter()
            .any(|hash| verify_password(hash, new_password))
        {
            return Ok(ChangePasswordOutcome::PasswordReused);
        }

        let new_password_hash = hash_password(new_password)?;
        let changed = hms_db::auth::change_user_password(
            &self.inner.pool,
            facility_id,
            user_id,
            &new_password_hash,
        )
        .await?;

        Ok(if changed.is_some() {
            ChangePasswordOutcome::Changed
        } else {
            ChangePasswordOutcome::UserNotFound
        })
    }

    pub async fn list_auth_sessions(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
        current_session_id: Uuid,
    ) -> Result<Vec<UserSessionRow>> {
        if facility_id != self.facility_id() {
            return Ok(Vec::new());
        }
        hms_db::auth::list_active_user_sessions(
            &self.inner.pool,
            facility_id,
            user_id,
            current_session_id,
            20,
        )
        .await
    }

    pub async fn revoke_auth_session(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
        session_id: Uuid,
    ) -> Result<bool> {
        if facility_id != self.facility_id() {
            return Ok(false);
        }
        hms_db::auth::revoke_user_session(
            &self.inner.pool,
            facility_id,
            user_id,
            session_id,
            "user_revoked",
        )
        .await
    }

    pub async fn revoke_other_auth_sessions(
        &self,
        user_id: Uuid,
        facility_id: Uuid,
        current_session_id: Uuid,
    ) -> Result<u64> {
        if facility_id != self.facility_id() {
            return Ok(0);
        }
        hms_db::auth::revoke_other_user_sessions(
            &self.inner.pool,
            facility_id,
            user_id,
            current_session_id,
            "user_revoked_others",
        )
        .await
    }

    pub async fn deployment_capabilities(&self) -> Result<DeploymentCapabilities> {
        let features = hms_db::admin::effective_feature_flags(
            &self.inner.pool,
            self.facility_id(),
            self.inner.config.deployment_profile,
        )
        .await?;
        Ok(deployment_capabilities_from_features(
            self.inner.config.deployment_profile,
            self.facility_id(),
            &self.inner.config.facility_code,
            features,
        ))
    }

    pub async fn list_organization_units(
        &self,
        cursor: Option<AdminCursor>,
        limit: i64,
        unit_type: Option<OrgUnitType>,
        is_active: Option<bool>,
    ) -> Result<Vec<OrganizationUnitListItem>> {
        hms_db::admin::list_organization_units(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
            unit_type,
            is_active,
        )
        .await
    }

    pub async fn create_organization_unit(
        &self,
        payload: CreateOrganizationUnitRequest,
    ) -> Result<OrganizationUnitListItem> {
        hms_db::admin::create_organization_unit(
            &self.inner.pool,
            NewOrganizationUnit {
                facility_id: self.facility_id(),
                code: payload.code,
                name: payload.name,
                unit_type: payload.unit_type,
                parent_unit_id: payload.parent_unit_id,
            },
        )
        .await
    }

    pub async fn get_organization_unit(
        &self,
        id: Uuid,
    ) -> Result<Option<OrganizationUnitListItem>> {
        hms_db::admin::get_organization_unit_by_id(&self.inner.pool, self.facility_id(), id).await
    }

    pub async fn list_organization_unit_children(
        &self,
        parent_unit_id: Uuid,
        cursor: Option<AdminCursor>,
        limit: i64,
    ) -> Result<Vec<OrganizationUnitListItem>> {
        hms_db::admin::list_organization_unit_children(
            &self.inner.pool,
            self.facility_id(),
            parent_unit_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn list_organization_unit_ancestors(
        &self,
        unit_id: Uuid,
        limit: i64,
    ) -> Result<Vec<OrganizationUnitListItem>> {
        hms_db::admin::list_organization_unit_ancestors(
            &self.inner.pool,
            self.facility_id(),
            unit_id,
            limit,
        )
        .await
    }

    pub async fn list_organization_unit_descendants(
        &self,
        unit_id: Uuid,
        cursor: Option<AdminCursor>,
        limit: i64,
    ) -> Result<Vec<OrganizationUnitListItem>> {
        hms_db::admin::list_organization_unit_descendants(
            &self.inner.pool,
            self.facility_id(),
            unit_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn list_position_templates(
        &self,
        cursor: Option<AdminCursor>,
        limit: i64,
    ) -> Result<Vec<PositionTemplateListItem>> {
        hms_db::admin::list_position_templates(&self.inner.pool, self.facility_id(), cursor, limit)
            .await
    }

    pub async fn create_position_template(
        &self,
        payload: CreatePositionTemplateRequest,
    ) -> Result<PositionTemplateListItem> {
        hms_db::admin::create_position_template(
            &self.inner.pool,
            NewPositionTemplate {
                facility_id: self.facility_id(),
                code: payload.code,
                title: payload.title,
                description: payload.description,
                permission_codes: payload.permission_codes,
            },
        )
        .await
    }

    pub async fn list_positions(
        &self,
        cursor: Option<AdminCursor>,
        limit: i64,
    ) -> Result<Vec<PositionListItem>> {
        hms_db::admin::list_positions(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn create_position(
        &self,
        payload: CreatePositionRequest,
    ) -> Result<PositionListItem> {
        hms_db::admin::create_position(
            &self.inner.pool,
            NewPosition {
                facility_id: self.facility_id(),
                code: payload.code,
                title: payload.title,
                org_unit_id: payload.org_unit_id,
                template_id: payload.template_id,
            },
        )
        .await
    }

    pub async fn list_authority_appointments(
        &self,
        cursor: Option<AdminCursor>,
        limit: i64,
    ) -> Result<Vec<AuthorityAppointmentListItem>> {
        hms_db::admin::list_authority_appointments(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_authority_appointment(
        &self,
        payload: CreateAuthorityAppointmentRequest,
        actor_user_id: Uuid,
        request_id: Option<String>,
    ) -> Result<AuthorityAppointmentListItem> {
        hms_db::admin::create_authority_appointment(
            &self.inner.pool,
            NewAuthorityAppointment {
                facility_id: self.facility_id(),
                position_id: payload.position_id,
                user_id: payload.user_id,
                appointed_by_user_id: actor_user_id,
                appointment_type: payload.appointment_type,
                starts_at: payload.starts_at.unwrap_or_else(Utc::now),
                ends_at: payload.ends_at,
            },
            request_id,
        )
        .await
    }

    pub async fn list_permission_assignments(
        &self,
        cursor: Option<AdminCursor>,
        limit: i64,
    ) -> Result<Vec<PermissionAssignmentListItem>> {
        hms_db::admin::list_permission_assignments(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_permission_assignment(
        &self,
        payload: CreatePermissionAssignmentRequest,
        actor_user_id: Uuid,
        request_id: Option<String>,
    ) -> Result<PermissionAssignmentListItem> {
        hms_db::admin::create_permission_assignment(
            &self.inner.pool,
            NewPermissionAssignment {
                facility_id: self.facility_id(),
                grantee_user_id: payload.grantee_user_id,
                permission_code: payload.permission_code,
                scope_type: payload.scope_type,
                scope_id: payload.scope_id,
                granted_by_user_id: actor_user_id,
                starts_at: payload.starts_at.unwrap_or_else(Utc::now),
                ends_at: payload.ends_at,
                reason_code: payload.reason_code,
            },
            request_id,
        )
        .await
    }

    pub async fn list_feature_entitlements(&self) -> Result<Vec<FeatureEntitlementListItem>> {
        hms_db::admin::list_feature_entitlements(&self.inner.pool, self.facility_id()).await
    }

    pub async fn update_feature_entitlement(
        &self,
        feature: FeatureKey,
        enabled: bool,
        actor_user_id: Uuid,
        request_id: Option<String>,
    ) -> Result<Option<FeatureEntitlementListItem>> {
        hms_db::admin::update_feature_entitlement(
            &self.inner.pool,
            self.facility_id(),
            feature,
            enabled,
            actor_user_id,
            request_id,
        )
        .await
    }

    pub async fn delete_feature_entitlement(
        &self,
        feature: FeatureKey,
        actor_user_id: Uuid,
        request_id: Option<String>,
    ) -> Result<Option<FeatureEntitlementListItem>> {
        hms_db::admin::delete_feature_entitlement(
            &self.inner.pool,
            self.facility_id(),
            feature,
            actor_user_id,
            request_id,
        )
        .await
    }

    pub async fn list_staff_accounts(
        &self,
        cursor: Option<AdminCursor>,
        limit: i64,
        search: Option<String>,
        is_active: Option<bool>,
        practitioners_only: Option<bool>,
    ) -> Result<Vec<StaffListItem>> {
        hms_db::admin::list_staff_accounts(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
            search,
            is_active,
            practitioners_only,
        )
        .await
    }

    pub async fn list_staff_directory(
        &self,
        cursor: Option<AdminCursor>,
        limit: i64,
    ) -> Result<Vec<StaffDirectoryItem>> {
        hms_db::admin::list_staff_directory(&self.inner.pool, self.facility_id(), cursor, limit)
            .await
    }

    pub async fn get_staff_account(&self, staff_id: Uuid) -> Result<Option<StaffListItem>> {
        hms_db::admin::get_staff_account(&self.inner.pool, self.facility_id(), staff_id).await
    }

    pub async fn create_staff_account(
        &self,
        payload: CreateStaffRequest,
        actor_user_id: Uuid,
        request_id: Option<String>,
    ) -> Result<StaffListItem> {
        let password_hash = hash_password(&payload.temporary_password)?;
        hms_db::admin::create_staff_account(
            &self.inner.pool,
            NewStaffAccount {
                facility_id: self.facility_id(),
                email: payload.email,
                display_name: payload.display_name,
                password_hash,
                employee_id: payload.employee_id,
                department: payload.department,
                position: payload.position,
                hire_date: payload.hire_date,
                created_by_user_id: actor_user_id,
                practitioner_profile: payload.practitioner_profile.map(practitioner_profile),
            },
            request_id,
        )
        .await
    }

    pub async fn update_staff_account(
        &self,
        staff_id: Uuid,
        payload: UpdateStaffRequest,
        actor_user_id: Uuid,
        request_id: Option<String>,
    ) -> Result<Option<StaffListItem>> {
        hms_db::admin::update_staff_account(
            &self.inner.pool,
            self.facility_id(),
            staff_id,
            payload,
            actor_user_id,
            request_id,
        )
        .await
    }

    pub async fn force_staff_password_reset(
        &self,
        staff_id: Uuid,
        actor_user_id: Uuid,
        request_id: Option<String>,
    ) -> Result<Option<StaffListItem>> {
        hms_db::admin::force_staff_password_reset(
            &self.inner.pool,
            self.facility_id(),
            staff_id,
            actor_user_id,
            request_id,
        )
        .await
    }

    pub async fn deactivate_staff_account(
        &self,
        staff_id: Uuid,
        actor_user_id: Uuid,
        request_id: Option<String>,
    ) -> Result<Option<StaffListItem>> {
        hms_db::admin::deactivate_staff_account(
            &self.inner.pool,
            self.facility_id(),
            staff_id,
            actor_user_id,
            request_id,
        )
        .await
    }

    pub async fn reactivate_staff_account(
        &self,
        staff_id: Uuid,
        actor_user_id: Uuid,
        request_id: Option<String>,
    ) -> Result<Option<StaffListItem>> {
        hms_db::admin::reactivate_staff_account(
            &self.inner.pool,
            self.facility_id(),
            staff_id,
            actor_user_id,
            request_id,
        )
        .await
    }

    pub async fn upsert_practitioner_profile(
        &self,
        staff_id: Uuid,
        actor_user_id: Uuid,
        payload: UpsertPractitionerProfileRequest,
        request_id: Option<String>,
    ) -> Result<Option<StaffListItem>> {
        hms_db::admin::upsert_practitioner_profile(
            &self.inner.pool,
            self.facility_id(),
            staff_id,
            actor_user_id,
            practitioner_profile(payload),
            request_id,
        )
        .await
    }

    pub async fn list_practitioners(
        &self,
        cursor: Option<AdminCursor>,
        limit: i64,
        search: Option<String>,
        is_active: Option<bool>,
    ) -> Result<Vec<PractitionerListItem>> {
        hms_db::admin::list_practitioners(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
            search,
            is_active,
        )
        .await
    }

    pub async fn get_practitioner(&self, id: Uuid) -> Result<Option<PractitionerListItem>> {
        hms_db::admin::get_practitioner(&self.inner.pool, self.facility_id(), id).await
    }

    pub async fn list_committees(
        &self,
        cursor: Option<AdminCursor>,
        limit: i64,
    ) -> Result<Vec<CommitteeListItem>> {
        hms_db::admin::list_committees(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn create_committee(
        &self,
        payload: CreateCommitteeRequest,
    ) -> Result<CommitteeListItem> {
        hms_db::admin::create_committee(
            &self.inner.pool,
            NewCommittee {
                facility_id: self.facility_id(),
                code: payload.code,
                name: payload.name,
                mandate: payload.mandate,
            },
        )
        .await
    }

    pub async fn list_delegations(
        &self,
        cursor: Option<AdminCursor>,
        limit: i64,
    ) -> Result<Vec<DelegationListItem>> {
        hms_db::admin::list_delegations(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn create_delegation(
        &self,
        payload: CreateDelegationRequest,
        request_id: Option<String>,
    ) -> Result<DelegationListItem> {
        hms_db::admin::create_delegation(
            &self.inner.pool,
            NewDelegation {
                facility_id: self.facility_id(),
                delegator_user_id: payload.delegator_user_id,
                delegate_user_id: payload.delegate_user_id,
                permission_code: payload.permission_code,
                starts_at: payload.starts_at.unwrap_or_else(Utc::now),
                ends_at: payload.ends_at,
                reason: payload.reason,
            },
            request_id,
        )
        .await
    }

    pub async fn list_audit_events(
        &self,
        cursor: Option<AdminCursor>,
        limit: i64,
        filters: AuditEventFilters,
    ) -> Result<Vec<AuditEventListItem>> {
        hms_db::admin::list_audit_events(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
            filters,
        )
        .await
    }

    pub async fn get_patient(&self, id: Uuid) -> Result<Option<PatientRecord>> {
        hms_db::patients::get_patient(&self.inner.pool, self.facility_id(), id).await
    }

    pub async fn list_clinical_note_templates(
        &self,
        limit: i64,
    ) -> Result<Vec<ClinicalNoteTemplate>> {
        hms_db::clinical::list_note_templates(&self.inner.pool, self.facility_id(), limit).await
    }

    pub async fn get_clinical_note_template(
        &self,
        template_id: Uuid,
    ) -> Result<Option<ClinicalNoteTemplate>> {
        hms_db::clinical::get_note_template(&self.inner.pool, self.facility_id(), template_id).await
    }

    pub async fn create_clinical_note_template(
        &self,
        title: String,
        note_type: String,
        body_template: String,
    ) -> Result<ClinicalNoteTemplate> {
        hms_db::clinical::create_note_template(
            &self.inner.pool,
            NewClinicalNoteTemplate {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                title,
                note_type,
                body_template,
            },
        )
        .await
    }

    pub async fn update_clinical_note_template(
        &self,
        template_id: Uuid,
        payload: UpdateClinicalNoteTemplateRequest,
    ) -> Result<Option<ClinicalNoteTemplate>> {
        hms_db::clinical::update_note_template(
            &self.inner.pool,
            self.facility_id(),
            template_id,
            UpdateClinicalNoteTemplate {
                title: payload.title,
                note_type: payload.note_type,
                body_template: payload.body_template,
                is_active: payload.is_active,
            },
        )
        .await
    }

    pub async fn deactivate_clinical_note_template(
        &self,
        template_id: Uuid,
    ) -> Result<Option<ClinicalNoteTemplate>> {
        hms_db::clinical::deactivate_note_template(
            &self.inner.pool,
            self.facility_id(),
            template_id,
        )
        .await
    }

    pub async fn list_clinical_notes(
        &self,
        patient_id: Uuid,
        cursor: Option<ClinicalCursor>,
        limit: i64,
    ) -> Result<Vec<ClinicalNoteListItem>> {
        hms_db::clinical::list_notes(
            &self.inner.pool,
            self.facility_id(),
            patient_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_clinical_note(
        &self,
        patient_id: Uuid,
        note_type: String,
        title: String,
        body: String,
        actor_user_id: Uuid,
    ) -> Result<ClinicalNoteListItem> {
        hms_db::clinical::create_note(
            &self.inner.pool,
            NewClinicalNote {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                note_type,
                title,
                body,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn get_clinical_note_context(&self, note_id: Uuid) -> Result<Option<NoteContext>> {
        hms_db::clinical::get_note_context(&self.inner.pool, self.facility_id(), note_id).await
    }

    pub async fn get_clinical_note_detail(
        &self,
        note_id: Uuid,
    ) -> Result<Option<ClinicalNoteDetail>> {
        hms_db::clinical::get_note_detail(&self.inner.pool, self.facility_id(), note_id).await
    }

    pub async fn list_clinical_note_versions(
        &self,
        note_id: Uuid,
    ) -> Result<Vec<ClinicalNoteVersion>> {
        hms_db::clinical::list_note_versions(&self.inner.pool, note_id).await
    }

    pub async fn create_clinical_note_version(
        &self,
        note_id: Uuid,
        body: String,
        actor_user_id: Uuid,
    ) -> Result<ClinicalNoteVersion> {
        hms_db::clinical::create_note_version(&self.inner.pool, note_id, body, actor_user_id).await
    }

    pub async fn list_problems(
        &self,
        patient_id: Uuid,
        cursor: Option<ClinicalCursor>,
        limit: i64,
    ) -> Result<Vec<ProblemListItem>> {
        hms_db::clinical::list_problems(
            &self.inner.pool,
            self.facility_id(),
            patient_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_problem(
        &self,
        patient_id: Uuid,
        label: String,
        onset_date: Option<NaiveDate>,
        actor_user_id: Uuid,
    ) -> Result<ProblemListItem> {
        hms_db::clinical::create_problem(
            &self.inner.pool,
            NewProblem {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                label,
                onset_date,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn get_problem(&self, problem_id: Uuid) -> Result<Option<ProblemListItem>> {
        hms_db::clinical::get_problem(&self.inner.pool, self.facility_id(), problem_id).await
    }

    pub async fn update_problem_status(
        &self,
        problem_id: Uuid,
        status: ProblemStatus,
    ) -> Result<Option<ProblemListItem>> {
        hms_db::clinical::update_problem_status(
            &self.inner.pool,
            self.facility_id(),
            problem_id,
            status,
        )
        .await
    }

    pub async fn update_problem(
        &self,
        problem_id: Uuid,
        update: UpdateProblemRequest,
    ) -> Result<Option<ProblemListItem>> {
        hms_db::clinical::update_problem(&self.inner.pool, self.facility_id(), problem_id, update)
            .await
    }

    pub async fn list_allergies(
        &self,
        patient_id: Uuid,
        cursor: Option<ClinicalCursor>,
        limit: i64,
    ) -> Result<Vec<AllergyListItem>> {
        hms_db::clinical::list_allergies(
            &self.inner.pool,
            self.facility_id(),
            patient_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_allergy(
        &self,
        patient_id: Uuid,
        substance: String,
        reaction: Option<String>,
        severity: AllergySeverity,
        actor_user_id: Uuid,
    ) -> Result<AllergyListItem> {
        hms_db::clinical::create_allergy(
            &self.inner.pool,
            NewAllergy {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                substance,
                reaction,
                severity,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn get_allergy(&self, allergy_id: Uuid) -> Result<Option<AllergyListItem>> {
        hms_db::clinical::get_allergy(&self.inner.pool, self.facility_id(), allergy_id).await
    }

    pub async fn update_allergy(
        &self,
        allergy_id: Uuid,
        update: UpdateAllergyRequest,
    ) -> Result<Option<AllergyListItem>> {
        hms_db::clinical::update_allergy(&self.inner.pool, self.facility_id(), allergy_id, update)
            .await
    }

    pub async fn deactivate_allergy(&self, allergy_id: Uuid) -> Result<Option<AllergyListItem>> {
        hms_db::clinical::deactivate_allergy(&self.inner.pool, self.facility_id(), allergy_id).await
    }

    pub async fn list_prescriptions(
        &self,
        patient_id: Uuid,
        cursor: Option<ClinicalCursor>,
        limit: i64,
    ) -> Result<Vec<PrescriptionListItem>> {
        hms_db::clinical::list_prescriptions(
            &self.inner.pool,
            self.facility_id(),
            patient_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_prescription(
        &self,
        patient_id: Uuid,
        medication_name: String,
        dose: String,
        frequency: String,
        actor_user_id: Uuid,
    ) -> Result<PrescriptionListItem> {
        hms_db::clinical::create_prescription(
            &self.inner.pool,
            NewPrescription {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                medication_name,
                dose,
                frequency,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn get_prescription(
        &self,
        prescription_id: Uuid,
    ) -> Result<Option<PrescriptionListItem>> {
        hms_db::clinical::get_prescription(&self.inner.pool, self.facility_id(), prescription_id)
            .await
    }

    pub async fn update_prescription(
        &self,
        prescription_id: Uuid,
        update: UpdatePrescriptionRequest,
    ) -> Result<Option<PrescriptionListItem>> {
        hms_db::clinical::update_prescription(
            &self.inner.pool,
            self.facility_id(),
            prescription_id,
            update,
        )
        .await
    }

    pub async fn list_chart_entries(
        &self,
        patient_id: Uuid,
        cursor: Option<ClinicalCursor>,
        limit: i64,
    ) -> Result<Vec<ChartEntryListItem>> {
        hms_db::clinical::list_chart_entries(
            &self.inner.pool,
            self.facility_id(),
            patient_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_chart_entry(
        &self,
        patient_id: Uuid,
        entry_type: ChartEntryType,
        measured_at: DateTime<Utc>,
        value: String,
        unit: Option<String>,
        actor_user_id: Uuid,
    ) -> Result<ChartEntryListItem> {
        hms_db::clinical::create_chart_entry(
            &self.inner.pool,
            NewChartEntry {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                entry_type,
                measured_at,
                value,
                unit,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn patient_chronicle_summary(
        &self,
        patient_id: Uuid,
        limit: i64,
    ) -> Result<Option<PatientChronicleSummary>> {
        hms_db::clinical::patient_chronicle_summary(
            &self.inner.pool,
            self.facility_id(),
            patient_id,
            limit,
        )
        .await
    }

    pub async fn list_lab_specimens(
        &self,
        cursor: Option<LabCursor>,
        limit: i64,
    ) -> Result<Vec<SpecimenListItem>> {
        hms_db::laboratory::list_specimens(&self.inner.pool, self.facility_id(), cursor, limit)
            .await
    }

    pub async fn get_lab_specimen(&self, specimen_id: Uuid) -> Result<Option<SpecimenListItem>> {
        hms_db::laboratory::get_specimen_by_id(&self.inner.pool, self.facility_id(), specimen_id)
            .await
    }

    pub async fn create_lab_specimen(
        &self,
        order: &OrderContext,
        specimen_type: String,
        actor_user_id: Uuid,
    ) -> Result<SpecimenListItem> {
        hms_db::laboratory::create_specimen(
            &self.inner.pool,
            NewSpecimen {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                order_id: order.id,
                patient_id: order.patient_id,
                specimen_type,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn get_lab_specimen_context(
        &self,
        specimen_id: Uuid,
    ) -> Result<Option<SpecimenContext>> {
        hms_db::laboratory::get_specimen_context(&self.inner.pool, self.facility_id(), specimen_id)
            .await
    }

    pub async fn receive_lab_specimen(
        &self,
        specimen_id: Uuid,
    ) -> Result<Option<SpecimenListItem>> {
        hms_db::laboratory::receive_specimen(&self.inner.pool, self.facility_id(), specimen_id)
            .await
    }

    pub async fn list_lab_results(
        &self,
        cursor: Option<LabCursor>,
        limit: i64,
        filters: LabResultListFilters,
    ) -> Result<Vec<LabResultListItem>> {
        hms_db::laboratory::list_results(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
            filters,
        )
        .await
    }

    pub async fn get_lab_result(&self, result_id: Uuid) -> Result<Option<LabResultListItem>> {
        hms_db::laboratory::get_result_by_id(&self.inner.pool, self.facility_id(), result_id).await
    }

    pub async fn create_lab_result(
        &self,
        specimen: &SpecimenContext,
        test_id: Uuid,
        value: String,
        unit: Option<String>,
        actor_user_id: Uuid,
    ) -> Result<LabResultListItem> {
        hms_db::laboratory::create_result(
            &self.inner.pool,
            NewLabResult {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                specimen_id: specimen.id,
                order_id: specimen.order_id,
                patient_id: specimen.patient_id,
                test_id,
                value,
                unit,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn create_lab_results(
        &self,
        specimen: &SpecimenContext,
        results: Vec<(Uuid, String, Option<String>)>,
        actor_user_id: Uuid,
    ) -> Result<Vec<LabResultListItem>> {
        let records = results
            .into_iter()
            .map(|(test_id, value, unit)| NewLabResult {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                specimen_id: specimen.id,
                order_id: specimen.order_id,
                patient_id: specimen.patient_id,
                test_id,
                value,
                unit,
                actor_user_id,
            })
            .collect();
        hms_db::laboratory::create_results(
            &self.inner.pool,
            self.facility_id(),
            specimen.order_id,
            records,
        )
        .await
    }

    pub async fn get_lab_result_context(&self, result_id: Uuid) -> Result<Option<ResultContext>> {
        hms_db::laboratory::get_result_context(&self.inner.pool, self.facility_id(), result_id)
            .await
    }

    pub async fn verify_lab_result(
        &self,
        result_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Option<LabResultListItem>> {
        hms_db::laboratory::verify_result(
            &self.inner.pool,
            self.facility_id(),
            result_id,
            actor_user_id,
        )
        .await
    }

    pub async fn bulk_verify_lab_results(
        &self,
        order_id: Option<Uuid>,
        result_ids: Vec<Uuid>,
        actor_user_id: Uuid,
    ) -> Result<i64> {
        hms_db::laboratory::verify_results(
            &self.inner.pool,
            self.facility_id(),
            order_id,
            &result_ids,
            actor_user_id,
        )
        .await
    }

    pub async fn list_inventory_categories(&self) -> Result<Vec<InventoryCategoryListItem>> {
        hms_db::inventory::list_categories(&self.inner.pool, self.facility_id()).await
    }

    pub async fn list_service_catalog(
        &self,
        cursor: Option<BillingCursor>,
        limit: i64,
        filters: hms_db::billing::ServiceCatalogFilters,
    ) -> Result<Vec<ServiceCatalogItem>> {
        hms_db::billing::list_service_catalog(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
            filters,
        )
        .await
    }

    pub async fn list_service_prices(&self) -> Result<Vec<ServicePriceListItem>> {
        hms_db::billing::list_service_prices(&self.inner.pool, self.facility_id()).await
    }

    pub async fn list_billing_rules(
        &self,
        filters: hms_db::billing::BillingRuleFilters,
        limit: i64,
    ) -> Result<Vec<BillingRuleListItem>> {
        hms_db::billing::list_billing_rules(&self.inner.pool, self.facility_id(), filters, limit)
            .await
    }

    pub async fn get_billing_rule(&self, rule_id: Uuid) -> Result<Option<BillingRuleListItem>> {
        hms_db::billing::get_billing_rule(&self.inner.pool, self.facility_id(), rule_id).await
    }

    pub async fn billing_dashboard_summary(&self) -> Result<BillingDashboardSummary> {
        hms_db::billing::billing_dashboard_summary(&self.inner.pool, self.facility_id()).await
    }

    pub async fn list_billing_invoices(
        &self,
        patient_id: Option<Uuid>,
        cursor: Option<BillingCursor>,
        limit: i64,
    ) -> Result<Vec<InvoiceListItem>> {
        hms_db::billing::list_invoices(
            &self.inner.pool,
            self.facility_id(),
            patient_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_billing_invoice(
        &self,
        patient_id: Uuid,
        service_price_id: Uuid,
        quantity: i64,
        actor_user_id: Uuid,
    ) -> Result<InvoiceListItem> {
        let id = Uuid::new_v4();
        hms_db::billing::create_invoice(
            &self.inner.pool,
            NewInvoice {
                id,
                facility_id: self.facility_id(),
                patient_id,
                service_price_id,
                quantity,
                invoice_number: format!("INV-{}", &id.simple().to_string()[..10].to_uppercase()),
                actor_user_id,
            },
        )
        .await
    }

    pub async fn get_billing_invoice(&self, invoice_id: Uuid) -> Result<Option<InvoiceListItem>> {
        hms_db::billing::get_invoice(&self.inner.pool, self.facility_id(), invoice_id).await
    }

    pub async fn billing_invoice_context(
        &self,
        invoice_id: Uuid,
    ) -> Result<Option<InvoiceContext>> {
        hms_db::billing::invoice_context(&self.inner.pool, self.facility_id(), invoice_id).await
    }

    pub async fn list_billing_payments(
        &self,
        cursor: Option<BillingCursor>,
        limit: i64,
    ) -> Result<Vec<PaymentListItem>> {
        hms_db::billing::list_payments(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn create_billing_payment(
        &self,
        invoice_id: Uuid,
        amount_minor: i64,
        method: PaymentMethod,
        cash_session_id: Option<Uuid>,
        actor_user_id: Uuid,
    ) -> Result<PaymentListItem> {
        let id = Uuid::new_v4();
        hms_db::billing::create_payment(
            &self.inner.pool,
            NewPayment {
                id,
                facility_id: self.facility_id(),
                invoice_id,
                receipt_id: Uuid::new_v4(),
                receipt_number: format!("RCT-{}", &id.simple().to_string()[..10].to_uppercase()),
                amount_minor,
                method,
                cash_session_id,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn list_billing_receipts(
        &self,
        cursor: Option<BillingCursor>,
        limit: i64,
    ) -> Result<Vec<ReceiptListItem>> {
        hms_db::billing::list_receipts(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn get_billing_receipt(&self, receipt_id: Uuid) -> Result<Option<ReceiptListItem>> {
        hms_db::billing::get_receipt(&self.inner.pool, self.facility_id(), receipt_id).await
    }

    pub async fn get_billing_receipt_by_number(
        &self,
        receipt_number: &str,
    ) -> Result<Option<ReceiptListItem>> {
        hms_db::billing::get_receipt_by_number(&self.inner.pool, self.facility_id(), receipt_number)
            .await
    }

    pub async fn get_billing_receipt_by_payment(
        &self,
        payment_id: Uuid,
    ) -> Result<Option<ReceiptListItem>> {
        hms_db::billing::get_receipt_by_payment(&self.inner.pool, self.facility_id(), payment_id)
            .await
    }

    pub async fn list_cash_drawers(&self) -> Result<Vec<CashDrawerListItem>> {
        hms_db::billing::list_cash_drawers(&self.inner.pool, self.facility_id()).await
    }

    pub async fn list_cash_sessions(
        &self,
        cursor: Option<BillingCursor>,
        limit: i64,
        filters: CashSessionFilters,
    ) -> Result<Vec<CashSessionListItem>> {
        hms_db::billing::list_cash_sessions(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
            filters,
        )
        .await
    }

    pub async fn get_cash_session(&self, session_id: Uuid) -> Result<Option<CashSessionListItem>> {
        hms_db::billing::get_cash_session(&self.inner.pool, self.facility_id(), session_id).await
    }

    pub async fn open_cash_session(
        &self,
        drawer_id: Uuid,
        opening_float_minor: i64,
        actor_user_id: Uuid,
    ) -> Result<CashSessionListItem> {
        hms_db::billing::open_cash_session(
            &self.inner.pool,
            NewCashSession {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                drawer_id,
                opening_float_minor,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn close_cash_session(
        &self,
        session_id: Uuid,
        payload: CloseCashSessionRequest,
        actor_user_id: Uuid,
    ) -> Result<Option<CashSessionListItem>> {
        hms_db::billing::close_cash_session(
            &self.inner.pool,
            self.facility_id(),
            session_id,
            payload.counted_cash_minor,
            actor_user_id,
        )
        .await
    }

    pub async fn list_nhis_claims(
        &self,
        cursor: Option<BillingCursor>,
        limit: i64,
    ) -> Result<Vec<ClaimListItem>> {
        hms_db::billing::list_claims(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn get_nhis_claim(&self, claim_id: Uuid) -> Result<Option<ClaimListItem>> {
        hms_db::billing::get_claim(&self.inner.pool, self.facility_id(), claim_id).await
    }

    pub async fn create_nhis_claim(
        &self,
        invoice_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<ClaimListItem> {
        let id = Uuid::new_v4();
        hms_db::billing::create_claim(
            &self.inner.pool,
            NewClaim {
                id,
                facility_id: self.facility_id(),
                invoice_id,
                claim_number: format!("CLM-{}", &id.simple().to_string()[..10].to_uppercase()),
                actor_user_id,
            },
        )
        .await
    }

    pub async fn nhis_claim_contexts(&self, claim_ids: &[Uuid]) -> Result<Vec<ClaimContext>> {
        hms_db::billing::claim_contexts(&self.inner.pool, self.facility_id(), claim_ids).await
    }

    pub async fn list_nhis_batches(
        &self,
        cursor: Option<BillingCursor>,
        limit: i64,
    ) -> Result<Vec<NhisBatchListItem>> {
        hms_db::billing::list_nhis_batches(&self.inner.pool, self.facility_id(), cursor, limit)
            .await
    }

    pub async fn create_nhis_batch(
        &self,
        claim_ids: Vec<Uuid>,
        actor_user_id: Uuid,
    ) -> Result<NhisBatchListItem> {
        let id = Uuid::new_v4();
        hms_db::billing::create_nhis_batch(
            &self.inner.pool,
            NewNhisBatch {
                id,
                facility_id: self.facility_id(),
                batch_number: format!("NHB-{}", &id.simple().to_string()[..10].to_uppercase()),
                claim_ids,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn export_nhis_batch(&self, batch_id: Uuid) -> Result<Option<NhisBatchExport>> {
        hms_db::billing::export_nhis_batch(&self.inner.pool, self.facility_id(), batch_id).await
    }

    pub async fn list_remittance_imports(
        &self,
        cursor: Option<BillingCursor>,
        limit: i64,
    ) -> Result<Vec<RemittanceImportListItem>> {
        hms_db::billing::list_remittance_imports(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_remittance_import(
        &self,
        batch_id: Uuid,
        reference: String,
        total_paid_minor: i64,
        actor_user_id: Uuid,
    ) -> Result<RemittanceImportListItem> {
        hms_db::billing::create_remittance_import(
            &self.inner.pool,
            NewRemittanceImport {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                batch_id,
                reference,
                total_paid_minor,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn list_inventory_items(
        &self,
        cursor: Option<InventoryCursor>,
        limit: i64,
        filters: hms_db::inventory::InventoryItemFilters,
    ) -> Result<Vec<InventoryItemListItem>> {
        hms_db::inventory::list_items(&self.inner.pool, self.facility_id(), cursor, limit, filters)
            .await
    }

    pub async fn get_inventory_item(&self, item_id: Uuid) -> Result<Option<InventoryItemListItem>> {
        hms_db::inventory::get_item(&self.inner.pool, self.facility_id(), item_id).await
    }

    pub async fn list_storage_locations(
        &self,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<StorageLocationListItem>> {
        hms_db::inventory::list_locations(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn list_suppliers(
        &self,
        cursor: Option<InventoryCursor>,
        limit: i64,
        filters: hms_db::inventory::SupplierFilters,
    ) -> Result<Vec<SupplierListItem>> {
        hms_db::inventory::list_suppliers(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
            filters,
        )
        .await
    }

    pub async fn get_storage_location(
        &self,
        location_id: Uuid,
    ) -> Result<Option<StorageLocationListItem>> {
        hms_db::inventory::get_location(&self.inner.pool, self.facility_id(), location_id).await
    }

    pub async fn inventory_dashboard_summary(
        &self,
        expiring_within_days: i32,
    ) -> Result<InventoryDashboardSummary> {
        hms_db::inventory::inventory_dashboard_summary(
            &self.inner.pool,
            self.facility_id(),
            expiring_within_days,
        )
        .await
    }

    pub async fn list_storage_location_stock(
        &self,
        location_id: Uuid,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<StorageLocationStockItem>> {
        hms_db::inventory::list_storage_location_stock(
            &self.inner.pool,
            self.facility_id(),
            location_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn list_stock_batches(
        &self,
        cursor: Option<InventoryCursor>,
        limit: i64,
        filters: hms_db::inventory::StockBatchFilters,
    ) -> Result<Vec<StockBatchListItem>> {
        hms_db::inventory::list_batches(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
            filters,
        )
        .await
    }

    pub async fn list_inventory_item_stock_batches(
        &self,
        item_id: Uuid,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<StockBatchListItem>> {
        hms_db::inventory::list_item_batches(
            &self.inner.pool,
            self.facility_id(),
            item_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_stock_batch(
        &self,
        item_id: Uuid,
        location_id: Uuid,
        batch_number: String,
        expires_on: Option<NaiveDate>,
        quantity_received: i64,
        actor_user_id: Uuid,
    ) -> Result<StockBatchListItem> {
        hms_db::inventory::create_batch(
            &self.inner.pool,
            NewStockBatch {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                item_id,
                location_id,
                batch_number,
                expires_on,
                quantity_received,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn list_stock_movements(
        &self,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<StockMovementListItem>> {
        hms_db::inventory::list_movements(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn list_inventory_item_stock_movements(
        &self,
        item_id: Uuid,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<StockMovementListItem>> {
        hms_db::inventory::list_item_movements(
            &self.inner.pool,
            self.facility_id(),
            item_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn list_inventory_item_stock_by_location(
        &self,
        item_id: Uuid,
    ) -> Result<Vec<InventoryItemStockLocationItem>> {
        hms_db::inventory::list_item_stock_by_location(
            &self.inner.pool,
            self.facility_id(),
            item_id,
        )
        .await
    }

    pub async fn list_stock_transfers(
        &self,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<StockTransferListItem>> {
        hms_db::inventory::list_transfers(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn get_stock_transfer(
        &self,
        transfer_id: Uuid,
    ) -> Result<Option<StockTransferListItem>> {
        hms_db::inventory::get_transfer(&self.inner.pool, self.facility_id(), transfer_id).await
    }

    pub async fn create_stock_transfer(
        &self,
        item_id: Uuid,
        from_location_id: Uuid,
        to_location_id: Uuid,
        quantity: i64,
        actor_user_id: Uuid,
    ) -> Result<StockTransferListItem> {
        hms_db::inventory::create_transfer(
            &self.inner.pool,
            NewStockTransfer {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                item_id,
                from_location_id,
                to_location_id,
                quantity,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn list_stock_requisitions(
        &self,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<StockRequisitionListItem>> {
        hms_db::inventory::list_requisitions(&self.inner.pool, self.facility_id(), cursor, limit)
            .await
    }

    pub async fn get_stock_requisition(
        &self,
        requisition_id: Uuid,
    ) -> Result<Option<StockRequisitionListItem>> {
        hms_db::inventory::get_requisition(&self.inner.pool, self.facility_id(), requisition_id)
            .await
    }

    pub async fn create_stock_requisition(
        &self,
        requesting_location_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<StockRequisitionListItem> {
        hms_db::inventory::create_requisition(
            &self.inner.pool,
            NewStockRequisition {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                requesting_location_id,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn submit_stock_requisition(
        &self,
        requisition_id: Uuid,
    ) -> Result<Option<StockRequisitionListItem>> {
        hms_db::inventory::submit_requisition(&self.inner.pool, self.facility_id(), requisition_id)
            .await
    }

    pub async fn approve_stock_requisition(
        &self,
        requisition_id: Uuid,
    ) -> Result<Option<StockRequisitionListItem>> {
        hms_db::inventory::approve_requisition(&self.inner.pool, self.facility_id(), requisition_id)
            .await
    }

    pub async fn fulfill_stock_requisition(
        &self,
        requisition_id: Uuid,
    ) -> Result<Option<StockRequisitionListItem>> {
        hms_db::inventory::fulfill_requisition(&self.inner.pool, self.facility_id(), requisition_id)
            .await
    }

    pub async fn reject_stock_requisition(
        &self,
        requisition_id: Uuid,
        reason: String,
    ) -> Result<Option<StockRequisitionListItem>> {
        hms_db::inventory::reject_requisition(
            &self.inner.pool,
            self.facility_id(),
            requisition_id,
            reason,
        )
        .await
    }

    pub async fn cancel_stock_requisition(
        &self,
        requisition_id: Uuid,
    ) -> Result<Option<StockRequisitionListItem>> {
        hms_db::inventory::cancel_requisition(&self.inner.pool, self.facility_id(), requisition_id)
            .await
    }

    pub async fn list_purchase_orders(
        &self,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<PurchaseOrderListItem>> {
        hms_db::inventory::list_purchase_orders(&self.inner.pool, self.facility_id(), cursor, limit)
            .await
    }

    pub async fn get_purchase_order(
        &self,
        purchase_order_id: Uuid,
    ) -> Result<Option<PurchaseOrderListItem>> {
        hms_db::inventory::get_purchase_order(
            &self.inner.pool,
            self.facility_id(),
            purchase_order_id,
        )
        .await
    }

    pub async fn create_purchase_order(
        &self,
        supplier_name: String,
        actor_user_id: Uuid,
    ) -> Result<PurchaseOrderListItem> {
        hms_db::inventory::create_purchase_order(
            &self.inner.pool,
            NewPurchaseOrder {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                supplier_name,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn approve_purchase_order(
        &self,
        purchase_order_id: Uuid,
    ) -> Result<Option<PurchaseOrderListItem>> {
        hms_db::inventory::approve_purchase_order(
            &self.inner.pool,
            self.facility_id(),
            purchase_order_id,
        )
        .await
    }

    pub async fn send_purchase_order(
        &self,
        purchase_order_id: Uuid,
    ) -> Result<Option<PurchaseOrderListItem>> {
        hms_db::inventory::send_purchase_order(
            &self.inner.pool,
            self.facility_id(),
            purchase_order_id,
        )
        .await
    }

    pub async fn list_goods_received_notes(
        &self,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<GoodsReceivedNoteListItem>> {
        hms_db::inventory::list_grns(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn get_goods_received_note(
        &self,
        grn_id: Uuid,
    ) -> Result<Option<GoodsReceivedNoteListItem>> {
        hms_db::inventory::get_grn(&self.inner.pool, self.facility_id(), grn_id).await
    }

    pub async fn create_goods_received_note(
        &self,
        purchase_order_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<GoodsReceivedNoteListItem> {
        hms_db::inventory::create_grn(
            &self.inner.pool,
            NewGoodsReceivedNote {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                purchase_order_id,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn inspect_goods_received_note(
        &self,
        grn_id: Uuid,
    ) -> Result<Option<GoodsReceivedNoteListItem>> {
        hms_db::inventory::inspect_grn(&self.inner.pool, self.facility_id(), grn_id).await
    }

    pub async fn accept_goods_received_note(
        &self,
        grn_id: Uuid,
    ) -> Result<Option<GoodsReceivedNoteListItem>> {
        hms_db::inventory::accept_grn(&self.inner.pool, self.facility_id(), grn_id).await
    }

    pub async fn list_controlled_substance_register(
        &self,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<ControlledSubstanceRegisterItem>> {
        hms_db::inventory::list_controlled_register(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
        )
        .await
    }

    pub async fn get_controlled_substance_register_entry(
        &self,
        entry_id: Uuid,
    ) -> Result<Option<ControlledSubstanceRegisterItem>> {
        hms_db::inventory::get_controlled_register_entry(
            &self.inner.pool,
            self.facility_id(),
            entry_id,
        )
        .await
    }

    pub async fn list_controlled_substance_register_entries(
        &self,
        entry_id: Uuid,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<ControlledSubstanceRegisterEntryItem>> {
        hms_db::inventory::list_controlled_register_entries(
            &self.inner.pool,
            self.facility_id(),
            entry_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn validate_controlled_substance_register_balance(
        &self,
        entry_id: Uuid,
    ) -> Result<Option<ControlledSubstanceBalanceValidation>> {
        hms_db::inventory::validate_controlled_register_balance(
            &self.inner.pool,
            self.facility_id(),
            entry_id,
        )
        .await
    }

    pub async fn create_controlled_substance_count(
        &self,
        entry_id: Uuid,
        actual_count: i64,
        witness_user_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<ControlledSubstanceRegisterItem> {
        hms_db::inventory::create_controlled_count(
            &self.inner.pool,
            NewControlledCount {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                register_entry_id: entry_id,
                actual_count,
                witness_user_id,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn create_controlled_substance_movement(
        &self,
        item_id: Uuid,
        location_id: Uuid,
        movement_type: ControlledMovementType,
        quantity_delta: i64,
        witness_user_id: Option<Uuid>,
        actor_user_id: Uuid,
    ) -> Result<ControlledSubstanceRegisterItem> {
        hms_db::inventory::create_controlled_movement(
            &self.inner.pool,
            NewControlledMovement {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                item_id,
                location_id,
                movement_type,
                quantity_delta,
                witness_user_id,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn list_pharmacy_dispenses(
        &self,
        cursor: Option<InventoryCursor>,
        limit: i64,
    ) -> Result<Vec<PharmacyDispenseListItem>> {
        hms_db::inventory::list_dispenses(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn create_pharmacy_dispense(
        &self,
        patient_id: Uuid,
        item_id: Uuid,
        location_id: Uuid,
        quantity: i64,
        actor_user_id: Uuid,
    ) -> Result<PharmacyDispenseListItem> {
        hms_db::inventory::create_dispense(
            &self.inner.pool,
            NewPharmacyDispense {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                item_id,
                location_id,
                quantity,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn list_wards(
        &self,
        cursor: Option<WardCursor>,
        limit: i64,
        search: Option<String>,
    ) -> Result<Vec<WardListItem>> {
        hms_db::ward::list_wards(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
            search.as_deref(),
        )
        .await
    }

    pub async fn get_ward(&self, ward_id: Uuid) -> Result<Option<WardListItem>> {
        hms_db::ward::get_ward(&self.inner.pool, self.facility_id(), ward_id).await
    }

    pub async fn create_ward(&self, code: String, name: String) -> Result<WardListItem> {
        hms_db::ward::create_ward(
            &self.inner.pool,
            NewWard {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                code,
                name,
            },
        )
        .await
    }

    pub async fn update_ward(
        &self,
        ward_id: Uuid,
        update: WardUpdate,
    ) -> Result<Option<WardListItem>> {
        hms_db::ward::update_ward(&self.inner.pool, self.facility_id(), ward_id, update).await
    }

    pub async fn list_ward_sections(
        &self,
        ward_id: Uuid,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<WardSectionListItem>> {
        hms_db::ward::list_ward_sections(
            &self.inner.pool,
            self.facility_id(),
            ward_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_ward_section(
        &self,
        ward_id: Uuid,
        code: String,
        name: String,
        actor_user_id: Uuid,
    ) -> Result<WardSectionListItem> {
        hms_db::ward::create_ward_section(
            &self.inner.pool,
            NewWardSection {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                ward_id,
                code,
                name,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn get_ward_section(&self, section_id: Uuid) -> Result<Option<WardSectionListItem>> {
        hms_db::ward::get_ward_section_by_id(&self.inner.pool, self.facility_id(), section_id).await
    }

    pub async fn update_ward_section(
        &self,
        section_id: Uuid,
        update: WardSectionUpdate,
    ) -> Result<Option<WardSectionListItem>> {
        hms_db::ward::update_ward_section(&self.inner.pool, self.facility_id(), section_id, update)
            .await
    }

    pub async fn list_ward_beds(
        &self,
        ward_id: Uuid,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<BedListItem>> {
        hms_db::ward::list_ward_beds(&self.inner.pool, self.facility_id(), ward_id, cursor, limit)
            .await
    }

    pub async fn list_section_beds(
        &self,
        section_id: Uuid,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<BedListItem>> {
        hms_db::ward::list_section_beds(
            &self.inner.pool,
            self.facility_id(),
            section_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn get_bed(&self, bed_id: Uuid) -> Result<Option<BedListItem>> {
        hms_db::ward::get_bed_by_id(&self.inner.pool, self.facility_id(), bed_id).await
    }

    pub async fn create_bed(
        &self,
        ward_id: Uuid,
        section_id: Option<Uuid>,
        bed_code: String,
        actor_user_id: Uuid,
    ) -> Result<BedListItem> {
        hms_db::ward::create_bed(
            &self.inner.pool,
            NewBed {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                ward_id,
                section_id,
                bed_code,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn update_bed(&self, bed_id: Uuid, update: BedUpdate) -> Result<Option<BedListItem>> {
        hms_db::ward::update_bed(&self.inner.pool, self.facility_id(), bed_id, update).await
    }

    pub async fn list_ward_board(
        &self,
        ward_id: Option<Uuid>,
        patient_id: Option<Uuid>,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<WardBoardItem>> {
        hms_db::ward::list_ward_board(
            &self.inner.pool,
            self.facility_id(),
            ward_id,
            patient_id,
            cursor,
            limit,
        )
        .await
    }

    pub async fn get_ward_board_admission(
        &self,
        admission_id: Uuid,
    ) -> Result<Option<WardBoardItem>> {
        hms_db::ward::get_ward_board_admission(&self.inner.pool, self.facility_id(), admission_id)
            .await
    }

    pub async fn get_admission_context(
        &self,
        admission_case_id: Uuid,
    ) -> Result<Option<AdmissionContext>> {
        hms_db::ward::get_admission_context(&self.inner.pool, self.facility_id(), admission_case_id)
            .await
    }

    pub async fn list_admission_cases(
        &self,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<AdmissionCaseListItem>> {
        hms_db::ward::list_admission_cases(&self.inner.pool, self.facility_id(), cursor, limit)
            .await
    }

    pub async fn get_admission_case(
        &self,
        admission_case_id: Uuid,
    ) -> Result<Option<AdmissionCaseListItem>> {
        hms_db::ward::get_admission_case(&self.inner.pool, self.facility_id(), admission_case_id)
            .await
    }

    pub async fn create_admission_case(
        &self,
        patient_id: Uuid,
        ward_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<AdmissionCaseListItem> {
        hms_db::ward::create_admission_case(
            &self.inner.pool,
            NewAdmissionCase {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                ward_id,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn reserve_admission_bed(
        &self,
        admission_case_id: Uuid,
        bed_id: Option<Uuid>,
        actor_user_id: Uuid,
    ) -> Result<Option<AdmissionCaseListItem>> {
        hms_db::ward::reserve_admission_bed(
            &self.inner.pool,
            self.facility_id(),
            admission_case_id,
            bed_id,
            actor_user_id,
        )
        .await
    }

    pub async fn activate_admission_case(
        &self,
        admission_case_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Option<AdmissionCaseListItem>> {
        hms_db::ward::activate_admission_case(
            &self.inner.pool,
            self.facility_id(),
            admission_case_id,
            actor_user_id,
        )
        .await
    }

    pub async fn cancel_admission_case(
        &self,
        admission_case_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Option<AdmissionCaseListItem>> {
        hms_db::ward::cancel_admission_case(
            &self.inner.pool,
            self.facility_id(),
            admission_case_id,
            actor_user_id,
        )
        .await
    }

    pub async fn admit_patient(
        &self,
        patient_id: Uuid,
        ward_id: Uuid,
        bed_id: Option<Uuid>,
        actor_user_id: Uuid,
    ) -> Result<WardBoardItem> {
        hms_db::ward::admit_patient(
            &self.inner.pool,
            NewAdmission {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                ward_id,
                bed_id,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn list_discharge_cases(
        &self,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<DischargeCaseListItem>> {
        hms_db::ward::list_discharge_cases(&self.inner.pool, self.facility_id(), cursor, limit)
            .await
    }

    pub async fn request_discharge(
        &self,
        admission: &AdmissionContext,
        actor_user_id: Uuid,
    ) -> Result<DischargeCaseListItem> {
        hms_db::ward::request_discharge(
            &self.inner.pool,
            Uuid::new_v4(),
            self.facility_id(),
            admission,
            actor_user_id,
        )
        .await
    }

    pub async fn complete_discharge(
        &self,
        discharge_case_id: Uuid,
    ) -> Result<Option<DischargeCaseListItem>> {
        hms_db::ward::complete_discharge(&self.inner.pool, self.facility_id(), discharge_case_id)
            .await
    }

    pub async fn cancel_discharge(
        &self,
        discharge_case_id: Uuid,
    ) -> Result<Option<DischargeCaseListItem>> {
        hms_db::ward::cancel_discharge(&self.inner.pool, self.facility_id(), discharge_case_id)
            .await
    }

    pub async fn get_discharge_case(
        &self,
        discharge_case_id: Uuid,
    ) -> Result<Option<DischargeCaseListItem>> {
        hms_db::ward::get_discharge_case(&self.inner.pool, self.facility_id(), discharge_case_id)
            .await
    }

    pub async fn list_nursing_tasks(
        &self,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<NursingTaskListItem>> {
        hms_db::ward::list_nursing_tasks(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn create_nursing_task(
        &self,
        admission: &AdmissionContext,
        task_type: NursingTaskType,
        due_at: DateTime<Utc>,
        assigned_to_user_id: Option<Uuid>,
        actor_user_id: Uuid,
    ) -> Result<NursingTaskListItem> {
        hms_db::ward::create_nursing_task(
            &self.inner.pool,
            NewNursingTask {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                ward_id: admission.ward_id,
                task_type,
                due_at,
                assigned_to_user_id,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn complete_nursing_task(
        &self,
        task_id: Uuid,
    ) -> Result<Option<NursingTaskListItem>> {
        hms_db::ward::complete_nursing_task(&self.inner.pool, self.facility_id(), task_id).await
    }

    pub async fn cancel_nursing_task(&self, task_id: Uuid) -> Result<Option<NursingTaskListItem>> {
        hms_db::ward::cancel_nursing_task(&self.inner.pool, self.facility_id(), task_id).await
    }

    pub async fn get_nursing_task(&self, task_id: Uuid) -> Result<Option<NursingTaskListItem>> {
        hms_db::ward::get_nursing_task(&self.inner.pool, self.facility_id(), task_id).await
    }

    pub async fn list_medication_administrations(
        &self,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<MedicationAdministrationListItem>> {
        hms_db::ward::list_medication_administrations(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
        )
        .await
    }

    pub async fn schedule_medication_administration(
        &self,
        admission: &AdmissionContext,
        medication_name: String,
        scheduled_at: DateTime<Utc>,
        actor_user_id: Uuid,
    ) -> Result<MedicationAdministrationListItem> {
        hms_db::ward::schedule_medication_administration(
            &self.inner.pool,
            NewMedicationAdministration {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                medication_name,
                scheduled_at,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn administer_medication(
        &self,
        medication_id: Uuid,
        actor_user_id: Uuid,
        witness_user_id: Option<Uuid>,
    ) -> Result<Option<MedicationAdministrationListItem>> {
        hms_db::ward::administer_medication(
            &self.inner.pool,
            self.facility_id(),
            medication_id,
            actor_user_id,
            witness_user_id,
        )
        .await
    }

    pub async fn get_medication_administration(
        &self,
        medication_id: Uuid,
    ) -> Result<Option<MedicationAdministrationListItem>> {
        hms_db::ward::get_medication_administration(
            &self.inner.pool,
            self.facility_id(),
            medication_id,
        )
        .await
    }

    pub async fn list_handoffs(
        &self,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<HandoffListItem>> {
        hms_db::ward::list_handoffs(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn create_handoff(
        &self,
        ward_id: Uuid,
        to_user_id: Uuid,
        shift_label: String,
        actor_user_id: Uuid,
    ) -> Result<HandoffListItem> {
        hms_db::ward::create_handoff(
            &self.inner.pool,
            NewHandoff {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                ward_id,
                from_user_id: actor_user_id,
                to_user_id,
                shift_label,
            },
        )
        .await
    }

    pub async fn complete_handoff(&self, handoff_id: Uuid) -> Result<Option<HandoffListItem>> {
        hms_db::ward::complete_handoff(&self.inner.pool, self.facility_id(), handoff_id).await
    }

    pub async fn get_handoff(&self, handoff_id: Uuid) -> Result<Option<HandoffListItem>> {
        hms_db::ward::get_handoff(&self.inner.pool, self.facility_id(), handoff_id).await
    }

    pub async fn list_treatment_sheets(
        &self,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<TreatmentSheetListItem>> {
        hms_db::ward::list_treatment_sheets(&self.inner.pool, self.facility_id(), cursor, limit)
            .await
    }

    pub async fn create_treatment_sheet(
        &self,
        admission: &AdmissionContext,
        sheet_date: NaiveDate,
        actor_user_id: Uuid,
    ) -> Result<TreatmentSheetListItem> {
        hms_db::ward::create_treatment_sheet(
            &self.inner.pool,
            NewTreatmentSheet {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                sheet_date,
                actor_user_id,
            },
        )
        .await
    }

    pub async fn list_patient_vitals(
        &self,
        patient_id: Option<Uuid>,
        admission_case_id: Option<Uuid>,
        recorded_since: Option<DateTime<Utc>>,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<PatientVitalsListItem>> {
        hms_db::ward::list_patient_vitals(
            &self.inner.pool,
            self.facility_id(),
            patient_id,
            admission_case_id,
            recorded_since,
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_patient_vitals(
        &self,
        admission: &AdmissionContext,
        recorded_at: DateTime<Utc>,
        temperature_c: Option<f32>,
        systolic_bp: Option<i32>,
        diastolic_bp: Option<i32>,
        pulse: Option<i32>,
        respiratory_rate: Option<i32>,
        oxygen_saturation: Option<i32>,
        actor_user_id: Uuid,
    ) -> Result<PatientVitalsListItem> {
        hms_db::ward::create_patient_vitals(
            &self.inner.pool,
            NewPatientVitals {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                recorded_at,
                temperature_c,
                systolic_bp,
                diastolic_bp,
                pulse,
                respiratory_rate,
                oxygen_saturation,
                recorded_by_user_id: actor_user_id,
            },
        )
        .await
    }

    pub async fn list_nursing_alerts(
        &self,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<NursingAlertListItem>> {
        hms_db::ward::list_nursing_alerts(&self.inner.pool, self.facility_id(), cursor, limit).await
    }

    pub async fn create_nursing_alert(
        &self,
        admission: &AdmissionContext,
        severity: NursingAlertSeverity,
        title: String,
        actor_user_id: Uuid,
    ) -> Result<NursingAlertListItem> {
        hms_db::ward::create_nursing_alert(
            &self.inner.pool,
            NewNursingAlert {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                severity,
                title,
                created_by_user_id: actor_user_id,
            },
        )
        .await
    }

    pub async fn acknowledge_nursing_alert(
        &self,
        alert_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Option<NursingAlertListItem>> {
        hms_db::ward::acknowledge_nursing_alert(
            &self.inner.pool,
            self.facility_id(),
            alert_id,
            actor_user_id,
        )
        .await
    }

    pub async fn get_nursing_alert(&self, alert_id: Uuid) -> Result<Option<NursingAlertListItem>> {
        hms_db::ward::get_nursing_alert(&self.inner.pool, self.facility_id(), alert_id).await
    }

    pub async fn list_monitoring_events(
        &self,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<MonitoringEventListItem>> {
        hms_db::ward::list_monitoring_events(&self.inner.pool, self.facility_id(), cursor, limit)
            .await
    }

    pub async fn create_monitoring_event(
        &self,
        admission: &AdmissionContext,
        event_kind: MonitoringEventKind,
        summary: String,
        recorded_at: DateTime<Utc>,
        actor_user_id: Uuid,
    ) -> Result<MonitoringEventListItem> {
        hms_db::ward::create_monitoring_event(
            &self.inner.pool,
            NewMonitoringEvent {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                event_kind,
                summary,
                recorded_at,
                recorded_by_user_id: actor_user_id,
            },
        )
        .await
    }

    pub async fn list_fluid_balance_entries(
        &self,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<FluidBalanceListItem>> {
        hms_db::ward::list_fluid_balance_entries(
            &self.inner.pool,
            self.facility_id(),
            cursor,
            limit,
        )
        .await
    }

    pub async fn create_fluid_balance_entry(
        &self,
        admission: &AdmissionContext,
        recorded_at: DateTime<Utc>,
        intake_ml: i32,
        output_ml: i32,
        actor_user_id: Uuid,
    ) -> Result<FluidBalanceListItem> {
        hms_db::ward::create_fluid_balance_entry(
            &self.inner.pool,
            NewFluidBalanceEntry {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                recorded_at,
                intake_ml,
                output_ml,
                recorded_by_user_id: actor_user_id,
            },
        )
        .await
    }

    pub async fn list_ward_stock_requests(
        &self,
        cursor: Option<WardCursor>,
        limit: i64,
    ) -> Result<Vec<WardStockRequestListItem>> {
        hms_db::ward::list_ward_stock_requests(&self.inner.pool, self.facility_id(), cursor, limit)
            .await
    }

    pub async fn create_ward_stock_request(
        &self,
        ward_id: Uuid,
        requested_item: String,
        quantity_requested: i32,
        actor_user_id: Uuid,
    ) -> Result<WardStockRequestListItem> {
        hms_db::ward::create_ward_stock_request(
            &self.inner.pool,
            NewWardStockRequest {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                ward_id,
                requested_item,
                quantity_requested,
                requested_by_user_id: actor_user_id,
            },
        )
        .await
    }

    pub async fn approve_ward_stock_request(
        &self,
        request_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Option<WardStockRequestListItem>> {
        hms_db::ward::approve_ward_stock_request(
            &self.inner.pool,
            self.facility_id(),
            request_id,
            actor_user_id,
        )
        .await
    }

    pub async fn fulfill_ward_stock_request(
        &self,
        request_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Option<WardStockRequestListItem>> {
        hms_db::ward::fulfill_ward_stock_request(
            &self.inner.pool,
            self.facility_id(),
            request_id,
            actor_user_id,
        )
        .await
    }

    async fn issue_session_for_user(
        &self,
        user: &UserAccount,
        session_family_id: Option<Uuid>,
        rotated_from_session_id: Option<Uuid>,
        device_label: Option<&str>,
    ) -> Result<Option<LoginOutcome>> {
        let session_id = Uuid::new_v4();
        let session_family_id = session_family_id.unwrap_or(session_id);
        let refresh_token = generate_secret_token();
        let csrf_token = generate_secret_token();
        let expires_at = Utc::now()
            + chrono::Duration::from_std(self.inner.config.refresh_token_ttl)
                .context("refresh token ttl converts to chrono duration")?;

        hms_db::auth::insert_refresh_session(
            &self.inner.pool,
            &NewRefreshSession {
                token_hash: hash_refresh_token(&refresh_token),
                session_id,
                session_family_id,
                rotated_from_session_id,
                user_id: user.id,
                facility_id: user.facility_id,
                session_version: user.session_version,
                permission_version_at_issue: user.permission_version,
                csrf_token_hash: hash_refresh_token(&csrf_token),
                expires_at,
                device_label: device_label.map(ToOwned::to_owned),
            },
        )
        .await?;

        let active_profile = serde_json::to_value(user.active_profile)?
            .as_str()
            .unwrap_or("hospital")
            .to_owned();
        let access_token = issue_access_token(
            &self.inner.config.jwt_secret,
            user.id,
            session_id,
            user.facility_id,
            active_profile,
            user.permission_version,
            user.session_version,
            self.inner.config.access_token_ttl,
        )
        .context("failed to issue access token")?;

        Ok(Some(LoginOutcome {
            access_token,
            refresh_token,
            csrf_token,
            session_id,
            user: user.to_auth_user(),
        }))
    }
}

fn practitioner_profile(payload: UpsertPractitionerProfileRequest) -> NewPractitionerProfile {
    NewPractitionerProfile {
        license_number: payload.license_number,
        specialization: payload.specialization,
        qualification: payload.qualification,
        fhir_practitioner_id: payload.fhir_practitioner_id,
    }
}

fn verify_password(hash: &str, password: &str) -> bool {
    let Ok(hash) = PasswordHash::new(hash) else {
        return false;
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &hash)
        .is_ok()
}

fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| anyhow::anyhow!("failed to hash password: {error}"))?
        .to_string())
}

fn password_meets_policy(password: &str) -> bool {
    password.len() >= 12
        && password.chars().any(char::is_uppercase)
        && password.chars().any(char::is_lowercase)
        && password.chars().any(|value| value.is_ascii_digit())
        && password.chars().any(|value| !value.is_ascii_alphanumeric())
}

pub(crate) fn csrf_compare_hash(token: &str) -> String {
    hash_refresh_token(token)
}
