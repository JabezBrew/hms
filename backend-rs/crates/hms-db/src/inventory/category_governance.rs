//! Current category metadata and direct-parent publication; no inherited item meaning.
use crate::clinical::prescription_courses;
use crate::PgPool;
use chrono::{DateTime, Utc};
use hms_domain::inventory_categories::*;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{types::Json, FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;
type Tx<'a> = Transaction<'a, Postgres>;
pub type InventoryCategoryActor = super::items::InventoryItemActor;
/// Compatible category name for the shared retained inventory read proof.
pub type InventoryCategoryReadActor = super::read_access::InventoryReadActor;
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InventoryCategoryError {
    Invalid,
    InvalidSource,
    NotFound,
    VersionConflict,
    RequestConflict,
    CodeConflict,
    ItemReference,
    ChildReference,
    Authority,
    Busy,
}
impl std::fmt::Display for InventoryCategoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Current inventory category review is required.")
    }
}
impl std::error::Error for InventoryCategoryError {}
pub fn database_error(error: &sqlx::Error) -> Option<InventoryCategoryError> {
    let d = error.as_database_error()?;
    if d.code().as_deref() == Some("55P03") {
        return Some(InventoryCategoryError::Busy);
    }
    match d.message() {
        "inventory_category_code_conflict" => Some(InventoryCategoryError::CodeConflict),
        "inventory_category_item_reference" => Some(InventoryCategoryError::ItemReference),
        "inventory_category_child_reference" => Some(InventoryCategoryError::ChildReference),
        "inventory_category_parent_unavailable" => Some(InventoryCategoryError::InvalidSource),
        "inventory_category_invalid" => Some(InventoryCategoryError::Invalid),
        _ => None,
    }
}
fn sql_error(e: sqlx::Error) -> anyhow::Error {
    match database_error(&e) {
        Some(v) => v.into(),
        None => e.into(),
    }
}
#[derive(FromRow)]
struct Row {
    id: Uuid,
    code: String,
    name: String,
    description: Option<String>,
    parent_id: Option<Uuid>,
    parent_code: Option<String>,
    parent_name: Option<String>,
    parent_version: Option<i64>,
    parent_active: Option<bool>,
    is_active: bool,
    version: i64,
    catalog_changed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    created_by_user_id: Option<Uuid>,
    updated_by_user_id: Option<Uuid>,
}
const COLUMNS:&str="c.id,c.code,c.name,c.description,c.parent_id,p.code AS parent_code,p.name AS parent_name,p.version AS parent_version,p.is_active AS parent_active,c.is_active,c.version,c.catalog_changed_at,c.created_at,c.created_by_user_id,c.updated_by_user_id";
fn base_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(format!("SELECT {COLUMNS} FROM inventory_categories c LEFT JOIN inventory_categories p ON p.id=c.parent_id AND p.facility_id=c.facility_id WHERE c.facility_id="))
}
impl From<Row> for GovernedInventoryCategory {
    fn from(r: Row) -> Self {
        let parent = match (
            r.parent_id,
            r.parent_code,
            r.parent_name,
            r.parent_version,
            r.parent_active,
        ) {
            (Some(id), Some(code), Some(name), Some(version), Some(is_active)) => {
                Some(InventoryCategoryParent {
                    id,
                    code,
                    name,
                    version,
                    is_active,
                })
            }
            _ => None,
        };
        Self {
            id: r.id,
            code: r.code,
            name: r.name,
            description: r.description,
            parent_id: r.parent_id,
            parent,
            is_active: r.is_active,
            version: r.version,
            catalog_changed_at: r.catalog_changed_at,
            created_at: r.created_at,
            created_by_user_id: r.created_by_user_id,
            updated_by_user_id: r.updated_by_user_id,
        }
    }
}

fn hash(v: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(v).to_vec()
}
fn text(s: String, max_chars: usize, max_bytes: usize) -> Result<String, InventoryCategoryError> {
    let s = s.trim().to_owned();
    if s.is_empty()
        || s.chars().count() > max_chars
        || s.len() > max_bytes
        || s.chars().any(char::is_control)
    {
        Err(InventoryCategoryError::Invalid)
    } else {
        Ok(s)
    }
}
fn description(
    s: Option<String>,
    old: Option<&Option<String>>,
) -> Result<Option<String>, InventoryCategoryError> {
    if old.is_some_and(|v| v == &s) {
        return Ok(s);
    }
    if s.as_ref().is_some_and(|v| {
        v.len() > 8000
            || v.chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    }) {
        Err(InventoryCategoryError::Invalid)
    } else {
        Ok(s)
    }
}
fn facts(i: &InventoryCategoryReviewedInput) -> (Uuid, Option<Uuid>, Option<i64>, &'static str) {
    match i {
        InventoryCategoryReviewedInput::Create {
            client_request_id, ..
        } => (*client_request_id, None, None, "create"),
        InventoryCategoryReviewedInput::Correct {
            client_request_id,
            category_id,
            expected_version,
            ..
        } => (
            *client_request_id,
            Some(*category_id),
            Some(*expected_version),
            "correct",
        ),
        InventoryCategoryReviewedInput::Retire {
            client_request_id,
            category_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*category_id),
            Some(*expected_version),
            "retire",
        ),
        InventoryCategoryReviewedInput::Reactivate {
            client_request_id,
            category_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*category_id),
            Some(*expected_version),
            "reactivate",
        ),
    }
}
fn selection(id: Uuid, version: i64) -> Result<(), InventoryCategoryError> {
    if id.is_nil() || version < 1 {
        Err(InventoryCategoryError::Invalid)
    } else {
        Ok(())
    }
}
fn validate_identity(i: &InventoryCategoryReviewedInput) -> Result<(), InventoryCategoryError> {
    let (k, id, v, _) = facts(i);
    if k.is_nil() || id.is_some_and(|v| v.is_nil()) || v.is_some_and(|v| v < 1) {
        return Err(InventoryCategoryError::Invalid);
    }
    match i {
        InventoryCategoryReviewedInput::Create {
            parent: Some(p), ..
        } => selection(p.parent_id, p.expected_parent_version),
        InventoryCategoryReviewedInput::Correct {
            parent_change:
                InventoryCategoryParentChange::Set {
                    parent_id,
                    expected_parent_version,
                },
            ..
        } => selection(*parent_id, *expected_parent_version),
        _ => Ok(()),
    }
}
fn normalize(
    i: InventoryCategoryReviewedInput,
    before: Option<&GovernedInventoryCategory>,
) -> Result<InventoryCategoryReviewedInput, InventoryCategoryError> {
    Ok(match i {
        InventoryCategoryReviewedInput::Create {
            client_request_id,
            code,
            name,
            description: desc,
            parent,
        } => InventoryCategoryReviewedInput::Create {
            client_request_id,
            code: text(code, 120, 480)?,
            name: text(name, 100, 400)?,
            description: description(desc, None)?,
            parent,
        },
        InventoryCategoryReviewedInput::Correct {
            client_request_id,
            category_id,
            expected_version,
            name,
            description: desc,
            parent_change,
            reason,
        } => {
            let b = before.ok_or(InventoryCategoryError::InvalidSource)?;
            InventoryCategoryReviewedInput::Correct {
                client_request_id,
                category_id,
                expected_version,
                name: if name == b.name {
                    name
                } else {
                    text(name, 100, 400)?
                },
                description: description(desc, Some(&b.description))?,
                parent_change,
                reason: text(reason, 1000, 4000)?,
            }
        }
        other => other,
    })
}
fn digest(i: &InventoryCategoryReviewedInput) -> anyhow::Result<Vec<u8>> {
    Ok(hash(serde_json::to_vec(&serde_json::to_value(i)?)?))
}
async fn authority(
    tx: &mut Tx<'_>,
    a: &mut InventoryCategoryActor,
) -> anyhow::Result<prescription_courses::PrescriptionActor> {
    super::items::authority(tx, a).await.map_err(|e| {
        if e.downcast_ref::<super::items::InventoryItemError>()
            == Some(&super::items::InventoryItemError::Authority)
        {
            InventoryCategoryError::Authority.into()
        } else {
            e
        }
    })
}
async fn read_authority(
    tx: &mut Tx<'_>,
    actor: &mut InventoryCategoryReadActor,
) -> anyhow::Result<prescription_courses::PrescriptionActor> {
    super::read_access::authority(tx, actor)
        .await
        .map_err(|error| {
            if error.downcast_ref::<super::read_access::InventoryReadError>()
                == Some(&super::read_access::InventoryReadError::Authority)
            {
                InventoryCategoryError::Authority.into()
            } else {
                error
            }
        })
}

async fn gate(tx: &mut Tx<'_>, facility: Uuid) -> anyhow::Result<()> {
    sqlx::query("SELECT inventory_category_graph_gate($1)")
        .bind(facility)
        .execute(&mut **tx)
        .await
        .map_err(sql_error)?;
    Ok(())
}
async fn request_gate(tx: &mut Tx<'_>, facility: Uuid, key: Uuid) -> anyhow::Result<()> {
    let mut data = b"hms.inventory-category.request.v1".to_vec();
    data.extend_from_slice(facility.as_bytes());
    data.extend_from_slice(key.as_bytes());
    let d = hash(data);
    let n = i64::from_be_bytes(d[..8].try_into()?);
    let ok: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(n)
        .fetch_one(&mut **tx)
        .await?;
    if !ok {
        return Err(InventoryCategoryError::Busy.into());
    }
    Ok(())
}
async fn state_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    id: Uuid,
    lock: bool,
) -> anyhow::Result<GovernedInventoryCategory> {
    let mut q = base_query();
    q.push_bind(facility).push(" AND c.id=").push_bind(id);
    if lock {
        q.push(" FOR UPDATE OF c NOWAIT");
    }
    let r = q
        .build_query_as::<Row>()
        .fetch_optional(&mut **tx)
        .await
        .map_err(sql_error)?
        .ok_or(InventoryCategoryError::NotFound)?;
    Ok(r.into())
}
async fn parent_proof(
    tx: &mut Tx<'_>,
    facility: Uuid,
    subject: Uuid,
    id: Option<Uuid>,
    expected: Option<i64>,
) -> anyhow::Result<()> {
    sqlx::query("SELECT inventory_category_parent_proof($1,$2,$3,$4)")
        .bind(facility)
        .bind(subject)
        .bind(id)
        .bind(expected)
        .execute(&mut **tx)
        .await
        .map_err(sql_error)?;
    Ok(())
}
async fn unused(tx: &mut Tx<'_>, id: Uuid) -> anyhow::Result<()> {
    let(item,child):(bool,bool)=sqlx::query_as("SELECT inventory_category_has_item_reference($1),inventory_category_has_child_reference($1)").bind(id).fetch_one(&mut **tx).await?;
    if item {
        return Err(InventoryCategoryError::ItemReference.into());
    }
    if child {
        return Err(InventoryCategoryError::ChildReference.into());
    }
    Ok(())
}
#[derive(FromRow)]
struct Saved {
    actor_user_id: Uuid,
    payload_digest: Vec<u8>,
    receipt: Json<InventoryCategoryCommandReceipt>,
}
pub async fn command(
    pool: &PgPool,
    mut actor: InventoryCategoryActor,
    input: InventoryCategoryReviewedInput,
) -> anyhow::Result<InventoryCategoryCommandReceipt> {
    validate_identity(&input)?;
    let (key, id, expected, action) = facts(&input);
    let key_hash = hash(key.as_bytes());
    let mut tx = pool.begin().await?;
    let proof = authority(&mut tx, &mut actor).await?;
    request_gate(&mut tx, actor.facility_id, key).await?;
    let saved=sqlx::query_as::<_,Saved>("SELECT actor_user_id,payload_digest,receipt FROM inventory_category_commands WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(&key_hash).fetch_optional(&mut *tx).await?;
    if let Some(saved) = saved {
        if saved.actor_user_id != actor.user_id
            || facts(&saved.receipt.0.reviewed_input).3 != action
        {
            return Err(InventoryCategoryError::RequestConflict.into());
        }
        let normalized = normalize(input, saved.receipt.0.before.as_ref())?;
        if digest(&normalized)? != saved.payload_digest {
            return Err(InventoryCategoryError::RequestConflict.into());
        }
        prescription_courses::check_authorization(&mut tx, &proof).await?;
        tx.commit().await?;
        return Ok(saved.receipt.0);
    }
    gate(&mut tx, actor.facility_id).await?;
    let before = match id {
        Some(id) => Some(state_tx(&mut tx, actor.facility_id, id, true).await?),
        None => None,
    };
    if let (Some(v), Some(c)) = (expected, before.as_ref()) {
        if v != c.version {
            return Err(InventoryCategoryError::VersionConflict.into());
        }
    }
    let input = normalize(input, before.as_ref())?;
    let payload_digest = digest(&input)?;
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await?;
    let (category, changed) = match &input {
        InventoryCategoryReviewedInput::Create {
            code,
            name,
            description,
            parent,
            ..
        } => {
            let id = Uuid::new_v4();
            let parent_id = parent.as_ref().map(|p| p.parent_id);
            parent_proof(
                &mut tx,
                actor.facility_id,
                id,
                parent_id,
                parent.as_ref().map(|p| p.expected_parent_version),
            )
            .await?;
            let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM inventory_categories WHERE facility_id=$1 AND code=$2)").bind(actor.facility_id).bind(code).fetch_one(&mut *tx).await?;
            if exists {
                return Err(InventoryCategoryError::CodeConflict.into());
            }
            sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name,description,parent_id,is_active,created_at,catalog_changed_at,created_by_user_id,updated_by_user_id)VALUES($1,$2,$3,$4,$5,$6,true,$7,$7,$8,$8)").bind(id).bind(actor.facility_id).bind(code).bind(name).bind(description).bind(parent_id).bind(now).bind(actor.user_id).execute(&mut *tx).await.map_err(sql_error)?;
            (state_tx(&mut tx, actor.facility_id, id, false).await?, true)
        }
        InventoryCategoryReviewedInput::Correct {
            name,
            description,
            parent_change,
            ..
        } => {
            let b = before
                .as_ref()
                .ok_or(InventoryCategoryError::InvalidSource)?;
            let parent_id = match parent_change {
                InventoryCategoryParentChange::Retain => b.parent_id,
                InventoryCategoryParentChange::Clear => None,
                InventoryCategoryParentChange::Set {
                    parent_id,
                    expected_parent_version,
                } => {
                    parent_proof(
                        &mut tx,
                        actor.facility_id,
                        b.id,
                        Some(*parent_id),
                        Some(*expected_parent_version),
                    )
                    .await?;
                    Some(*parent_id)
                }
            };
            let changed =
                b.name != *name || b.description != *description || b.parent_id != parent_id;
            if changed {
                sqlx::query("UPDATE inventory_categories SET name=$3,description=$4,parent_id=$5,version=version+1,catalog_changed_at=$6,updated_by_user_id=$7 WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(b.id).bind(name).bind(description).bind(parent_id).bind(now).bind(actor.user_id).execute(&mut *tx).await.map_err(sql_error)?;
            }
            (
                state_tx(&mut tx, actor.facility_id, b.id, false).await?,
                changed,
            )
        }
        InventoryCategoryReviewedInput::Retire { .. }
        | InventoryCategoryReviewedInput::Reactivate { .. } => {
            let b = before
                .as_ref()
                .ok_or(InventoryCategoryError::InvalidSource)?;
            unused(&mut tx, b.id).await?;
            let active = action == "reactivate";
            if active {
                parent_proof(&mut tx, actor.facility_id, b.id, b.parent_id, None).await?;
            }
            let changed = b.is_active != active;
            if changed {
                sqlx::query("UPDATE inventory_categories SET is_active=$3,version=version+1,catalog_changed_at=$4,updated_by_user_id=$5 WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(b.id).bind(active).bind(now).bind(actor.user_id).execute(&mut *tx).await.map_err(sql_error)?;
            }
            (
                state_tx(&mut tx, actor.facility_id, b.id, false).await?,
                changed,
            )
        }
    };
    let receipt = InventoryCategoryCommandReceipt {
        client_request_id: key,
        input_digest: payload_digest.iter().map(|v| format!("{v:02x}")).collect(),
        reviewed_input: input,
        recorded_by_user_id: actor.user_id,
        category,
        before,
        changed,
        recorded_at: now,
    };
    let command_id = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_category_commands(id,facility_id,request_key_hash,actor_user_id,category_id,action,payload_digest,receipt,recorded_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(command_id).bind(actor.facility_id).bind(&key_hash).bind(actor.user_id).bind(receipt.category.id).bind(action).bind(&payload_digest).bind(Json(&receipt)).bind(now).execute(&mut *tx).await?;
    crate::admin::insert_audit_event_tx(&mut tx,crate::admin::NewAuditEvent{facility_id:actor.facility_id,actor_user_id:Some(actor.user_id),request_id:Some(actor.request_id),event_type:format!("inventory.category.{action}"),resource_type:"inventory_category".into(),resource_id:Some(receipt.category.id),metadata:json!({"action":action,"version":receipt.category.version,"changed":changed,"command_id":command_id})}).await?;
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(receipt)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: InventoryCategoryActor,
    key: Uuid,
) -> anyhow::Result<InventoryCategoryCommandReceipt> {
    if key.is_nil() {
        return Err(InventoryCategoryError::Invalid.into());
    }
    let mut tx = pool.begin().await?;
    let proof = authority(&mut tx, &mut actor).await?;
    let r=sqlx::query_scalar::<_,Json<InventoryCategoryCommandReceipt>>("SELECT receipt FROM inventory_category_commands WHERE facility_id=$1 AND actor_user_id=$2 AND request_key_hash=$3").bind(actor.facility_id).bind(actor.user_id).bind(hash(key.as_bytes())).fetch_optional(&mut *tx).await?.ok_or(InventoryCategoryError::NotFound)?;
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(r.0)
}
pub async fn detail(
    pool: &PgPool,
    mut actor: InventoryCategoryReadActor,
    id: Uuid,
) -> anyhow::Result<Option<InventoryCategoryAdministration>> {
    let mut tx = pool.begin().await?;
    let proof = read_authority(&mut tx, &mut actor).await?;
    let mut q = base_query();
    q.push_bind(actor.facility_id)
        .push(" AND c.id=")
        .push_bind(id);
    let row = hms_observability::observe_db_query(
        "inventory.category.admin.detail",
        q.build_query_as::<Row>().fetch_optional(&mut *tx),
    )
    .await?;
    let result = if let Some(row) = row {
        let category: GovernedInventoryCategory = row.into();
        let (item, child): (bool, bool) = hms_observability::observe_db_query(
            "inventory.category.admin.eligibility",
            sqlx::query_as("SELECT inventory_category_has_item_reference($1),inventory_category_has_child_reference($1)")
                .bind(id)
                .fetch_one(&mut *tx),
        )
        .await?;
        let lifecycle_blocked_by = if item {
            Some(InventoryCategoryEligibilityBlocker::ItemReference)
        } else if child {
            Some(InventoryCategoryEligibilityBlocker::ChildReference)
        } else {
            None
        };
        let parent_unavailable =
            category.parent_id.is_some() && category.parent.as_ref().is_none_or(|p| !p.is_active);
        Some(InventoryCategoryAdministration {
            category,
            eligibility: InventoryCategoryEligibility {
                lifecycle_blocked_by,
                parent_unavailable,
            },
        })
    } else {
        None
    };
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(result)
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
struct DirectoryRow {
    id: Uuid,
    code: String,
    name: String,
    is_active: bool,
    version: i64,
    parent_id: Option<Uuid>,
    catalog_changed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}
impl From<DirectoryRow> for InventoryCategoryAdministrationListItem {
    fn from(r: DirectoryRow) -> Self {
        Self {
            id: r.id,
            code: r.code,
            name: r.name,
            is_active: r.is_active,
            version: r.version,
            parent_id: r.parent_id,
            catalog_changed_at: r.catalog_changed_at,
            created_at: r.created_at,
        }
    }
}
pub async fn list(
    pool: &PgPool,
    mut actor: InventoryCategoryReadActor,
    cursor: Option<super::InventoryCursor>,
    limit: i64,
    query: InventoryCategoryAdministrationQuery,
) -> anyhow::Result<Vec<InventoryCategoryAdministrationListItem>> {
    let mut tx = pool.begin().await?;
    let proof = read_authority(&mut tx, &mut actor).await?;
    let mut q=QueryBuilder::<Postgres>::new("SELECT c.id,c.code,c.name,c.is_active,c.version,c.parent_id,c.catalog_changed_at,c.created_at FROM inventory_categories c WHERE c.facility_id=");
    q.push_bind(actor.facility_id);
    if let Some(active) = query.is_active {
        q.push(" AND c.is_active=").push_bind(active);
    }
    if let Some(pattern) = search_pattern(query.search.as_deref()) {
        q.push(" AND(c.code||' '||c.name) ILIKE ")
            .push_bind(pattern)
            .push(" ESCAPE '\\'");
    }
    super::apply_cursor(&mut q, "c.created_at", "c.id", cursor);
    q.push(" ORDER BY c.created_at DESC,c.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = hms_observability::observe_db_query(
        "inventory.category.admin.page",
        q.build_query_as::<DirectoryRow>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows.into_iter().map(Into::into).collect();
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(result)
}
#[derive(FromRow)]
struct History {
    id: Uuid,
    action: String,
    recorded_at: DateTime<Utc>,
    before_version: Option<i64>,
    after_version: i64,
    name_changed: bool,
    description_changed: bool,
    parent_changed: bool,
    active_changed: bool,
}
pub async fn history(
    pool: &PgPool,
    mut actor: InventoryCategoryReadActor,
    category: Uuid,
    cursor: Option<super::InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<InventoryCategoryHistoryRow>> {
    let mut tx = pool.begin().await?;
    let proof = read_authority(&mut tx, &mut actor).await?;
    let exists: bool = hms_observability::observe_db_query(
        "inventory.category.history.source",
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM inventory_categories WHERE facility_id=$1 AND id=$2)",
        )
        .bind(actor.facility_id)
        .bind(category)
        .fetch_one(&mut *tx),
    )
    .await?;
    if !exists {
        prescription_courses::check_authorization(&mut tx, &proof).await?;
        tx.commit().await?;
        return Err(InventoryCategoryError::NotFound.into());
    }
    let mut q=QueryBuilder::<Postgres>::new("SELECT id,action,recorded_at,(receipt->'before'->>'version')::bigint AS before_version,(receipt->'category'->>'version')::bigint AS after_version,(receipt->'before'->>'name' IS DISTINCT FROM receipt->'category'->>'name') AS name_changed,(receipt->'before'->>'description' IS DISTINCT FROM receipt->'category'->>'description') AS description_changed,(receipt->'before'->>'parent_id' IS DISTINCT FROM receipt->'category'->>'parent_id') AS parent_changed,(receipt->'before'->>'is_active' IS DISTINCT FROM receipt->'category'->>'is_active') AS active_changed FROM inventory_category_commands WHERE facility_id=");
    q.push_bind(actor.facility_id)
        .push(" AND category_id=")
        .push_bind(category);
    super::apply_cursor(&mut q, "recorded_at", "id", cursor);
    q.push(" ORDER BY recorded_at DESC,id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = hms_observability::observe_db_query(
        "inventory.category.history.page",
        q.build_query_as::<History>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows
        .into_iter()
        .map(|r| InventoryCategoryHistoryRow {
            id: r.id,
            action: r.action,
            recorded_at: r.recorded_at,
            before_version: r.before_version,
            after_version: r.after_version,
            name_changed: r.name_changed,
            description_changed: r.description_changed,
            parent_changed: r.parent_changed,
            active_changed: r.active_changed,
        })
        .collect();
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(result)
}
