use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use hms_domain::auth::{
    ActiveAuthority, AuthSecurityState, AuthUser, BreakGlassCategory, BreakGlassGrant,
    BreakGlassGrantDenialReason, BreakGlassGrantOutcome, ClinicalPatientAccessEvidence,
    ClinicalPatientAccessReason, PatientDataVisibility, UpdateAuthProfileRequest,
    BREAK_GLASS_GRANT_TTL_HOURS, BREAK_GLASS_MAX_ACTIVE_GRANTS_PER_USER,
    BREAK_GLASS_PERMISSION_CODE,
};
use hms_domain::deployment::{DeploymentProfile, FeatureKey, PermissionCode};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct UserAccount {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub facility_id: Uuid,
    pub facility_code: String,
    pub active_profile: DeploymentProfile,
    pub permissions: Vec<PermissionCode>,
    pub features: Vec<FeatureKey>,
    pub patient_visibility: Vec<PatientDataVisibility>,
    pub session_version: i64,
    pub permission_version: i64,
    pub password_change_required: bool,
    pub auth_security: AuthSecurityState,
    pub password_hash: String,
}

#[derive(Clone, Debug, FromRow)]
struct UserRow {
    id: Uuid,
    email: String,
    display_name: String,
    facility_id: Uuid,
    facility_code: String,
    active_profile: String,
    session_version: i64,
    permission_version: i64,
    password_change_required: bool,
    password_hash: String,
    permission_codes: Vec<String>,
    feature_keys: Vec<String>,
    visibility_codes: Vec<String>,
    passkey_enrolled: bool,
    recovery_codes_remaining: i64,
}

#[derive(Clone, Debug, FromRow)]
struct RequestContextFactsRow {
    id: Uuid,
    email: String,
    display_name: String,
    facility_id: Uuid,
    facility_code: String,
    active_profile: String,
    session_version: i64,
    permission_version: i64,
    password_change_required: bool,
    permission_codes: Vec<String>,
    feature_keys: Vec<String>,
    visibility_codes: Vec<String>,
    passkey_enrolled: bool,
    recovery_codes_remaining: i64,
    feature_flags: Value,
    active_authorities: Value,
}

#[derive(Clone, Debug)]
pub struct RequestContextAuthFacts {
    pub user: AuthUser,
    pub feature_flags: HashMap<FeatureKey, bool>,
    pub active_authorities: Vec<ActiveAuthority>,
}

#[derive(Clone, Debug, FromRow)]
pub struct RefreshSessionRow {
    pub session_id: Uuid,
    pub session_family_id: Uuid,
    pub user_id: Uuid,
    pub facility_id: Uuid,
    pub session_version: i64,
    pub permission_version_at_issue: i64,
    pub csrf_token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub device_label: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewRefreshSession {
    pub token_hash: String,
    pub session_id: Uuid,
    pub session_family_id: Uuid,
    pub rotated_from_session_id: Option<Uuid>,
    pub user_id: Uuid,
    pub facility_id: Uuid,
    pub session_version: i64,
    pub permission_version_at_issue: i64,
    pub csrf_token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub device_label: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
pub struct UserSessionRow {
    pub id: Uuid,
    pub device_label: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
    pub is_current: bool,
}

#[derive(Clone, Debug)]
pub struct NewPasswordResetToken {
    pub token_hash: String,
    pub user_id: Uuid,
    pub facility_id: Uuid,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
pub struct PasswordResetTokenRow {
    pub user_id: Uuid,
    pub facility_id: Uuid,
    pub expires_at: DateTime<Utc>,
    pub used_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug)]
pub struct StartBreakGlassGrant {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub patient_id: Uuid,
    pub category: BreakGlassCategory,
    pub reason_text: Option<String>,
    pub request_id: Option<String>,
    pub now: DateTime<Utc>,
    pub reauth_verified_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug)]
pub struct EndBreakGlassGrants {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub patient_id: Uuid,
    pub ended_by_user_id: Uuid,
    pub request_id: Option<String>,
    pub now: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct BreakGlassGrantRow {
    id: Uuid,
    facility_id: Uuid,
    user_id: Uuid,
    patient_id: Uuid,
    category: String,
    reason_text: Option<String>,
    started_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WebAuthnCredentialRow {
    pub id: Uuid,
    pub credential_id: String,
    pub passkey: serde_json::Value,
    pub label: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug)]
pub struct NewWebAuthnCredential {
    pub id: Uuid,
    pub user_id: Uuid,
    pub facility_id: Uuid,
    pub credential_id: String,
    pub passkey: serde_json::Value,
    pub label: Option<String>,
}

#[derive(Clone, Copy, Debug)]
pub enum WebAuthnCeremonyType {
    Registration,
    Authentication,
}

impl WebAuthnCeremonyType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Registration => "registration",
            Self::Authentication => "authentication",
        }
    }
}

#[derive(Clone, Debug, FromRow)]
pub struct WebAuthnChallengeRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub facility_id: Uuid,
    pub state: serde_json::Value,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct NewWebAuthnChallenge {
    pub id: Uuid,
    pub user_id: Uuid,
    pub facility_id: Uuid,
    pub ceremony_type: WebAuthnCeremonyType,
    pub state: serde_json::Value,
    pub expires_at: DateTime<Utc>,
}

impl UserAccount {
    pub fn to_auth_user(&self) -> AuthUser {
        AuthUser {
            id: self.id,
            email: self.email.clone(),
            display_name: self.display_name.clone(),
            facility_id: self.facility_id,
            facility_code: self.facility_code.clone(),
            active_profile: self.active_profile,
            permissions: self.permissions.clone(),
            features: self.features.clone(),
            patient_visibility: self.patient_visibility.clone(),
            session_version: self.session_version,
            permission_version: self.permission_version,
            password_change_required: self.password_change_required,
            auth_security: self.auth_security.clone(),
        }
    }
}

pub async fn user_by_id(pool: &PgPool, user_id: Uuid) -> anyhow::Result<Option<UserAccount>> {
    let row = hms_observability::observe_db_query(
        "auth.user_by_id",
        sqlx::query_as::<_, UserRow>(
        r#"
        SELECT users.id,
               users.email,
               users.display_name,
               users.facility_id,
               facilities.code AS facility_code,
               facilities.deployment_profile AS active_profile,
               users.session_version,
               users.permission_version,
               users.password_change_required,
               users.password_hash,
               COALESCE(user_permissions.permission_codes, ARRAY[]::text[]) AS permission_codes,
               COALESCE(user_features.feature_keys, ARRAY[]::text[]) AS feature_keys,
               COALESCE(user_patient_visibility.visibility_codes, ARRAY[]::text[]) AS visibility_codes,
               EXISTS (
                   SELECT 1
                   FROM auth_webauthn_credentials
                   WHERE auth_webauthn_credentials.facility_id = users.facility_id
                     AND auth_webauthn_credentials.user_id = users.id
                     AND auth_webauthn_credentials.disabled_at IS NULL
               ) AS passkey_enrolled,
               COALESCE(auth_recovery_codes.remaining, 0)::bigint AS recovery_codes_remaining
        FROM users
        JOIN facilities ON facilities.id = users.facility_id
        LEFT JOIN LATERAL (
            SELECT array_agg(permission_code ORDER BY permission_code) AS permission_codes
            FROM user_permissions
            WHERE user_id = users.id
        ) user_permissions ON TRUE
        LEFT JOIN LATERAL (
            SELECT array_agg(feature_key ORDER BY feature_key) AS feature_keys
            FROM user_features
            WHERE user_id = users.id
        ) user_features ON TRUE
        LEFT JOIN LATERAL (
            SELECT array_agg(visibility ORDER BY visibility) AS visibility_codes
            FROM user_patient_visibility
            WHERE user_id = users.id
        ) user_patient_visibility ON TRUE
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::bigint AS remaining
            FROM auth_recovery_codes
            WHERE facility_id = users.facility_id
              AND user_id = users.id
              AND used_at IS NULL
              AND invalidated_at IS NULL
        ) auth_recovery_codes ON TRUE
        WHERE users.id = $1 AND users.is_active = TRUE
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool),
    )
    .await?;

    hydrate_user(row)
}

pub async fn user_by_id_for_facility(
    pool: &PgPool,
    user_id: Uuid,
    facility_id: Uuid,
) -> anyhow::Result<Option<UserAccount>> {
    let row = hms_observability::observe_db_query(
        "auth.user_by_id_for_facility",
        sqlx::query_as::<_, UserRow>(
            r#"
        SELECT users.id,
               users.email,
               users.display_name,
               users.facility_id,
               facilities.code AS facility_code,
               facilities.deployment_profile AS active_profile,
               users.session_version,
               users.permission_version,
               users.password_change_required,
               users.password_hash,
               COALESCE(user_permissions.permission_codes, ARRAY[]::text[]) AS permission_codes,
               COALESCE(user_features.feature_keys, ARRAY[]::text[]) AS feature_keys,
               COALESCE(user_patient_visibility.visibility_codes, ARRAY[]::text[]) AS visibility_codes,
               EXISTS (
                   SELECT 1
                   FROM auth_webauthn_credentials
                   WHERE auth_webauthn_credentials.facility_id = users.facility_id
                     AND auth_webauthn_credentials.user_id = users.id
                     AND auth_webauthn_credentials.disabled_at IS NULL
               ) AS passkey_enrolled,
               COALESCE(auth_recovery_codes.remaining, 0)::bigint AS recovery_codes_remaining
        FROM users
        JOIN facilities ON facilities.id = users.facility_id
        LEFT JOIN LATERAL (
            SELECT array_agg(permission_code ORDER BY permission_code) AS permission_codes
            FROM user_permissions
            WHERE user_id = users.id
        ) user_permissions ON TRUE
        LEFT JOIN LATERAL (
            SELECT array_agg(feature_key ORDER BY feature_key) AS feature_keys
            FROM user_features
            WHERE user_id = users.id
        ) user_features ON TRUE
        LEFT JOIN LATERAL (
            SELECT array_agg(visibility ORDER BY visibility) AS visibility_codes
            FROM user_patient_visibility
            WHERE user_id = users.id
        ) user_patient_visibility ON TRUE
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::bigint AS remaining
            FROM auth_recovery_codes
            WHERE facility_id = users.facility_id
              AND user_id = users.id
              AND used_at IS NULL
              AND invalidated_at IS NULL
        ) auth_recovery_codes ON TRUE
        WHERE users.id = $1
          AND users.facility_id = $2
          AND users.is_active = TRUE
          AND facilities.is_active = TRUE
        "#,
        )
        .bind(user_id)
        .bind(facility_id)
        .fetch_optional(pool),
    )
    .await?;

    hydrate_user(row)
}

pub async fn request_context_facts(
    pool: &PgPool,
    user_id: Uuid,
    facility_id: Uuid,
    fallback_profile: DeploymentProfile,
) -> anyhow::Result<Option<RequestContextAuthFacts>> {
    let row = hms_observability::observe_db_query(
        "auth.request_context_facts",
        sqlx::query_as::<_, RequestContextFactsRow>(
            r#"
            SELECT users.id,
                   users.email,
                   users.display_name,
                   users.facility_id,
                   facilities.code AS facility_code,
                   facilities.deployment_profile AS active_profile,
                   users.session_version,
                   users.permission_version,
                   users.password_change_required,
                   COALESCE(user_permissions.permission_codes, ARRAY[]::text[]) AS permission_codes,
                   COALESCE(user_features.feature_keys, ARRAY[]::text[]) AS feature_keys,
                   COALESCE(user_patient_visibility.visibility_codes, ARRAY[]::text[]) AS visibility_codes,
                   EXISTS (
                       SELECT 1
                       FROM auth_webauthn_credentials
                       WHERE auth_webauthn_credentials.facility_id = users.facility_id
                         AND auth_webauthn_credentials.user_id = users.id
                         AND auth_webauthn_credentials.disabled_at IS NULL
                   ) AS passkey_enrolled,
                   COALESCE(auth_recovery_codes.remaining, 0)::bigint AS recovery_codes_remaining,
                   COALESCE((
                     SELECT jsonb_agg(to_jsonb(feature_rows) ORDER BY feature_rows.feature_key NULLS FIRST)
                     FROM (
                       SELECT feature_facility.deployment_profile,
                              facility_feature_entitlements.feature_key,
                              facility_feature_entitlements.enabled
                       FROM facilities AS feature_facility
                       LEFT JOIN facility_feature_entitlements
                         ON facility_feature_entitlements.facility_id = feature_facility.id
                       WHERE feature_facility.id = $2
                         AND feature_facility.is_active = TRUE
                     ) feature_rows
                   ), '[]'::jsonb) AS feature_flags,
                   COALESCE((
                     SELECT jsonb_agg(to_jsonb(active_authorities) ORDER BY active_authorities.starts_at ASC, active_authorities.source_id ASC, active_authorities.permission_code ASC NULLS LAST)
                     FROM (
                       SELECT 'position_appointment' AS source,
                              authority_appointments.id AS source_id,
                              authority_appointments.facility_id,
                              authority_permissions.permission_code,
                              'organization_unit' AS scope_type,
                              positions.org_unit_id AS scope_id,
                              authority_appointments.starts_at,
                              authority_appointments.ends_at
                       FROM authority_appointments
                       JOIN positions ON positions.id = authority_appointments.position_id
                       LEFT JOIN position_templates ON position_templates.id = positions.template_id
                       LEFT JOIN LATERAL unnest(COALESCE(position_templates.permission_codes, '{}'::text[]))
                           AS authority_permissions(permission_code) ON TRUE
                       WHERE authority_appointments.facility_id = $2
                         AND authority_appointments.user_id = $1
                         AND authority_appointments.status = 'active'
                         AND positions.status = 'active'
                         AND authority_appointments.starts_at <= now()
                         AND (authority_appointments.ends_at IS NULL OR authority_appointments.ends_at > now())

                       UNION ALL

                       SELECT 'permission_assignment' AS source,
                              permission_assignments.id AS source_id,
                              permission_assignments.facility_id,
                              permission_assignments.permission_code,
                              permission_assignments.scope_type,
                              permission_assignments.scope_id,
                              permission_assignments.starts_at,
                              permission_assignments.ends_at
                       FROM permission_assignments
                       WHERE permission_assignments.facility_id = $2
                         AND permission_assignments.grantee_user_id = $1
                         AND permission_assignments.status = 'active'
                         AND permission_assignments.starts_at <= now()
                         AND (permission_assignments.ends_at IS NULL OR permission_assignments.ends_at > now())

                       UNION ALL

                       SELECT 'delegation' AS source,
                              delegations.id AS source_id,
                              delegations.facility_id,
                              delegations.permission_code,
                              'facility' AS scope_type,
                              NULL::uuid AS scope_id,
                              delegations.starts_at,
                              delegations.ends_at
                       FROM delegations
                       WHERE delegations.facility_id = $2
                         AND delegations.delegate_user_id = $1
                         AND delegations.status = 'active'
                         AND delegations.starts_at <= now()
                         AND (delegations.ends_at IS NULL OR delegations.ends_at > now())
                     ) active_authorities
                   ), '[]'::jsonb) AS active_authorities
            FROM users
            JOIN facilities ON facilities.id = users.facility_id
            LEFT JOIN LATERAL (
                SELECT array_agg(permission_code ORDER BY permission_code) AS permission_codes
                FROM user_permissions
                WHERE user_id = users.id
            ) user_permissions ON TRUE
            LEFT JOIN LATERAL (
                SELECT array_agg(feature_key ORDER BY feature_key) AS feature_keys
                FROM user_features
                WHERE user_id = users.id
            ) user_features ON TRUE
            LEFT JOIN LATERAL (
                SELECT array_agg(visibility ORDER BY visibility) AS visibility_codes
                FROM user_patient_visibility
                WHERE user_id = users.id
            ) user_patient_visibility ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::bigint AS remaining
                FROM auth_recovery_codes
                WHERE facility_id = users.facility_id
                  AND user_id = users.id
                  AND used_at IS NULL
                  AND invalidated_at IS NULL
            ) auth_recovery_codes ON TRUE
            WHERE users.id = $1
              AND users.facility_id = $2
              AND users.is_active = TRUE
              AND facilities.is_active = TRUE
            "#,
        )
        .bind(user_id)
        .bind(facility_id)
        .fetch_optional(pool),
    )
    .await?;

    hydrate_request_context_facts(row, fallback_profile)
}

pub async fn user_by_email_and_facility(
    pool: &PgPool,
    email: &str,
    facility_code: &str,
) -> anyhow::Result<Option<UserAccount>> {
    let row = hms_observability::observe_db_query(
        "auth.user_by_email_and_facility",
        sqlx::query_as::<_, UserRow>(
        r#"
        SELECT users.id,
               users.email,
               users.display_name,
               users.facility_id,
               facilities.code AS facility_code,
               facilities.deployment_profile AS active_profile,
               users.session_version,
               users.permission_version,
               users.password_change_required,
               users.password_hash,
               COALESCE(user_permissions.permission_codes, ARRAY[]::text[]) AS permission_codes,
               COALESCE(user_features.feature_keys, ARRAY[]::text[]) AS feature_keys,
               COALESCE(user_patient_visibility.visibility_codes, ARRAY[]::text[]) AS visibility_codes,
               EXISTS (
                   SELECT 1
                   FROM auth_webauthn_credentials
                   WHERE auth_webauthn_credentials.facility_id = users.facility_id
                     AND auth_webauthn_credentials.user_id = users.id
                     AND auth_webauthn_credentials.disabled_at IS NULL
               ) AS passkey_enrolled,
               COALESCE(auth_recovery_codes.remaining, 0)::bigint AS recovery_codes_remaining
        FROM users
        JOIN facilities ON facilities.id = users.facility_id
        LEFT JOIN LATERAL (
            SELECT array_agg(permission_code ORDER BY permission_code) AS permission_codes
            FROM user_permissions
            WHERE user_id = users.id
        ) user_permissions ON TRUE
        LEFT JOIN LATERAL (
            SELECT array_agg(feature_key ORDER BY feature_key) AS feature_keys
            FROM user_features
            WHERE user_id = users.id
        ) user_features ON TRUE
        LEFT JOIN LATERAL (
            SELECT array_agg(visibility ORDER BY visibility) AS visibility_codes
            FROM user_patient_visibility
            WHERE user_id = users.id
        ) user_patient_visibility ON TRUE
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::bigint AS remaining
            FROM auth_recovery_codes
            WHERE facility_id = users.facility_id
              AND user_id = users.id
              AND used_at IS NULL
              AND invalidated_at IS NULL
        ) auth_recovery_codes ON TRUE
        WHERE lower(users.email) = lower($1)
          AND lower(facilities.code) = lower($2)
          AND users.is_active = TRUE
          AND facilities.is_active = TRUE
        "#,
    )
    .bind(email.trim())
    .bind(facility_code.trim())
    .fetch_optional(pool),
    )
    .await?;

    hydrate_user(row)
}

pub async fn update_user_profile(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    update: UpdateAuthProfileRequest,
) -> anyhow::Result<Option<UserAccount>> {
    let display_name = update.display_name.map(|value| value.trim().to_owned());
    let result = sqlx::query(
        r#"
        UPDATE users
        SET display_name = COALESCE($1, display_name),
            updated_at = now()
        WHERE id = $2
          AND facility_id = $3
          AND is_active = TRUE
        "#,
    )
    .bind(display_name)
    .bind(user_id)
    .bind(facility_id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Ok(None);
    }

    user_by_id(pool, user_id).await
}

pub async fn insert_refresh_session(
    pool: &PgPool,
    session: &NewRefreshSession,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO refresh_sessions (
            token_hash,
            session_id,
            session_family_id,
            rotated_from_session_id,
            user_id,
            facility_id,
            session_version,
            permission_version_at_issue,
            csrf_token_hash,
            expires_at,
            device_label
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        "#,
    )
    .bind(&session.token_hash)
    .bind(session.session_id)
    .bind(session.session_family_id)
    .bind(session.rotated_from_session_id)
    .bind(session.user_id)
    .bind(session.facility_id)
    .bind(session.session_version)
    .bind(session.permission_version_at_issue)
    .bind(&session.csrf_token_hash)
    .bind(session.expires_at)
    .bind(session.device_label.as_deref())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn refresh_session_by_token_hash(
    pool: &PgPool,
    token_hash: &str,
) -> anyhow::Result<Option<RefreshSessionRow>> {
    Ok(sqlx::query_as::<_, RefreshSessionRow>(
        r#"
        SELECT session_id,
               session_family_id,
               user_id,
               facility_id,
               session_version,
               permission_version_at_issue,
               csrf_token_hash,
               expires_at,
               revoked_at,
               device_label
        FROM refresh_sessions
        WHERE token_hash = $1
        "#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?)
}

pub async fn list_active_user_sessions(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    current_session_id: Uuid,
    limit: i64,
) -> anyhow::Result<Vec<UserSessionRow>> {
    Ok(sqlx::query_as::<_, UserSessionRow>(
        r#"
        SELECT session_id AS id,
               device_label,
               created_at,
               last_seen_at,
               expires_at,
               session_id = $3 AS is_current
        FROM refresh_sessions
        WHERE facility_id = $1
          AND user_id = $2
          AND revoked_at IS NULL
          AND expires_at > now()
        ORDER BY (session_id = $3) DESC,
                 COALESCE(last_seen_at, created_at) DESC,
                 created_at DESC
        LIMIT $4
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .bind(current_session_id)
    .bind(limit.clamp(1, 50))
    .fetch_all(pool)
    .await?)
}

pub async fn revoke_user_session(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    session_id: Uuid,
    reason: &str,
) -> anyhow::Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, now()),
            last_seen_at = now(),
            revoked_reason = COALESCE(revoked_reason, $4)
        WHERE facility_id = $1
          AND user_id = $2
          AND session_id = $3
          AND revoked_at IS NULL
          AND expires_at > now()
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .bind(session_id)
    .bind(reason)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() == 1)
}

pub async fn revoke_other_user_sessions(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    current_session_id: Uuid,
    reason: &str,
) -> anyhow::Result<u64> {
    let result = sqlx::query(
        r#"
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, now()),
            last_seen_at = now(),
            revoked_reason = COALESCE(revoked_reason, $4)
        WHERE facility_id = $1
          AND user_id = $2
          AND session_id <> $3
          AND revoked_at IS NULL
          AND expires_at > now()
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .bind(current_session_id)
    .bind(reason)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn revoke_refresh_session(
    pool: &PgPool,
    token_hash: &str,
    csrf_token_hash: &str,
    reason: &str,
) -> anyhow::Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE refresh_sessions
        SET revoked_at = now(),
            last_seen_at = now(),
            revoked_reason = $3
        WHERE token_hash = $1
          AND csrf_token_hash = $2
          AND revoked_at IS NULL
        "#,
    )
    .bind(token_hash)
    .bind(csrf_token_hash)
    .bind(reason)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() == 1)
}

pub async fn revoke_refresh_session_family(
    pool: &PgPool,
    session_family_id: Uuid,
    reason: &str,
) -> anyhow::Result<u64> {
    let result = sqlx::query(
        r#"
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, now()),
            last_seen_at = now(),
            revoked_reason = COALESCE(revoked_reason, $2)
        WHERE session_family_id = $1
        "#,
    )
    .bind(session_family_id)
    .bind(reason)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn insert_password_reset_token(
    pool: &PgPool,
    token: &NewPasswordResetToken,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO password_reset_tokens (token_hash, user_id, facility_id, expires_at)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(&token.token_hash)
    .bind(token.user_id)
    .bind(token.facility_id)
    .bind(token.expires_at)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn password_reset_token_by_hash(
    pool: &PgPool,
    token_hash: &str,
) -> anyhow::Result<Option<PasswordResetTokenRow>> {
    Ok(sqlx::query_as::<_, PasswordResetTokenRow>(
        r#"
        SELECT user_id,
               facility_id,
               expires_at,
               used_at
        FROM password_reset_tokens
        WHERE token_hash = $1
        "#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?)
}

pub async fn password_hashes_for_user(
    pool: &PgPool,
    user_id: Uuid,
    history_limit: i64,
) -> anyhow::Result<Vec<String>> {
    let mut hashes = Vec::new();
    if let Some(current) =
        sqlx::query_scalar::<_, String>("SELECT password_hash FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?
    {
        hashes.push(current);
    }

    let historical = sqlx::query_scalar::<_, String>(
        r#"
        SELECT password_hash
        FROM password_history
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        "#,
    )
    .bind(user_id)
    .bind(history_limit)
    .fetch_all(pool)
    .await?;
    hashes.extend(historical);

    Ok(hashes)
}

pub async fn change_user_password(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    new_password_hash: &str,
) -> anyhow::Result<Option<UserAccount>> {
    let mut transaction = pool.begin().await?;
    let current_hash = sqlx::query_scalar::<_, String>(
        r#"
        SELECT password_hash
        FROM users
        WHERE id = $1
          AND facility_id = $2
          AND is_active = TRUE
        FOR UPDATE
        "#,
    )
    .bind(user_id)
    .bind(facility_id)
    .fetch_optional(&mut *transaction)
    .await?;

    let Some(current_hash) = current_hash else {
        return Ok(None);
    };

    sqlx::query(
        r#"
        INSERT INTO password_history (id, user_id, password_hash)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(current_hash)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE users
        SET password_hash = $3,
            password_change_required = FALSE,
            session_version = session_version + 1,
            updated_at = now()
        WHERE id = $1
          AND facility_id = $2
          AND is_active = TRUE
        "#,
    )
    .bind(user_id)
    .bind(facility_id)
    .bind(new_password_hash)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, now()),
            revoked_reason = COALESCE(revoked_reason, 'password_changed')
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    user_by_id(pool, user_id).await
}

pub async fn complete_password_reset(
    pool: &PgPool,
    token_hash: &str,
    user_id: Uuid,
    new_password_hash: &str,
) -> anyhow::Result<bool> {
    let mut transaction = pool.begin().await?;
    let token_user_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT user_id
        FROM password_reset_tokens
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > now()
        FOR UPDATE
        "#,
    )
    .bind(token_hash)
    .fetch_optional(&mut *transaction)
    .await?;

    if token_user_id != Some(user_id) {
        return Ok(false);
    }

    sqlx::query(
        r#"
        UPDATE users
        SET password_hash = $2,
            password_change_required = FALSE,
            session_version = session_version + 1,
            updated_at = now()
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .bind(new_password_hash)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE password_reset_tokens
        SET used_at = now()
        WHERE token_hash = $1
        "#,
    )
    .bind(token_hash)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO password_history (id, user_id, password_hash)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(new_password_hash)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, now()),
            revoked_reason = COALESCE(revoked_reason, 'password_reset_completed')
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    Ok(true)
}

pub async fn list_webauthn_credentials(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
) -> anyhow::Result<Vec<WebAuthnCredentialRow>> {
    Ok(sqlx::query_as::<_, WebAuthnCredentialRow>(
        r#"
        SELECT id,
               credential_id,
               passkey,
               label,
               created_at,
               last_used_at
        FROM auth_webauthn_credentials
        WHERE facility_id = $1
          AND user_id = $2
          AND disabled_at IS NULL
        ORDER BY created_at DESC, id DESC
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

pub async fn insert_webauthn_challenge(
    pool: &PgPool,
    challenge: &NewWebAuthnChallenge,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO auth_webauthn_challenges (
            id,
            user_id,
            facility_id,
            ceremony_type,
            state,
            expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(challenge.id)
    .bind(challenge.user_id)
    .bind(challenge.facility_id)
    .bind(challenge.ceremony_type.as_str())
    .bind(&challenge.state)
    .bind(challenge.expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn consume_webauthn_challenge(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    challenge_id: Uuid,
    ceremony_type: WebAuthnCeremonyType,
) -> anyhow::Result<Option<WebAuthnChallengeRow>> {
    let mut transaction = pool.begin().await?;
    let challenge = sqlx::query_as::<_, WebAuthnChallengeRow>(
        r#"
        SELECT id,
               user_id,
               facility_id,
               state,
               expires_at
        FROM auth_webauthn_challenges
        WHERE id = $1
          AND facility_id = $2
          AND user_id = $3
          AND ceremony_type = $4
          AND consumed_at IS NULL
          AND expires_at > now()
        FOR UPDATE
        "#,
    )
    .bind(challenge_id)
    .bind(facility_id)
    .bind(user_id)
    .bind(ceremony_type.as_str())
    .fetch_optional(&mut *transaction)
    .await?;

    if challenge.is_some() {
        sqlx::query(
            r#"
            UPDATE auth_webauthn_challenges
            SET consumed_at = now()
            WHERE id = $1
            "#,
        )
        .bind(challenge_id)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    Ok(challenge)
}

pub async fn insert_webauthn_credential(
    pool: &PgPool,
    credential: &NewWebAuthnCredential,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO auth_webauthn_credentials (
            id,
            user_id,
            facility_id,
            credential_id,
            passkey,
            label
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(credential.id)
    .bind(credential.user_id)
    .bind(credential.facility_id)
    .bind(&credential.credential_id)
    .bind(&credential.passkey)
    .bind(credential.label.as_deref())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_webauthn_credential_after_authentication(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    credential_id: &str,
    passkey: &serde_json::Value,
) -> anyhow::Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE auth_webauthn_credentials
        SET passkey = $4,
            last_used_at = now()
        WHERE facility_id = $1
          AND user_id = $2
          AND credential_id = $3
          AND disabled_at IS NULL
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .bind(credential_id)
    .bind(passkey)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
}

pub async fn replace_recovery_codes(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    code_hashes: Vec<String>,
) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;
    sqlx::query(
        r#"
        UPDATE auth_recovery_codes
        SET invalidated_at = COALESCE(invalidated_at, now())
        WHERE facility_id = $1
          AND user_id = $2
          AND used_at IS NULL
          AND invalidated_at IS NULL
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;

    let generated_set_id = Uuid::new_v4();
    for code_hash in code_hashes {
        sqlx::query(
            r#"
            INSERT INTO auth_recovery_codes (
                id,
                user_id,
                facility_id,
                code_hash,
                generated_set_id
            )
            VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(facility_id)
        .bind(code_hash)
        .bind(generated_set_id)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    Ok(())
}

pub async fn consume_recovery_code(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    code_hash: &str,
) -> anyhow::Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE auth_recovery_codes
        SET used_at = now()
        WHERE facility_id = $1
          AND user_id = $2
          AND code_hash = $3
          AND used_at IS NULL
          AND invalidated_at IS NULL
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .bind(code_hash)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
}

pub async fn recovery_codes_remaining(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)::bigint
        FROM auth_recovery_codes
        WHERE facility_id = $1
          AND user_id = $2
          AND used_at IS NULL
          AND invalidated_at IS NULL
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?)
}

pub async fn clinical_patient_access_evidence(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    patient_id: Uuid,
    now: DateTime<Utc>,
) -> anyhow::Result<ClinicalPatientAccessEvidence> {
    let has_workflow_access = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM patient_contexts
            JOIN patients ON patients.id = patient_contexts.patient_id
            WHERE patient_contexts.facility_id = $1
              AND patient_contexts.user_id = $2
              AND patient_contexts.patient_id = $3
              AND patients.facility_id = $1
              AND patients.status = 'active'
        ) OR EXISTS (
            SELECT 1
            FROM clinical_notes
            JOIN patients ON patients.id = clinical_notes.patient_id
            WHERE clinical_notes.facility_id = $1
              AND clinical_notes.created_by_user_id = $2
              AND clinical_notes.patient_id = $3
              AND patients.facility_id = $1
              AND patients.status = 'active'
        )
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .bind(patient_id)
    .fetch_one(pool)
    .await?;

    Ok(ClinicalPatientAccessEvidence {
        workflow_reason: has_workflow_access
            .then_some(ClinicalPatientAccessReason::ActiveClinicalRelationship),
        break_glass_grant: active_break_glass_grant_for_patient(
            pool,
            facility_id,
            user_id,
            patient_id,
            now,
        )
        .await?,
    })
}

pub async fn active_break_glass_grant_for_patient(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    patient_id: Uuid,
    now: DateTime<Utc>,
) -> anyhow::Result<Option<BreakGlassGrant>> {
    let row = sqlx::query_as::<_, BreakGlassGrantRow>(
        r#"
        SELECT id,
               facility_id,
               user_id,
               patient_id,
               category,
               reason_text,
               started_at,
               expires_at,
               ended_at
        FROM patient_break_glass_grants
        WHERE facility_id = $1
          AND user_id = $2
          AND patient_id = $3
          AND ended_at IS NULL
          AND started_at <= $4
          AND expires_at > $4
        ORDER BY started_at DESC, id DESC
        LIMIT 1
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .bind(patient_id)
    .bind(now)
    .fetch_optional(pool)
    .await?;

    row.map(break_glass_grant_from_row).transpose()
}

pub async fn start_break_glass_grant(
    pool: &PgPool,
    command: StartBreakGlassGrant,
) -> anyhow::Result<BreakGlassGrantOutcome> {
    if !reauth_is_fresh(command.reauth_verified_at, command.now) {
        return Ok(BreakGlassGrantOutcome::Denied(
            BreakGlassGrantDenialReason::ReauthRequired,
        ));
    }

    let has_permission = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM users
            JOIN user_permissions ON user_permissions.user_id = users.id
            WHERE users.id = $1
              AND users.facility_id = $2
              AND users.is_active = TRUE
              AND user_permissions.permission_code = $3
        )
        "#,
    )
    .bind(command.user_id)
    .bind(command.facility_id)
    .bind(BREAK_GLASS_PERMISSION_CODE)
    .fetch_one(pool)
    .await?;
    if !has_permission {
        return Ok(BreakGlassGrantOutcome::Denied(
            BreakGlassGrantDenialReason::MissingDedicatedPermission,
        ));
    }

    let patient_is_active = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM patients
            WHERE id = $1
              AND facility_id = $2
              AND status = 'active'
        )
        "#,
    )
    .bind(command.patient_id)
    .bind(command.facility_id)
    .fetch_one(pool)
    .await?;
    if !patient_is_active {
        return Ok(BreakGlassGrantOutcome::Denied(
            BreakGlassGrantDenialReason::PatientNotActive,
        ));
    }

    if active_break_glass_grant_for_patient(
        pool,
        command.facility_id,
        command.user_id,
        command.patient_id,
        command.now,
    )
    .await?
    .is_some()
    {
        return Ok(BreakGlassGrantOutcome::Denied(
            BreakGlassGrantDenialReason::ActiveGrantAlreadyExists,
        ));
    }

    let active_count =
        active_break_glass_grant_count(pool, command.facility_id, command.user_id, command.now)
            .await?;
    if active_count >= BREAK_GLASS_MAX_ACTIVE_GRANTS_PER_USER {
        return Ok(BreakGlassGrantOutcome::Denied(
            BreakGlassGrantDenialReason::TooManyActiveGrants,
        ));
    }

    let reason_text = command
        .reason_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let expires_at = command.now + Duration::hours(BREAK_GLASS_GRANT_TTL_HOURS);
    let mut transaction = pool.begin().await?;
    let category = codec::encode(command.category)?;
    let row = sqlx::query_as::<_, BreakGlassGrantRow>(
        r#"
        INSERT INTO patient_break_glass_grants (
            id,
            facility_id,
            user_id,
            patient_id,
            category,
            reason_text,
            started_at,
            expires_at,
            request_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id,
                  facility_id,
                  user_id,
                  patient_id,
                  category,
                  reason_text,
                  started_at,
                  expires_at,
                  ended_at
        "#,
    )
    .bind(command.id)
    .bind(command.facility_id)
    .bind(command.user_id)
    .bind(command.patient_id)
    .bind(&category)
    .bind(reason_text)
    .bind(command.now)
    .bind(expires_at)
    .bind(command.request_id.as_deref())
    .fetch_one(&mut *transaction)
    .await?;

    insert_break_glass_audit_event(
        &mut transaction,
        command.facility_id,
        command.user_id,
        command.request_id.as_deref(),
        "patient.break_glass.started",
        command.patient_id,
        serde_json::json!({ "category": category }),
    )
    .await?;
    transaction.commit().await?;

    Ok(BreakGlassGrantOutcome::Granted(break_glass_grant_from_row(
        row,
    )?))
}

pub async fn end_break_glass_grants(
    pool: &PgPool,
    command: EndBreakGlassGrants,
) -> anyhow::Result<u64> {
    let mut transaction = pool.begin().await?;
    let result = sqlx::query(
        r#"
        UPDATE patient_break_glass_grants
        SET ended_at = $5,
            ended_by_user_id = $4
        WHERE facility_id = $1
          AND user_id = $2
          AND patient_id = $3
          AND ended_at IS NULL
          AND started_at <= $5
          AND expires_at > $5
        "#,
    )
    .bind(command.facility_id)
    .bind(command.user_id)
    .bind(command.patient_id)
    .bind(command.ended_by_user_id)
    .bind(command.now)
    .execute(&mut *transaction)
    .await?;

    let ended = result.rows_affected();
    if ended > 0 {
        insert_break_glass_audit_event(
            &mut transaction,
            command.facility_id,
            command.ended_by_user_id,
            command.request_id.as_deref(),
            "patient.break_glass.ended",
            command.patient_id,
            serde_json::json!({ "ended_count": ended }),
        )
        .await?;
    }
    transaction.commit().await?;
    Ok(ended)
}

async fn active_break_glass_grant_count(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    now: DateTime<Utc>,
) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM patient_break_glass_grants
        WHERE facility_id = $1
          AND user_id = $2
          AND ended_at IS NULL
          AND started_at <= $3
          AND expires_at > $3
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .bind(now)
    .fetch_one(pool)
    .await?)
}

fn reauth_is_fresh(reauth_verified_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    let Some(verified_at) = reauth_verified_at else {
        return false;
    };
    verified_at <= now && now <= verified_at + Duration::minutes(15)
}

fn break_glass_grant_from_row(row: BreakGlassGrantRow) -> anyhow::Result<BreakGlassGrant> {
    Ok(BreakGlassGrant {
        id: row.id,
        facility_id: row.facility_id,
        user_id: row.user_id,
        patient_id: row.patient_id,
        category: codec::decode::<BreakGlassCategory>(&row.category)?,
        reason_text: row.reason_text,
        started_at: row.started_at,
        expires_at: row.expires_at,
        ended_at: row.ended_at,
    })
}

async fn insert_break_glass_audit_event(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    facility_id: Uuid,
    actor_user_id: Uuid,
    request_id: Option<&str>,
    event_type: &str,
    patient_id: Uuid,
    metadata: serde_json::Value,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO audit_events (
            id,
            facility_id,
            actor_user_id,
            request_id,
            event_type,
            resource_type,
            resource_id,
            metadata
        )
        VALUES ($1, $2, $3, $4, $5, 'patient', $6, $7)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(facility_id)
    .bind(actor_user_id)
    .bind(request_id)
    .bind(event_type)
    .bind(patient_id)
    .bind(metadata)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

fn hydrate_user(row: Option<UserRow>) -> anyhow::Result<Option<UserAccount>> {
    let Some(row) = row else {
        return Ok(None);
    };

    let permissions = row
        .permission_codes
        .iter()
        .map(|value| codec::decode(value))
        .collect::<anyhow::Result<Vec<_>>>()?;

    Ok(Some(UserAccount {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        facility_id: row.facility_id,
        facility_code: row.facility_code,
        active_profile: codec::decode(&row.active_profile)?,
        permissions: permissions.clone(),
        features: row
            .feature_keys
            .iter()
            .map(|value| codec::decode(value))
            .collect::<anyhow::Result<_>>()?,
        patient_visibility: row
            .visibility_codes
            .iter()
            .map(|value| codec::decode(value))
            .collect::<anyhow::Result<_>>()?,
        session_version: row.session_version,
        permission_version: row.permission_version,
        password_change_required: row.password_change_required,
        auth_security: AuthSecurityState::from_permissions(
            &permissions,
            row.passkey_enrolled,
            row.recovery_codes_remaining,
        ),
        password_hash: row.password_hash,
    }))
}

fn hydrate_request_context_facts(
    row: Option<RequestContextFactsRow>,
    fallback_profile: DeploymentProfile,
) -> anyhow::Result<Option<RequestContextAuthFacts>> {
    let Some(row) = row else {
        return Ok(None);
    };

    let permissions = row
        .permission_codes
        .iter()
        .map(|value| codec::decode(value))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let feature_rows: Vec<crate::admin::EffectiveFeatureFlagRow> =
        serde_json::from_value(row.feature_flags)?;
    let authority_rows: Vec<crate::admin::ActiveAuthorityRow> =
        serde_json::from_value(row.active_authorities)?;

    Ok(Some(RequestContextAuthFacts {
        user: AuthUser {
            id: row.id,
            email: row.email,
            display_name: row.display_name,
            facility_id: row.facility_id,
            facility_code: row.facility_code,
            active_profile: codec::decode(&row.active_profile)?,
            permissions: permissions.clone(),
            features: row
                .feature_keys
                .iter()
                .map(|value| codec::decode(value))
                .collect::<anyhow::Result<_>>()?,
            patient_visibility: row
                .visibility_codes
                .iter()
                .map(|value| codec::decode(value))
                .collect::<anyhow::Result<_>>()?,
            session_version: row.session_version,
            permission_version: row.permission_version,
            password_change_required: row.password_change_required,
            auth_security: AuthSecurityState::from_permissions(
                &permissions,
                row.passkey_enrolled,
                row.recovery_codes_remaining,
            ),
        },
        feature_flags: crate::admin::effective_feature_flags_from_rows(
            feature_rows,
            fallback_profile,
        )?,
        active_authorities: crate::admin::active_authorities_from_rows(authority_rows)?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use hms_domain::auth::{
        BreakGlassCategory, BreakGlassGrantDenialReason, BreakGlassGrantOutcome,
        BREAK_GLASS_PERMISSION_CODE,
    };
    use hms_domain::patients::{PatientAdministrativeStatus, Sex};

    async fn grant_break_glass_permission(db: &crate::test_support::TestDb) {
        sqlx::query(
            r#"
            INSERT INTO user_permissions (user_id, permission_code)
            VALUES ($1, $2)
            ON CONFLICT (user_id, permission_code) DO NOTHING
            "#,
        )
        .bind(db.owner_user_id())
        .bind(BREAK_GLASS_PERMISSION_CODE)
        .execute(db.pool())
        .await
        .expect("break-glass permission can be granted for test");
    }

    async fn revoke_break_glass_permission(db: &crate::test_support::TestDb) {
        sqlx::query(
            r#"
            DELETE FROM user_permissions
            WHERE user_id = $1 AND permission_code = $2
            "#,
        )
        .bind(db.owner_user_id())
        .bind(BREAK_GLASS_PERMISSION_CODE)
        .execute(db.pool())
        .await
        .expect("break-glass permission can be revoked for test");
    }

    fn start_command(
        db: &crate::test_support::TestDb,
        patient_id: Uuid,
        now: DateTime<Utc>,
    ) -> StartBreakGlassGrant {
        StartBreakGlassGrant {
            id: Uuid::new_v4(),
            facility_id: db.facility_id(),
            user_id: db.owner_user_id(),
            patient_id,
            category: BreakGlassCategory::LifeThreateningEmergency,
            reason_text: Some("acute airway risk".to_owned()),
            request_id: Some("break-glass-test".to_owned()),
            now,
            reauth_verified_at: Some(now),
        }
    }

    #[tokio::test]
    async fn break_glass_start_requires_permission_reauth_and_active_patient() {
        let db = crate::test_support::TestDb::hospital()
            .await
            .expect("test db starts");
        let patient = db
            .scenario("break_glass_required")
            .registered_patient()
            .await
            .expect("patient is created");
        let now = Utc::now();

        revoke_break_glass_permission(&db).await;
        assert_eq!(
            start_break_glass_grant(db.pool(), start_command(&db, patient.id, now))
                .await
                .expect("grant start evaluates"),
            BreakGlassGrantOutcome::Denied(BreakGlassGrantDenialReason::MissingDedicatedPermission)
        );

        grant_break_glass_permission(&db).await;
        let mut stale = start_command(&db, patient.id, now);
        stale.reauth_verified_at = Some(now - Duration::minutes(16));
        assert_eq!(
            start_break_glass_grant(db.pool(), stale)
                .await
                .expect("stale reauth evaluates"),
            BreakGlassGrantOutcome::Denied(BreakGlassGrantDenialReason::ReauthRequired)
        );

        crate::patients::update_patient(
            db.pool(),
            crate::patients::PatientUpdate {
                id: patient.id,
                facility_id: db.facility_id(),
                first_name: None,
                last_name: None,
                date_of_birth: None,
                sex: Some(Sex::Female),
                status: Some(PatientAdministrativeStatus::Inactive),
                actor_user_id: db.owner_user_id(),
                request_id: Some("inactive-patient-test".to_owned()),
            },
        )
        .await
        .expect("patient can be marked inactive");
        assert_eq!(
            start_break_glass_grant(db.pool(), start_command(&db, patient.id, now))
                .await
                .expect("inactive patient evaluates"),
            BreakGlassGrantOutcome::Denied(BreakGlassGrantDenialReason::PatientNotActive)
        );
    }

    #[tokio::test]
    async fn break_glass_grants_are_scoped_limited_non_extendable_and_audited() {
        let db = crate::test_support::TestDb::hospital()
            .await
            .expect("test db starts");
        grant_break_glass_permission(&db).await;
        let now = Utc::now();
        let patient = db
            .scenario("break_glass_scope")
            .registered_patient()
            .await
            .expect("patient is created");

        let first = start_break_glass_grant(db.pool(), start_command(&db, patient.id, now))
            .await
            .expect("grant starts");
        let BreakGlassGrantOutcome::Granted(grant) = first else {
            panic!("expected granted break-glass outcome, got {first:?}");
        };
        assert_eq!(grant.user_id, db.owner_user_id());
        assert_eq!(grant.patient_id, patient.id);
        assert_eq!(grant.facility_id, db.facility_id());
        assert_eq!(
            grant.expires_at.signed_duration_since(grant.started_at),
            Duration::hours(2)
        );
        assert!(grant.ended_at.is_none());

        assert_eq!(
            start_break_glass_grant(db.pool(), start_command(&db, patient.id, now))
                .await
                .expect("duplicate active grant evaluates"),
            BreakGlassGrantOutcome::Denied(BreakGlassGrantDenialReason::ActiveGrantAlreadyExists)
        );

        let active = active_break_glass_grant_for_patient(
            db.pool(),
            db.facility_id(),
            db.owner_user_id(),
            patient.id,
            now,
        )
        .await
        .expect("active grant loads")
        .expect("grant is active");
        assert_eq!(active.id, grant.id);

        let ended = end_break_glass_grants(
            db.pool(),
            EndBreakGlassGrants {
                facility_id: db.facility_id(),
                user_id: db.owner_user_id(),
                patient_id: patient.id,
                ended_by_user_id: db.owner_user_id(),
                request_id: Some("break-glass-end-test".to_owned()),
                now,
            },
        )
        .await
        .expect("grant ends");
        assert_eq!(ended, 1);
        assert!(
            active_break_glass_grant_for_patient(
                db.pool(),
                db.facility_id(),
                db.owner_user_id(),
                patient.id,
                now,
            )
            .await
            .expect("active grant check succeeds")
            .is_none(),
            "ended grant is no longer active across devices"
        );

        let audit_count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT count(*)
            FROM audit_events
            WHERE facility_id = $1
              AND actor_user_id = $2
              AND resource_id = $3
              AND event_type IN ('patient.break_glass.started', 'patient.break_glass.ended')
            "#,
        )
        .bind(db.facility_id())
        .bind(db.owner_user_id())
        .bind(patient.id)
        .fetch_one(db.pool())
        .await
        .expect("audit count loads");
        assert_eq!(audit_count, 2);
    }

    #[tokio::test]
    async fn break_glass_caps_active_grants_per_user() {
        let db = crate::test_support::TestDb::hospital()
            .await
            .expect("test db starts");
        grant_break_glass_permission(&db).await;
        let now = Utc::now();

        for index in 0..3 {
            let patient = crate::patients::create_patient(
                db.pool(),
                crate::patients::NewPatient {
                    id: Uuid::new_v4(),
                    facility_id: db.facility_id(),
                    patient_code: format!("P-BG-CAP-{index}"),
                    first_name: format!("Grant{index}"),
                    last_name: "Patient".to_owned(),
                    date_of_birth: chrono::NaiveDate::from_ymd_opt(1990, 1, 1)
                        .expect("static date is valid"),
                    sex: Sex::Female,
                },
            )
            .await
            .expect("patient can be created");
            assert!(matches!(
                start_break_glass_grant(db.pool(), start_command(&db, patient.id, now))
                    .await
                    .expect("grant starts"),
                BreakGlassGrantOutcome::Granted(_)
            ));
        }

        let fourth = db
            .scenario("break_glass_cap")
            .registered_patient()
            .await
            .expect("fourth patient is created");
        assert_eq!(
            start_break_glass_grant(db.pool(), start_command(&db, fourth.id, now))
                .await
                .expect("cap evaluates"),
            BreakGlassGrantOutcome::Denied(BreakGlassGrantDenialReason::TooManyActiveGrants)
        );
    }
}
