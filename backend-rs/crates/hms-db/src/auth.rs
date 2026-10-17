use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use hms_domain::auth::{
    ActiveAuthority, AuthSecurityState, AuthUser, BreakGlassCategory, BreakGlassGrant,
    BreakGlassGrantDenialReason, BreakGlassGrantOutcome, BreakGlassGrantSummary,
    ClinicalPatientAccessEvidence, ClinicalPatientAccessReason, CurrentBreakGlassStatus,
    PatientDataVisibility, UpdateAuthProfileRequest, BREAK_GLASS_GRANT_TTL_HOURS,
    BREAK_GLASS_MAX_ACTIVE_GRANTS_PER_USER, BREAK_GLASS_PERMISSION_CODE,
};
use hms_domain::deployment::{DeploymentProfile, FeatureKey, PermissionCode};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

pub mod assurance;
mod webauthn;
pub use webauthn::{
    begin_webauthn_ceremony, insert_webauthn_challenge_bound, webauthn_credentials_authorized,
    WebAuthnActor, WebAuthnCeremony, WebAuthnError,
};

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
    auth_factor_version: i64,
}

#[derive(Clone, Debug, FromRow)]
struct SessionUserRow {
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
    auth_factor_version: i64,
    session_expires_at: DateTime<Utc>,
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
    auth_factor_version: i64,
    feature_flags: Value,
    active_authorities: Value,
    feature_entitlements_updated_at: Option<DateTime<Utc>>,
    session_expires_at: DateTime<Utc>,
    factor_expires_at: Option<DateTime<Utc>>,
    password_verified_at: DateTime<Utc>,
    session_assurance: Value,
    assurance_version: i64,
}

#[derive(Clone, Copy, Debug)]
pub struct UserAuthVersions {
    pub session_version: i64,
    pub permission_version: i64,
    pub active_profile: DeploymentProfile,
    pub auth_factor_version: i64,
    pub assurance_version: i64,
    pub password_change_required: bool,
    pub feature_entitlements_updated_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug)]
pub struct RequestContextAuthFacts {
    pub user: AuthUser,
    pub feature_flags: HashMap<FeatureKey, bool>,
    pub active_authorities: Vec<ActiveAuthority>,
    pub feature_entitlements_updated_at: Option<DateTime<Utc>>,
    pub session_expires_at: DateTime<Utc>,
    /// Cache staleness bound only; factor expiry does not end ordinary access.
    pub cache_expires_at: DateTime<Utc>,
    pub password_verified_at: DateTime<Utc>,
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
    pub session_started_at: DateTime<Utc>,
    pub idle_expires_at: DateTime<Utc>,
    pub absolute_expires_at: DateTime<Utc>,
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
    pub session_started_at: DateTime<Utc>,
    pub idle_expires_at: DateTime<Utc>,
    pub absolute_expires_at: DateTime<Utc>,
    pub device_label: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewAuthAuditEvent {
    pub facility_id: Uuid,
    pub actor_user_id: Option<Uuid>,
    pub request_id: Option<String>,
    pub event_type: String,
    pub resource_type: String,
    pub resource_id: Option<Uuid>,
    pub metadata: Value,
}

#[derive(Clone, Debug, FromRow)]
pub struct UserSessionRow {
    pub id: Uuid,
    pub device_label: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
    pub session_started_at: DateTime<Utc>,
    pub idle_expires_at: DateTime<Utc>,
    pub absolute_expires_at: DateTime<Utc>,
    pub is_current: bool,
}

#[derive(Clone, Debug)]
pub struct SessionUserAccount {
    pub user: UserAccount,
    pub session_expires_at: DateTime<Utc>,
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

#[derive(Clone, Debug)]
pub struct AuditBreakGlassChronicleView {
    pub grant_id: Uuid,
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub patient_id: Uuid,
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
               users.auth_factor_version,
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
            FROM effective_user_permissions
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
    user_by_id_for_facility_with_session(
        pool,
        user_id,
        facility_id,
        None,
        "auth.user_by_id_for_facility",
    )
    .await
}

pub async fn user_by_id_for_facility_session(
    pool: &PgPool,
    user_id: Uuid,
    facility_id: Uuid,
    session_id: Uuid,
) -> anyhow::Result<Option<UserAccount>> {
    Ok(
        user_by_id_for_facility_session_with_deadline(pool, user_id, facility_id, session_id)
            .await?
            .map(|session_user| session_user.user),
    )
}

pub async fn user_by_id_for_facility_session_with_deadline(
    pool: &PgPool,
    user_id: Uuid,
    facility_id: Uuid,
    session_id: Uuid,
) -> anyhow::Result<Option<SessionUserAccount>> {
    let row = hms_observability::observe_db_query(
        "auth.user_by_id_for_facility_session",
        sqlx::query_as::<_, SessionUserRow>(
            r#"
        SELECT users.id,
               users.email,
               users.display_name,
               users.facility_id,
               facilities.code AS facility_code,
               facilities.deployment_profile AS active_profile,
               users.session_version,
               users.auth_factor_version,
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
               COALESCE(auth_recovery_codes.remaining, 0)::bigint AS recovery_codes_remaining,
               LEAST(
                   refresh_sessions.expires_at,
                   refresh_sessions.idle_expires_at,
                   refresh_sessions.absolute_expires_at,
                   (SELECT MIN(boundary_at) FROM user_authority_boundaries b
                    CROSS JOIN LATERAL (VALUES (b.starts_at), (b.ends_at)) boundary(boundary_at)
                    WHERE b.user_id = users.id AND b.facility_id = users.facility_id AND boundary_at > now())
               ) AS session_expires_at
        FROM users
        JOIN facilities ON facilities.id = users.facility_id
        JOIN refresh_sessions
          ON refresh_sessions.session_id = $3
         AND refresh_sessions.user_id = users.id
         AND refresh_sessions.facility_id = users.facility_id
         AND refresh_sessions.session_version = users.session_version
         AND refresh_sessions.permission_version_at_issue = users.permission_version
         AND refresh_sessions.revoked_at IS NULL
         AND refresh_sessions.expires_at > now()
         AND refresh_sessions.idle_expires_at > now()
         AND refresh_sessions.absolute_expires_at > now()
        LEFT JOIN LATERAL (
            SELECT array_agg(permission_code ORDER BY permission_code) AS permission_codes
            FROM effective_user_permissions
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
        .bind(session_id)
        .fetch_optional(pool),
    )
    .await?;

    hydrate_session_user(row)
}

async fn user_by_id_for_facility_with_session(
    pool: &PgPool,
    user_id: Uuid,
    facility_id: Uuid,
    session_id: Option<Uuid>,
    query_name: &'static str,
) -> anyhow::Result<Option<UserAccount>> {
    let row = hms_observability::observe_db_query(
        query_name,
        sqlx::query_as::<_, UserRow>(
            r#"
        SELECT users.id,
               users.email,
               users.display_name,
               users.facility_id,
               facilities.code AS facility_code,
               facilities.deployment_profile AS active_profile,
               users.session_version,
               users.auth_factor_version,
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
            FROM effective_user_permissions
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
          AND (
              $3::uuid IS NULL
              OR EXISTS (
                  SELECT 1
                  FROM refresh_sessions
                  WHERE refresh_sessions.session_id = $3
                    AND refresh_sessions.user_id = users.id
                    AND refresh_sessions.facility_id = users.facility_id
                    AND refresh_sessions.session_version = users.session_version
                    AND refresh_sessions.permission_version_at_issue = users.permission_version
                    AND refresh_sessions.revoked_at IS NULL
                    AND refresh_sessions.expires_at > now()
                    AND refresh_sessions.idle_expires_at > now()
                    AND refresh_sessions.absolute_expires_at > now()
              )
          )
        "#,
        )
        .bind(user_id)
        .bind(facility_id)
        .bind(session_id)
        .fetch_optional(pool),
    )
    .await?;

    hydrate_user(row)
}

pub async fn user_auth_versions_for_facility(
    pool: &PgPool,
    user: Uuid,
    facility: Uuid,
) -> anyhow::Result<Option<UserAuthVersions>> {
    auth_versions_inner(pool, user, facility, None).await
}
pub async fn session_auth_versions_for_facility(
    pool: &PgPool,
    user: Uuid,
    facility: Uuid,
    session: Uuid,
) -> anyhow::Result<Option<UserAuthVersions>> {
    auth_versions_inner(pool, user, facility, Some(session)).await
}
async fn auth_versions_inner(
    pool: &PgPool,
    user_id: Uuid,
    facility_id: Uuid,
    session: Option<Uuid>,
) -> anyhow::Result<Option<UserAuthVersions>> {
    let row = hms_observability::observe_db_query(
        "auth.user_auth_versions_for_facility",
        sqlx::query_as::<_, (i64, i64, bool, i64, String, Option<DateTime<Utc>>, i64) >(
            r#"
            SELECT users.session_version, users.auth_factor_version, users.password_change_required,
                   users.permission_version,
                   facilities.deployment_profile AS active_profile,
                   (
                       SELECT MAX(facility_feature_entitlements.updated_at)
                       FROM facility_feature_entitlements
                       WHERE facility_feature_entitlements.facility_id = users.facility_id
                   ) AS feature_entitlements_updated_at,
                   COALESCE((SELECT assurance_version FROM refresh_sessions WHERE session_id=$3),0) AS assurance_version
            FROM users
            JOIN facilities ON facilities.id = users.facility_id
            WHERE users.id = $1
              AND users.facility_id = $2
              AND users.is_active = TRUE
              AND facilities.is_active = TRUE
              AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM refresh_sessions s WHERE s.session_id=$3 AND s.user_id=users.id AND s.facility_id=users.facility_id AND s.session_version=users.session_version AND s.permission_version_at_issue=users.permission_version AND s.revoked_at IS NULL AND LEAST(s.expires_at,s.idle_expires_at,s.absolute_expires_at)>clock_timestamp()))
            "#,
        )
        .bind(user_id)
        .bind(facility_id)
        .bind(session)
        .fetch_optional(pool),
    )
    .await?;

    row.map(
        |(
            session_version,
            auth_factor_version,
            password_change_required,
            permission_version,
            active_profile,
            feature_entitlements_updated_at,
            assurance_version,
        )| {
            Ok(UserAuthVersions {
                session_version,
                permission_version,
                active_profile: codec::decode(&active_profile)?,
                auth_factor_version,
                assurance_version,
                password_change_required,
                feature_entitlements_updated_at,
            })
        },
    )
    .transpose()
}

pub async fn request_context_facts(
    pool: &PgPool,
    user_id: Uuid,
    facility_id: Uuid,
    session_id: Uuid,
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
                   users.auth_factor_version,
                   refresh_sessions.password_verified_at,
                   refresh_sessions.assurance_version,
                   COALESCE(factor.proof,'{"method":null,"verified_at":null,"expires_at":null,"credential_id":null}'::jsonb) AS session_assurance,
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
                         AND positions.facility_id=authority_appointments.facility_id
                       JOIN organization_units ON organization_units.id=positions.org_unit_id
                         AND organization_units.facility_id=positions.facility_id
                         AND organization_units.is_active
                       LEFT JOIN position_templates ON position_templates.id = positions.template_id
                         AND position_templates.facility_id=positions.facility_id
                       LEFT JOIN LATERAL unnest(COALESCE(position_templates.permission_codes, '{}'::text[]))
                           AS authority_permissions(permission_code) ON TRUE
                       WHERE authority_appointments.facility_id = $2
                         AND authority_appointments.user_id = $1
                         AND authority_appointments.status = 'active'
                         AND positions.status = 'active'
                         AND (positions.template_id IS NULL OR position_templates.id IS NOT NULL)
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
                   ), '[]'::jsonb) AS active_authorities,
	                   (
	                     SELECT MAX(facility_feature_entitlements.updated_at)
	                     FROM facility_feature_entitlements
	                     WHERE facility_feature_entitlements.facility_id = users.facility_id
	                   ) AS feature_entitlements_updated_at,
	                   factor.proof_expires_at AS factor_expires_at,
	                   LEAST(
	                     refresh_sessions.expires_at,
	                     refresh_sessions.idle_expires_at,
	                     refresh_sessions.absolute_expires_at,
                   (SELECT MIN(boundary_at) FROM user_authority_boundaries b
                    CROSS JOIN LATERAL (VALUES (b.starts_at), (b.ends_at)) boundary(boundary_at)
                    WHERE b.user_id = users.id AND b.facility_id = users.facility_id AND boundary_at > now())
	                   ) AS session_expires_at
	            FROM users
	            JOIN facilities ON facilities.id = users.facility_id
	            JOIN refresh_sessions
	              ON refresh_sessions.session_id = $3
	             AND refresh_sessions.user_id = users.id
	             AND refresh_sessions.facility_id = users.facility_id
	             AND refresh_sessions.session_version = users.session_version
	             AND refresh_sessions.permission_version_at_issue = users.permission_version
	             AND refresh_sessions.revoked_at IS NULL
	             AND refresh_sessions.expires_at > now()
	             AND refresh_sessions.idle_expires_at > now()
	             AND refresh_sessions.absolute_expires_at > now()
	            LEFT JOIN LATERAL (
                SELECT jsonb_build_object('method',a.method,'verified_at',a.verified_at,'expires_at',a.expires_at,'credential_id',a.credential_id) AS proof,a.expires_at AS proof_expires_at
                FROM auth_session_assurance a LEFT JOIN auth_webauthn_credentials k ON k.id=a.credential_id AND k.facility_id=a.facility_id AND k.user_id=a.user_id
                WHERE a.session_id=refresh_sessions.session_id AND a.user_id=users.id AND a.facility_id=users.facility_id
                AND a.session_version=users.session_version AND a.permission_version=users.permission_version AND a.factor_version=users.auth_factor_version
                AND a.active_profile=facilities.deployment_profile AND a.verified_at<=clock_timestamp() AND a.expires_at>clock_timestamp()
                AND (a.method='recovery' OR k.id IS NOT NULL AND k.disabled_at IS NULL)
            ) factor ON TRUE
            LEFT JOIN LATERAL (
	                SELECT array_agg(permission_code ORDER BY permission_code) AS permission_codes
	                FROM effective_user_permissions
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
        .bind(session_id)
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
               users.auth_factor_version,
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
            FROM effective_user_permissions
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
    insert_refresh_session_query(
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
            session_started_at,
            idle_expires_at,
            absolute_expires_at,
            device_label
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        "#,
        ),
        session,
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn insert_refresh_session_with_audit(
    pool: &PgPool,
    session: &NewRefreshSession,
    audit_event: NewAuthAuditEvent,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        WITH inserted_session AS (
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
                session_started_at,
                idle_expires_at,
                absolute_expires_at,
                device_label
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING 1
        )
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
        SELECT $15, $16, $17, $18, $19, $20, $21, $22
        FROM inserted_session
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
    .bind(session.session_started_at)
    .bind(session.idle_expires_at)
    .bind(session.absolute_expires_at)
    .bind(session.device_label.as_deref())
    .bind(Uuid::new_v4())
    .bind(audit_event.facility_id)
    .bind(audit_event.actor_user_id)
    .bind(audit_event.request_id)
    .bind(audit_event.event_type)
    .bind(audit_event.resource_type)
    .bind(audit_event.resource_id)
    .bind(audit_event.metadata)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn insert_auth_audit_event(
    pool: &PgPool,
    audit_event: NewAuthAuditEvent,
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(audit_event.facility_id)
    .bind(audit_event.actor_user_id)
    .bind(audit_event.request_id)
    .bind(audit_event.event_type)
    .bind(audit_event.resource_type)
    .bind(audit_event.resource_id)
    .bind(audit_event.metadata)
    .execute(pool)
    .await?;
    Ok(())
}

/// Opaque proof that a credential attempt reserved durable admission capacity.
/// A reservation belongs to one fixed window and cannot affect a newer one.
pub struct LoginAttemptReservation {
    facility_id: Uuid,
    resource_type: String,
    resource_key: String,
    window_started_at: DateTime<Utc>,
    admitted_at: DateTime<Utc>,
}

impl LoginAttemptReservation {
    /// Database-clock lower bound captured before password verification. It
    /// never advances after CPU work or a subsequent workflow lock wait.
    pub fn admitted_at(&self) -> DateTime<Utc> {
        self.admitted_at
    }
}

/// Atomically reserves the shared failure budget before password work. Scope
/// contains only an internal identifier, never raw login input. A process crash
/// or cancelled attempt leaves a fail-closed reservation until the window ends.
pub async fn reserve_login_attempt(
    pool: &PgPool,
    facility_id: Uuid,
    resource_type: &str,
    resource_id: Option<Uuid>,
) -> anyhow::Result<Option<LoginAttemptReservation>> {
    let resource_key = resource_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| "none".to_owned());
    let admission = sqlx::query_as::<_, (DateTime<Utc>, DateTime<Utc>)>(
        r#"
        INSERT INTO auth_login_attempt_budgets (
            facility_id, resource_type, resource_key, window_started_at,
            failed_attempts, in_flight_attempts
        )
        VALUES ($1, $2, $3, now(), 0, 1)
        ON CONFLICT (facility_id, resource_type, resource_key) DO UPDATE SET
            window_started_at = CASE
                WHEN auth_login_attempt_budgets.window_started_at <= now() - interval '15 minutes'
                  OR auth_login_attempt_budgets.failed_attempts + auth_login_attempt_budgets.in_flight_attempts = 0
                THEN now() ELSE auth_login_attempt_budgets.window_started_at END,
            failed_attempts = CASE
                WHEN auth_login_attempt_budgets.window_started_at <= now() - interval '15 minutes'
                  OR auth_login_attempt_budgets.failed_attempts + auth_login_attempt_budgets.in_flight_attempts = 0
                THEN 0 ELSE auth_login_attempt_budgets.failed_attempts END,
            in_flight_attempts = CASE
                WHEN auth_login_attempt_budgets.window_started_at <= now() - interval '15 minutes'
                  OR auth_login_attempt_budgets.failed_attempts + auth_login_attempt_budgets.in_flight_attempts = 0
                THEN 1 ELSE auth_login_attempt_budgets.in_flight_attempts + 1 END,
            updated_at = now()
        WHERE auth_login_attempt_budgets.window_started_at <= now() - interval '15 minutes'
           OR auth_login_attempt_budgets.failed_attempts + auth_login_attempt_budgets.in_flight_attempts < 10
        RETURNING window_started_at, clock_timestamp()
        "#,
    )
    .bind(facility_id)
    .bind(resource_type)
    .bind(&resource_key)
    .fetch_optional(pool)
    .await?;
    Ok(
        admission.map(|(window_started_at, admitted_at)| LoginAttemptReservation {
            facility_id,
            resource_type: resource_type.to_owned(),
            resource_key,
            window_started_at,
            admitted_at,
        }),
    )
}

/// Converts a reservation into a failure or releases it after success. False
/// means the reservation's window was lost/expired; callers must not issue a
/// session on that result. The update never releases another window's budget.
pub async fn complete_login_attempt(
    pool: &PgPool,
    reservation: LoginAttemptReservation,
    failed: bool,
) -> anyhow::Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE auth_login_attempt_budgets
        SET in_flight_attempts = in_flight_attempts - 1,
            failed_attempts = failed_attempts + CASE WHEN $5 THEN 1 ELSE 0 END,
            updated_at = now()
        WHERE facility_id = $1
          AND resource_type = $2
          AND resource_key = $3
          AND window_started_at = $4
          AND window_started_at > now() - interval '15 minutes'
          AND in_flight_attempts > 0
        "#,
    )
    .bind(reservation.facility_id)
    .bind(&reservation.resource_type)
    .bind(&reservation.resource_key)
    .bind(reservation.window_started_at)
    .bind(failed)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
}

pub async fn insert_login_failure_audit(
    pool: &PgPool,
    audit_event: NewAuthAuditEvent,
) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;
    let occurred_at = sqlx::query_scalar::<_, DateTime<Utc>>(
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
        VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)
        RETURNING occurred_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(audit_event.facility_id)
    .bind(audit_event.request_id.as_deref())
    .bind(&audit_event.event_type)
    .bind(&audit_event.resource_type)
    .bind(audit_event.resource_id)
    .bind(&audit_event.metadata)
    .fetch_one(&mut *transaction)
    .await?;

    let resource_key = audit_event
        .resource_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| "none".to_owned());

    sqlx::query(
        r#"
        INSERT INTO auth_login_failure_counters (
            facility_id,
            resource_type,
            resource_key,
            window_started_at,
            failure_count,
            burst_audited_at,
            last_failed_at
        )
        VALUES ($1, $2, $3, $4, 1, NULL, $4)
        ON CONFLICT (facility_id, resource_type, resource_key)
        DO UPDATE SET
            window_started_at = CASE
                WHEN auth_login_failure_counters.window_started_at >= EXCLUDED.last_failed_at - interval '15 minutes'
                    THEN auth_login_failure_counters.window_started_at
                ELSE EXCLUDED.window_started_at
            END,
            failure_count = CASE
                WHEN auth_login_failure_counters.window_started_at >= EXCLUDED.last_failed_at - interval '15 minutes'
                    THEN auth_login_failure_counters.failure_count + 1
                ELSE 1
            END,
            burst_audited_at = CASE
                WHEN auth_login_failure_counters.window_started_at >= EXCLUDED.last_failed_at - interval '15 minutes'
                    THEN auth_login_failure_counters.burst_audited_at
                ELSE NULL
            END,
            last_failed_at = EXCLUDED.last_failed_at,
            updated_at = now()
        "#,
    )
    .bind(audit_event.facility_id)
    .bind(&audit_event.resource_type)
    .bind(&resource_key)
    .bind(occurred_at)
    .execute(&mut *transaction)
    .await?;

    let burst_failure_count = sqlx::query_scalar::<_, i64>(
        r#"
        UPDATE auth_login_failure_counters
        SET burst_audited_at = $4,
            updated_at = now()
        WHERE facility_id = $1
          AND resource_type = $2
          AND resource_key = $3
          AND failure_count >= 5
          AND burst_audited_at IS NULL
        RETURNING failure_count
        "#,
    )
    .bind(audit_event.facility_id)
    .bind(&audit_event.resource_type)
    .bind(&resource_key)
    .bind(occurred_at)
    .fetch_optional(&mut *transaction)
    .await?;

    if let Some(failure_count) = burst_failure_count {
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
            SELECT $1,
                   $2,
                   NULL,
                   $3,
                   'auth.login_failure_burst.detected',
                   $4,
                   $5,
                   jsonb_build_object(
                       'severity', 'high',
                       'failure_count', $6,
                       'window_minutes', 15
                   )
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(audit_event.facility_id)
        .bind(audit_event.request_id.as_deref())
        .bind(&audit_event.resource_type)
        .bind(audit_event.resource_id)
        .bind(failure_count)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    Ok(())
}

fn insert_refresh_session_query<'q>(
    query: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    session: &'q NewRefreshSession,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    query
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
        .bind(session.session_started_at)
        .bind(session.idle_expires_at)
        .bind(session.absolute_expires_at)
        .bind(session.device_label.as_deref())
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
               session_started_at,
               idle_expires_at,
               absolute_expires_at,
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
               session_started_at,
               idle_expires_at,
               absolute_expires_at,
               session_id = $3 AS is_current
        FROM refresh_sessions
        WHERE facility_id = $1
          AND user_id = $2
          AND revoked_at IS NULL
          AND expires_at > now()
          AND idle_expires_at > now()
          AND absolute_expires_at > now()
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

async fn lock_auth_facility(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    facility: Uuid,
) -> anyhow::Result<bool> {
    Ok(
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM facilities WHERE id=$1 FOR SHARE")
            .bind(facility)
            .fetch_optional(&mut **transaction)
            .await?
            .is_some(),
    )
}

pub async fn revoke_user_session(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    session_id: Uuid,
    reason: &str,
) -> anyhow::Result<bool> {
    let mut transaction = pool.begin().await?;
    if !lock_auth_facility(&mut transaction, facility_id).await? {
        return Ok(false);
    }
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
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(result.rows_affected() == 1)
}

pub async fn revoke_other_user_sessions(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    current_session_id: Uuid,
    reason: &str,
) -> anyhow::Result<u64> {
    let mut transaction = pool.begin().await?;
    if !lock_auth_facility(&mut transaction, facility_id).await? {
        return Ok(0);
    }
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
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(result.rows_affected())
}

pub async fn revoke_refresh_session(
    pool: &PgPool,
    token_hash: &str,
    csrf_token_hash: &str,
    reason: &str,
) -> anyhow::Result<bool> {
    let Some(facility) = sqlx::query_scalar::<_, Uuid>(
        "SELECT facility_id FROM refresh_sessions WHERE token_hash=$1 AND csrf_token_hash=$2",
    )
    .bind(token_hash)
    .bind(csrf_token_hash)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(false);
    };
    let mut transaction = pool.begin().await?;
    if !lock_auth_facility(&mut transaction, facility).await? {
        return Ok(false);
    }
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
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(result.rows_affected() == 1)
}

pub async fn revoke_refresh_session_family(
    pool: &PgPool,
    session_family_id: Uuid,
    reason: &str,
) -> anyhow::Result<u64> {
    let Some(facility)=sqlx::query_scalar::<_,Uuid>("SELECT facility_id FROM refresh_sessions WHERE session_family_id=$1 ORDER BY session_id LIMIT 1").bind(session_family_id).fetch_optional(pool).await? else{return Ok(0)};
    let mut transaction = pool.begin().await?;
    if !lock_auth_facility(&mut transaction, facility).await? {
        return Ok(0);
    }
    let result = sqlx::query(
        r#"
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, now()),
            last_seen_at = now(),
            revoked_reason = COALESCE(revoked_reason, $2)
        WHERE session_family_id = $1
          AND facility_id=$3
        "#,
    )
    .bind(session_family_id)
    .bind(reason)
    .bind(facility)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(result.rows_affected())
}

pub async fn revoke_refresh_session_family_with_audit(
    pool: &PgPool,
    session_family_id: Uuid,
    reason: &str,
    audit_event: NewAuthAuditEvent,
) -> anyhow::Result<u64> {
    let mut transaction = pool.begin().await?;
    // Audited revocation must acquire its facility before session updates. A
    // feature/staff publisher may hold that facility and retire the same rows.
    if !lock_auth_facility(&mut transaction, audit_event.facility_id).await? {
        return Err(assurance::FactorError::AuthorizationExpired.into());
    }
    let revoked = sqlx::query_scalar::<_, i64>(
        r#"
        WITH revoked AS (
            UPDATE refresh_sessions
            SET revoked_at = now(),
                last_seen_at = now(),
                revoked_reason = $2
            WHERE session_family_id = $1
              AND facility_id = $4
              AND revoked_at IS NULL
            RETURNING 1
        ),
        audit AS (
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
            SELECT $3, $4, $5, $6, $7, $8, $9, $10
            RETURNING 1
        )
        SELECT count(*)::bigint FROM revoked
        "#,
    )
    .bind(session_family_id)
    .bind(reason)
    .bind(Uuid::new_v4())
    .bind(audit_event.facility_id)
    .bind(audit_event.actor_user_id)
    .bind(audit_event.request_id)
    .bind(audit_event.event_type)
    .bind(audit_event.resource_type)
    .bind(audit_event.resource_id)
    .bind(audit_event.metadata)
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(revoked as u64)
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
    expected_current_hash: &str,
    new_password_hash: &str,
) -> anyhow::Result<Option<UserAccount>> {
    change_user_password_inner(
        pool,
        facility_id,
        user_id,
        expected_current_hash,
        new_password_hash,
        None,
    )
    .await
}

pub async fn change_user_password_authorized(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    expected_current_hash: &str,
    new_password_hash: &str,
    authorization: WebAuthnActor,
) -> anyhow::Result<Option<UserAccount>> {
    change_user_password_inner(
        pool,
        facility_id,
        user_id,
        expected_current_hash,
        new_password_hash,
        Some(authorization),
    )
    .await
}

async fn change_user_password_inner(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    expected_current_hash: &str,
    new_password_hash: &str,
    mut authorization: Option<WebAuthnActor>,
) -> anyhow::Result<Option<UserAccount>> {
    let mut transaction = pool.begin().await?;
    if !lock_auth_facility(&mut transaction, facility_id).await? {
        if authorization.is_some() {
            return Err(assurance::FactorError::AuthorizationExpired.into());
        }
        return Ok(None);
    }
    let deadline = if let Some(actor) = authorization.as_mut() {
        Some(
            assurance::require_bound_session_tx(&mut transaction, actor, facility_id, user_id)
                .await?,
        )
    } else {
        None
    };
    let current_hash = sqlx::query_scalar::<_, String>(
        r#"
        SELECT password_hash
        FROM users
        WHERE id = $1
          AND facility_id = $2
          AND is_active = TRUE
        FOR NO KEY UPDATE
        "#,
    )
    .bind(user_id)
    .bind(facility_id)
    .fetch_optional(&mut *transaction)
    .await?;

    let Some(current_hash) = current_hash else {
        return Ok(None);
    };
    if current_hash != expected_current_hash {
        return Ok(None);
    }

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
        "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
    )
    .bind(user_id)
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

    if let Some(end) = deadline {
        assurance::check_session_deadline_tx(&mut transaction, end).await?;
    }
    transaction.commit().await?;
    user_by_id(pool, user_id).await
}

pub async fn complete_password_reset(
    pool: &PgPool,
    token_hash: &str,
    user_id: Uuid,
    expected_current_hash: &str,
    new_password_hash: &str,
) -> anyhow::Result<bool> {
    let Some(facility) =
        sqlx::query_scalar::<_, Uuid>("SELECT facility_id FROM users WHERE id=$1 AND is_active")
            .bind(user_id)
            .fetch_optional(pool)
            .await?
    else {
        return Ok(false);
    };
    let mut transaction = pool.begin().await?;
    if !lock_auth_facility(&mut transaction, facility).await? {
        return Ok(false);
    }
    // Lock the account before individual token rows. Distinct emailed links
    // must race as one password change, without token/user lock inversion.
    let current_hash = sqlx::query_scalar::<_, String>(
        "SELECT password_hash FROM users WHERE id = $1 AND facility_id=$2 AND is_active = TRUE FOR NO KEY UPDATE",
    )
    .bind(user_id)
    .bind(facility)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(current_hash) = current_hash else {
        return Ok(false);
    };
    if current_hash != expected_current_hash {
        return Ok(false);
    }
    let token = sqlx::query_as::<_, (Uuid, DateTime<Utc>)>(
        r#"
        SELECT user_id,expires_at
        FROM password_reset_tokens
        WHERE token_hash = $1
          AND user_id = $2
          AND facility_id=$3
          AND used_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(token_hash)
    .bind(user_id)
    .bind(facility)
    .fetch_optional(&mut *transaction)
    .await?;

    let Some((token_user_id, expires)) = token else {
        return Ok(false);
    };
    if token_user_id != user_id
        || !sqlx::query_scalar::<_, bool>("SELECT clock_timestamp()<$1")
            .bind(expires)
            .fetch_one(&mut *transaction)
            .await?
    {
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
        WHERE user_id = $1 AND used_at IS NULL
        "#,
    )
    .bind(user_id)
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
    .bind(current_hash)
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

    if !sqlx::query_scalar::<_, bool>("SELECT clock_timestamp()<$1")
        .bind(expires)
        .fetch_one(&mut *transaction)
        .await?
    {
        return Ok(false);
    }
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
              AND patients.record_status = 'registered'
              AND patients.vital_status <> 'deceased'
        ) OR EXISTS (
            SELECT 1
            FROM clinical_notes
            JOIN patients ON patients.id = clinical_notes.patient_id
            WHERE clinical_notes.facility_id = $1
              AND clinical_notes.created_by_user_id = $2
              AND clinical_notes.patient_id = $3
              AND patients.facility_id = $1
              AND patients.record_status = 'registered'
              AND patients.vital_status <> 'deceased'
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

/// Current actor's minimal grant projection. The patient existence check stays
/// facility-scoped and does not load identity or clinical fields.
pub async fn current_break_glass_status_for_patient(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    patient_id: Uuid,
    now: DateTime<Utc>,
) -> anyhow::Result<Option<CurrentBreakGlassStatus>> {
    let row = sqlx::query_as::<_, (Option<Uuid>, Option<DateTime<Utc>>)>(
        r#"
        SELECT active_grant.id, active_grant.expires_at
        FROM patients patient
        LEFT JOIN LATERAL (
            SELECT grants.id, grants.expires_at
            FROM patient_break_glass_grants grants
            WHERE grants.facility_id = patient.facility_id
              AND grants.patient_id = patient.id
              AND grants.user_id = $2
              AND grants.ended_at IS NULL
              AND grants.started_at <= $4
              AND grants.expires_at > $4
            ORDER BY grants.started_at DESC, grants.id DESC
            LIMIT 1
        ) active_grant ON TRUE
        WHERE patient.facility_id = $1 AND patient.id = $3
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .bind(patient_id)
    .bind(now)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id, expires_at)| CurrentBreakGlassStatus {
        grant: id
            .zip(expires_at)
            .map(|(id, expires_at)| BreakGlassGrantSummary { id, expires_at }),
    }))
}

pub async fn start_break_glass_grant(
    pool: &PgPool,
    command: StartBreakGlassGrant,
) -> anyhow::Result<BreakGlassGrantOutcome> {
    start_break_glass_grant_inner(pool, command, None).await
}

pub async fn start_break_glass_grant_authorized(
    pool: &PgPool,
    command: StartBreakGlassGrant,
    authorization: crate::auth::WebAuthnActor,
) -> anyhow::Result<BreakGlassGrantOutcome> {
    start_break_glass_grant_inner(pool, command, Some(authorization)).await
}

async fn start_break_glass_grant_inner(
    pool: &PgPool,
    command: StartBreakGlassGrant,
    authorization: Option<crate::auth::WebAuthnActor>,
) -> anyhow::Result<BreakGlassGrantOutcome> {
    let mut transaction = pool.begin().await?;
    // Quota serialization precedes the shared factor proof: concurrent starts
    // must not both hold SHARE and then attempt to upgrade the same actor.
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR SHARE")
        .bind(command.facility_id)
        .fetch_one(&mut *transaction)
        .await?;
    // Same actor's start/end operations share this lock order. NO KEY UPDATE
    // permits audit/FK KEY SHARE locks while serializing quota decisions.
    let actor = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE id = $1 AND facility_id = $2 FOR NO KEY UPDATE",
    )
    .bind(command.user_id)
    .bind(command.facility_id)
    .fetch_optional(&mut *transaction)
    .await?;
    if actor.is_none() {
        anyhow::bail!("break-glass actor was not found in this facility");
    }
    let privileged_deadline = if let Some(mut actor) = authorization {
        Some(
            crate::auth::assurance::require_family_privileged_tx(
                &mut transaction,
                &mut actor,
                command.facility_id,
                command.user_id,
                hms_domain::deployment::PermissionCode::PatientBreakGlassInvoke,
                hms_domain::deployment::FeatureKey::Patients,
            )
            .await?,
        )
    } else {
        None
    };
    if !reauth_is_fresh(command.reauth_verified_at, command.now) {
        return deny_break_glass_grant(
            transaction,
            &command,
            BreakGlassGrantDenialReason::ReauthRequired,
        )
        .await;
    }

    let has_permission = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM users
            JOIN effective_user_permissions AS user_permissions ON user_permissions.user_id = users.id
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
    .fetch_one(&mut *transaction)
    .await?;
    if !has_permission {
        return deny_break_glass_grant(
            transaction,
            &command,
            BreakGlassGrantDenialReason::MissingDedicatedPermission,
        )
        .await;
    }

    let active_patient = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id
        FROM patients
        WHERE id = $1
          AND facility_id = $2
          AND record_status = 'registered'
          AND vital_status <> 'deceased'
        FOR SHARE
        "#,
    )
    .bind(command.patient_id)
    .bind(command.facility_id)
    .fetch_optional(&mut *transaction)
    .await?;
    if active_patient.is_none() {
        return deny_break_glass_grant(
            transaction,
            &command,
            BreakGlassGrantDenialReason::PatientNotActive,
        )
        .await;
    }

    // Count every unexpired open grant, including one started by a competing
    // request with a later pre-lock timestamp. Otherwise an older waiter could
    // mistake that committed grant for a future grant and bypass the limits.
    let (active_count, same_patient) = sqlx::query_as::<_, (i64, bool)>(
        r#"
        SELECT count(*), COALESCE(bool_or(patient_id = $3), FALSE)
        FROM patient_break_glass_grants
        WHERE facility_id = $1 AND user_id = $2 AND ended_at IS NULL
          AND expires_at > $4
        "#,
    )
    .bind(command.facility_id)
    .bind(command.user_id)
    .bind(command.patient_id)
    .bind(command.now)
    .fetch_one(&mut *transaction)
    .await?;
    if same_patient {
        return deny_break_glass_grant(
            transaction,
            &command,
            BreakGlassGrantDenialReason::ActiveGrantAlreadyExists,
        )
        .await;
    }

    if active_count >= BREAK_GLASS_MAX_ACTIVE_GRANTS_PER_USER {
        return deny_break_glass_grant(
            transaction,
            &command,
            BreakGlassGrantDenialReason::TooManyActiveGrants,
        )
        .await;
    }

    let reason_text = command
        .reason_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let expires_at = command.now + Duration::hours(BREAK_GLASS_GRANT_TTL_HOURS);
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
    if let Some(end) = privileged_deadline {
        crate::auth::assurance::check_privileged_deadline_tx(&mut transaction, end).await?;
    }
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
    // Match start and facility-entitlement publication order. Ending a grant
    // remains an attenuation command and does not require a fresh factor.
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR SHARE")
        .bind(command.facility_id)
        .fetch_one(&mut *transaction)
        .await?;
    sqlx::query("SELECT id FROM users WHERE id = $1 AND facility_id = $2 FOR NO KEY UPDATE")
        .bind(command.user_id)
        .bind(command.facility_id)
        .fetch_optional(&mut *transaction)
        .await?;
    let result = sqlx::query(
        r#"
        UPDATE patient_break_glass_grants
        SET ended_at = GREATEST($5, started_at),
            ended_by_user_id = $4
        WHERE facility_id = $1
          AND user_id = $2
          AND patient_id = $3
          AND ended_at IS NULL
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

pub async fn audit_break_glass_chronicle_view_once(
    pool: &PgPool,
    command: AuditBreakGlassChronicleView,
) -> anyhow::Result<bool> {
    let mut transaction = pool.begin().await?;
    let audited_grant = sqlx::query_scalar::<_, Uuid>(
        r#"
        UPDATE patient_break_glass_grants
        SET chronicle_view_audited_at = $5
        WHERE id = $1
          AND facility_id = $2
          AND user_id = $3
          AND patient_id = $4
          AND ended_at IS NULL
          AND started_at <= $5
          AND expires_at > $5
          AND chronicle_view_audited_at IS NULL
        RETURNING id
        "#,
    )
    .bind(command.grant_id)
    .bind(command.facility_id)
    .bind(command.user_id)
    .bind(command.patient_id)
    .bind(command.now)
    .fetch_optional(&mut *transaction)
    .await?;

    if audited_grant.is_some() {
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(command.facility_id)
        .bind(command.user_id)
        .bind(command.request_id.as_deref())
        .bind("patient.chronicle.outside_assignment_viewed")
        .bind("patient_chronicle")
        .bind(command.patient_id)
        .bind(serde_json::json!({
            "severity": "high",
            "break_glass_grant_id": command.grant_id,
            "access_source": "break_glass",
            "access_reason": "break_glass_emergency"
        }))
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        return Ok(true);
    }

    let grant_is_active = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM patient_break_glass_grants
            WHERE id = $1
              AND facility_id = $2
              AND user_id = $3
              AND patient_id = $4
              AND ended_at IS NULL
              AND started_at <= $5
              AND expires_at > $5
        )
        "#,
    )
    .bind(command.grant_id)
    .bind(command.facility_id)
    .bind(command.user_id)
    .bind(command.patient_id)
    .bind(command.now)
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(grant_is_active)
}

async fn deny_break_glass_grant(
    mut transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    command: &StartBreakGlassGrant,
    reason: BreakGlassGrantDenialReason,
) -> anyhow::Result<BreakGlassGrantOutcome> {
    let category = codec::encode(command.category)?;
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
        VALUES ($1, $2, $3, $4, 'patient.break_glass.denied', 'patient', $5, $6)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(command.facility_id)
    .bind(command.user_id)
    .bind(command.request_id.as_deref())
    .bind(command.patient_id)
    .bind(serde_json::json!({
        "severity": "high",
        "category": category,
        "denial_reason": reason
    }))
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(BreakGlassGrantOutcome::Denied(reason))
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
        auth_security: {
            let mut security = AuthSecurityState::from_permissions(
                &permissions,
                row.passkey_enrolled,
                row.recovery_codes_remaining,
            );
            security.factor_version = row.auth_factor_version;
            security
        },
        password_hash: row.password_hash,
    }))
}

fn hydrate_session_user(row: Option<SessionUserRow>) -> anyhow::Result<Option<SessionUserAccount>> {
    let Some(row) = row else {
        return Ok(None);
    };

    let session_expires_at = row.session_expires_at;
    let user = hydrate_user(Some(UserRow {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        facility_id: row.facility_id,
        facility_code: row.facility_code,
        active_profile: row.active_profile,
        session_version: row.session_version,
        permission_version: row.permission_version,
        password_change_required: row.password_change_required,
        password_hash: row.password_hash,
        permission_codes: row.permission_codes,
        feature_keys: row.feature_keys,
        visibility_codes: row.visibility_codes,
        passkey_enrolled: row.passkey_enrolled,
        recovery_codes_remaining: row.recovery_codes_remaining,
        auth_factor_version: row.auth_factor_version,
    }))?
    .expect("session row hydrates to a user");

    Ok(Some(SessionUserAccount {
        user,
        session_expires_at,
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
            auth_security: {
                let mut security = AuthSecurityState::from_permissions(
                    &permissions,
                    row.passkey_enrolled,
                    row.recovery_codes_remaining,
                );
                security.factor_version = row.auth_factor_version;
                security.assurance_version = row.assurance_version;
                security.session_assurance = serde_json::from_value(row.session_assurance)?;
                security.privileged_actions_allowed = !security.passkey_required
                    || security.session_assurance.is_fresh_passkey_at(Utc::now());
                security
            },
        },
        feature_flags: crate::admin::effective_feature_flags_from_rows(
            feature_rows,
            fallback_profile,
        )?,
        active_authorities: crate::admin::active_authorities_from_rows(authority_rows)?,
        feature_entitlements_updated_at: row.feature_entitlements_updated_at,
        session_expires_at: row.session_expires_at,
        cache_expires_at: row.factor_expires_at.map_or(row.session_expires_at, |end| {
            end.min(row.session_expires_at)
        }),
        password_verified_at: row.password_verified_at,
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
                record_status: None,
                vital_status: None,
                superseded_by_patient_id: None,
                status_reason_code: None,
                status_reason_note: None,
                actor_user_id: db.owner_user_id(),
                request_id: Some("inactive-patient-test".to_owned()),
            },
        )
        .await
        .expect("patient can be marked inactive");
        assert_eq!(
            start_break_glass_grant(db.pool(), start_command(&db, patient.id, now))
                .await
                .expect("restricted patient record evaluates"),
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
                    created_by_user_id: db.owner_user_id(),
                    request_id: None,
                    patient_code: format!("P-BG-CAP-{index}"),
                    first_name: format!("Grant{index}"),
                    last_name: "Patient".to_owned(),
                    date_of_birth: chrono::NaiveDate::from_ymd_opt(1990, 1, 1)
                        .expect("static date is valid"),
                    sex: Sex::Female,
                    duplicate_override: None,
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

    #[tokio::test]
    async fn break_glass_concurrent_distinct_patients_cannot_exceed_actor_cap() {
        let db = crate::test_support::TestDb::hospital()
            .await
            .expect("test db starts");
        grant_break_glass_permission(&db).await;
        let now = Utc::now();
        let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(6));
        let mut tasks = Vec::new();
        for index in 0..6 {
            let patient = db
                .scenario(format!("break_glass_concurrent_cap_{index}"))
                .registered_patient()
                .await
                .expect("patient creates");
            let command = start_command(&db, patient.id, now);
            let pool = db.pool().clone();
            let barrier = barrier.clone();
            tasks.push(tokio::spawn(async move {
                barrier.wait().await;
                start_break_glass_grant(&pool, command)
                    .await
                    .expect("concurrent start evaluates")
            }));
        }
        let mut granted = 0;
        let mut denied = 0;
        for task in tasks {
            match task.await.expect("start task joins") {
                BreakGlassGrantOutcome::Granted(_) => granted += 1,
                BreakGlassGrantOutcome::Denied(
                    BreakGlassGrantDenialReason::TooManyActiveGrants,
                ) => denied += 1,
                other => panic!("unexpected concurrency outcome {other:?}"),
            }
        }
        assert_eq!((granted, denied), (3, 3));
        let persisted: i64 = sqlx::query_scalar("SELECT count(*) FROM patient_break_glass_grants WHERE facility_id = $1 AND user_id = $2 AND ended_at IS NULL")
            .bind(db.facility_id()).bind(db.owner_user_id()).fetch_one(db.pool()).await.unwrap();
        assert_eq!(persisted, 3);
        let audit: (i64, i64) = sqlx::query_as("SELECT count(*) FILTER (WHERE event_type = 'patient.break_glass.started'), count(*) FILTER (WHERE event_type = 'patient.break_glass.denied') FROM audit_events WHERE facility_id = $1 AND actor_user_id = $2")
            .bind(db.facility_id()).bind(db.owner_user_id()).fetch_one(db.pool()).await.unwrap();
        assert_eq!(audit, (3, 3));
    }

    #[tokio::test]
    async fn break_glass_concurrent_same_patient_creates_once_without_extending_expiry() {
        let db = crate::test_support::TestDb::hospital()
            .await
            .expect("test db starts");
        grant_break_glass_permission(&db).await;
        let patient = db
            .scenario("break_glass_concurrent_same")
            .registered_patient()
            .await
            .unwrap();
        let now = Utc::now();
        let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(8));
        let mut tasks = Vec::new();
        for index in 0..8 {
            let command = start_command(&db, patient.id, now + Duration::milliseconds(index));
            let pool = db.pool().clone();
            let barrier = barrier.clone();
            tasks.push(tokio::spawn(async move {
                barrier.wait().await;
                start_break_glass_grant(&pool, command)
                    .await
                    .expect("concurrent start evaluates")
            }));
        }
        let mut winner = None;
        let mut denied = 0;
        for task in tasks {
            match task.await.expect("start task joins") {
                BreakGlassGrantOutcome::Granted(grant) => {
                    assert!(winner.replace(grant).is_none(), "only one grant may win");
                }
                BreakGlassGrantOutcome::Denied(
                    BreakGlassGrantDenialReason::ActiveGrantAlreadyExists,
                ) => denied += 1,
                other => panic!("unexpected concurrency outcome {other:?}"),
            }
        }
        let winner = winner.expect("one request granted");
        assert_eq!(denied, 7);
        let persisted: (i64, DateTime<Utc>, DateTime<Utc>) = sqlx::query_as("SELECT count(*) OVER(), started_at, expires_at FROM patient_break_glass_grants WHERE facility_id = $1 AND user_id = $2 AND patient_id = $3")
            .bind(db.facility_id()).bind(db.owner_user_id()).bind(patient.id).fetch_one(db.pool()).await.unwrap();
        assert_eq!(persisted, (1, winner.started_at, winner.expires_at));
        assert_eq!(winner.expires_at - winner.started_at, Duration::hours(2));
        let audit: (i64, i64) = sqlx::query_as("SELECT count(*) FILTER (WHERE event_type = 'patient.break_glass.started'), count(*) FILTER (WHERE event_type = 'patient.break_glass.denied') FROM audit_events WHERE facility_id = $1 AND actor_user_id = $2 AND resource_id = $3")
            .bind(db.facility_id()).bind(db.owner_user_id()).bind(patient.id).fetch_one(db.pool()).await.unwrap();
        assert_eq!(audit, (1, 7));
    }

    #[tokio::test]
    async fn break_glass_audit_failure_rolls_back_grant_insert() {
        let db = crate::test_support::TestDb::hospital()
            .await
            .expect("test db starts");
        grant_break_glass_permission(&db).await;
        let patient = db
            .scenario("break_glass_audit_rollback")
            .registered_patient()
            .await
            .unwrap();
        sqlx::query("CREATE FUNCTION reject_break_glass_start_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'patient.break_glass.started' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$")
            .execute(db.pool()).await.unwrap();
        sqlx::query("CREATE TRIGGER reject_break_glass_start_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_break_glass_start_audit()")
            .execute(db.pool()).await.unwrap();
        assert!(
            start_break_glass_grant(db.pool(), start_command(&db, patient.id, Utc::now()))
                .await
                .is_err()
        );
        let grants: i64 = sqlx::query_scalar("SELECT count(*) FROM patient_break_glass_grants WHERE facility_id = $1 AND user_id = $2 AND patient_id = $3")
            .bind(db.facility_id()).bind(db.owner_user_id()).bind(patient.id).fetch_one(db.pool()).await.unwrap();
        let audits: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE facility_id = $1 AND actor_user_id = $2 AND resource_id = $3 AND event_type LIKE 'patient.break_glass.%'")
            .bind(db.facility_id()).bind(db.owner_user_id()).bind(patient.id).fetch_one(db.pool()).await.unwrap();
        assert_eq!((grants, audits), (0, 0));
    }

    #[tokio::test]
    async fn break_glass_end_with_older_request_timestamp_still_ends_serialized_grant() {
        let db = crate::test_support::TestDb::hospital()
            .await
            .expect("test db starts");
        grant_break_glass_permission(&db).await;
        let patient = db
            .scenario("break_glass_end_waiter")
            .registered_patient()
            .await
            .unwrap();
        let earlier = Utc::now();
        let later = earlier + Duration::milliseconds(1);
        let granted = start_break_glass_grant(db.pool(), start_command(&db, patient.id, later))
            .await
            .unwrap();
        let BreakGlassGrantOutcome::Granted(grant) = granted else {
            panic!("grant expected");
        };
        let ended = end_break_glass_grants(
            db.pool(),
            EndBreakGlassGrants {
                facility_id: db.facility_id(),
                user_id: db.owner_user_id(),
                patient_id: patient.id,
                ended_by_user_id: db.owner_user_id(),
                request_id: None,
                now: earlier,
            },
        )
        .await
        .unwrap();
        assert_eq!(ended, 1);
        let saved: (DateTime<Utc>, DateTime<Utc>) = sqlx::query_as(
            "SELECT ended_at, expires_at FROM patient_break_glass_grants WHERE id = $1",
        )
        .bind(grant.id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(saved.0, grant.started_at);
        assert_eq!(saved.1, grant.expires_at);
        assert!(active_break_glass_grant_for_patient(
            db.pool(),
            db.facility_id(),
            db.owner_user_id(),
            patient.id,
            later
        )
        .await
        .unwrap()
        .is_none());
    }
}
