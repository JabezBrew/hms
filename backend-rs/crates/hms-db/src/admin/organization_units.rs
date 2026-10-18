//! Exact UUID/CAS organization maintenance under retained privileged authority.
use super::{privileged, BusinessFactorActor, NewAuditEvent};
use crate::{codec, PgPool};
use chrono::{DateTime, Utc};
use hms_domain::{
    admin::OrganizationUnitListItem, deployment::PermissionCode, organization_units::*,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{types::Json, FromRow, Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone, Copy, Debug)]
pub enum OrganizationUnitError {
    Invalid,
    NotFound,
    VersionConflict,
    RequestConflict,
    ReferenceUnavailable,
    HasChildren,
    HasPositions,
    HasScopeGrants,
    Busy,
}
impl std::fmt::Display for OrganizationUnitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Organization maintenance requires current review.")
    }
}
impl std::error::Error for OrganizationUnitError {}
type Tx<'a> = Transaction<'a, Postgres>;
const BLOCKERS_SQL:&str="SELECT EXISTS(SELECT 1 FROM organization_units WHERE parent_unit_id=$1), EXISTS(SELECT 1 FROM positions WHERE org_unit_id=$1), EXISTS(SELECT 1 FROM permission_assignments WHERE scope_type='organization_unit' AND scope_id=$1)";

fn lock_error(e: sqlx::Error) -> anyhow::Error {
    if e.as_database_error()
        .is_some_and(|d| d.code().as_deref() == Some("55P03"))
    {
        OrganizationUnitError::Busy.into()
    } else {
        e.into()
    }
}
fn hash(bytes: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
async fn try_gate(
    tx: &mut Tx<'_>,
    namespace: &[u8],
    facility: Uuid,
    key: &[u8],
) -> anyhow::Result<()> {
    let mut material = namespace.to_vec();
    material.extend_from_slice(facility.as_bytes());
    material.extend_from_slice(key);
    let digest = hash(material);
    let gate = i64::from_be_bytes(digest[..8].try_into()?);
    let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(gate)
        .fetch_one(&mut **tx)
        .await?;
    if !acquired {
        return Err(OrganizationUnitError::Busy.into());
    }
    Ok(())
}
fn facts(input: &OrganizationUnitReviewedInput) -> (Uuid, Option<Uuid>, &'static str, Option<i64>) {
    match input {
        OrganizationUnitReviewedInput::Create {
            client_request_id, ..
        } => (*client_request_id, None, "create", None),
        OrganizationUnitReviewedInput::Rename {
            client_request_id,
            unit_id,
            expected_version,
            ..
        } => (
            *client_request_id,
            Some(*unit_id),
            "rename",
            Some(*expected_version),
        ),
        OrganizationUnitReviewedInput::Retire {
            client_request_id,
            unit_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*unit_id),
            "retire",
            Some(*expected_version),
        ),
        OrganizationUnitReviewedInput::Reactivate {
            client_request_id,
            unit_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*unit_id),
            "reactivate",
            Some(*expected_version),
        ),
    }
}
fn validate(input: &OrganizationUnitReviewedInput) -> anyhow::Result<()> {
    let (key, id, _, version) = facts(input);
    if key.is_nil() || id.is_some_and(|v| v.is_nil()) || version.is_some_and(|v| v < 1) {
        return Err(OrganizationUnitError::Invalid.into());
    }
    let name = match input {
        OrganizationUnitReviewedInput::Create {
            code,
            name,
            parent_unit_id,
            ..
        } => {
            if code.is_empty()
                || code.len() > 48
                || !code
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                || parent_unit_id.is_some_and(|v| v.is_nil())
            {
                return Err(OrganizationUnitError::Invalid.into());
            }
            Some(name)
        }
        OrganizationUnitReviewedInput::Rename { name, .. } => Some(name),
        _ => None,
    };
    if name.is_some_and(|n| n.trim().is_empty() || n.len() > 160 || n.chars().any(char::is_control))
    {
        return Err(OrganizationUnitError::Invalid.into());
    }
    Ok(())
}
async fn parent(tx: &mut Tx<'_>, facility: Uuid, id: Option<Uuid>) -> anyhow::Result<()> {
    if let Some(id) = id {
        let found=sqlx::query_scalar::<_,Uuid>("SELECT id FROM organization_units WHERE facility_id=$1 AND id=$2 AND is_active FOR SHARE NOWAIT")
            .bind(facility).bind(id).fetch_optional(&mut **tx).await.map_err(lock_error)?;
        if found.is_none() {
            return Err(OrganizationUnitError::ReferenceUnavailable.into());
        }
    }
    Ok(())
}
async fn unit(
    tx: &mut Tx<'_>,
    facility: Uuid,
    id: Uuid,
    write: bool,
) -> anyhow::Result<OrganizationUnitListItem> {
    let statement = if write {
        "SELECT id FROM organization_units WHERE facility_id=$1 AND id=$2 FOR UPDATE NOWAIT"
    } else {
        "SELECT id FROM organization_units WHERE facility_id=$1 AND id=$2 FOR SHARE NOWAIT"
    };
    if sqlx::query_scalar::<_, Uuid>(statement)
        .bind(facility)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(lock_error)?
        .is_none()
    {
        return Err(OrganizationUnitError::NotFound.into());
    }
    let row=sqlx::query_as::<_,super::OrganizationUnitRow>("SELECT u.id,u.code,u.name,u.unit_type,p.id AS parent_unit_id,p.name parent_unit_name,u.is_active,u.created_at,u.updated_at,u.version FROM organization_units u LEFT JOIN organization_units p ON p.id=u.parent_unit_id AND p.facility_id=u.facility_id WHERE u.facility_id=$1 AND u.id=$2")
        .bind(facility).bind(id).fetch_one(&mut **tx).await?;
    super::organization_unit_from_row(row)
}
#[derive(FromRow)]
struct Saved {
    actor_user_id: Uuid,
    payload_digest: Vec<u8>,
    receipt: Json<OrganizationUnitCommandReceipt>,
}

pub async fn execute(
    pool: &PgPool,
    mut actor: BusinessFactorActor,
    input: OrganizationUnitReviewedInput,
) -> anyhow::Result<OrganizationUnitCommandReceipt> {
    validate(&input)?;
    let (key, id, action, expected) = facts(&input);
    let facility = actor.identity.facility_id;
    let user = actor.identity.user_id;
    let digest = hash(serde_json::to_vec(&serde_json::to_value(&input)?)?);
    let key_hash = hash(key.as_bytes());
    let mut tx = pool.begin().await?;
    let end = privileged::begin_business(
        &mut tx,
        Some(&mut actor),
        facility,
        user,
        &[],
        PermissionCode::AdminAuthorityManage,
        false,
    )
    .await?;
    try_gate(
        &mut tx,
        b"hms.organization.unit.command.v1",
        facility,
        &key_hash,
    )
    .await?;
    let saved=sqlx::query_as::<_,Saved>("SELECT actor_user_id,payload_digest,receipt FROM organization_unit_commands WHERE facility_id=$1 AND request_key_hash=$2")
        .bind(facility).bind(&key_hash).fetch_optional(&mut *tx).await?;
    if let Some(saved) = saved {
        if saved.actor_user_id != user || saved.payload_digest != digest {
            return Err(OrganizationUnitError::RequestConflict.into());
        }
        privileged::finish(&mut tx, end).await?;
        tx.commit().await?;
        return Ok(saved.receipt.0);
    }
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await?;
    let (unit, changed) = if let OrganizationUnitReviewedInput::Create {
        code,
        name,
        unit_type,
        parent_unit_id,
        ..
    } = &input
    {
        // A different UUID cannot wait on the code unique index of another
        // canonical in-flight create while retaining its own authority locks.
        try_gate(
            &mut tx,
            b"hms.organization.unit.code.v1",
            facility,
            code.as_bytes(),
        )
        .await?;
        parent(&mut tx, facility, *parent_unit_id).await?;
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO organization_units(id,facility_id,code,name,unit_type,parent_unit_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)")
            .bind(id).bind(facility).bind(code).bind(name).bind(codec::encode(*unit_type)?).bind(parent_unit_id).bind(now).execute(&mut *tx).await?;
        (unit(&mut tx, facility, id, true).await?, true)
    } else {
        let id = id.ok_or(OrganizationUnitError::Invalid)?;
        // Topology is immutable at persistence, so this parent projection cannot
        // retarget while its active SHARE gate precedes the exact unit gate.
        if action == "reactivate" {
            let (p,active,version) = sqlx::query_as::<_, (Option<Uuid>,bool,i64)>(
                "SELECT parent_unit_id,is_active,version FROM organization_units WHERE facility_id=$1 AND id=$2",
            )
            .bind(facility)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(OrganizationUnitError::NotFound)?;
            if Some(version) != expected {
                return Err(OrganizationUnitError::VersionConflict.into());
            }
            if !active {
                parent(&mut tx, facility, p).await?;
            }
        }
        let old = unit(&mut tx, facility, id, true).await?;
        if Some(old.version) != expected {
            return Err(OrganizationUnitError::VersionConflict.into());
        }
        let (name, active) = match &input {
            OrganizationUnitReviewedInput::Rename { name, .. } => (name.clone(), old.is_active),
            OrganizationUnitReviewedInput::Retire { .. } => (old.name.clone(), false),
            OrganizationUnitReviewedInput::Reactivate { .. } => (old.name.clone(), true),
            _ => return Err(OrganizationUnitError::Invalid.into()),
        };
        let changed = name != old.name || active != old.is_active;
        if changed {
            if active != old.is_active {
                let (children, positions, grants): (bool, bool, bool) =
                    hms_observability::observe_db_query(
                        "admin.organization_unit.blockers",
                        sqlx::query_as(BLOCKERS_SQL).bind(id).fetch_one(&mut *tx),
                    )
                    .await?;
                if children {
                    return Err(OrganizationUnitError::HasChildren.into());
                }
                if positions {
                    return Err(OrganizationUnitError::HasPositions.into());
                }
                if grants {
                    return Err(OrganizationUnitError::HasScopeGrants.into());
                }
            }
            sqlx::query("UPDATE organization_units SET name=$3,is_active=$4,version=version+1,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(facility).bind(id).bind(name).bind(active).execute(&mut *tx).await?;
        }
        (unit(&mut tx, facility, id, true).await?, changed)
    };
    let receipt = OrganizationUnitCommandReceipt {
        client_request_id: key,
        input_digest: hex(&digest),
        reviewed_input: input,
        recorded_by_user_id: user,
        unit,
        changed,
        recorded_at: now,
    };
    sqlx::query("INSERT INTO organization_unit_commands(facility_id,request_key_hash,actor_user_id,unit_id,action,payload_digest,receipt,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(facility).bind(key_hash).bind(user).bind(receipt.unit.id).bind(action).bind(digest).bind(Json(&receipt)).bind(now).execute(&mut *tx).await?;
    super::insert_audit_event_tx(
        &mut tx,
        NewAuditEvent {
            facility_id: facility,
            actor_user_id: Some(user),
            request_id: Some(actor.identity.request_id),
            event_type: format!("admin.organization_unit.{action}"),
            resource_type: "organization_unit".into(),
            resource_id: Some(receipt.unit.id),
            metadata: json!({"action":action,"version":receipt.unit.version,"changed":changed}),
        },
    )
    .await?;
    privileged::finish(&mut tx, end).await?;
    tx.commit().await?;
    Ok(receipt)
}

#[cfg(test)]
mod tests;

pub async fn receipt(
    pool: &PgPool,
    mut actor: BusinessFactorActor,
    key: Uuid,
) -> anyhow::Result<OrganizationUnitCommandReceipt> {
    if key.is_nil() {
        return Err(OrganizationUnitError::Invalid.into());
    }
    let facility = actor.identity.facility_id;
    let user = actor.identity.user_id;
    let mut tx = pool.begin().await?;
    let end = privileged::begin_business(
        &mut tx,
        Some(&mut actor),
        facility,
        user,
        &[],
        PermissionCode::AdminAuthorityManage,
        false,
    )
    .await?;
    let row=sqlx::query_scalar::<_,Json<OrganizationUnitCommandReceipt>>("SELECT receipt FROM organization_unit_commands WHERE facility_id=$1 AND request_key_hash=$2 AND actor_user_id=$3")
        .bind(facility).bind(hash(key.as_bytes())).bind(user).fetch_optional(&mut *tx).await?.ok_or(OrganizationUnitError::NotFound)?;
    privileged::finish(&mut tx, end).await?;
    tx.commit().await?;
    Ok(row.0)
}
