//! Current configuration commands; no quantity or clinical interpretation.
use crate::clinical::{
    medication_access,
    prescription_courses::{self, PrescriptionActor, PrescriptionAuthorization},
};
use crate::PgPool;
use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::{deployment::FeatureKey, inventory_items::*};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{types::Json, FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;
type Tx<'a> = Transaction<'a, Postgres>;
#[derive(Clone)]
pub struct InventoryItemActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: String,
    pub authorization: PrescriptionAuthorization,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InventoryItemError {
    Invalid,
    InvalidSource,
    NotFound,
    VersionConflict,
    RequestConflict,
    CodeConflict,
    OperationalHistory,
    ControlledOrUnsupported,
    Authority,
    Busy,
}
impl std::fmt::Display for InventoryItemError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Current inventory item review is required.")
    }
}
impl std::error::Error for InventoryItemError {}
#[derive(FromRow)]
struct Row {
    id: Uuid,
    category_id: Uuid,
    category_code: Option<String>,
    category_name: Option<String>,
    code: String,
    name: String,
    unit: String,
    item_type: String,
    controlled: bool,
    is_active: bool,
    version: i64,
    catalog_changed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}
const COLUMNS:&str="i.id,i.category_id,c.code AS category_code,c.name AS category_name,i.code,i.name,i.unit,i.item_type,i.controlled,i.is_active,i.version,i.catalog_changed_at,i.created_at";
fn base_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(format!("SELECT {COLUMNS} FROM inventory_items i LEFT JOIN inventory_categories c ON c.id=i.category_id AND c.facility_id=i.facility_id WHERE i.facility_id="))
}
impl From<Row> for GovernedInventoryItem {
    fn from(r: Row) -> Self {
        Self {
            id: r.id,
            category_id: r.category_id,
            category: match (r.category_code, r.category_name) {
                (Some(code), Some(name)) => Some(InventoryItemCategory {
                    id: r.category_id,
                    code,
                    name,
                }),
                _ => None,
            },
            code: r.code,
            name: r.name,
            unit: r.unit,
            effective_controlled: r.controlled || r.item_type == "controlled_substance",
            item_type: r.item_type,
            controlled: r.controlled,
            is_active: r.is_active,
            version: r.version,
            catalog_changed_at: r.catalog_changed_at,
            created_at: r.created_at,
        }
    }
}
fn hash(v: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(v).to_vec()
}
pub fn database_error(error: &sqlx::Error) -> Option<InventoryItemError> {
    let d = error.as_database_error()?;
    if d.code().as_deref() == Some("55P03") {
        return Some(InventoryItemError::Busy);
    }
    match d.message() {
        "inventory_item_code_conflict" => Some(InventoryItemError::CodeConflict),
        "inventory_item_operational_history" => Some(InventoryItemError::OperationalHistory),
        "inventory_item_controlled_or_unsupported" => {
            Some(InventoryItemError::ControlledOrUnsupported)
        }
        "inventory_item_reference_unavailable"
        | "inventory_item_category_unavailable"
        | "inventory_transfer_unit_review_required" => Some(InventoryItemError::InvalidSource),
        _ => None,
    }
}
fn sql_error(e: sqlx::Error) -> anyhow::Error {
    match database_error(&e) {
        Some(v) => v.into(),
        None => e.into(),
    }
}
fn projection(i: &GovernedInventoryItem) -> InventoryItemProjection {
    InventoryItemProjection {
        code: i.code.clone(),
        name: i.name.clone(),
        unit: i.unit.clone(),
        version: i.version,
    }
}
fn ordinary(i: &GovernedInventoryItem) -> bool {
    !i.effective_controlled && matches!(i.item_type.as_str(), "medication" | "supply")
}
fn normalize_new(s: String) -> Result<String, InventoryItemError> {
    let s = s.trim().to_owned();
    if s.is_empty() || s.len() > 480 || s.chars().count() > 120 || s.chars().any(char::is_control) {
        Err(InventoryItemError::Invalid)
    } else {
        Ok(s)
    }
}
fn normalize_changed(s: String, old: &str) -> Result<String, InventoryItemError> {
    if s == old {
        Ok(s)
    } else {
        normalize_new(s)
    }
}
fn facts(i: &InventoryItemReviewedInput) -> (Uuid, Option<Uuid>, Option<i64>, &'static str) {
    match i {
        InventoryItemReviewedInput::Create {
            client_request_id, ..
        } => (*client_request_id, None, None, "create"),
        InventoryItemReviewedInput::Correct {
            client_request_id,
            item_id,
            expected_version,
            ..
        } => (
            *client_request_id,
            Some(*item_id),
            Some(*expected_version),
            "correct",
        ),
        InventoryItemReviewedInput::Retire {
            client_request_id,
            item_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*item_id),
            Some(*expected_version),
            "retire",
        ),
        InventoryItemReviewedInput::Reactivate {
            client_request_id,
            item_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*item_id),
            Some(*expected_version),
            "reactivate",
        ),
    }
}
fn validate_identity(i: &InventoryItemReviewedInput) -> Result<(), InventoryItemError> {
    let (k, id, v, _) = facts(i);
    if k.is_nil() || id.is_some_and(|v| v.is_nil()) || v.is_some_and(|v| v < 1) {
        return Err(InventoryItemError::Invalid);
    }
    if let InventoryItemReviewedInput::Create { category_id, .. } = i {
        if category_id.is_nil() {
            return Err(InventoryItemError::Invalid);
        }
    }
    Ok(())
}
fn normalize(
    i: InventoryItemReviewedInput,
    before: Option<&InventoryItemProjection>,
) -> Result<InventoryItemReviewedInput, InventoryItemError> {
    Ok(match i {
        InventoryItemReviewedInput::Create {
            client_request_id,
            category_id,
            code,
            name,
            unit,
            item_type,
        } => InventoryItemReviewedInput::Create {
            client_request_id,
            category_id,
            code: normalize_new(code)?,
            name: normalize_new(name)?,
            unit: normalize_new(unit)?,
            item_type,
        },
        InventoryItemReviewedInput::Correct {
            client_request_id,
            item_id,
            expected_version,
            effective_from,
            code,
            name,
            unit,
            reason,
        } => {
            let b = before.ok_or(InventoryItemError::InvalidSource)?;
            InventoryItemReviewedInput::Correct {
                client_request_id,
                item_id,
                expected_version,
                effective_from,
                code: normalize_changed(code, &b.code)?,
                name: normalize_changed(name, &b.name)?,
                unit: normalize_changed(unit, &b.unit)?,
                reason: normalize_new(reason)?,
            }
        }
        other => other,
    })
}
fn digest(i: &InventoryItemReviewedInput) -> anyhow::Result<Vec<u8>> {
    Ok(hash(serde_json::to_vec(&serde_json::to_value(i)?)?))
}
pub(crate) async fn authority(
    tx: &mut Tx<'_>,
    a: &mut InventoryItemActor,
) -> anyhow::Result<PrescriptionActor> {
    let mut proof = PrescriptionActor {
        facility_id: a.facility_id,
        user_id: a.user_id,
        request_id: Some(a.request_id.clone()),
        authorization: Some(a.authorization.clone()),
    };
    prescription_courses::verify_actor(tx, &mut proof).await?;
    a.authorization = proof
        .authorization
        .clone()
        .ok_or(InventoryItemError::Authority)?;
    medication_access::require_current_features_tx(
        tx,
        a.facility_id,
        a.authorization.active_profile,
        &[FeatureKey::Inventory],
    )
    .await?;
    let(ok,boundary):(bool,Option<DateTime<Utc>>)=hms_observability::observe_db_query("inventory.item.proof.permissions",sqlx::query_as(r#"
 WITH point AS MATERIALIZED(SELECT clock_timestamp() at),effective AS(
 SELECT permission_code FROM user_permissions WHERE user_id=$2
 UNION SELECT permission_code FROM permission_assignments p CROSS JOIN point n WHERE p.facility_id=$1 AND p.grantee_user_id=$2 AND p.scope_type='facility' AND p.scope_id IS NULL AND p.status='active' AND p.starts_at<=n.at AND(p.ends_at IS NULL OR p.ends_at>n.at)
 UNION SELECT permission_code FROM delegations d CROSS JOIN point n WHERE d.facility_id=$1 AND d.delegate_user_id=$2 AND d.status='active' AND d.starts_at<=n.at AND(d.ends_at IS NULL OR d.ends_at>n.at))
 SELECT(SELECT count(*) FROM effective WHERE permission_code IN('inventory.manage','patient.demographics.view'))=2
 AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='demographics')
 AND EXISTS(SELECT 1 FROM user_features WHERE user_id=$2 AND feature_key='inventory'),
 (SELECT min(boundary) FROM user_authority_boundaries b CROSS JOIN LATERAL(VALUES(b.starts_at),(b.ends_at)) boundaries(boundary) CROSS JOIN point n WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
 "#).bind(a.facility_id).bind(a.user_id).fetch_one(&mut **tx)).await?;
    if !ok {
        return Err(InventoryItemError::Authority.into());
    }
    if let Some(at) = boundary {
        a.authorization.valid_until = a.authorization.valid_until.min(at)
    }
    proof.authorization = Some(a.authorization.clone());
    prescription_courses::check_authorization(tx, &proof).await?;
    Ok(proof)
}
async fn request_gate(tx: &mut Tx<'_>, facility: Uuid, key: Uuid) -> anyhow::Result<()> {
    let mut data = b"hms.inventory-item.request.v1".to_vec();
    data.extend_from_slice(facility.as_bytes());
    data.extend_from_slice(key.as_bytes());
    let d = hash(data);
    let n = i64::from_be_bytes(d[..8].try_into()?);
    let ok: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(n)
        .fetch_one(&mut **tx)
        .await?;
    if !ok {
        return Err(InventoryItemError::Busy.into());
    }
    Ok(())
}
async fn code_gate(tx: &mut Tx<'_>, facility: Uuid, codes: Vec<String>) -> anyhow::Result<()> {
    sqlx::query("SELECT inventory_item_reserve_codes($1,$2)")
        .bind(facility)
        .bind(codes)
        .execute(&mut **tx)
        .await
        .map_err(sql_error)?;
    Ok(())
}
async fn category(tx: &mut Tx<'_>, facility: Uuid, id: Uuid) -> anyhow::Result<()> {
    let row:Option<Uuid>=sqlx::query_scalar("SELECT id FROM inventory_categories WHERE facility_id=$1 AND id=$2 AND is_active FOR SHARE NOWAIT").bind(facility).bind(id).fetch_optional(&mut **tx).await.map_err(sql_error)?;
    if row.is_none() {
        return Err(InventoryItemError::InvalidSource.into());
    }
    Ok(())
}
async fn state_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    id: Uuid,
    lock: bool,
) -> anyhow::Result<GovernedInventoryItem> {
    let mut q = base_query();
    q.push_bind(facility).push(" AND i.id=").push_bind(id);
    if lock {
        q.push(" FOR UPDATE OF i NOWAIT");
    }
    let row = q
        .build_query_as::<Row>()
        .fetch_optional(&mut **tx)
        .await
        .map_err(sql_error)?
        .ok_or(InventoryItemError::NotFound)?;
    Ok(row.into())
}
async fn has_history(tx: &mut Tx<'_>, id: Uuid) -> anyhow::Result<bool> {
    Ok(hms_observability::observe_db_query(
        "inventory.item.source.history",
        sqlx::query_scalar("SELECT inventory_item_has_operational_history($1)")
            .bind(id)
            .fetch_one(&mut **tx),
    )
    .await?)
}
#[derive(FromRow)]
struct Saved {
    actor_user_id: Uuid,
    payload_digest: Vec<u8>,
    receipt: Json<InventoryItemCommandReceipt>,
}
pub async fn command(
    pool: &PgPool,
    mut actor: InventoryItemActor,
    input: InventoryItemReviewedInput,
) -> anyhow::Result<InventoryItemCommandReceipt> {
    validate_identity(&input)?;
    let (key, id, expected, action) = facts(&input);
    let key_hash = hash(key.as_bytes());
    let mut tx = pool.begin().await?;
    let proof = authority(&mut tx, &mut actor).await?;
    request_gate(&mut tx, actor.facility_id, key).await?;
    let saved=sqlx::query_as::<_,Saved>("SELECT actor_user_id,payload_digest,receipt FROM inventory_item_commands WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(&key_hash).fetch_optional(&mut *tx).await?;
    if let Some(saved) = saved {
        if saved.actor_user_id != actor.user_id
            || facts(&saved.receipt.0.reviewed_input).3 != action
        {
            return Err(InventoryItemError::RequestConflict.into());
        }
        let before = saved
            .receipt
            .0
            .correction_revision
            .as_ref()
            .map(|r| &r.before);
        let normalized = normalize(input, before)?;
        if digest(&normalized)? != saved.payload_digest {
            return Err(InventoryItemError::RequestConflict.into());
        }
        prescription_courses::check_authorization(&mut tx, &proof).await?;
        tx.commit().await?;
        return Ok(saved.receipt.0);
    }
    let before = match id {
        Some(id) => Some(state_tx(&mut tx, actor.facility_id, id, true).await?),
        None => None,
    };
    if let (Some(expected), Some(item)) = (expected, before.as_ref()) {
        if expected != item.version {
            return Err(InventoryItemError::VersionConflict.into());
        }
    }
    let before_projection = before.as_ref().map(projection);
    let input = normalize(input, before_projection.as_ref())?;
    let payload_digest = digest(&input)?;
    let (now, today): (DateTime<Utc>, NaiveDate) = sqlx::query_as(
        "SELECT point,(point AT TIME ZONE 'UTC')::date FROM(SELECT clock_timestamp() point)n",
    )
    .fetch_one(&mut *tx)
    .await?;
    let (mut item, changed, revision) = match &input {
        InventoryItemReviewedInput::Create {
            category_id,
            code,
            name,
            unit,
            item_type,
            ..
        } => {
            category(&mut tx, actor.facility_id, *category_id).await?;
            code_gate(&mut tx, actor.facility_id, vec![code.clone()]).await?;
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM inventory_items WHERE facility_id=$1 AND code=$2)",
            )
            .bind(actor.facility_id)
            .bind(code)
            .fetch_one(&mut *tx)
            .await?;
            if exists {
                return Err(InventoryItemError::CodeConflict.into());
            }
            let id = Uuid::new_v4();
            let kind = match item_type {
                OrdinaryInventoryItemType::Medication => "medication",
                OrdinaryInventoryItemType::Supply => "supply",
            };
            sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,unit,item_type,controlled,is_active,created_at,updated_at,catalog_changed_at)VALUES($1,$2,$3,$4,$5,$6,$7,false,true,$8,$8,$8)").bind(id).bind(actor.facility_id).bind(category_id).bind(code).bind(name).bind(unit).bind(kind).bind(now).execute(&mut *tx).await.map_err(sql_error)?;
            (
                state_tx(&mut tx, actor.facility_id, id, false).await?,
                true,
                None,
            )
        }
        InventoryItemReviewedInput::Correct {
            effective_from,
            code,
            name,
            unit,
            ..
        } => {
            if *effective_from > today {
                return Err(InventoryItemError::Invalid.into());
            }
            let before = before.as_ref().ok_or(InventoryItemError::InvalidSource)?;
            let changed = before.code != *code || before.name != *name || before.unit != *unit;
            if before.unit != *unit {
                if !ordinary(before) {
                    return Err(InventoryItemError::ControlledOrUnsupported.into());
                }
                if has_history(&mut tx, before.id).await? {
                    return Err(InventoryItemError::OperationalHistory.into());
                }
            }
            if before.code != *code {
                code_gate(
                    &mut tx,
                    actor.facility_id,
                    vec![before.code.clone(), code.clone()],
                )
                .await?;
                let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM inventory_items WHERE facility_id=$1 AND code=$2 AND id<>$3)").bind(actor.facility_id).bind(code).bind(before.id).fetch_one(&mut *tx).await?;
                if exists {
                    return Err(InventoryItemError::CodeConflict.into());
                }
            }
            if changed {
                sqlx::query("UPDATE inventory_items SET code=$3,name=$4,unit=$5,version=version+1,catalog_changed_at=$6,updated_at=$6 WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(before.id).bind(code).bind(name).bind(unit).bind(now).execute(&mut *tx).await.map_err(sql_error)?;
            }
            let item = state_tx(&mut tx, actor.facility_id, before.id, false).await?;
            let revision = InventoryItemCorrectionRevision {
                id: Uuid::new_v4(),
                reviewed_effective_from: *effective_from,
                recorded_at: now,
                before: projection(before),
                after: projection(&item),
                projection_changed: changed,
            };
            (item, changed, Some(revision))
        }
        InventoryItemReviewedInput::Retire { .. }
        | InventoryItemReviewedInput::Reactivate { .. } => {
            let before = before.as_ref().ok_or(InventoryItemError::InvalidSource)?;
            if !ordinary(before) {
                return Err(InventoryItemError::ControlledOrUnsupported.into());
            }
            if has_history(&mut tx, before.id).await? {
                return Err(InventoryItemError::OperationalHistory.into());
            }
            let active = action == "reactivate";
            if active {
                category(&mut tx, actor.facility_id, before.category_id).await?;
                for text in [&before.code, &before.name, &before.unit] {
                    if normalize_new(text.clone()).ok().as_ref() != Some(text) {
                        return Err(InventoryItemError::InvalidSource.into());
                    }
                }
            }
            let changed = before.is_active != active;
            if changed {
                sqlx::query("UPDATE inventory_items SET is_active=$3,version=version+1,catalog_changed_at=$4,updated_at=$4 WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(before.id).bind(active).bind(now).execute(&mut *tx).await.map_err(sql_error)?;
            }
            (
                state_tx(&mut tx, actor.facility_id, before.id, false).await?,
                changed,
                None,
            )
        }
    };
    // The original result records one point/category observation, not later current state.
    item.effective_controlled = item.controlled || item.item_type == "controlled_substance";
    let receipt = InventoryItemCommandReceipt {
        client_request_id: key,
        input_digest: payload_digest.iter().map(|v| format!("{v:02x}")).collect(),
        reviewed_input: input,
        recorded_by_user_id: actor.user_id,
        item,
        changed,
        recorded_at: now,
        correction_revision: revision,
    };
    sqlx::query("INSERT INTO inventory_item_commands(facility_id,request_key_hash,actor_user_id,item_id,action,payload_digest,receipt,recorded_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(actor.facility_id).bind(&key_hash).bind(actor.user_id).bind(receipt.item.id).bind(action).bind(&payload_digest).bind(Json(&receipt)).bind(now).execute(&mut *tx).await?;
    if let Some(r) = &receipt.correction_revision {
        sqlx::query("INSERT INTO inventory_item_catalog_revisions(id,facility_id,item_id,request_key_hash,reviewed_effective_from,recorded_at,before_code,before_name,before_unit,before_version,after_code,after_name,after_unit,after_version,projection_changed,reason_present)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true)").bind(r.id).bind(actor.facility_id).bind(receipt.item.id).bind(&key_hash).bind(r.reviewed_effective_from).bind(now).bind(&r.before.code).bind(&r.before.name).bind(&r.before.unit).bind(r.before.version).bind(&r.after.code).bind(&r.after.name).bind(&r.after.unit).bind(r.after.version).bind(r.projection_changed).execute(&mut *tx).await?;
    }
    crate::admin::insert_audit_event_tx(
        &mut tx,
        crate::admin::NewAuditEvent {
            facility_id: actor.facility_id,
            actor_user_id: Some(actor.user_id),
            request_id: Some(actor.request_id),
            event_type: format!("inventory.item.{action}"),
            resource_type: "inventory_item".into(),
            resource_id: Some(receipt.item.id),
            metadata: json!({"action":action,"version":receipt.item.version,"changed":changed}),
        },
    )
    .await?;
    // Re-evaluate both date and all retained proof at final DB time, after audit waits.
    if let InventoryItemReviewedInput::Correct { effective_from, .. } = &receipt.reviewed_input {
        let today: NaiveDate =
            sqlx::query_scalar("SELECT(clock_timestamp() AT TIME ZONE 'UTC')::date")
                .fetch_one(&mut *tx)
                .await?;
        if *effective_from > today {
            return Err(InventoryItemError::Invalid.into());
        }
    }
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(receipt)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: InventoryItemActor,
    key: Uuid,
) -> anyhow::Result<InventoryItemCommandReceipt> {
    if key.is_nil() {
        return Err(InventoryItemError::Invalid.into());
    }
    let mut tx = pool.begin().await?;
    let proof = authority(&mut tx, &mut actor).await?;
    let receipt=sqlx::query_scalar::<_,Json<InventoryItemCommandReceipt>>("SELECT receipt FROM inventory_item_commands WHERE facility_id=$1 AND actor_user_id=$2 AND request_key_hash=$3").bind(actor.facility_id).bind(actor.user_id).bind(hash(key.as_bytes())).fetch_optional(&mut *tx).await?.ok_or(InventoryItemError::NotFound)?;
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(receipt.0)
}
pub async fn detail(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<InventoryItemAdministration>> {
    let mut q = base_query();
    q.push_bind(facility).push(" AND i.id=").push_bind(id);
    let row = hms_observability::observe_db_query(
        "inventory.item.admin.detail",
        q.build_query_as::<Row>().fetch_optional(pool),
    )
    .await?;
    let Some(row) = row else { return Ok(None) };
    let item: GovernedInventoryItem = row.into();
    let blocker = if !ordinary(&item) {
        Some(InventoryItemEligibilityBlocker::ControlledOrUnsupported)
    } else {
        let used: bool = hms_observability::observe_db_query(
            "inventory.item.admin.eligibility",
            sqlx::query_scalar("SELECT inventory_item_has_operational_history($1)")
                .bind(id)
                .fetch_one(pool),
        )
        .await?;
        used.then_some(InventoryItemEligibilityBlocker::OperationalReference)
    };
    Ok(Some(InventoryItemAdministration {
        item,
        eligibility: InventoryItemEligibility {
            unit_change_blocked_by: blocker,
            lifecycle_blocked_by: blocker,
        },
    }))
}
pub async fn list(
    pool: &PgPool,
    facility: Uuid,
    cursor: Option<super::InventoryCursor>,
    limit: i64,
    query: InventoryItemAdministrationQuery,
) -> anyhow::Result<Vec<GovernedInventoryItem>> {
    let mut q = base_query();
    q.push_bind(facility);
    if let Some(active) = query.is_active {
        q.push(" AND i.is_active=").push_bind(active);
    }
    if let Some(pattern) = search_pattern(query.search.as_deref()) {
        q.push(" AND(i.code ILIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR i.name ILIKE ")
            .push_bind(pattern)
            .push(" ESCAPE '\\')");
    }
    super::apply_cursor(&mut q, "i.created_at", "i.id", cursor);
    q.push(" ORDER BY i.created_at DESC,i.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = hms_observability::observe_db_query(
        "inventory.item.admin.page",
        q.build_query_as::<Row>().fetch_all(pool),
    )
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}
#[derive(Clone, Copy, Debug)]
pub struct InventoryItemHistoryCursor {
    pub recorded_at: DateTime<Utc>,
    pub source_rank: u8,
    pub id: Uuid,
}
#[derive(FromRow)]
struct Legacy {
    id: Uuid,
    effective_from: NaiveDate,
    effective_to: Option<NaiveDate>,
    code: String,
    name: String,
    unit: String,
    recorded_at: DateTime<Utc>,
    reason_present: bool,
}
#[derive(FromRow)]
struct Revision {
    id: Uuid,
    reviewed_effective_from: NaiveDate,
    recorded_at: DateTime<Utc>,
    before_code: String,
    before_name: String,
    before_unit: String,
    before_version: i64,
    after_code: String,
    after_name: String,
    after_unit: String,
    after_version: i64,
    projection_changed: bool,
    reason_present: bool,
}
pub async fn history(
    pool: &PgPool,
    facility: Uuid,
    item: Uuid,
    cursor: Option<InventoryItemHistoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<InventoryItemHistoryRow>> {
    let exists: bool = hms_observability::observe_db_query(
        "inventory.item.history.source",
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM inventory_items WHERE facility_id=$1 AND id=$2)",
        )
        .bind(facility)
        .bind(item)
        .fetch_one(pool),
    )
    .await?;
    if !exists {
        return Err(InventoryItemError::NotFound.into());
    }
    let limit = limit.clamp(1, 101);
    let at = cursor.map(|c| c.recorded_at);
    let rank = cursor.map(|c| i16::from(c.source_rank));
    let id = cursor.map(|c| c.id);
    let legacy=hms_observability::observe_db_query("inventory.item.history.legacy",sqlx::query_as::<_,Legacy>("SELECT id,effective_from,effective_to,code,name,unit,created_at AS recorded_at,(reason IS NOT NULL AND reason<>'') AS reason_present FROM inventory_item_catalog_versions WHERE facility_id=$1 AND item_id=$2 AND($3::timestamptz IS NULL OR(created_at,0::smallint,id)<($3,$4,$5)) ORDER BY created_at DESC,id DESC LIMIT $6").bind(facility).bind(item).bind(at).bind(rank).bind(id).bind(limit).fetch_all(pool)).await?;
    let governed=hms_observability::observe_db_query("inventory.item.history.current",sqlx::query_as::<_,Revision>("SELECT id,reviewed_effective_from,recorded_at,before_code,before_name,before_unit,before_version,after_code,after_name,after_unit,after_version,projection_changed,reason_present FROM inventory_item_catalog_revisions WHERE facility_id=$1 AND item_id=$2 AND($3::timestamptz IS NULL OR(recorded_at,1::smallint,id)<($3,$4,$5)) ORDER BY recorded_at DESC,id DESC LIMIT $6").bind(facility).bind(item).bind(at).bind(rank).bind(id).bind(limit).fetch_all(pool)).await?;
    let mut rows: Vec<_> = legacy
        .into_iter()
        .map(|r| InventoryItemHistoryRow::LegacyDatedVersion {
            id: r.id,
            effective_from: r.effective_from,
            effective_to: r.effective_to,
            code: r.code,
            name: r.name,
            unit: r.unit,
            recorded_at: r.recorded_at,
            reason_present: r.reason_present,
        })
        .chain(
            governed
                .into_iter()
                .map(|r| InventoryItemHistoryRow::GovernedCorrection {
                    id: r.id,
                    reviewed_effective_from: r.reviewed_effective_from,
                    recorded_at: r.recorded_at,
                    before: InventoryItemProjection {
                        code: r.before_code,
                        name: r.before_name,
                        unit: r.before_unit,
                        version: r.before_version,
                    },
                    after: InventoryItemProjection {
                        code: r.after_code,
                        name: r.after_name,
                        unit: r.after_unit,
                        version: r.after_version,
                    },
                    projection_changed: r.projection_changed,
                    reason_present: r.reason_present,
                }),
        )
        .collect();
    rows.sort_by_key(|r| std::cmp::Reverse(r.cursor_facts()));
    rows.truncate(limit as usize);
    Ok(rows)
}

fn search_pattern(s: Option<&str>) -> Option<String> {
    s.map(str::trim).filter(|v| !v.is_empty()).map(|v| {
        format!(
            "%{}%",
            v.replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        )
    })
}

#[derive(FromRow)]
struct Category {
    id: Uuid,
    code: String,
    name: String,
}
pub async fn categories(
    pool: &PgPool,
    facility: Uuid,
    anchor: Option<Uuid>,
    limit: i64,
    search: Option<&str>,
) -> anyhow::Result<Vec<hms_domain::inventory::InventoryCategoryListItem>> {
    let pattern = search_pattern(search);
    let rows=hms_observability::observe_db_query("inventory.item.categories.page",sqlx::query_as::<_,Category>(r#"SELECT c.id,c.code,c.name FROM inventory_categories c WHERE c.facility_id=$1 AND c.is_active AND($2::uuid IS NULL OR(c.code,c.id)>(SELECT a.code,a.id FROM inventory_categories a WHERE a.facility_id=$1 AND a.id=$2)) AND($3::text IS NULL OR c.code ILIKE $3 ESCAPE '\' OR c.name ILIKE $3 ESCAPE '\') ORDER BY c.code,c.id LIMIT $4"#).bind(facility).bind(anchor).bind(pattern).bind(limit.clamp(1,101)).fetch_all(pool)).await?;
    Ok(rows
        .into_iter()
        .map(|r| hms_domain::inventory::InventoryCategoryListItem {
            id: r.id,
            code: r.code,
            name: r.name,
        })
        .collect())
}
