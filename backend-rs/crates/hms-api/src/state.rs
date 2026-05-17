use std::sync::Arc;

use anyhow::{Context, Result};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use chrono::{DateTime, Utc};
use hms_db::auth::{NewRefreshSession, UserAccount, UserSessionRow};
use hms_db::provision::{generate_secret_token, hash_refresh_token, BaselineProvisioning};
use hms_db::search::{OmniSearchFilters, OmniSearchResult};
use hms_db::ward::{
    AdmissionContext, NewFluidBalanceEntry, NewMonitoringEvent, NewNursingAlert, NewPatientVitals,
    NewWardStockRequest, WardCursor,
};
use hms_domain::auth::{ActiveAuthority, AuthUser, UpdateAuthProfileRequest};
use hms_domain::capabilities::{deployment_capabilities_from_features, DeploymentCapabilities};
use hms_domain::patients::PatientRecord;
use hms_domain::search::SearchResourceType;
use hms_domain::ward::{
    FluidBalanceListItem, MonitoringEventKind, MonitoringEventListItem, NursingAlertListItem,
    NursingAlertSeverity, PatientVitalsListItem, WardStockRequestListItem,
};
use hms_events::DomainEventKind;
use tracing::warn;
use uuid::Uuid;

use crate::auth::{issue_access_token, verify_access_token, AccessClaims};
use crate::config::Config;
use crate::passwords::hash_password;

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

    pub async fn get_patient(&self, id: Uuid) -> Result<Option<PatientRecord>> {
        hms_db::patients::get_patient(&self.inner.pool, self.facility_id(), id).await
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

fn verify_password(hash: &str, password: &str) -> bool {
    let Ok(hash) = PasswordHash::new(hash) else {
        return false;
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &hash)
        .is_ok()
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
