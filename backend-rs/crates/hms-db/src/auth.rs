use chrono::{DateTime, Utc};
use hms_domain::auth::{AuthUser, PatientDataVisibility};
use hms_domain::deployment::{DeploymentProfile, FeatureKey, PermissionCode};
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
        }
    }
}

pub async fn user_by_id(pool: &PgPool, user_id: Uuid) -> anyhow::Result<Option<UserAccount>> {
    let row = sqlx::query_as::<_, UserRow>(
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
               users.password_hash
        FROM users
        JOIN facilities ON facilities.id = users.facility_id
        WHERE users.id = $1 AND users.is_active = TRUE
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    hydrate_user(pool, row).await
}

pub async fn user_by_email_and_facility(
    pool: &PgPool,
    email: &str,
    facility_code: &str,
) -> anyhow::Result<Option<UserAccount>> {
    let row = sqlx::query_as::<_, UserRow>(
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
               users.password_hash
        FROM users
        JOIN facilities ON facilities.id = users.facility_id
        WHERE lower(users.email) = lower($1)
          AND lower(facilities.code) = lower($2)
          AND users.is_active = TRUE
          AND facilities.is_active = TRUE
        "#,
    )
    .bind(email.trim())
    .bind(facility_code.trim())
    .fetch_optional(pool)
    .await?;

    hydrate_user(pool, row).await
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
            expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
               revoked_at
        FROM refresh_sessions
        WHERE token_hash = $1
        "#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?)
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

async fn hydrate_user(pool: &PgPool, row: Option<UserRow>) -> anyhow::Result<Option<UserAccount>> {
    let Some(row) = row else {
        return Ok(None);
    };

    let permission_codes = sqlx::query_scalar::<_, String>(
        "SELECT permission_code FROM user_permissions WHERE user_id = $1 ORDER BY permission_code",
    )
    .bind(row.id)
    .fetch_all(pool)
    .await?;
    let feature_keys = sqlx::query_scalar::<_, String>(
        "SELECT feature_key FROM user_features WHERE user_id = $1 ORDER BY feature_key",
    )
    .bind(row.id)
    .fetch_all(pool)
    .await?;
    let visibility_codes = sqlx::query_scalar::<_, String>(
        "SELECT visibility FROM user_patient_visibility WHERE user_id = $1 ORDER BY visibility",
    )
    .bind(row.id)
    .fetch_all(pool)
    .await?;

    Ok(Some(UserAccount {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        facility_id: row.facility_id,
        facility_code: row.facility_code,
        active_profile: codec::decode(&row.active_profile)?,
        permissions: permission_codes
            .iter()
            .map(|value| codec::decode(value))
            .collect::<anyhow::Result<_>>()?,
        features: feature_keys
            .iter()
            .map(|value| codec::decode(value))
            .collect::<anyhow::Result<_>>()?,
        patient_visibility: visibility_codes
            .iter()
            .map(|value| codec::decode(value))
            .collect::<anyhow::Result<_>>()?,
        session_version: row.session_version,
        permission_version: row.permission_version,
        password_change_required: row.password_change_required,
        password_hash: row.password_hash,
    }))
}
