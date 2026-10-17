//! Versioned facility network policy. One bounded read per request, no TTL cache.
use crate::{codec, PgPool};
use chrono::{DateTime, Utc};
use hms_domain::network::*;
use hms_observability::observe_db_query;
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use std::net::IpAddr;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkPolicyError {
    InvalidPolicy,
    VersionChanged,
    RequestConflict,
    WouldLockOut,
    InvalidActor,
    ReauthExpired,
}
impl NetworkPolicyError {
    pub fn message(self) -> &'static str {
        match self {
 Self::InvalidPolicy=>"Use valid explicit CIDRs and a reason of at most 1000 characters.",
 Self::VersionChanged=>"The network policy changed. Reload and review its current version.",
 Self::RequestConflict=>"This request reference was used for a different policy change.",
 Self::WouldLockOut=>"The candidate must retain onsite access for this connection. Use the operator command for a deliberate change of access.",
 Self::InvalidActor=>"The policy actor and facility could not be verified.",
 Self::ReauthExpired=>"Confirm your sign-in again before publishing the policy.",
}
    }
}
impl std::fmt::Display for NetworkPolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}
impl std::error::Error for NetworkPolicyError {}

/// The request's server-resolved network decision must remain current until a
/// protected business/read transaction publishes. This is deliberately separate
/// from own-auth ceremonies and the policy writer's CAS/FOR UPDATE protocol.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkPublicationError {
    MissingProof,
    PolicyChanged,
}
impl NetworkPublicationError {
    pub fn code(self) -> &'static str {
        match self {
            Self::MissingProof => "network_policy_proof_required",
            Self::PolicyChanged => "network_policy_changed",
        }
    }
    pub fn message(self) -> &'static str {
        match self {
            Self::MissingProof => "Current network access proof is required.",
            Self::PolicyChanged => "Network access changed. Reload and review current access.",
        }
    }
}
impl std::fmt::Display for NetworkPublicationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}
impl std::error::Error for NetworkPublicationError {}

pub async fn require_publication_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    facility: Uuid,
    expected_version: i64,
) -> anyhow::Result<()> {
    if expected_version < 0 {
        return Err(NetworkPublicationError::MissingProof.into());
    }
    if expected_version == 0 {
        observe_db_query(
            "network.publication.sentinel",
            sqlx::query("INSERT INTO facility_network_policies(facility_id) VALUES($1) ON CONFLICT DO NOTHING")
                .bind(facility)
                .execute(&mut **tx),
        )
        .await?;
    }
    let actual: Option<i64> = observe_db_query(
        "network.publication.lock",
        sqlx::query_scalar(
            "SELECT version FROM facility_network_policies WHERE facility_id=$1 FOR SHARE",
        )
        .bind(facility)
        .fetch_optional(&mut **tx),
    )
    .await?;
    if actual != Some(expected_version) {
        return Err(NetworkPublicationError::PolicyChanged.into());
    }
    Ok(())
}

/// Order only the actor and explicitly reviewed target users before retaining
/// policy proof. A target may itself publish policy with a strong user lock;
/// acquiring it after policy SHARE would invert that publisher's order.
/// This grants no authority: callers still perform their mandatory identity,
/// feature, deadline and active/local target eligibility checks afterwards.
pub(crate) async fn prelock_publication_users_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    facility: Uuid,
    actor: Uuid,
    targets: &[Uuid],
) -> anyhow::Result<()> {
    if targets.iter().all(|target| *target == actor) {
        return Ok(());
    }
    let _parent: Option<Uuid> = observe_db_query(
        "network.publication.target_facility",
        sqlx::query_scalar("SELECT id FROM facilities WHERE id=$1 FOR SHARE")
            .bind(facility)
            .fetch_optional(&mut **tx),
    )
    .await?;
    let mut users = targets.to_vec();
    users.push(actor);
    users.sort_unstable();
    users.dedup();
    let _: Vec<Uuid> = observe_db_query(
        "network.publication.target_users",
        sqlx::query_scalar(
            "SELECT id FROM users WHERE facility_id=$1 AND id=ANY($2) ORDER BY id FOR SHARE",
        )
        .bind(facility)
        .bind(users)
        .fetch_all(&mut **tx),
    )
    .await?;
    Ok(())
}

#[derive(Clone)]
pub struct NetworkPolicyActor {
    pub facility_id: Uuid,
    pub user_id: Option<Uuid>,
    pub request_id: Option<String>,
    pub reauth_deadline: Option<DateTime<Utc>>,
    pub auth_versions: Option<(i64, i64)>,
    pub session_id: Option<Uuid>,
    pub active_profile: Option<hms_domain::deployment::DeploymentProfile>,
    /// Server-resolved policy at authorization time, never the caller's CAS value.
    /// Explicit operator bootstrap/recovery has no connection authorization proof.
    pub resolved_policy_version: Option<i64>,
}
#[derive(FromRow)]
struct PolicyRow {
    version: i64,
    onsite_cidrs: Vec<String>,
    offsite_mode: String,
    updated_at: Option<DateTime<Utc>>,
    updated_by_user_id: Option<Uuid>,
}
impl PolicyRow {
    fn policy(self) -> anyhow::Result<NetworkPolicy> {
        Ok(NetworkPolicy {
            configured: self.version > 0,
            version: self.version,
            onsite_cidrs: self.onsite_cidrs,
            offsite_mode: codec::decode(&self.offsite_mode)?,
            updated_at: self.updated_at,
            updated_by_user_id: self.updated_by_user_id,
        })
    }
}
pub fn unconfigured_policy() -> NetworkPolicy {
    NetworkPolicy {
        configured: false,
        version: 0,
        onsite_cidrs: vec![],
        offsite_mode: NetworkOffsiteMode::Readonly,
        updated_at: None,
        updated_by_user_id: None,
    }
}
pub async fn get_policy(pool: &PgPool, facility: Uuid) -> anyhow::Result<NetworkPolicy> {
    let row=observe_db_query("network.policy.get",sqlx::query_as::<_,PolicyRow>("SELECT version,onsite_cidrs::text[] AS onsite_cidrs,offsite_mode,updated_at,updated_by_user_id FROM facility_network_policies WHERE facility_id=$1").bind(facility).fetch_optional(pool)).await?;
    row.map(PolicyRow::policy)
        .transpose()
        .map(|value| value.unwrap_or_else(unconfigured_policy))
}
pub fn normalize_candidate(
    candidate: NetworkPolicyCandidate,
) -> anyhow::Result<NetworkPolicyCandidate> {
    let ranges = NetworkRanges::parse(&candidate.onsite_cidrs, false)
        .map_err(|_| NetworkPolicyError::InvalidPolicy)?;
    Ok(NetworkPolicyCandidate {
        onsite_cidrs: ranges.canonical(),
        offsite_mode: candidate.offsite_mode,
    })
}
#[derive(FromRow)]
struct SavedCommand {
    actor_user_id: Option<Uuid>,
    source_kind: String,
    payload_digest: Vec<u8>,
    result_version: Option<i64>,
}

/// `current_client` is mandatory for an authenticated administrator. Operators
/// use the same CAS/idempotency path with an explicit facility and no fake user.
pub async fn update_policy(
    pool: &PgPool,
    actor: NetworkPolicyActor,
    input: UpdateNetworkPolicyRequest,
    current_client: Option<IpAddr>,
) -> anyhow::Result<NetworkPolicyWriteResult> {
    update_policy_with_proof(pool, actor, input, current_client, None).await
}

/// Mandatory same-session factor proof for authenticated API publication.
pub async fn update_policy_authorized(
    pool: &PgPool,
    actor: NetworkPolicyActor,
    input: UpdateNetworkPolicyRequest,
    current_client: Option<IpAddr>,
    proof: crate::auth::WebAuthnActor,
) -> anyhow::Result<NetworkPolicyWriteResult> {
    if actor.user_id != Some(proof.user_id)
        || actor.facility_id != proof.facility_id
        || actor.session_id != Some(proof.session_id)
        || actor.auth_versions != Some((proof.session_version, proof.permission_version))
        || actor.active_profile != Some(proof.active_profile)
    {
        return Err(crate::auth::assurance::FactorError::AuthorizationExpired.into());
    }
    update_policy_with_proof(pool, actor, input, current_client, Some(proof)).await
}

async fn update_policy_with_proof(
    pool: &PgPool,
    mut actor: NetworkPolicyActor,
    mut input: UpdateNetworkPolicyRequest,
    current_client: Option<IpAddr>,
    mut proof: Option<crate::auth::WebAuthnActor>,
) -> anyhow::Result<NetworkPolicyWriteResult> {
    let candidate = normalize_candidate(NetworkPolicyCandidate {
        onsite_cidrs: input.onsite_cidrs,
        offsite_mode: input.offsite_mode,
    })?;
    input.onsite_cidrs = candidate.onsite_cidrs;
    input.reason = input.reason.trim().to_owned();
    if input.client_request_id.is_nil()
        || input.expected_version < 0
        || input.reason.is_empty()
        || input.reason.chars().count() > 1000
    {
        return Err(NetworkPolicyError::InvalidPolicy.into());
    }
    if actor.user_id.is_some() && current_client.is_none() {
        return Err(NetworkPolicyError::WouldLockOut.into());
    }
    if actor.user_id.is_some() && actor.reauth_deadline.is_none() {
        return Err(NetworkPolicyError::ReauthExpired.into());
    }
    if actor.user_id.is_some() && actor.resolved_policy_version.is_none() {
        return Err(NetworkPolicyError::InvalidActor.into());
    }
    let source = if actor.user_id.is_some() {
        "admin"
    } else {
        "operator"
    };
    let key = Sha256::digest(input.client_request_id.as_bytes()).to_vec();
    let digest = Sha256::digest(serde_json::to_vec(&input)?).to_vec();
    let mut tx = pool.begin().await?;
    let valid_facility: Option<String> = sqlx::query_scalar(
        "SELECT deployment_profile FROM facilities WHERE id=$1 AND is_active FOR SHARE",
    )
    .bind(actor.facility_id)
    .fetch_optional(&mut *tx)
    .await?;
    if valid_facility.is_none()
        || (actor.user_id.is_some()
            && actor
                .active_profile
                .map(codec::encode)
                .transpose()?
                .as_ref()
                != valid_facility.as_ref())
    {
        return Err(NetworkPolicyError::InvalidActor.into());
    }
    let proof_deadline = crate::admin::privileged::begin(
        &mut tx,
        proof.as_mut(),
        actor.facility_id,
        actor.user_id.unwrap_or_default(),
        &[],
        hms_domain::deployment::PermissionCode::AdminAuthorityManage,
        false,
    )
    .await?;
    if let Some(user) = actor.user_id {
        let valid:Option<(i64,i64)>=sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1 AND facility_id=$2 AND is_active AND NOT password_change_required FOR SHARE").bind(user).bind(actor.facility_id).fetch_optional(&mut *tx).await?;
        if valid.is_none() || valid != actor.auth_versions {
            return Err(NetworkPolicyError::InvalidActor.into());
        }
        let versions = valid.unwrap();
        let session = actor.session_id.ok_or(NetworkPolicyError::InvalidActor)?;
        let session_deadline:Option<DateTime<Utc>>=sqlx::query_scalar("SELECT LEAST(expires_at,idle_expires_at,absolute_expires_at) FROM refresh_sessions WHERE facility_id=$1 AND user_id=$2 AND session_id=$3 AND session_version=$4 AND permission_version_at_issue=$5 AND revoked_at IS NULL AND LEAST(expires_at,idle_expires_at,absolute_expires_at)>clock_timestamp() FOR SHARE").bind(actor.facility_id).bind(user).bind(session).bind(versions.0).bind(versions.1).fetch_optional(&mut *tx).await?;
        let session_deadline = session_deadline.ok_or(NetworkPolicyError::InvalidActor)?;
        actor.reauth_deadline = actor
            .reauth_deadline
            .map(|deadline| deadline.min(session_deadline));
    }
    let added=sqlx::query("INSERT INTO facility_network_policy_commands(facility_id,request_key_hash,actor_user_id,source_kind,payload_digest) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING").bind(actor.facility_id).bind(&key).bind(actor.user_id).bind(source).bind(&digest).execute(&mut *tx).await?;
    if added.rows_affected() == 0 {
        let saved=sqlx::query_as::<_,SavedCommand>("SELECT actor_user_id,source_kind,payload_digest,result_version FROM facility_network_policy_commands WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(&key).fetch_one(&mut *tx).await?;
        if saved.actor_user_id != actor.user_id
            || saved.source_kind != source
            || saved.payload_digest != digest
        {
            return Err(NetworkPolicyError::RequestConflict.into());
        }
        let version = saved
            .result_version
            .ok_or_else(|| anyhow::anyhow!("network_policy_command_incomplete"))?;
        let row=sqlx::query_as::<_,PolicyRow>("SELECT version,onsite_cidrs::text[] AS onsite_cidrs,offsite_mode,updated_at,updated_by_user_id FROM facility_network_policy_versions WHERE facility_id=$1 AND version=$2").bind(actor.facility_id).bind(version).fetch_one(&mut *tx).await?;
        check_deadline(&mut tx, &actor).await?;
        crate::admin::privileged::finish(&mut tx, proof_deadline).await?;
        tx.commit().await?;
        return Ok(NetworkPolicyWriteResult {
            client_request_id: input.client_request_id,
            policy: row.policy()?,
            replayed: true,
        });
    }
    sqlx::query(
        "INSERT INTO facility_network_policies(facility_id) VALUES($1) ON CONFLICT DO NOTHING",
    )
    .bind(actor.facility_id)
    .execute(&mut *tx)
    .await?;
    let version: i64 = sqlx::query_scalar(
        "SELECT version FROM facility_network_policies WHERE facility_id=$1 FOR UPDATE",
    )
    .bind(actor.facility_id)
    .fetch_one(&mut *tx)
    .await?;
    if version != input.expected_version
        || (actor.user_id.is_some() && actor.resolved_policy_version != Some(version))
    {
        return Err(NetworkPolicyError::VersionChanged.into());
    }
    // This check uses the actual server-derived client, never the preview result.
    if actor.user_id.is_some()
        && !NetworkRanges::parse(&input.onsite_cidrs, false)
            .map_err(|_| NetworkPolicyError::InvalidPolicy)?
            .contains(current_client.ok_or(NetworkPolicyError::WouldLockOut)?)
    {
        return Err(NetworkPolicyError::WouldLockOut.into());
    }
    check_deadline(&mut tx, &actor).await?;
    let next = version
        .checked_add(1)
        .filter(|value| *value <= 9_007_199_254_740_991)
        .ok_or(NetworkPolicyError::VersionChanged)?;
    let mode = codec::encode(input.offsite_mode)?;
    let row=sqlx::query_as::<_,PolicyRow>("UPDATE facility_network_policies SET version=$2,onsite_cidrs=$3::text[]::cidr[],offsite_mode=$4,updated_at=clock_timestamp(),updated_by_user_id=$5 WHERE facility_id=$1 RETURNING version,onsite_cidrs::text[] AS onsite_cidrs,offsite_mode,updated_at,updated_by_user_id").bind(actor.facility_id).bind(next).bind(&input.onsite_cidrs).bind(&mode).bind(actor.user_id).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO facility_network_policy_versions(facility_id,version,onsite_cidrs,offsite_mode,updated_at,updated_by_user_id,source_kind,reason) VALUES($1,$2,$3::text[]::cidr[],$4,$5,$6,$7,$8)").bind(actor.facility_id).bind(next).bind(&input.onsite_cidrs).bind(&mode).bind(row.updated_at).bind(actor.user_id).bind(source).bind(&input.reason).execute(&mut *tx).await?;
    sqlx::query("UPDATE facility_network_policy_commands SET result_version=$3 WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(&key).bind(next).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,'network.policy.updated','network_policy',$2,jsonb_build_object('version',$5::bigint,'mode',$6::text,'range_count',$7::integer,'source',$8::text))").bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(next).bind(mode).bind(input.onsite_cidrs.len() as i32).bind(source).execute(&mut *tx).await?;
    check_deadline(&mut tx, &actor).await?;
    crate::admin::privileged::finish(&mut tx, proof_deadline).await?;
    tx.commit().await?;
    Ok(NetworkPolicyWriteResult {
        client_request_id: input.client_request_id,
        policy: row.policy()?,
        replayed: false,
    })
}

async fn check_deadline(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    actor: &NetworkPolicyActor,
) -> anyhow::Result<()> {
    if actor.user_id.is_some() {
        let valid: bool = sqlx::query_scalar("SELECT clock_timestamp()<$1")
            .bind(actor.reauth_deadline)
            .fetch_one(&mut **tx)
            .await?;
        if !valid {
            return Err(NetworkPolicyError::ReauthExpired.into());
        }
    }
    Ok(())
}
