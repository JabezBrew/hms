//! Unused-location lifecycle; stock/history closeout is intentionally separate.
use crate::clinical::{
    medication_access,
    prescription_courses::{self, PrescriptionActor, PrescriptionAuthorization},
};
use crate::{codec, PgPool};
use chrono::{DateTime, Utc};
use hms_domain::{deployment::FeatureKey, storage_locations::*};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{types::Json, FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;
type Tx<'a> = Transaction<'a, Postgres>;
#[derive(Clone)]
pub struct StorageLocationActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: String,
    pub authorization: PrescriptionAuthorization,
}
#[derive(Clone, Copy, Debug)]
pub enum StorageLocationError {
    Invalid,
    NotFound,
    VersionConflict,
    RequestConflict,
    OperationalHistory,
    Authority,
    Busy,
}
impl std::fmt::Display for StorageLocationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Current storage location review is required.")
    }
}
impl std::error::Error for StorageLocationError {}
#[derive(FromRow)]
struct Row {
    id: Uuid,
    code: String,
    name: String,
    location_type: String,
    temperature_zone: String,
    is_active: bool,
    version: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}
impl From<Row> for GovernedStorageLocation {
    fn from(r: Row) -> Self {
        Self {
            id: r.id,
            code: r.code,
            name: r.name,
            location_type: r.location_type,
            temperature_zone: r.temperature_zone,
            is_active: r.is_active,
            version: r.version,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}
const COLUMNS: &str =
    "id,code,name,location_type,temperature_zone,is_active,version,created_at,updated_at";
fn hash(v: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(v).to_vec()
}
fn lock_error(e: sqlx::Error) -> anyhow::Error {
    if e.as_database_error()
        .is_some_and(|d| d.code().as_deref() == Some("55P03"))
    {
        StorageLocationError::Busy.into()
    } else {
        e.into()
    }
}
async fn authority(
    tx: &mut Tx<'_>,
    a: &mut StorageLocationActor,
) -> anyhow::Result<PrescriptionActor> {
    let mut identity = PrescriptionActor {
        facility_id: a.facility_id,
        user_id: a.user_id,
        request_id: Some(a.request_id.clone()),
        authorization: Some(a.authorization.clone()),
    };
    prescription_courses::verify_actor(tx, &mut identity).await?;
    a.authorization = identity
        .authorization
        .clone()
        .ok_or(StorageLocationError::Authority)?;
    medication_access::require_current_features_tx(
        tx,
        a.facility_id,
        a.authorization.active_profile,
        &[FeatureKey::Inventory],
    )
    .await?;
    let(ok,boundary):(bool,Option<DateTime<Utc>>)=hms_observability::observe_db_query("inventory.location.proof.permissions",sqlx::query_as(r#"
 WITH point AS MATERIALIZED(SELECT clock_timestamp() at),effective AS(
 SELECT permission_code FROM user_permissions WHERE user_id=$2
 UNION SELECT permission_code FROM permission_assignments p CROSS JOIN point n WHERE p.facility_id=$1 AND p.grantee_user_id=$2 AND p.scope_type='facility' AND p.scope_id IS NULL AND p.status='active' AND p.starts_at<=n.at AND(p.ends_at IS NULL OR p.ends_at>n.at)
 UNION SELECT permission_code FROM delegations d CROSS JOIN point n WHERE d.facility_id=$1 AND d.delegate_user_id=$2 AND d.status='active' AND d.starts_at<=n.at AND(d.ends_at IS NULL OR d.ends_at>n.at))
 SELECT (SELECT count(*) FROM effective WHERE permission_code IN('inventory.manage','patient.demographics.view'))=2
 AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='demographics')
 AND EXISTS(SELECT 1 FROM user_features WHERE user_id=$2 AND feature_key='inventory'),
 (SELECT min(boundary) FROM user_authority_boundaries b CROSS JOIN LATERAL(VALUES(b.starts_at),(b.ends_at)) boundaries(boundary) CROSS JOIN point n WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
 "#).bind(a.facility_id).bind(a.user_id).fetch_one(&mut **tx)).await?;
    if !ok {
        return Err(StorageLocationError::Authority.into());
    }
    if let Some(at) = boundary {
        a.authorization.valid_until = a.authorization.valid_until.min(at);
    }
    identity.authorization = Some(a.authorization.clone());
    prescription_courses::check_authorization(tx, &identity).await?;
    Ok(identity)
}
async fn gate(tx: &mut Tx<'_>, facility: Uuid, namespace: &[u8], key: &[u8]) -> anyhow::Result<()> {
    let mut material = namespace.to_vec();
    material.extend_from_slice(facility.as_bytes());
    material.extend_from_slice(key);
    let bytes = hash(material);
    let number = i64::from_be_bytes(bytes[..8].try_into()?);
    let ok: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(number)
        .fetch_one(&mut **tx)
        .await?;
    if !ok {
        return Err(StorageLocationError::Busy.into());
    }
    Ok(())
}
fn facts(i: &StorageLocationReviewedInput) -> (Uuid, Option<Uuid>, &'static str, Option<i64>) {
    match i {
        StorageLocationReviewedInput::Create {
            client_request_id, ..
        } => (*client_request_id, None, "create", None),
        StorageLocationReviewedInput::Rename {
            client_request_id,
            location_id,
            expected_version,
            ..
        } => (
            *client_request_id,
            Some(*location_id),
            "rename",
            Some(*expected_version),
        ),
        StorageLocationReviewedInput::Retire {
            client_request_id,
            location_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*location_id),
            "retire",
            Some(*expected_version),
        ),
        StorageLocationReviewedInput::Reactivate {
            client_request_id,
            location_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*location_id),
            "reactivate",
            Some(*expected_version),
        ),
    }
}
fn validate(i: &StorageLocationReviewedInput) -> anyhow::Result<()> {
    let (k, id, _, v) = facts(i);
    if k.is_nil() || id.is_some_and(|i| i.is_nil()) || v.is_some_and(|v| v < 1) {
        return Err(StorageLocationError::Invalid.into());
    }
    let name = match i {
        StorageLocationReviewedInput::Create { name, code, .. } => {
            if code.is_empty()
                || code.len() > 48
                || !code
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            {
                return Err(StorageLocationError::Invalid.into());
            }
            Some(name)
        }
        StorageLocationReviewedInput::Rename { name, .. } => Some(name),
        _ => None,
    };
    if name.is_some_and(|v| {
        v.trim() != v || v.is_empty() || v.len() > 160 || v.chars().any(char::is_control)
    }) {
        return Err(StorageLocationError::Invalid.into());
    }
    Ok(())
}
async fn location(
    tx: &mut Tx<'_>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<GovernedStorageLocation> {
    let sql = format!(
        "SELECT {COLUMNS} FROM storage_locations WHERE facility_id=$1 AND id=$2 FOR UPDATE NOWAIT"
    );
    Ok(sqlx::query_as::<_, Row>(&sql)
        .bind(facility)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(lock_error)?
        .ok_or(StorageLocationError::NotFound)?
        .into())
}
#[derive(FromRow)]
struct Saved {
    actor_user_id: Uuid,
    payload_digest: Vec<u8>,
    receipt: Json<StorageLocationCommandReceipt>,
}
pub async fn execute(
    pool: &PgPool,
    mut actor: StorageLocationActor,
    input: StorageLocationReviewedInput,
) -> anyhow::Result<StorageLocationCommandReceipt> {
    validate(&input)?;
    let (key, id, action, expected) = facts(&input);
    let digest = hash(serde_json::to_vec(&serde_json::to_value(&input)?)?);
    let key_hash = hash(key.as_bytes());
    let mut tx = pool.begin().await?;
    let proof = authority(&mut tx, &mut actor).await?;
    gate(
        &mut tx,
        actor.facility_id,
        b"hms.storage.location.command.v1",
        &key_hash,
    )
    .await?;
    let saved=sqlx::query_as::<_,Saved>("SELECT actor_user_id,payload_digest,receipt FROM storage_location_commands WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(&key_hash).fetch_optional(&mut *tx).await?;
    if let Some(saved) = saved {
        if saved.actor_user_id != actor.user_id || saved.payload_digest != digest {
            return Err(StorageLocationError::RequestConflict.into());
        }
        prescription_courses::check_authorization(&mut tx, &proof).await?;
        tx.commit().await?;
        return Ok(saved.receipt.0);
    }
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await?;
    let (location, changed) = if let StorageLocationReviewedInput::Create {
        code,
        name,
        location_type,
        temperature_zone,
        ..
    } = &input
    {
        gate(
            &mut tx,
            actor.facility_id,
            b"hms.storage.location.code.v1",
            code.as_bytes(),
        )
        .await?;
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name,location_type,temperature_zone,created_at,updated_at)VALUES($1,$2,$3,$4,$5,$6,$7,$7)").bind(id).bind(actor.facility_id).bind(code).bind(name).bind(codec::encode(*location_type)?).bind(codec::encode(*temperature_zone)?).bind(now).execute(&mut *tx).await?;
        (location(&mut tx, actor.facility_id, id).await?, true)
    } else {
        let id = id.ok_or(StorageLocationError::Invalid)?;
        let old = location(&mut tx, actor.facility_id, id).await?;
        if Some(old.version) != expected {
            return Err(StorageLocationError::VersionConflict.into());
        }
        let (name, active) = match &input {
            StorageLocationReviewedInput::Rename { name, .. } => (name.clone(), old.is_active),
            StorageLocationReviewedInput::Retire { .. } => (old.name.clone(), false),
            StorageLocationReviewedInput::Reactivate { .. } => (old.name.clone(), true),
            _ => return Err(StorageLocationError::Invalid.into()),
        };
        let changed = name != old.name || active != old.is_active;
        if changed {
            if active != old.is_active {
                let used: bool = hms_observability::observe_db_query(
                    "inventory.location.operational_history",
                    sqlx::query_scalar("SELECT storage_location_has_operational_history($1)")
                        .bind(id)
                        .fetch_one(&mut *tx),
                )
                .await?;
                if used {
                    return Err(StorageLocationError::OperationalHistory.into());
                }
            }
            sqlx::query("UPDATE storage_locations SET name=$3,is_active=$4,version=version+1,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(id).bind(name).bind(active).execute(&mut *tx).await?;
        }
        (location(&mut tx, actor.facility_id, id).await?, changed)
    };
    let receipt = StorageLocationCommandReceipt {
        client_request_id: key,
        input_digest: digest.iter().map(|v| format!("{v:02x}")).collect(),
        reviewed_input: input,
        recorded_by_user_id: actor.user_id,
        location,
        changed,
        recorded_at: now,
    };
    sqlx::query("INSERT INTO storage_location_commands(facility_id,request_key_hash,actor_user_id,location_id,action,payload_digest,receipt,recorded_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(actor.facility_id).bind(key_hash).bind(actor.user_id).bind(receipt.location.id).bind(action).bind(digest).bind(Json(&receipt)).bind(now).execute(&mut *tx).await?;
    crate::admin::insert_audit_event_tx(
        &mut tx,
        crate::admin::NewAuditEvent {
            facility_id: actor.facility_id,
            actor_user_id: Some(actor.user_id),
            request_id: Some(actor.request_id),
            event_type: format!("inventory.storage_location.{action}"),
            resource_type: "storage_location".into(),
            resource_id: Some(receipt.location.id),
            metadata: json!({"action":action,"version":receipt.location.version,"changed":changed}),
        },
    )
    .await?;
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(receipt)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: StorageLocationActor,
    key: Uuid,
) -> anyhow::Result<StorageLocationCommandReceipt> {
    if key.is_nil() {
        return Err(StorageLocationError::Invalid.into());
    }
    let mut tx = pool.begin().await?;
    let proof = authority(&mut tx, &mut actor).await?;
    let r=sqlx::query_scalar::<_,Json<StorageLocationCommandReceipt>>("SELECT receipt FROM storage_location_commands WHERE facility_id=$1 AND request_key_hash=$2 AND actor_user_id=$3").bind(actor.facility_id).bind(hash(key.as_bytes())).bind(actor.user_id).fetch_optional(&mut *tx).await?.ok_or(StorageLocationError::NotFound)?;
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(r.0)
}
pub async fn detail(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<GovernedStorageLocation>> {
    let sql = format!("SELECT {COLUMNS} FROM storage_locations WHERE facility_id=$1 AND id=$2");
    Ok(sqlx::query_as::<_, Row>(&sql)
        .bind(facility)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(Into::into))
}
pub async fn list(
    pool: &PgPool,
    facility: Uuid,
    cursor: Option<super::InventoryCursor>,
    limit: i64,
    query: StorageLocationAdministrationQuery,
) -> anyhow::Result<Vec<GovernedStorageLocation>> {
    let mut q = QueryBuilder::<Postgres>::new(format!(
        "SELECT {COLUMNS} FROM storage_locations WHERE facility_id="
    ));
    q.push_bind(facility);
    if let Some(active) = query.is_active {
        q.push(" AND is_active=").push_bind(active);
    }
    if let Some(v) = query.location_type {
        q.push(" AND location_type=").push_bind(v);
    }
    if let Some(v) = query.temperature_zone {
        q.push(" AND temperature_zone=").push_bind(v);
    }
    if let Some(v) = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| {
            format!(
                "%{}%",
                v.replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            )
        })
    {
        q.push(" AND (code ILIKE ")
            .push_bind(v.clone())
            .push(" ESCAPE '\\' OR name ILIKE ")
            .push_bind(v)
            .push(" ESCAPE '\\')");
    }
    if let Some(c) = cursor {
        q.push(" AND (created_at,id)<(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY created_at DESC,id DESC LIMIT ")
        .push_bind(limit);
    Ok(q.build_query_as::<Row>()
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(Into::into)
        .collect())
}
