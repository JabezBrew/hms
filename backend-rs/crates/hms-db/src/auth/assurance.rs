//! Durable exact-session factor proof and restricted, hashed pre-login grants.
//! Crypto is performed by the API's pure verifier while the bounded ceremony
//! owns this transaction. No HTTP or other external I/O belongs in this module.
use super::*;
use hms_domain::auth_assurance::*;
use sqlx::{Postgres, Transaction};
type Tx<'a> = Transaction<'a, Postgres>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FactorError {
    InvalidGrant,
    InvalidChallenge,
    AuthorizationExpired,
    ManagementRequired,
    CredentialLimit,
    IssueLimit,
    PasswordConfirmationRequired,
    FactorRequired,
    LastCredential,
    NotFound,
    InvalidInput,
}
impl std::fmt::Display for FactorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Authentication proof could not be confirmed.")
    }
}
impl std::error::Error for FactorError {}

/// Independent cutoffs retained until the final protected commit. Expiring a
/// factor does not imply that the ordinary session or password has expired.
#[derive(Clone, Copy)]
pub struct PrivilegedDeadline {
    authority: DateTime<Utc>,
    password: DateTime<Utc>,
    factor: DateTime<Utc>,
}
impl PrivilegedDeadline {
    pub fn expires_at(self) -> DateTime<Utc> {
        self.authority.min(self.password).min(self.factor)
    }
    fn check_at(self, at: DateTime<Utc>) -> Result<(), FactorError> {
        if at >= self.authority {
            return Err(FactorError::AuthorizationExpired);
        }
        if at >= self.password {
            return Err(FactorError::PasswordConfirmationRequired);
        }
        if at >= self.factor {
            return Err(FactorError::FactorRequired);
        }
        Ok(())
    }
}

#[derive(FromRow)]
struct Identity {
    session_version: i64,
    permission_version: i64,
    auth_factor_version: i64,
    profile: String,
    password_hash: String,
}
async fn identity(tx: &mut Tx<'_>, facility: Uuid, user: Uuid) -> anyhow::Result<Identity> {
    identity_locked(tx, facility, user, true).await
}
async fn identity_locked(
    tx: &mut Tx<'_>,
    facility: Uuid,
    user: Uuid,
    mutating: bool,
) -> anyhow::Result<Identity> {
    let profile: Option<String> = sqlx::query_scalar(
        "SELECT deployment_profile FROM facilities WHERE id=$1 AND is_active FOR SHARE",
    )
    .bind(facility)
    .fetch_optional(&mut **tx)
    .await?;
    let statement = if mutating {
        "SELECT session_version,permission_version,auth_factor_version,password_hash FROM users WHERE facility_id=$1 AND id=$2 AND is_active FOR NO KEY UPDATE"
    } else {
        "SELECT session_version,permission_version,auth_factor_version,password_hash FROM users WHERE facility_id=$1 AND id=$2 AND is_active FOR SHARE"
    };
    let (session_version, permission_version, auth_factor_version, password_hash): (
        i64,
        i64,
        i64,
        String,
    ) = sqlx::query_as(statement)
        .bind(facility)
        .bind(user)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(FactorError::AuthorizationExpired)?;
    Ok(Identity {
        session_version,
        permission_version,
        auth_factor_version,
        profile: profile.ok_or(FactorError::AuthorizationExpired)?,
        password_hash,
    })
}
async fn deadline(tx: &mut Tx<'_>, end: DateTime<Utc>) -> anyhow::Result<()> {
    if !sqlx::query_scalar::<_, bool>("SELECT clock_timestamp()<$1")
        .bind(end)
        .fetch_one(&mut **tx)
        .await?
    {
        return Err(FactorError::AuthorizationExpired.into());
    }
    Ok(())
}
async fn now(tx: &mut Tx<'_>) -> anyhow::Result<DateTime<Utc>> {
    Ok(sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut **tx)
        .await?)
}
async fn audit(
    tx: &mut Tx<'_>,
    facility: Uuid,
    user: Uuid,
    request: Option<&str>,
    event: &str,
    resource: Uuid,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,$4,'auth_factor',$5,'{}'::jsonb)").bind(facility).bind(user).bind(request).bind(event).bind(resource).execute(&mut **tx).await?;
    Ok(())
}
async fn session_created(
    tx: &mut Tx<'_>,
    session: &NewRefreshSession,
    request: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,'auth.login.created','auth_session',$4,'{}'::jsonb)").bind(session.facility_id).bind(session.user_id).bind(request).bind(session.session_id).execute(&mut **tx).await?;
    Ok(())
}
pub async fn bounded_credentials(
    tx: &mut Tx<'_>,
    facility: Uuid,
    user: Uuid,
) -> anyhow::Result<Vec<WebAuthnCredentialRow>> {
    let rows=sqlx::query_as("SELECT id,credential_id,passkey,label,created_at,last_used_at FROM auth_webauthn_credentials WHERE facility_id=$1 AND user_id=$2 AND disabled_at IS NULL ORDER BY id LIMIT 11 FOR UPDATE").bind(facility).bind(user).fetch_all(&mut **tx).await?;
    if rows.len() > MAX_ACTIVE_PASSKEYS as usize
        || rows.iter().any(|row: &WebAuthnCredentialRow| {
            !hms_auth::passkey_record_is_structurally_valid(&row.credential_id, &row.passkey)
        })
    {
        return Err(FactorError::ManagementRequired.into());
    }
    Ok(rows)
}
async fn issue(tx: &mut Tx<'_>, facility: Uuid, user: Uuid, purpose: &str) -> anyhow::Result<()> {
    let admitted:Option<i64>=sqlx::query_scalar("INSERT INTO auth_factor_issue_budgets(facility_id,user_id,purpose,window_started_at,issued) VALUES($1,$2,$3,clock_timestamp(),1) ON CONFLICT(facility_id,user_id,purpose) DO UPDATE SET window_started_at=CASE WHEN auth_factor_issue_budgets.window_started_at<=clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE auth_factor_issue_budgets.window_started_at END, issued=CASE WHEN auth_factor_issue_budgets.window_started_at<=clock_timestamp()-interval '15 minutes' THEN 1 ELSE auth_factor_issue_budgets.issued+1 END WHERE auth_factor_issue_budgets.window_started_at<=clock_timestamp()-interval '15 minutes' OR auth_factor_issue_budgets.issued<10 RETURNING issued").bind(facility).bind(user).bind(purpose).fetch_optional(&mut **tx).await?;
    if admitted.is_none() {
        return Err(FactorError::IssueLimit.into());
    }
    Ok(())
}

#[derive(FromRow)]
pub struct LoginGrant {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub session_version: i64,
    pub permission_version: i64,
    pub factor_version: i64,
    pub active_profile: String,
    pub password_verified_at: DateTime<Utc>,
    pub device_label: Option<String>,
    pub state: String,
    pub expires_at: DateTime<Utc>,
    pub failed_attempts: i16,
    pub consumed_at: Option<DateTime<Utc>>,
}
const GRANT:&str="SELECT id,facility_id,user_id,session_version,permission_version,factor_version,active_profile,password_verified_at,device_label,state,expires_at,failed_attempts,consumed_at FROM auth_login_grants";
pub async fn create_login_grant(
    pool: &PgPool,
    user: &UserAccount,
    token_hash: &str,
    device: Option<&str>,
    password_at: DateTime<Utc>,
) -> anyhow::Result<LoginGrant> {
    let mut tx = pool.begin().await?;
    let current = identity(&mut tx, user.facility_id, user.id).await?;
    if current.password_hash != user.password_hash
        || current.session_version != user.session_version
        || current.permission_version != user.permission_version
        || current.profile != codec::encode(user.active_profile)?
    {
        return Err(FactorError::AuthorizationExpired.into());
    }
    let credentials = bounded_credentials(&mut tx, user.facility_id, user.id).await?;
    issue(&mut tx, user.facility_id, user.id, "login_grant").await?;
    // This statement starts after the actor lock wait. Its stable cutoff lets
    // the expiry index skip retained history; a threshold needs at most 3 rows.
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM (SELECT 1 FROM auth_login_grants WHERE facility_id=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>statement_timestamp() LIMIT 3) pending").bind(user.facility_id).bind(user.id).fetch_one(&mut *tx).await?;
    if count >= 3 {
        return Err(FactorError::IssueLimit.into());
    }
    let id = Uuid::new_v4();
    let at = now(&mut tx).await?;
    if password_at > at {
        return Err(FactorError::AuthorizationExpired.into());
    }
    deadline(&mut tx, password_at + Duration::minutes(5)).await?;
    sqlx::query("INSERT INTO auth_login_grants(id,token_hash,facility_id,user_id,session_version,permission_version,factor_version,active_profile,password_verified_at,device_label,state,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)").bind(id).bind(token_hash).bind(user.facility_id).bind(user.id).bind(current.session_version).bind(current.permission_version).bind(current.auth_factor_version).bind(&current.profile).bind(password_at).bind(device).bind(if credentials.is_empty(){"setup"}else{"factor"}).bind(at).bind(password_at+Duration::minutes(5)).execute(&mut *tx).await?;
    let grant = sqlx::query_as(&format!("{GRANT} WHERE id=$1"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(grant)
}
pub async fn login_grant(pool: &PgPool, hash: &str) -> anyhow::Result<LoginGrant> {
    sqlx::query_as(&format!("{GRANT} WHERE token_hash=$1"))
        .bind(hash)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| FactorError::InvalidGrant.into())
}
async fn lock_grant(
    tx: &mut Tx<'_>,
    hash: &str,
    expected: &LoginGrant,
) -> anyhow::Result<LoginGrant> {
    let current = identity(tx, expected.facility_id, expected.user_id).await?;
    let grant: LoginGrant = sqlx::query_as(&format!("{GRANT} WHERE token_hash=$1 FOR UPDATE"))
        .bind(hash)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(FactorError::InvalidGrant)?;
    if grant.id != expected.id
        || grant.consumed_at.is_some()
        || grant.failed_attempts >= 10
        || grant.session_version != current.session_version
        || grant.permission_version != current.permission_version
        || grant.active_profile != current.profile
        || grant.factor_version != current.auth_factor_version
    {
        return Err(FactorError::InvalidGrant.into());
    }
    deadline(tx, grant.expires_at).await?;
    Ok(grant)
}
pub async fn issue_bootstrap_grant(
    pool: &PgPool,
    facility: Uuid,
    user: Uuid,
    hash: &str,
) -> anyhow::Result<DateTime<Utc>> {
    let mut tx = pool.begin().await?;
    identity(&mut tx, facility, user).await?;
    if !bounded_credentials(&mut tx, facility, user)
        .await?
        .is_empty()
    {
        return Err(FactorError::FactorRequired.into());
    }
    sqlx::query("UPDATE auth_factor_bootstrap_grants SET consumed_at=clock_timestamp() WHERE facility_id=$1 AND user_id=$2 AND consumed_at IS NULL").bind(facility).bind(user).execute(&mut *tx).await?;
    let id = Uuid::new_v4();
    let end = now(&mut tx).await? + Duration::minutes(15);
    sqlx::query("INSERT INTO auth_factor_bootstrap_grants(id,token_hash,facility_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5)").bind(id).bind(hash).bind(facility).bind(user).bind(end).execute(&mut *tx).await?;
    audit(
        &mut tx,
        facility,
        user,
        None,
        "auth.factor.bootstrap.issued",
        id,
    )
    .await?;
    tx.commit().await?;
    Ok(end)
}

pub struct FactorOptions {
    tx: Tx<'static>,
    grant: Option<LoginGrant>,
    actor: Option<WebAuthnActor>,
    credentials: Vec<WebAuthnCredentialRow>,
    purpose: &'static str,
    bootstrap: Option<Uuid>,
    password_confirmation_at: Option<DateTime<Utc>>,
    end: DateTime<Utc>,
}
impl FactorOptions {
    pub fn credentials(&self) -> &[WebAuthnCredentialRow] {
        &self.credentials
    }
    pub fn user_id(&self) -> Uuid {
        self.grant
            .as_ref()
            .map(|g| g.user_id)
            .unwrap_or_else(|| self.actor.as_ref().unwrap().user_id)
    }
    pub async fn save(
        mut self,
        id: Uuid,
        state: Value,
        expires: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        let (facility, user, sv, pv, fv, profile, grant, session) = if let Some(g) = &self.grant {
            (
                g.facility_id,
                g.user_id,
                g.session_version,
                g.permission_version,
                g.factor_version,
                g.active_profile.clone(),
                Some(g.id),
                None,
            )
        } else {
            let a = self.actor.as_ref().unwrap();
            let fv: i64 = sqlx::query_scalar("SELECT auth_factor_version FROM users WHERE id=$1")
                .bind(a.user_id)
                .fetch_one(&mut *self.tx)
                .await?;
            (
                a.facility_id,
                a.user_id,
                a.session_version,
                a.permission_version,
                fv,
                codec::encode(a.active_profile)?,
                None,
                Some(a.session_id),
            )
        };
        let count:i64=sqlx::query_scalar("SELECT count(*) FROM (SELECT 1 FROM auth_factor_challenges WHERE facility_id=$1 AND user_id=$2 AND purpose=$3 AND consumed_at IS NULL AND expires_at>statement_timestamp() LIMIT 3) pending").bind(facility).bind(user).bind(self.purpose).fetch_one(&mut *self.tx).await?;
        if count >= MAX_PENDING_FACTOR_CHALLENGES {
            return Err(FactorError::IssueLimit.into());
        }
        issue(&mut self.tx, facility, user, self.purpose).await?;
        sqlx::query("INSERT INTO auth_factor_challenges(id,facility_id,user_id,purpose,login_grant_id,session_id,bootstrap_id,session_version,permission_version,factor_version,active_profile,password_confirmation_at,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)").bind(id).bind(facility).bind(user).bind(self.purpose).bind(grant).bind(session).bind(self.bootstrap).bind(sv).bind(pv).bind(fv).bind(profile).bind(self.password_confirmation_at).bind(state).bind(expires.min(self.end)).execute(&mut *self.tx).await?;
        deadline(&mut self.tx, self.end).await?;
        self.tx.commit().await?;
        Ok(())
    }
}
pub async fn login_options(
    pool: &PgPool,
    hash: &str,
    bootstrap_hash: Option<&str>,
) -> anyhow::Result<FactorOptions> {
    let expected = login_grant(pool, hash).await?;
    let mut tx = pool.begin().await?;
    let grant = lock_grant(&mut tx, hash, &expected).await?;
    let credentials = bounded_credentials(&mut tx, grant.facility_id, grant.user_id).await?;
    let mut end = grant.expires_at;
    let bootstrap = if grant.state == "setup" {
        if !credentials.is_empty() {
            return Err(FactorError::InvalidGrant.into());
        }
        let (id,expires):(Uuid,DateTime<Utc>)=sqlx::query_as("SELECT id,expires_at FROM auth_factor_bootstrap_grants WHERE facility_id=$1 AND user_id=$2 AND token_hash=$3 AND consumed_at IS NULL FOR UPDATE").bind(grant.facility_id).bind(grant.user_id).bind(bootstrap_hash.ok_or(FactorError::InvalidGrant)?).fetch_optional(&mut *tx).await?.ok_or(FactorError::InvalidGrant)?;
        deadline(&mut tx, expires).await?;
        end = end.min(expires);
        Some(id)
    } else {
        if bootstrap_hash.is_some() || credentials.is_empty() {
            return Err(FactorError::InvalidGrant.into());
        }
        None
    };
    Ok(FactorOptions {
        tx,
        grant: Some(grant),
        actor: None,
        credentials,
        purpose: if bootstrap.is_some() {
            "setup"
        } else {
            "login"
        },
        bootstrap,
        password_confirmation_at: None,
        end,
    })
}
async fn session(
    tx: &mut Tx<'_>,
    actor: &mut WebAuthnActor,
) -> anyhow::Result<(i64, DateTime<Utc>)> {
    session_locked(tx, actor, true).await
}
async fn session_locked(
    tx: &mut Tx<'_>,
    actor: &mut WebAuthnActor,
    mutating: bool,
) -> anyhow::Result<(i64, DateTime<Utc>)> {
    let i = identity_locked(tx, actor.facility_id, actor.user_id, mutating).await?;
    if i.session_version != actor.session_version
        || i.permission_version != actor.permission_version
        || i.profile != codec::encode(actor.active_profile)?
    {
        return Err(FactorError::AuthorizationExpired.into());
    }
    let statement = if mutating {
        "SELECT LEAST(expires_at,idle_expires_at,absolute_expires_at),password_verified_at FROM refresh_sessions WHERE session_id=$1 AND facility_id=$2 AND user_id=$3 AND session_version=$4 AND permission_version_at_issue=$5 AND revoked_at IS NULL FOR UPDATE"
    } else {
        "SELECT LEAST(expires_at,idle_expires_at,absolute_expires_at),password_verified_at FROM refresh_sessions WHERE session_id=$1 AND facility_id=$2 AND user_id=$3 AND session_version=$4 AND permission_version_at_issue=$5 AND revoked_at IS NULL FOR SHARE"
    };
    let (end, password): (DateTime<Utc>, DateTime<Utc>) = sqlx::query_as(statement)
        .bind(actor.session_id)
        .bind(actor.facility_id)
        .bind(actor.user_id)
        .bind(actor.session_version)
        .bind(actor.permission_version)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(FactorError::AuthorizationExpired)?;
    actor.valid_until = actor.valid_until.min(end);
    deadline(tx, actor.valid_until).await?;
    Ok((i.auth_factor_version, password))
}
pub async fn step_up_options(
    pool: &PgPool,
    mut actor: WebAuthnActor,
    confirmed_password_hash: Option<(&str, DateTime<Utc>)>,
) -> anyhow::Result<FactorOptions> {
    let mut tx = pool.begin().await?;
    let (_, password) = session(&mut tx, &mut actor).await?;
    let at = now(&mut tx).await?;
    let confirmation = if let Some((hash, verified_at)) = confirmed_password_hash {
        let actual: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id=$1")
            .bind(actor.user_id)
            .fetch_one(&mut *tx)
            .await?;
        if actual != hash {
            return Err(FactorError::AuthorizationExpired.into());
        }
        if verified_at > at {
            return Err(FactorError::AuthorizationExpired.into());
        }
        deadline(&mut tx, verified_at + Duration::minutes(15)).await?;
        Some(verified_at)
    } else {
        if at >= password + Duration::minutes(15) {
            return Err(FactorError::PasswordConfirmationRequired.into());
        }
        None
    };
    let credentials = bounded_credentials(&mut tx, actor.facility_id, actor.user_id).await?;
    if credentials.is_empty() {
        return Err(FactorError::FactorRequired.into());
    }
    let end = actor
        .valid_until
        .min(confirmation.unwrap_or(password) + Duration::minutes(15));
    Ok(FactorOptions {
        tx,
        grant: None,
        actor: Some(actor),
        credentials,
        purpose: "step_up",
        bootstrap: None,
        password_confirmation_at: confirmation,
        end,
    })
}

#[derive(FromRow)]
struct Challenge {
    id: Uuid,
    facility_id: Uuid,
    user_id: Uuid,
    purpose: String,
    login_grant_id: Option<Uuid>,
    session_id: Option<Uuid>,
    bootstrap_id: Option<Uuid>,
    session_version: i64,
    permission_version: i64,
    factor_version: i64,
    active_profile: String,
    password_confirmation_at: Option<DateTime<Utc>>,
    state: Value,
    expires_at: DateTime<Utc>,
}
const CHALLENGE:&str="SELECT id,facility_id,user_id,purpose,login_grant_id,session_id,bootstrap_id,session_version,permission_version,factor_version,active_profile,password_confirmation_at,state,expires_at FROM auth_factor_challenges";
pub struct FactorCeremony {
    tx: Tx<'static>,
    challenge: Challenge,
    grant: Option<LoginGrant>,
    actor: Option<WebAuthnActor>,
    credentials: Vec<WebAuthnCredentialRow>,
    end: DateTime<Utc>,
}
impl FactorCeremony {
    pub fn state(&self) -> Value {
        self.challenge.state.clone()
    }
    pub fn credentials(&self) -> &[WebAuthnCredentialRow] {
        &self.credentials
    }
    pub fn grant(&self) -> Option<&LoginGrant> {
        self.grant.as_ref()
    }
    pub async fn reject(mut self) -> anyhow::Result<()> {
        sqlx::query("UPDATE auth_factor_challenges SET consumed_at=clock_timestamp() WHERE id=$1")
            .bind(self.challenge.id)
            .execute(&mut *self.tx)
            .await?;
        if let Some(g) = &self.grant {
            sqlx::query("UPDATE auth_login_grants SET failed_attempts=failed_attempts+1 WHERE id=$1 AND failed_attempts<10").bind(g.id).execute(&mut *self.tx).await?;
        }
        audit(
            &mut self.tx,
            self.challenge.facility_id,
            self.challenge.user_id,
            None,
            "auth.factor.verification.failed",
            self.challenge.id,
        )
        .await?;
        deadline(&mut self.tx, self.end).await?;
        self.tx.commit().await?;
        Ok(())
    }
    pub async fn complete_setup(
        mut self,
        credential: String,
        passkey: Value,
    ) -> anyhow::Result<()> {
        if self.challenge.purpose != "setup" || !self.credentials.is_empty() {
            return Err(FactorError::InvalidChallenge.into());
        }
        let g = self.grant.as_ref().ok_or(FactorError::InvalidGrant)?;
        let bootstrap = self
            .challenge
            .bootstrap_id
            .ok_or(FactorError::InvalidGrant)?;
        let expires:Option<DateTime<Utc>>=sqlx::query_scalar("UPDATE auth_factor_bootstrap_grants SET consumed_at=clock_timestamp() WHERE id=$1 AND consumed_at IS NULL RETURNING expires_at").bind(bootstrap).fetch_optional(&mut *self.tx).await?;
        deadline(&mut self.tx, expires.ok_or(FactorError::InvalidGrant)?).await?;
        sqlx::query("INSERT INTO auth_webauthn_credentials(id,facility_id,user_id,credential_id,passkey) VALUES(gen_random_uuid(),$1,$2,$3,$4)").bind(g.facility_id).bind(g.user_id).bind(credential).bind(passkey).execute(&mut *self.tx).await?;
        sqlx::query("UPDATE auth_login_grants SET state='factor',factor_version=(SELECT auth_factor_version FROM users WHERE id=$2) WHERE id=$1").bind(g.id).bind(g.user_id).execute(&mut *self.tx).await?;
        self.finish("auth.factor.bootstrap.enrolled").await
    }
    pub async fn complete(
        mut self,
        credential: &str,
        passkey: Value,
        new_session: Option<&NewRefreshSession>,
        request_id: Option<&str>,
    ) -> anyhow::Result<()> {
        if self.challenge.purpose == "setup" {
            return Err(FactorError::InvalidChallenge.into());
        }
        let key = self
            .credentials
            .iter()
            .find(|k| k.credential_id == credential)
            .ok_or(FactorError::ManagementRequired)?
            .id;
        sqlx::query("UPDATE auth_webauthn_credentials SET passkey=$2,last_used_at=clock_timestamp() WHERE id=$1 AND disabled_at IS NULL").bind(key).bind(passkey).execute(&mut *self.tx).await?;
        let at = now(&mut self.tx).await?;
        let session_id = if let Some(g) = &self.grant {
            let s = new_session.ok_or(FactorError::InvalidInput)?;
            if s.user_id != g.user_id
                || s.facility_id != g.facility_id
                || s.session_version != g.session_version
                || s.permission_version_at_issue != g.permission_version
            {
                return Err(FactorError::InvalidInput.into());
            }
            insert_session(&mut self.tx, s, g.password_verified_at).await?;
            session_created(&mut self.tx, s, request_id).await?;
            sqlx::query("UPDATE auth_login_grants SET consumed_at=clock_timestamp() WHERE id=$1")
                .bind(g.id)
                .execute(&mut *self.tx)
                .await?;
            s.session_id
        } else {
            let actor = self.actor.as_ref().ok_or(FactorError::InvalidInput)?;
            if new_session.is_some() {
                return Err(FactorError::InvalidInput.into());
            }
            if let Some(confirmed) = self.challenge.password_confirmation_at {
                sqlx::query(
                    "UPDATE refresh_sessions SET password_verified_at=$2 WHERE session_id=$1",
                )
                .bind(actor.session_id)
                .bind(confirmed)
                .execute(&mut *self.tx)
                .await?;
            }
            actor.session_id
        };
        put_assurance(
            &mut self.tx,
            session_id,
            &self.challenge,
            "passkey",
            Some(key),
            at,
        )
        .await?;
        self.finish("auth.factor.passkey.verified").await
    }
    async fn finish(mut self, event: &str) -> anyhow::Result<()> {
        sqlx::query("UPDATE auth_factor_challenges SET consumed_at=clock_timestamp() WHERE id=$1")
            .bind(self.challenge.id)
            .execute(&mut *self.tx)
            .await?;
        audit(
            &mut self.tx,
            self.challenge.facility_id,
            self.challenge.user_id,
            None,
            event,
            self.challenge.id,
        )
        .await?;
        deadline(&mut self.tx, self.end).await?;
        self.tx.commit().await?;
        Ok(())
    }
}
pub async fn begin_login_ceremony(
    pool: &PgPool,
    hash: &str,
    id: Uuid,
    setup: bool,
) -> anyhow::Result<FactorCeremony> {
    let expected = login_grant(pool, hash).await?;
    let mut tx = pool.begin().await?;
    let grant = lock_grant(&mut tx, hash, &expected).await?;
    if (grant.state == "setup") != setup {
        return Err(FactorError::InvalidChallenge.into());
    }
    let challenge:Challenge=sqlx::query_as(&format!("{CHALLENGE} WHERE id=$1 AND login_grant_id=$2 AND purpose=$3 AND consumed_at IS NULL FOR UPDATE")).bind(id).bind(grant.id).bind(if setup{"setup"}else{"login"}).fetch_optional(&mut *tx).await?.ok_or(FactorError::InvalidChallenge)?;
    let mut end = grant.expires_at.min(challenge.expires_at);
    deadline(&mut tx, end).await?;
    if challenge.login_grant_id != Some(grant.id)
        || challenge.session_id.is_some()
        || challenge.facility_id != grant.facility_id
        || challenge.user_id != grant.user_id
        || challenge.session_version != grant.session_version
        || challenge.permission_version != grant.permission_version
        || challenge.factor_version != grant.factor_version
        || challenge.active_profile != grant.active_profile
    {
        return Err(FactorError::InvalidChallenge.into());
    }
    if let Some(id) = challenge.bootstrap_id {
        let expiry:Option<DateTime<Utc>>=sqlx::query_scalar("SELECT expires_at FROM auth_factor_bootstrap_grants WHERE id=$1 AND facility_id=$2 AND user_id=$3 AND consumed_at IS NULL FOR UPDATE").bind(id).bind(grant.facility_id).bind(grant.user_id).fetch_optional(&mut *tx).await?;
        let expiry = expiry.ok_or(FactorError::InvalidGrant)?;
        deadline(&mut tx, expiry).await?;
        end = end.min(expiry);
    }
    let credentials = bounded_credentials(&mut tx, grant.facility_id, grant.user_id).await?;
    Ok(FactorCeremony {
        tx,
        challenge,
        grant: Some(grant),
        actor: None,
        credentials,
        end,
    })
}
pub async fn begin_step_up(
    pool: &PgPool,
    mut actor: WebAuthnActor,
    id: Uuid,
) -> anyhow::Result<FactorCeremony> {
    let mut tx = pool.begin().await?;
    let (fv, _) = session(&mut tx, &mut actor).await?;
    let challenge:Challenge=sqlx::query_as(&format!("{CHALLENGE} WHERE id=$1 AND session_id=$2 AND purpose='step_up' AND consumed_at IS NULL FOR UPDATE")).bind(id).bind(actor.session_id).fetch_optional(&mut *tx).await?.ok_or(FactorError::InvalidChallenge)?;
    if challenge.session_id != Some(actor.session_id)
        || challenge.login_grant_id.is_some()
        || challenge.facility_id != actor.facility_id
        || challenge.user_id != actor.user_id
        || challenge.session_version != actor.session_version
        || challenge.permission_version != actor.permission_version
        || challenge.factor_version != fv
        || challenge.active_profile != codec::encode(actor.active_profile)?
    {
        return Err(FactorError::InvalidChallenge.into());
    }
    let end = actor.valid_until.min(challenge.expires_at);
    deadline(&mut tx, end).await?;
    let credentials = bounded_credentials(&mut tx, actor.facility_id, actor.user_id).await?;
    Ok(FactorCeremony {
        tx,
        challenge,
        grant: None,
        actor: Some(actor),
        credentials,
        end,
    })
}
async fn insert_session(
    tx: &mut Tx<'_>,
    s: &NewRefreshSession,
    password: DateTime<Utc>,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO refresh_sessions(token_hash,session_id,session_family_id,rotated_from_session_id,user_id,facility_id,session_version,permission_version_at_issue,csrf_token_hash,expires_at,session_started_at,idle_expires_at,absolute_expires_at,device_label,password_verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)").bind(&s.token_hash).bind(s.session_id).bind(s.session_family_id).bind(s.rotated_from_session_id).bind(s.user_id).bind(s.facility_id).bind(s.session_version).bind(s.permission_version_at_issue).bind(&s.csrf_token_hash).bind(s.expires_at).bind(s.session_started_at).bind(s.idle_expires_at).bind(s.absolute_expires_at).bind(&s.device_label).bind(password).execute(&mut **tx).await?;
    Ok(())
}
async fn put_assurance(
    tx: &mut Tx<'_>,
    session: Uuid,
    c: &Challenge,
    method: &str,
    key: Option<Uuid>,
    at: DateTime<Utc>,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO auth_session_assurance(session_id,facility_id,user_id,session_version,permission_version,factor_version,active_profile,method,credential_id,verified_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(session_id) DO UPDATE SET method=EXCLUDED.method,credential_id=EXCLUDED.credential_id,verified_at=EXCLUDED.verified_at,expires_at=EXCLUDED.expires_at,factor_version=EXCLUDED.factor_version").bind(session).bind(c.facility_id).bind(c.user_id).bind(c.session_version).bind(c.permission_version).bind(c.factor_version).bind(&c.active_profile).bind(method).bind(key).bind(at).bind(at+Duration::minutes(15)).execute(&mut **tx).await?;
    Ok(())
}
pub async fn complete_recovery(
    pool: &PgPool,
    hash: &str,
    code_hash: &str,
    new_session: &NewRefreshSession,
    request_id: Option<&str>,
) -> anyhow::Result<()> {
    let expected = login_grant(pool, hash).await?;
    let mut tx = pool.begin().await?;
    let grant = lock_grant(&mut tx, hash, &expected).await?;
    if grant.state != "factor"
        || new_session.user_id != grant.user_id
        || new_session.facility_id != grant.facility_id
        || new_session.session_version != grant.session_version
        || new_session.permission_version_at_issue != grant.permission_version
    {
        return Err(FactorError::InvalidGrant.into());
    }
    let used=sqlx::query("UPDATE auth_recovery_codes SET used_at=clock_timestamp() WHERE facility_id=$1 AND user_id=$2 AND code_hash=$3 AND used_at IS NULL AND invalidated_at IS NULL").bind(grant.facility_id).bind(grant.user_id).bind(code_hash).execute(&mut *tx).await?.rows_affected()==1;
    if !used {
        sqlx::query("UPDATE auth_login_grants SET failed_attempts=failed_attempts+1 WHERE id=$1 AND failed_attempts<10").bind(grant.id).execute(&mut *tx).await?;
        audit(
            &mut tx,
            grant.facility_id,
            grant.user_id,
            None,
            "auth.factor.recovery.failed",
            grant.id,
        )
        .await?;
        deadline(&mut tx, grant.expires_at).await?;
        tx.commit().await?;
        return Err(FactorError::InvalidGrant.into());
    }
    insert_session(&mut tx, new_session, grant.password_verified_at).await?;
    session_created(&mut tx, new_session, request_id).await?;
    sqlx::query("UPDATE auth_login_grants SET consumed_at=clock_timestamp() WHERE id=$1")
        .bind(grant.id)
        .execute(&mut *tx)
        .await?;
    let at = now(&mut tx).await?;
    sqlx::query("INSERT INTO auth_session_assurance(session_id,facility_id,user_id,session_version,permission_version,factor_version,active_profile,method,verified_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'recovery',$8,$9)").bind(new_session.session_id).bind(grant.facility_id).bind(grant.user_id).bind(grant.session_version).bind(grant.permission_version).bind(grant.factor_version).bind(&grant.active_profile).bind(at).bind(at+Duration::minutes(15)).execute(&mut *tx).await?;
    audit(
        &mut tx,
        grant.facility_id,
        grant.user_id,
        None,
        "auth.factor.recovery.verified",
        grant.id,
    )
    .await?;
    deadline(&mut tx, grant.expires_at).await?;
    tx.commit().await?;
    Ok(())
}

/// The caller must retain this transaction/proof until its protected commit.
/// Rechecks actual session, key epoch and credential after all source waits.
pub async fn require_privileged_tx(
    tx: &mut Tx<'_>,
    actor: &mut WebAuthnActor,
) -> anyhow::Result<PrivilegedDeadline> {
    let (epoch, password) = session_locked(tx, actor, false).await?;
    if sqlx::query_scalar::<_, bool>("SELECT password_change_required FROM users WHERE id=$1")
        .bind(actor.user_id)
        .fetch_one(&mut **tx)
        .await?
    {
        return Err(FactorError::AuthorizationExpired.into());
    }
    if now(tx).await? >= password + Duration::minutes(15) {
        return Err(FactorError::PasswordConfirmationRequired.into());
    }
    let factor:Option<DateTime<Utc>>=sqlx::query_scalar("SELECT a.expires_at FROM auth_session_assurance a JOIN auth_webauthn_credentials k ON k.id=a.credential_id AND k.facility_id=a.facility_id AND k.user_id=a.user_id AND k.disabled_at IS NULL WHERE a.session_id=$1 AND a.facility_id=$2 AND a.user_id=$3 AND a.session_version=$4 AND a.permission_version=$5 AND a.factor_version=$6 AND a.active_profile=$7 AND a.method='passkey' AND a.verified_at<=clock_timestamp() AND a.expires_at>clock_timestamp() FOR SHARE OF a,k").bind(actor.session_id).bind(actor.facility_id).bind(actor.user_id).bind(actor.session_version).bind(actor.permission_version).bind(epoch).bind(codec::encode(actor.active_profile)?).fetch_optional(&mut **tx).await?;
    let end = PrivilegedDeadline {
        authority: actor.valid_until,
        password: password + Duration::minutes(15),
        factor: factor.ok_or(FactorError::FactorRequired)?,
    };
    check_privileged_deadline_tx(tx, end).await?;
    Ok(end)
}
pub async fn status(
    pool: &PgPool,
    mut actor: WebAuthnActor,
) -> anyhow::Result<FactorAssuranceStatus> {
    let mut tx = pool.begin().await?;
    let (epoch, password) = session_locked(&mut tx, &mut actor, false).await?;
    let row:Option<(String,DateTime<Utc>,DateTime<Utc>,Option<Uuid>)>=sqlx::query_as("SELECT a.method,a.verified_at,a.expires_at,a.credential_id FROM auth_session_assurance a LEFT JOIN auth_webauthn_credentials k ON k.id=a.credential_id AND k.facility_id=a.facility_id AND k.user_id=a.user_id WHERE a.session_id=$1 AND a.facility_id=$2 AND a.user_id=$3 AND a.session_version=$4 AND a.permission_version=$5 AND a.factor_version=$6 AND a.active_profile=$7 AND (a.method='recovery' OR k.disabled_at IS NULL AND k.id IS NOT NULL) AND a.expires_at>clock_timestamp()").bind(actor.session_id).bind(actor.facility_id).bind(actor.user_id).bind(actor.session_version).bind(actor.permission_version).bind(epoch).bind(codec::encode(actor.active_profile)?).fetch_optional(&mut *tx).await?;
    let assurance = if let Some((method, at, end, key)) = row {
        SessionAssurance {
            method: Some(codec::decode(&method)?),
            verified_at: Some(at),
            expires_at: Some(end),
            credential_id: key,
        }
    } else {
        SessionAssurance::default()
    };
    deadline(&mut tx, actor.valid_until).await?;
    tx.commit().await?;
    Ok(FactorAssuranceStatus {
        assurance,
        password_verified_at: password,
        password_fresh_until: password + Duration::minutes(15),
    })
}
#[derive(FromRow)]
struct KeyRow {
    id: Uuid,
    label: Option<String>,
    created_at: DateTime<Utc>,
    last_used_at: Option<DateTime<Utc>>,
    disabled_at: Option<DateTime<Utc>>,
}
pub async fn list_keys(
    pool: &PgPool,
    mut actor: WebAuthnActor,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> anyhow::Result<Vec<PasskeyMetadata>> {
    let mut tx = pool.begin().await?;
    session_locked(&mut tx, &mut actor, false).await?;
    let mut query = sqlx::QueryBuilder::new("SELECT id,label,created_at,last_used_at,disabled_at FROM auth_webauthn_credentials WHERE facility_id=");
    query
        .push_bind(actor.facility_id)
        .push(" AND user_id=")
        .push_bind(actor.user_id);
    if let Some((at, id)) = cursor {
        query
            .push(" AND (created_at,id)<(")
            .push_bind(at)
            .push(",")
            .push_bind(id)
            .push(")");
    }
    query
        .push(" ORDER BY created_at DESC,id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows: Vec<KeyRow> = query.build_query_as().fetch_all(&mut *tx).await?;
    deadline(&mut tx, actor.valid_until).await?;
    tx.commit().await?;
    Ok(rows
        .into_iter()
        .map(|k| PasskeyMetadata {
            id: k.id,
            label: k.label,
            created_at: k.created_at,
            last_used_at: k.last_used_at,
            disabled_at: k.disabled_at,
        })
        .collect())
}
pub async fn change_key(
    pool: &PgPool,
    mut actor: WebAuthnActor,
    id: Uuid,
    label: Option<&str>,
    disable: bool,
) -> anyhow::Result<PasskeyMetadata> {
    if label.is_some_and(|v| v.trim().is_empty() || v.chars().count() > 120)
        || disable == label.is_some()
    {
        return Err(FactorError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    identity(&mut tx, actor.facility_id, actor.user_id).await?;
    let end = require_privileged_tx(&mut tx, &mut actor).await?;
    let keys = bounded_credentials(&mut tx, actor.facility_id, actor.user_id).await?;
    let selected = keys
        .iter()
        .find(|k| k.id == id)
        .ok_or(FactorError::NotFound)?;
    if disable && keys.len() <= 1 {
        return Err(FactorError::LastCredential.into());
    }
    if disable {
        sqlx::query(
            "UPDATE auth_webauthn_credentials SET disabled_at=clock_timestamp() WHERE id=$1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query("UPDATE auth_webauthn_credentials SET label=$2 WHERE id=$1")
            .bind(id)
            .bind(label.map(str::trim))
            .execute(&mut *tx)
            .await?;
    }
    let _ = selected;
    let k:KeyRow=sqlx::query_as("SELECT id,label,created_at,last_used_at,disabled_at FROM auth_webauthn_credentials WHERE id=$1").bind(id).fetch_one(&mut *tx).await?;
    audit(
        &mut tx,
        actor.facility_id,
        actor.user_id,
        Some(&actor.request_id),
        if disable {
            "auth.passkey.disabled"
        } else {
            "auth.passkey.renamed"
        },
        id,
    )
    .await?;
    check_privileged_deadline_tx(&mut tx, end).await?;
    tx.commit().await?;
    Ok(PasskeyMetadata {
        id: k.id,
        label: k.label,
        created_at: k.created_at,
        last_used_at: k.last_used_at,
        disabled_at: k.disabled_at,
    })
}
pub async fn replace_codes_authorized(
    pool: &PgPool,
    mut actor: WebAuthnActor,
    expected_password_hash: &str,
    hashes: &[String],
) -> anyhow::Result<()> {
    if hashes.len() != 10 {
        return Err(FactorError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    identity(&mut tx, actor.facility_id, actor.user_id).await?;
    let end = require_privileged_tx(&mut tx, &mut actor).await?;
    let actual: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id=$1")
        .bind(actor.user_id)
        .fetch_one(&mut *tx)
        .await?;
    if actual != expected_password_hash {
        return Err(FactorError::AuthorizationExpired.into());
    }
    sqlx::query("UPDATE auth_recovery_codes SET invalidated_at=clock_timestamp() WHERE facility_id=$1 AND user_id=$2 AND used_at IS NULL AND invalidated_at IS NULL").bind(actor.facility_id).bind(actor.user_id).execute(&mut *tx).await?;
    let set = Uuid::new_v4();
    sqlx::query("INSERT INTO auth_recovery_codes(id,user_id,facility_id,code_hash,generated_set_id) SELECT gen_random_uuid(),$1,$2,h,$3 FROM unnest($4::text[]) h").bind(actor.user_id).bind(actor.facility_id).bind(set).bind(hashes).execute(&mut *tx).await?;
    audit(
        &mut tx,
        actor.facility_id,
        actor.user_id,
        Some(&actor.request_id),
        "auth.recovery_codes.replaced",
        set,
    )
    .await?;
    check_privileged_deadline_tx(&mut tx, end).await?;
    tx.commit().await?;
    Ok(())
}
/// Registration of another key requires a current existing passkey, not merely
/// a password session. This helper is used by both legacy registration routes.
pub async fn registration_proof(pool: &PgPool, mut actor: WebAuthnActor) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    identity(&mut tx, actor.facility_id, actor.user_id).await?;
    let end = require_privileged_tx(&mut tx, &mut actor).await?;
    if bounded_credentials(&mut tx, actor.facility_id, actor.user_id)
        .await?
        .len()
        >= MAX_ACTIVE_PASSKEYS as usize
    {
        return Err(FactorError::CredentialLimit.into());
    }
    check_privileged_deadline_tx(&mut tx, end).await?;
    tx.commit().await?;
    Ok(())
}

/// Atomic rotation: old proof is transferred only while its exact credential,
/// epoch, versions and deadline remain live. Original verification time remains.
pub async fn rotate_session(
    pool: &PgPool,
    s: &NewRefreshSession,
    old_hash: &str,
    csrf_hash: &str,
) -> anyhow::Result<bool> {
    let mut tx = pool.begin().await?;
    let i = identity(&mut tx, s.facility_id, s.user_id).await?;
    if i.session_version != s.session_version
        || i.permission_version != s.permission_version_at_issue
    {
        return Ok(false);
    }
    let old:Option<(Uuid,DateTime<Utc>,DateTime<Utc>,DateTime<Utc>,Uuid)>=sqlx::query_as("SELECT session_id,password_verified_at,absolute_expires_at,LEAST(expires_at,idle_expires_at,absolute_expires_at),session_family_id FROM refresh_sessions WHERE token_hash=$1 AND csrf_token_hash=$2 AND user_id=$3 AND facility_id=$4 AND session_version=$5 AND permission_version_at_issue=$6 AND revoked_at IS NULL FOR UPDATE").bind(old_hash).bind(csrf_hash).bind(s.user_id).bind(s.facility_id).bind(s.session_version).bind(s.permission_version_at_issue).fetch_optional(&mut *tx).await?;
    let Some((old_id, password, absolute, live, family)) = old else {
        return Ok(false);
    };
    deadline(&mut tx, live).await?;
    if s.rotated_from_session_id != Some(old_id)
        || s.session_family_id != family
        || s.absolute_expires_at != absolute
    {
        return Err(FactorError::InvalidInput.into());
    }
    insert_session(&mut tx, s, password).await?;
    sqlx::query("INSERT INTO auth_session_assurance(session_id,facility_id,user_id,session_version,permission_version,factor_version,active_profile,method,credential_id,verified_at,expires_at) SELECT $1,a.facility_id,a.user_id,a.session_version,a.permission_version,a.factor_version,a.active_profile,a.method,a.credential_id,a.verified_at,a.expires_at FROM auth_session_assurance a LEFT JOIN auth_webauthn_credentials k ON k.id=a.credential_id AND k.facility_id=a.facility_id AND k.user_id=a.user_id WHERE a.session_id=$2 AND a.facility_id=$3 AND a.user_id=$4 AND a.factor_version=$5 AND a.active_profile=$6 AND a.session_version=$7 AND a.permission_version=$8 AND a.expires_at>clock_timestamp() AND (a.method='recovery' OR k.id IS NOT NULL AND k.disabled_at IS NULL)").bind(s.session_id).bind(old_id).bind(s.facility_id).bind(s.user_id).bind(i.auth_factor_version).bind(&i.profile).bind(i.session_version).bind(i.permission_version).execute(&mut *tx).await?;
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp(),revoked_reason='rotated' WHERE session_id=$1").bind(old_id).execute(&mut *tx).await?;
    deadline(&mut tx, live).await?;
    tx.commit().await?;
    Ok(true)
}
/// One bounded batch per table, no expired credential/audit evidence is deleted.
pub async fn cleanup_ephemeral_auth(pool: &PgPool, limit: i64) -> anyhow::Result<u64> {
    let mut tx = pool.begin().await?;
    let mut count = 0;
    sqlx::raw_sql("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='500ms'; SET LOCAL idle_in_transaction_session_timeout='10s'").execute(&mut *tx).await?;
    for table in [
        "auth_factor_challenges",
        "auth_webauthn_challenges",
        "auth_login_grants",
        "auth_factor_bootstrap_grants",
    ] {
        // Parent retention avoids an unbounded cascade, including malformed
        // operator-imported graphs. Indexed children are removed by their own
        // bounded batch first and remaining parents become eligible later.
        let unreferenced=match table {
        "auth_login_grants"=>" WHERE NOT EXISTS(SELECT 1 FROM auth_factor_challenges c WHERE c.login_grant_id=e.id)",
        "auth_factor_bootstrap_grants"=>" WHERE NOT EXISTS(SELECT 1 FROM auth_factor_challenges c WHERE c.bootstrap_id=e.id)",
        _=>"",
      };
        count+=sqlx::query(&format!("WITH expired AS MATERIALIZED(SELECT parent.id FROM {table} parent WHERE parent.expires_at<clock_timestamp()-interval '1 day' ORDER BY parent.expires_at,parent.id LIMIT $1 FOR UPDATE OF parent SKIP LOCKED),eligible AS(SELECT e.id FROM expired e{unreferenced}) DELETE FROM {table} t USING eligible e WHERE t.id=e.id")).bind(limit.clamp(1,1000)).execute(&mut *tx).await?.rows_affected();
    }
    count+=sqlx::query("WITH expired AS(SELECT facility_id,user_id,purpose FROM auth_factor_issue_budgets WHERE window_started_at<clock_timestamp()-interval '1 day' ORDER BY window_started_at,user_id LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM auth_factor_issue_budgets t USING expired e WHERE t.facility_id=e.facility_id AND t.user_id=e.user_id AND t.purpose=e.purpose").bind(limit.clamp(1,1000)).execute(&mut *tx).await?.rows_affected();
    tx.commit().await?;
    Ok(count)
}

pub async fn token_facts(
    pool: &PgPool,
    facility: Uuid,
    user: Uuid,
    session: Uuid,
) -> anyhow::Result<(DateTime<Utc>, DateTime<Utc>, DateTime<Utc>, DateTime<Utc>)> {
    sqlx::query_as("SELECT password_verified_at,expires_at,idle_expires_at,absolute_expires_at FROM refresh_sessions WHERE session_id=$1 AND facility_id=$2 AND user_id=$3 AND revoked_at IS NULL AND LEAST(expires_at,idle_expires_at,absolute_expires_at)>clock_timestamp()").bind(session).bind(facility).bind(user).fetch_optional(pool).await?.ok_or_else(||FactorError::AuthorizationExpired.into())
}

pub async fn insert_password_session(
    pool: &PgPool,
    user: &UserAccount,
    s: &NewRefreshSession,
    request: Option<&str>,
    password_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    let i = identity(&mut tx, user.facility_id, user.id).await?;
    if i.password_hash != user.password_hash
        || i.session_version != user.session_version
        || i.permission_version != user.permission_version
        || i.profile != codec::encode(user.active_profile)?
        || user.auth_security.privileged_user
        || !bounded_credentials(&mut tx, user.facility_id, user.id)
            .await?
            .is_empty()
    {
        return Err(FactorError::FactorRequired.into());
    }
    let at = now(&mut tx).await?;
    if password_at > at {
        return Err(FactorError::AuthorizationExpired.into());
    }
    deadline(&mut tx, password_at + Duration::minutes(15)).await?;
    insert_session(&mut tx, s, password_at).await?;
    session_created(&mut tx, s, request).await?;
    deadline(&mut tx, s.expires_at).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn check_privileged_deadline_tx(
    tx: &mut Tx<'_>,
    end: PrivilegedDeadline,
) -> anyhow::Result<()> {
    end.check_at(now(tx).await?)?;
    Ok(())
}
/// Own authentication writes require live session authority without inventing
/// privileged factor freshness. Strong locks serialize their actual mutation.
pub async fn require_bound_session_tx(
    tx: &mut Tx<'_>,
    actor: &mut WebAuthnActor,
    facility: Uuid,
    user: Uuid,
) -> anyhow::Result<DateTime<Utc>> {
    if actor.facility_id != facility || actor.user_id != user {
        return Err(FactorError::AuthorizationExpired.into());
    }
    session(tx, actor).await?;
    Ok(actor.valid_until)
}
pub async fn check_session_deadline_tx(tx: &mut Tx<'_>, end: DateTime<Utc>) -> anyhow::Result<()> {
    deadline(tx, end).await
}

pub async fn require_bound_privileged_tx(
    tx: &mut Tx<'_>,
    actor: &mut WebAuthnActor,
    facility: Uuid,
    user: Uuid,
) -> anyhow::Result<PrivilegedDeadline> {
    if actor.facility_id != facility || actor.user_id != user {
        return Err(FactorError::AuthorizationExpired.into());
    }
    require_privileged_tx(tx, actor).await
}

/// Exact family permission and current effective feature are rechecked while
/// the canonical facility/actor/session proof locks remain held. No other user
/// is locked here; callers with actor+target users must prelock them sorted.
pub async fn require_family_privileged_tx(
    tx: &mut Tx<'_>,
    actor: &mut WebAuthnActor,
    facility: Uuid,
    user: Uuid,
    permission: PermissionCode,
    feature: FeatureKey,
) -> anyhow::Result<PrivilegedDeadline> {
    let end = require_bound_privileged_tx(tx, actor, facility, user).await?;
    let allowed:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM effective_user_permissions WHERE user_id=$1 AND permission_code=$2)").bind(user).bind(codec::encode(permission)?).fetch_one(&mut **tx).await?;
    if !allowed {
        return Err(FactorError::AuthorizationExpired.into());
    }
    require_current_feature_tx(tx, actor, feature).await?;
    check_privileged_deadline_tx(tx, end).await?;
    Ok(end)
}

/// Revalidate a collected privileged read immediately before publication. The
/// caller must finish external I/O before entering this short transaction.
pub async fn confirm_family_privileged(
    pool: &PgPool,
    mut actor: WebAuthnActor,
    permission: PermissionCode,
    feature: FeatureKey,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    let facility = actor.facility_id;
    let user = actor.user_id;
    let end =
        require_family_privileged_tx(&mut tx, &mut actor, facility, user, permission, feature)
            .await?;
    check_privileged_deadline_tx(&mut tx, end).await?;
    tx.commit().await?;
    Ok(())
}

/// Additional feature of the same workflow, after the caller acquired and
/// retained require_family_privileged_tx's canonical facility/actor proof.
/// This performs no additional user/session locks or proof refresh.
pub async fn require_current_feature_tx(
    tx: &mut Tx<'_>,
    actor: &WebAuthnActor,
    feature: FeatureKey,
) -> anyhow::Result<()> {
    let configured: Option<bool> = sqlx::query_scalar(
        "SELECT enabled FROM facility_feature_entitlements WHERE facility_id=$1 AND feature_key=$2",
    )
    .bind(actor.facility_id)
    .bind(codec::encode(feature)?)
    .fetch_optional(&mut **tx)
    .await?;
    let enabled = configured.unwrap_or_else(|| {
        hms_domain::capabilities::feature_flags_for_profile(actor.active_profile)
            .get(&feature)
            .copied()
            .unwrap_or(false)
    });
    let user_enabled: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_features WHERE user_id=$1 AND feature_key=$2)",
    )
    .bind(actor.user_id)
    .bind(codec::encode(feature)?)
    .fetch_one(&mut **tx)
    .await?;
    if !enabled || !user_enabled {
        return Err(FactorError::AuthorizationExpired.into());
    }
    Ok(())
}

pub(super) async fn reserve_legacy_ceremony(
    tx: &mut Tx<'_>,
    facility: Uuid,
    user: Uuid,
    kind: WebAuthnCeremonyType,
) -> anyhow::Result<()> {
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM (SELECT 1 FROM auth_webauthn_challenges WHERE facility_id=$1 AND user_id=$2 AND ceremony_type=$3 AND consumed_at IS NULL AND expires_at>statement_timestamp() LIMIT 3) pending").bind(facility).bind(user).bind(kind.as_str()).fetch_one(&mut **tx).await?;
    if count >= MAX_PENDING_FACTOR_CHALLENGES {
        return Err(FactorError::IssueLimit.into());
    }
    issue(
        tx,
        facility,
        user,
        if matches!(kind, WebAuthnCeremonyType::Registration) {
            "registration_test"
        } else {
            "assertion_test"
        },
    )
    .await
}

#[derive(serde::Serialize)]
pub struct ReadinessCounts {
    pub privileged_unenrolled_accounts: i64,
    pub active_keys: i64,
    pub over_cap_accounts: i64,
}
pub async fn readiness_counts(pool: &PgPool, facility: Uuid) -> anyhow::Result<ReadinessCounts> {
    let permissions = hms_domain::auth::PRIVILEGED_PERMISSIONS
        .iter()
        .map(codec::encode)
        .collect::<anyhow::Result<Vec<_>>>()?;
    let (unenrolled,keys,over):(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM users u WHERE u.facility_id=$1 AND u.is_active AND EXISTS(SELECT 1 FROM effective_user_permissions p WHERE p.user_id=u.id AND p.permission_code=ANY($2)) AND NOT EXISTS(SELECT 1 FROM auth_webauthn_credentials k WHERE k.facility_id=u.facility_id AND k.user_id=u.id AND k.disabled_at IS NULL)),(SELECT count(*) FROM auth_webauthn_credentials WHERE facility_id=$1 AND disabled_at IS NULL),(SELECT count(*) FROM(SELECT user_id FROM auth_webauthn_credentials WHERE facility_id=$1 AND disabled_at IS NULL GROUP BY user_id HAVING count(*)>$3) x)").bind(facility).bind(permissions).bind(MAX_ACTIVE_PASSKEYS).fetch_one(pool).await?;
    Ok(ReadinessCounts {
        privileged_unenrolled_accounts: unenrolled,
        active_keys: keys,
        over_cap_accounts: over,
    })
}
#[derive(FromRow)]
pub struct KeyReadinessRecord {
    pub id: Uuid,
    pub credential_id: String,
    pub passkey: Value,
}
pub async fn key_readiness_page(
    pool: &PgPool,
    facility: Uuid,
    after: Option<Uuid>,
) -> anyhow::Result<Vec<KeyReadinessRecord>> {
    Ok(sqlx::query_as("SELECT id,credential_id,passkey FROM auth_webauthn_credentials WHERE facility_id=$1 AND disabled_at IS NULL AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 250").bind(facility).bind(after).fetch_all(pool).await?)
}
/// Explicit named local-operator retirement preserves key material and never
/// establishes a session, factor assurance, patient access, or replacement key.
pub async fn operator_retire_key(
    pool: &PgPool,
    facility: Uuid,
    user: Uuid,
    key: Uuid,
    reason: &str,
) -> anyhow::Result<()> {
    if reason.trim().is_empty() || reason.chars().count() > 2000 {
        return Err(FactorError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    identity(&mut tx, facility, user).await?;
    let disabled:Option<DateTime<Utc>>=sqlx::query_scalar("SELECT disabled_at FROM auth_webauthn_credentials WHERE id=$1 AND facility_id=$2 AND user_id=$3 FOR UPDATE").bind(key).bind(facility).bind(user).fetch_optional(&mut *tx).await?.ok_or(FactorError::NotFound)?;
    if disabled.is_none() {
        sqlx::query(
            "UPDATE auth_webauthn_credentials SET disabled_at=clock_timestamp() WHERE id=$1",
        )
        .bind(key)
        .execute(&mut *tx)
        .await?;
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO auth_factor_operator_actions(id,facility_id,user_id,credential_id,action,reason) VALUES($1,$2,$3,$4,'credential_retired',$5)").bind(id).bind(facility).bind(user).bind(key).bind(reason.trim()).execute(&mut *tx).await?;
        audit(
            &mut tx,
            facility,
            user,
            None,
            "auth.factor.operator.credential_retired",
            id,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
