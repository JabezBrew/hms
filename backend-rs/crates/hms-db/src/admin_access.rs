//! Managed authority lifecycle. Never infer ownership of historical direct rights.
use crate::{
    admin::{insert_audit_event_tx, AdminCursor, NewAuditEvent},
    codec, PgPool,
};
use chrono::{DateTime, Utc};
use hms_domain::admin_access::{
    AccessGrantKind, AccessGrantListItem, AccessGrantRevocation, LegacyPermissionReconciliation,
};
use serde_json::json;
use sqlx::{FromRow, QueryBuilder};
use uuid::Uuid;

#[derive(Debug)]
pub enum RevokeGrantError {
    NotFound,
    ReconciliationRequired,
    Database(sqlx::Error),
    Other(anyhow::Error),
}
impl From<sqlx::Error> for RevokeGrantError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}
impl From<anyhow::Error> for RevokeGrantError {
    fn from(error: anyhow::Error) -> Self {
        Self::Other(error)
    }
}
impl std::fmt::Display for RevokeGrantError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "access grant operation failed: {self:?}")
    }
}
impl std::error::Error for RevokeGrantError {}

#[derive(FromRow)]
struct GrantRow {
    id: Uuid,
    kind: String,
    user_id: Uuid,
    display_name: String,
    permission_code: Option<String>,
    position_title: Option<String>,
    scope_type: String,
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
    status: String,
    revoked_at: Option<DateTime<Utc>>,
    reconciliation_required: bool,
    created_at: DateTime<Utc>,
}

const GRANTS: &str = r#"
SELECT pa.id, 'permission_assignment'::text AS kind, pa.grantee_user_id AS user_id,
       u.display_name, pa.permission_code, NULL::text AS position_title, pa.scope_type,
       pa.starts_at, pa.ends_at, pa.status, pa.revoked_at, pa.created_at,
       EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = pa.grantee_user_id AND up.permission_code = pa.permission_code AND up.origin = 'legacy_unresolved') AS reconciliation_required,
       pa.facility_id
FROM permission_assignments pa JOIN users u ON u.id = pa.grantee_user_id AND u.facility_id = pa.facility_id
UNION ALL
SELECT d.id, 'delegation', d.delegate_user_id, u.display_name, d.permission_code, NULL::text, 'facility',
       d.starts_at, d.ends_at, d.status, d.revoked_at, d.created_at,
       EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = d.delegate_user_id AND up.permission_code = d.permission_code AND up.origin = 'legacy_unresolved'), d.facility_id
FROM delegations d JOIN users u ON u.id = d.delegate_user_id AND u.facility_id = d.facility_id
UNION ALL
SELECT a.id, 'authority_appointment', a.user_id, u.display_name, NULL::text, p.title, 'organization_unit',
       a.starts_at, a.ends_at, a.status, a.revoked_at, a.created_at, false, a.facility_id
FROM authority_appointments a JOIN users u ON u.id = a.user_id AND u.facility_id = a.facility_id
JOIN positions p ON p.id = a.position_id AND p.facility_id = a.facility_id
"#;

pub async fn list_access_grants(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
    kind: Option<AccessGrantKind>,
) -> anyhow::Result<Vec<AccessGrantListItem>> {
    let mut q = QueryBuilder::new(format!(
        "SELECT * FROM ({GRANTS}) grants WHERE facility_id = "
    ));
    q.push_bind(facility_id);
    if let Some(kind) = kind {
        q.push(" AND kind = ").push_bind(codec::encode(kind)?);
    }
    if let Some(cursor) = cursor {
        q.push(" AND (created_at, id) > (")
            .push_bind(cursor.occurred_at)
            .push(", ")
            .push_bind(cursor.id)
            .push(")");
    }
    q.push(" ORDER BY created_at ASC, id ASC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    q.build_query_as::<GrantRow>()
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| {
            Ok(AccessGrantListItem {
                id: r.id,
                kind: codec::decode(&r.kind)?,
                user_id: r.user_id,
                display_name: r.display_name,
                permission_code: r.permission_code.map(|v| codec::decode(&v)).transpose()?,
                position_title: r.position_title,
                scope_type: r.scope_type,
                starts_at: r.starts_at,
                ends_at: r.ends_at,
                status: if r.status == "active" && r.ends_at.is_some_and(|end| end <= Utc::now()) {
                    "expired".to_owned()
                } else {
                    r.status
                },
                revoked_at: r.revoked_at,
                reconciliation_required: r.reconciliation_required,
                created_at: r.created_at,
            })
        })
        .collect()
}

pub struct RevokeGrant {
    pub facility_id: Uuid,
    pub actor_user_id: Uuid,
    pub id: Uuid,
    pub kind: AccessGrantKind,
    pub reconciliation: Option<LegacyPermissionReconciliation>,
    pub request_id: Option<String>,
}

pub async fn revoke_access_grant(
    pool: &PgPool,
    command: RevokeGrant,
) -> Result<AccessGrantRevocation, RevokeGrantError> {
    revoke_access_grant_with_proof(pool, command, None).await
}

/// Mandatory same-transaction actor proof for the active API.
pub async fn revoke_access_grant_authorized(
    pool: &PgPool,
    command: RevokeGrant,
    actor: crate::auth::WebAuthnActor,
) -> Result<AccessGrantRevocation, RevokeGrantError> {
    revoke_access_grant_with_proof(pool, command, Some(actor)).await
}

async fn revoke_access_grant_with_proof(
    pool: &PgPool,
    command: RevokeGrant,
    mut proof: Option<crate::auth::WebAuthnActor>,
) -> Result<AccessGrantRevocation, RevokeGrantError> {
    // Identifiers come exclusively from the enum, never request text.
    let (table, user_column) = match command.kind {
        AccessGrantKind::PermissionAssignment => ("permission_assignments", "grantee_user_id"),
        AccessGrantKind::Delegation => ("delegations", "delegate_user_id"),
        AccessGrantKind::AuthorityAppointment => ("authority_appointments", "user_id"),
    };
    let mut tx = pool.begin().await?;
    let user_id = sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT {user_column} FROM {table} WHERE id=$1 AND facility_id=$2"
    ))
    .bind(command.id)
    .bind(command.facility_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(RevokeGrantError::NotFound)?;
    let proof_deadline = crate::admin::privileged::begin(
        &mut tx,
        proof.as_mut(),
        command.facility_id,
        command.actor_user_id,
        &[user_id],
        hms_domain::deployment::PermissionCode::AdminAuthorityManage,
        false,
    )
    .await?;
    // Same user lock is taken by managed create operations: reconciliation,
    // creation, version change and grant updates cannot interleave.
    let exists = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE id=$1 AND facility_id=$2 FOR NO KEY UPDATE",
    )
    .bind(user_id)
    .bind(command.facility_id)
    .fetch_optional(&mut *tx)
    .await?;
    if exists.is_none() {
        return Err(RevokeGrantError::NotFound);
    }
    let code_projection = if command.kind == AccessGrantKind::AuthorityAppointment {
        "NULL::text"
    } else {
        "permission_code"
    };
    let row = sqlx::query_as::<_,(String,Option<String>,Option<DateTime<Utc>>)>(
        &format!("SELECT status, {code_projection}, revoked_at FROM {table} WHERE id=$1 AND facility_id=$2 FOR UPDATE"))
        .bind(command.id).bind(command.facility_id).fetch_optional(&mut *tx).await?.ok_or(RevokeGrantError::NotFound)?;
    let mut reconciled = false;
    if let Some(code) = &row.1 {
        let origin = sqlx::query_scalar::<_,String>("SELECT origin FROM user_permissions WHERE user_id=$1 AND permission_code=$2 FOR UPDATE")
            .bind(user_id).bind(code).fetch_optional(&mut *tx).await?;
        if origin.as_deref() == Some("legacy_unresolved") {
            reconciled = true;
            match command
                .reconciliation
                .ok_or(RevokeGrantError::ReconciliationRequired)?
            {
                LegacyPermissionReconciliation::RetainIndependent => {
                    sqlx::query("UPDATE user_permissions SET origin='direct' WHERE user_id=$1 AND permission_code=$2")
                        .bind(user_id).bind(code).execute(&mut *tx).await?;
                }
                LegacyPermissionReconciliation::RemoveHistoricalCopy => {
                    sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code=$2 AND origin='legacy_unresolved'")
                        .bind(user_id).bind(code).execute(&mut *tx).await?;
                }
            }
        }
    }
    if row.0 != "revoked" || reconciled || row.2.is_none() {
        sqlx::query(&format!("UPDATE {table} SET status='revoked', revoked_at=COALESCE(revoked_at,clock_timestamp()), revoked_by_user_id=COALESCE(revoked_by_user_id,$3), updated_at=clock_timestamp() WHERE id=$1 AND facility_id=$2"))
            .bind(command.id).bind(command.facility_id).bind(command.actor_user_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE users SET permission_version=permission_version+1, updated_at=clock_timestamp() WHERE id=$1 AND facility_id=$2")
            .bind(user_id).bind(command.facility_id).execute(&mut *tx).await?;
        insert_audit_event_tx(
            &mut tx,
            NewAuditEvent {
                facility_id: command.facility_id,
                actor_user_id: Some(command.actor_user_id),
                request_id: command.request_id,
                event_type: "admin.access_grant.revoked".to_owned(),
                resource_type: codec::encode(command.kind)?,
                resource_id: Some(command.id),
                metadata: json!({"reconciliation":command.reconciliation}),
            },
        )
        .await?;
    }
    let revoked_at = sqlx::query_scalar::<_, DateTime<Utc>>(&format!(
        "SELECT revoked_at FROM {table} WHERE id=$1"
    ))
    .bind(command.id)
    .fetch_one(&mut *tx)
    .await?;
    let (independent_access_retained, effective_permission_remaining) = if let Some(code) = row.1 {
        let retained = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM user_permissions WHERE user_id=$1 AND permission_code=$2)",
        )
        .bind(user_id)
        .bind(&code)
        .fetch_one(&mut *tx)
        .await?;
        let effective = sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM effective_user_permissions WHERE user_id=$1 AND permission_code=$2)")
            .bind(user_id).bind(code).fetch_one(&mut *tx).await?;
        (retained, Some(effective))
    } else {
        (false, None)
    };
    crate::admin::privileged::finish(&mut tx, proof_deadline).await?;
    tx.commit().await?;
    Ok(AccessGrantRevocation {
        id: command.id,
        kind: command.kind,
        user_id,
        status: "revoked".to_owned(),
        revoked_at,
        independent_access_retained,
        effective_permission_remaining,
    })
}
