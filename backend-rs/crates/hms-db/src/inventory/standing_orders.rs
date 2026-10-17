//! Governed templates and immutable generated request snapshots.
use super::{apply_cursor, InventoryCursor};
use crate::{codec, PgPool};
use chrono::{Datelike, Days, Months, NaiveDate, Utc};
use hms_domain::inventory::StandingOrderStatus;
use hms_domain::inventory_standing::*;
use sqlx::{FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum StandingTemplateError {
    InvalidInput,
    ReferencesUnavailable,
    VersionConflict,
    Terminal,
    NotDue,
    OccurrenceChanged,
    UnitChanged,
    IncompleteSnapshot,
}
impl StandingTemplateError {
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidInput => {
                "Provide a name, valid schedule, distinct locations and 1–100 distinct items with positive quantities."
            }
            Self::ReferencesUnavailable => {
                "Locations and items must be active in this facility. Controlled items require their dedicated workflow."
            }
            Self::VersionConflict => "The template changed. Reload it before continuing.",
            Self::Terminal => "A cancelled template cannot be changed or generate another request.",
            Self::NotDue => {
                "Only an active template that is due today or earlier can generate a request."
            }
            Self::OccurrenceChanged => {
                "The scheduled occurrence changed. Reload the template before generating a request."
            }
            Self::UnitChanged => {
                "An item unit changed after this template was configured. Review and save the template before generating a request."
            }
            Self::IncompleteSnapshot => {
                "The saved template or request is incomplete and requires review."
            }
        }
    }
}
impl std::fmt::Display for StandingTemplateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}
impl std::error::Error for StandingTemplateError {}

pub struct TemplateActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: Option<String>,
}

#[derive(FromRow)]
struct TemplateRow {
    id: Uuid,
    name: String,
    requesting_location_id: Uuid,
    requesting_location_name: String,
    fulfilling_location_id: Uuid,
    fulfilling_location_name: String,
    frequency: String,
    status: String,
    next_run_on: NaiveDate,
    monthly_day: Option<i32>,
    version: i64,
    line_count: i32,
    notes: Option<String>,
    last_requisition_id: Option<Uuid>,
    last_generated_at: Option<chrono::DateTime<Utc>>,
    created_at: chrono::DateTime<Utc>,
}
#[derive(FromRow)]
struct TemplateItemRow {
    id: Uuid,
    item_id: Uuid,
    item_code: String,
    item_name: String,
    unit: String,
    current_unit: String,
    quantity: i64,
}
#[derive(FromRow)]
struct CatalogItem {
    id: Uuid,
    code: String,
    name: String,
    unit: String,
}
#[derive(FromRow)]
struct ReviewRow {
    id: Uuid,
    requesting_location_id: Uuid,
    requesting_location_name: String,
    fulfilling_location_id: Uuid,
    fulfilling_location_name: String,
    status: String,
    source_template_id: Uuid,
    template_version: i64,
    scheduled_for: NaiveDate,
    created_at: chrono::DateTime<Utc>,
    line_count: i32,
    approved_at: Option<chrono::DateTime<Utc>>,
    approved_by_user_id: Option<Uuid>,
    fulfilled_at: Option<chrono::DateTime<Utc>>,
    fulfilled_by_user_id: Option<Uuid>,
    cancelled_at: Option<chrono::DateTime<Utc>>,
}
#[derive(FromRow)]
struct ReviewItemRow {
    id: Uuid,
    item_id: Uuid,
    item_code: String,
    item_name: String,
    unit: String,
    quantity_requested: i64,
    quantity_issued: i64,
}

fn template_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"SELECT t.id,t.name,t.requesting_location_id,r.name AS requesting_location_name,
        t.fulfilling_location_id,f.name AS fulfilling_location_name,t.frequency,t.status,
        t.next_run_on,t.monthly_day,t.version,t.line_count,t.notes,t.created_at,
        last_run.requisition_id AS last_requisition_id,last_run.generated_at AS last_generated_at
        FROM inventory_standing_order_templates t
        JOIN storage_locations r ON r.id=t.requesting_location_id AND r.facility_id=t.facility_id
        JOIN storage_locations f ON f.id=t.fulfilling_location_id AND f.facility_id=t.facility_id
        LEFT JOIN LATERAL(SELECT requisition_id,generated_at FROM inventory_standing_order_runs
            WHERE facility_id=t.facility_id AND template_id=t.id
            ORDER BY generated_at DESC,id DESC LIMIT 1) last_run ON TRUE"#,
    )
}
fn summary(r: TemplateRow) -> anyhow::Result<(StandingTemplateListItem, Option<String>)> {
    Ok((
        StandingTemplateListItem {
            id: r.id,
            name: r.name,
            requesting_location_id: r.requesting_location_id,
            requesting_location_name: r.requesting_location_name,
            fulfilling_location_id: r.fulfilling_location_id,
            fulfilling_location_name: r.fulfilling_location_name,
            frequency: codec::decode(&r.frequency)?,
            status: codec::decode(&r.status)?,
            next_run_on: r.next_run_on,
            monthly_day: r.monthly_day,
            version: r.version,
            line_count: r.line_count,
            last_requisition_id: r.last_requisition_id,
            last_generated_at: r.last_generated_at,
            created_at: r.created_at,
        },
        r.notes,
    ))
}
pub async fn list_standing_templates(
    pool: &PgPool,
    facility: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
    query: StandingTemplateListQuery,
) -> anyhow::Result<Vec<StandingTemplateListItem>> {
    let mut q = template_query();
    q.push(" WHERE t.facility_id=").push_bind(facility);
    if let Some(status) = query.status {
        q.push(" AND t.status=").push_bind(codec::encode(status)?);
    }
    if query.due_only == Some(true) {
        q.push(" AND t.status='active' AND t.next_run_on <= ")
            .push_bind(Utc::now().date_naive());
    }
    if let Some(search) = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let escaped = search
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        q.push(" AND (t.name ILIKE ")
            .push_bind(format!("%{escaped}%"))
            .push(" ESCAPE '\\' OR r.name ILIKE ")
            .push_bind(format!("%{escaped}%"))
            .push(" ESCAPE '\\')");
    }
    apply_cursor(&mut q, "t.created_at", "t.id", cursor);
    q.push(" ORDER BY t.created_at DESC,t.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    q.build_query_as::<TemplateRow>()
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| Ok(summary(r)?.0))
        .collect()
}
pub async fn get_standing_template(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<StandingTemplateDetail>> {
    let mut tx = pool.begin().await?;
    // A shared parent lock gives the header and item rows one coherent version.
    let exists=sqlx::query_scalar::<_,Uuid>("SELECT id FROM inventory_standing_order_templates WHERE facility_id=$1 AND id=$2 FOR SHARE")
        .bind(facility).bind(id).fetch_optional(&mut *tx).await?;
    if exists.is_none() {
        return Ok(None);
    }
    let result = detail_tx(&mut tx, facility, id).await?;
    tx.commit().await?;
    Ok(Some(result))
}
async fn detail_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<StandingTemplateDetail> {
    let mut q = template_query();
    q.push(" WHERE t.facility_id=")
        .push_bind(facility)
        .push(" AND t.id=")
        .push_bind(id);
    let (summary, notes) = summary(
        q.build_query_as::<TemplateRow>()
            .fetch_one(&mut **tx)
            .await?,
    )?;
    let items = template_items(tx, facility, id).await?;
    if items.len() != summary.line_count as usize {
        return Err(StandingTemplateError::IncompleteSnapshot.into());
    }
    Ok(StandingTemplateDetail {
        summary,
        notes,
        items: items
            .into_iter()
            .map(|i| StandingTemplateItem {
                id: i.id,
                item_id: i.item_id,
                item_code: i.item_code,
                item_name: i.item_name,
                requires_unit_review: i.unit != i.current_unit,
                unit: i.unit,
                current_unit: i.current_unit,
                quantity: i.quantity,
            })
            .collect(),
    })
}
async fn template_items(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Vec<TemplateItemRow>> {
    Ok(sqlx::query_as("SELECT line.id,line.item_id,line.item_code,line.item_name,line.unit,item.unit AS current_unit,line.quantity FROM inventory_standing_order_template_items line JOIN inventory_items item ON item.id=line.item_id AND item.facility_id=line.facility_id WHERE line.facility_id=$1 AND line.template_id=$2 ORDER BY line.item_id LIMIT 101")
        .bind(facility).bind(id).fetch_all(&mut **tx).await?)
}
pub fn validate_standing_template(
    data: &CreateStandingTemplateRequest,
) -> Result<(), StandingTemplateError> {
    let ids = data
        .items
        .iter()
        .map(|i| i.item_id)
        .collect::<std::collections::HashSet<_>>();
    let monthly = match data.frequency {
        TemplateFrequency::Monthly => data.monthly_day.is_some_and(|d| (1..=31).contains(&d)),
        _ => data.monthly_day.is_none(),
    };
    if data.name.trim().is_empty()
        || data.name.trim().chars().count() > 100
        || data.requesting_location_id == data.fulfilling_location_id
        || !(1..=100).contains(&data.items.len())
        || ids.len() != data.items.len()
        || data
            .items
            .iter()
            .any(|i| i.quantity <= 0 || i.expected_unit.is_empty())
        || data.notes.as_deref().is_some_and(|n| n.trim().len() > 1000)
        || !monthly
        || !(1..=9999).contains(&data.next_run_on.year())
    {
        return Err(StandingTemplateError::InvalidInput);
    }
    if let Some(day) = data.monthly_day {
        if monthly_date(
            data.next_run_on.year(),
            data.next_run_on.month(),
            u32::from(day),
        ) != Some(data.next_run_on)
        {
            return Err(StandingTemplateError::InvalidInput);
        }
    }
    Ok(())
}
async fn references(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    data: &CreateStandingTemplateRequest,
) -> anyhow::Result<Vec<CatalogItem>> {
    let locations=sqlx::query_scalar::<_,Uuid>("SELECT id FROM storage_locations WHERE facility_id=$1 AND id=ANY($2) AND is_active ORDER BY id FOR SHARE")
        .bind(facility).bind(vec![data.requesting_location_id,data.fulfilling_location_id]).fetch_all(&mut **tx).await?;
    let items=sqlx::query_as::<_,CatalogItem>("SELECT id,code,name,unit FROM inventory_items WHERE facility_id=$1 AND id=ANY($2) AND is_active AND NOT controlled AND item_type<>'controlled_substance' ORDER BY id FOR SHARE")
        .bind(facility).bind(data.items.iter().map(|i|i.item_id).collect::<Vec<_>>()).fetch_all(&mut **tx).await?;
    if locations.len() != 2 || items.len() != data.items.len() {
        return Err(StandingTemplateError::ReferencesUnavailable.into());
    }
    if items.iter().any(|item| {
        !data
            .items
            .iter()
            .any(|line| line.item_id == item.id && line.expected_unit == item.unit)
    }) {
        return Err(StandingTemplateError::UnitChanged.into());
    }
    Ok(items)
}
async fn write_items(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
    data: &CreateStandingTemplateRequest,
    items: Vec<CatalogItem>,
) -> anyhow::Result<()> {
    let mut ids = vec![];
    let mut item_ids = vec![];
    let mut codes = vec![];
    let mut names = vec![];
    let mut units = vec![];
    let mut quantities = vec![];
    for item in items {
        ids.push(Uuid::new_v4());
        item_ids.push(item.id);
        codes.push(item.code);
        names.push(item.name);
        units.push(item.unit);
        quantities.push(
            data.items
                .iter()
                .find(|i| i.item_id == item.id)
                .ok_or(StandingTemplateError::InvalidInput)?
                .quantity,
        );
    }
    sqlx::query("INSERT INTO inventory_standing_order_template_items(id,facility_id,template_id,item_id,item_code,item_name,unit,quantity) SELECT line.id,$1,$2,line.item_id,line.code,line.name,line.unit,line.quantity FROM UNNEST($3::uuid[],$4::uuid[],$5::text[],$6::text[],$7::text[],$8::bigint[]) AS line(id,item_id,code,name,unit,quantity)")
        .bind(facility).bind(id).bind(ids).bind(item_ids).bind(codes).bind(names).bind(units).bind(quantities).execute(&mut **tx).await?;
    Ok(())
}
async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    actor: &TemplateActor,
    event: &str,
    id: Uuid,
    metadata: serde_json::Value,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'standing_order_template',$6,$7)")
        .bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(event).bind(id).bind(metadata).execute(&mut **tx).await?;
    Ok(())
}
pub async fn create_standing_template(
    pool: &PgPool,
    actor: TemplateActor,
    data: CreateStandingTemplateRequest,
) -> anyhow::Result<StandingTemplateDetail> {
    validate_standing_template(&data)?;
    let mut tx = pool.begin().await?;
    let items = references(&mut tx, actor.facility_id, &data).await?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_standing_order_templates(id,facility_id,name,requesting_location_id,fulfilling_location_id,frequency,status,next_run_on,monthly_day,line_count,notes,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11)")
        .bind(id).bind(actor.facility_id).bind(data.name.trim()).bind(data.requesting_location_id).bind(data.fulfilling_location_id).bind(codec::encode(data.frequency)?)
        .bind(data.next_run_on).bind(data.monthly_day.map(i32::from)).bind(data.items.len() as i32).bind(data.notes.as_deref().map(str::trim)).bind(actor.user_id).execute(&mut *tx).await?;
    write_items(&mut tx, actor.facility_id, id, &data, items).await?;
    audit(
        &mut tx,
        &actor,
        "inventory.standing_template.created",
        id,
        serde_json::json!({"line_count":data.items.len(),"version":1}),
    )
    .await?;
    let saved = detail_tx(&mut tx, actor.facility_id, id).await?;
    tx.commit().await?;
    Ok(saved)
}
pub async fn update_standing_template(
    pool: &PgPool,
    actor: TemplateActor,
    id: Uuid,
    data: UpdateStandingTemplateRequest,
) -> anyhow::Result<Option<StandingTemplateDetail>> {
    validate_standing_template(&data.template)?;
    let mut tx = pool.begin().await?;
    let saved = lock_template(&mut tx, actor.facility_id, id).await?;
    let Some((version, status)) = saved else {
        return Ok(None);
    };
    if status == "cancelled" {
        return Err(StandingTemplateError::Terminal.into());
    }
    if version != data.expected_version {
        return Err(StandingTemplateError::VersionConflict.into());
    }
    let occurrence_reused = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM inventory_standing_order_runs WHERE facility_id=$1 AND template_id=$2 AND scheduled_for >= $3)")
        .bind(actor.facility_id).bind(id).bind(data.template.next_run_on).fetch_one(&mut *tx).await?;
    if occurrence_reused {
        return Err(StandingTemplateError::OccurrenceChanged.into());
    }
    let version = version
        .checked_add(1)
        .ok_or(StandingTemplateError::VersionConflict)?;
    let items = references(&mut tx, actor.facility_id, &data.template).await?;
    let d = &data.template;
    sqlx::query("UPDATE inventory_standing_order_templates SET name=$3,requesting_location_id=$4,fulfilling_location_id=$5,frequency=$6,next_run_on=$7,monthly_day=$8,line_count=$9,notes=$10,version=$11,updated_at=now() WHERE facility_id=$1 AND id=$2")
        .bind(actor.facility_id).bind(id).bind(d.name.trim()).bind(d.requesting_location_id).bind(d.fulfilling_location_id).bind(codec::encode(d.frequency)?)
        .bind(d.next_run_on).bind(d.monthly_day.map(i32::from)).bind(d.items.len() as i32).bind(d.notes.as_deref().map(str::trim)).bind(version).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM inventory_standing_order_template_items WHERE facility_id=$1 AND template_id=$2").bind(actor.facility_id).bind(id).execute(&mut *tx).await?;
    write_items(&mut tx, actor.facility_id, id, d, items).await?;
    audit(
        &mut tx,
        &actor,
        "inventory.standing_template.updated",
        id,
        serde_json::json!({"line_count":d.items.len(),"version":version}),
    )
    .await?;
    let saved = detail_tx(&mut tx, actor.facility_id, id).await?;
    tx.commit().await?;
    Ok(Some(saved))
}
async fn lock_template(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<(i64, String)>> {
    Ok(sqlx::query_as("SELECT version,status FROM inventory_standing_order_templates WHERE facility_id=$1 AND id=$2 FOR UPDATE").bind(facility).bind(id).fetch_optional(&mut **tx).await?)
}
pub async fn change_standing_template_status(
    pool: &PgPool,
    actor: TemplateActor,
    id: Uuid,
    data: StandingTemplateStatusRequest,
) -> anyhow::Result<Option<StandingTemplateDetail>> {
    let mut tx = pool.begin().await?;
    let Some((version, status)) = lock_template(&mut tx, actor.facility_id, id).await? else {
        return Ok(None);
    };
    if version != data.expected_version {
        return Err(StandingTemplateError::VersionConflict.into());
    }
    let target = codec::encode(data.status)?;
    if status == target {
        let saved = detail_tx(&mut tx, actor.facility_id, id).await?;
        tx.commit().await?;
        return Ok(Some(saved));
    }
    if status == "cancelled" {
        return Err(StandingTemplateError::Terminal.into());
    }
    if data.status == StandingOrderStatus::Active {
        validate_saved_references(&mut tx, actor.facility_id, id).await?;
    }
    let version = version
        .checked_add(1)
        .ok_or(StandingTemplateError::VersionConflict)?;
    sqlx::query("UPDATE inventory_standing_order_templates SET status=$3,version=$4,updated_at=now() WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(id).bind(&target).bind(version).execute(&mut *tx).await?;
    audit(
        &mut tx,
        &actor,
        "inventory.standing_template.status_changed",
        id,
        serde_json::json!({"status":target,"version":version}),
    )
    .await?;
    let saved = detail_tx(&mut tx, actor.facility_id, id).await?;
    tx.commit().await?;
    Ok(Some(saved))
}
async fn validate_saved_references(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<()> {
    let saved = detail_tx(tx, facility, id).await?;
    let data = CreateStandingTemplateRequest {
        name: saved.summary.name,
        requesting_location_id: saved.summary.requesting_location_id,
        fulfilling_location_id: saved.summary.fulfilling_location_id,
        frequency: saved.summary.frequency,
        next_run_on: saved.summary.next_run_on,
        monthly_day: saved.summary.monthly_day.map(|d| d as u8),
        notes: saved.notes,
        items: saved
            .items
            .iter()
            .map(|i| StandingTemplateItemInput {
                item_id: i.item_id,
                quantity: i.quantity,
                expected_unit: i.unit.clone(),
            })
            .collect(),
    };
    let current = references(tx, facility, &data).await?;
    if current.iter().any(|item| {
        !saved
            .items
            .iter()
            .any(|line| line.item_id == item.id && line.unit == item.unit)
    }) {
        return Err(StandingTemplateError::UnitChanged.into());
    }
    Ok(())
}
pub async fn generate_standing_template_run(
    pool: &PgPool,
    actor: TemplateActor,
    id: Uuid,
    data: GenerateStandingTemplateRequest,
) -> anyhow::Result<Option<RequisitionReview>> {
    let mut tx = pool.begin().await?;
    let Some((version, status)) = lock_template(&mut tx, actor.facility_id, id).await? else {
        return Ok(None);
    };
    let replay=sqlx::query_scalar::<_,Uuid>("SELECT requisition_id FROM inventory_standing_order_runs WHERE facility_id=$1 AND template_id=$2 AND scheduled_for=$3")
        .bind(actor.facility_id).bind(id).bind(data.scheduled_for).fetch_optional(&mut *tx).await?;
    if let Some(request) = replay {
        // Header and line snapshots must describe the same committed request.
        // Approval and issue serialize on this parent, independently of the template.
        sqlx::query("SELECT id FROM stock_requisitions WHERE facility_id=$1 AND id=$2 FOR SHARE")
            .bind(actor.facility_id)
            .bind(request)
            .fetch_one(&mut *tx)
            .await?;
        let saved = review_tx(&mut tx, actor.facility_id, request)
            .await?
            .ok_or(StandingTemplateError::IncompleteSnapshot)?;
        tx.commit().await?;
        return Ok(Some(saved));
    }
    if version != data.expected_version {
        return Err(StandingTemplateError::VersionConflict.into());
    }
    if status != "active" {
        return Err(if status == "cancelled" {
            StandingTemplateError::Terminal
        } else {
            StandingTemplateError::NotDue
        }
        .into());
    }
    let template = detail_tx(&mut tx, actor.facility_id, id).await?;
    let today = Utc::now().date_naive();
    if template.summary.next_run_on != data.scheduled_for {
        return Err(StandingTemplateError::OccurrenceChanged.into());
    }
    if data.scheduled_for > today {
        return Err(StandingTemplateError::NotDue.into());
    }
    validate_saved_references(&mut tx, actor.facility_id, id).await?;
    let next = next_standing_occurrence(
        data.scheduled_for,
        template.summary.frequency,
        template.summary.monthly_day,
        today,
    )
    .ok_or(StandingTemplateError::InvalidInput)?;
    let request = Uuid::new_v4();
    sqlx::query("INSERT INTO stock_requisitions(id,facility_id,requesting_location_id,fulfilling_location_id,status,created_by_user_id,source_type,source_id,line_count) VALUES($1,$2,$3,$4,'requested',$5,'standing_order_template',$6,$7)")
        .bind(request).bind(actor.facility_id).bind(template.summary.requesting_location_id).bind(template.summary.fulfilling_location_id).bind(actor.user_id).bind(id).bind(template.summary.line_count).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO stock_requisition_items(id,facility_id,requisition_id,item_id,item_code,item_name,unit,quantity_requested) SELECT gen_random_uuid(),facility_id,$3,item_id,item_code,item_name,unit,quantity FROM inventory_standing_order_template_items WHERE facility_id=$1 AND template_id=$2")
        .bind(actor.facility_id).bind(id).bind(request).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO inventory_standing_order_runs(id,facility_id,template_id,template_version,scheduled_for,requisition_id,generated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(Uuid::new_v4()).bind(actor.facility_id).bind(id).bind(version).bind(data.scheduled_for).bind(request).bind(actor.user_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE inventory_standing_order_templates SET next_run_on=$3,updated_at=now() WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(id).bind(next).execute(&mut *tx).await?;
    audit(&mut tx,&actor,"inventory.standing_template.request_generated",id,serde_json::json!({"requisition_id":request,"template_version":version,"line_count":template.summary.line_count})).await?;
    let saved = review_tx(&mut tx, actor.facility_id, request)
        .await?
        .ok_or(StandingTemplateError::IncompleteSnapshot)?;
    tx.commit().await?;
    Ok(Some(saved))
}
pub async fn get_requisition_review(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<RequisitionReview>> {
    let mut tx = pool.begin().await?;
    let found = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM stock_requisitions WHERE facility_id=$1 AND id=$2 FOR SHARE",
    )
    .bind(facility)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    if found.is_none() {
        return Ok(None);
    }
    let saved = review_tx(&mut tx, facility, id).await?;
    tx.commit().await?;
    Ok(saved)
}
pub(super) async fn review_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<RequisitionReview>> {
    let row=sqlx::query_as::<_,ReviewRow>(r#"SELECT q.id,q.requesting_location_id,r.name AS requesting_location_name,q.fulfilling_location_id,f.name AS fulfilling_location_name,
        q.status,q.source_id AS source_template_id,run.template_version,run.scheduled_for,q.created_at,q.line_count,
        q.approved_at,q.approved_by_user_id,q.fulfilled_at,q.fulfilled_by_user_id,q.cancelled_at
        FROM stock_requisitions q JOIN inventory_standing_order_runs run ON run.requisition_id=q.id AND run.facility_id=q.facility_id AND run.template_id=q.source_id
        JOIN storage_locations r ON r.id=q.requesting_location_id AND r.facility_id=q.facility_id JOIN storage_locations f ON f.id=q.fulfilling_location_id AND f.facility_id=q.facility_id
        WHERE q.facility_id=$1 AND q.id=$2 AND q.source_type='standing_order_template'"#).bind(facility).bind(id).fetch_optional(&mut **tx).await?;
    let Some(r) = row else { return Ok(None) };
    let items=sqlx::query_as::<_,ReviewItemRow>("SELECT id,item_id,item_code,item_name,unit,quantity_requested,quantity_issued FROM stock_requisition_items WHERE facility_id=$1 AND requisition_id=$2 ORDER BY item_id LIMIT 101")
        .bind(facility).bind(id).fetch_all(&mut **tx).await?;
    if !(1..=100).contains(&items.len()) || items.len() != r.line_count as usize {
        return Err(StandingTemplateError::IncompleteSnapshot.into());
    }
    Ok(Some(RequisitionReview {
        id: r.id,
        requesting_location_id: r.requesting_location_id,
        requesting_location_name: r.requesting_location_name,
        fulfilling_location_id: r.fulfilling_location_id,
        fulfilling_location_name: r.fulfilling_location_name,
        status: codec::decode(&r.status)?,
        source_template_id: r.source_template_id,
        template_version: r.template_version,
        scheduled_for: r.scheduled_for,
        created_at: r.created_at,
        approved_at: r.approved_at,
        approved_by_user_id: r.approved_by_user_id,
        fulfilled_at: r.fulfilled_at,
        fulfilled_by_user_id: r.fulfilled_by_user_id,
        cancelled_at: r.cancelled_at,
        items: items
            .into_iter()
            .map(|i| RequisitionReviewItem {
                id: i.id,
                item_id: i.item_id,
                item_code: i.item_code,
                item_name: i.item_name,
                unit: i.unit,
                quantity_requested: i.quantity_requested,
                quantity_issued: i.quantity_issued,
            })
            .collect(),
    }))
}
fn monthly_date(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
    let first = NaiveDate::from_ymd_opt(year, month, 1)?;
    let last = first.checked_add_months(Months::new(1))?.pred_opt()?.day();
    first.with_day(day.min(last))
}
pub fn next_standing_occurrence(
    due: NaiveDate,
    frequency: TemplateFrequency,
    monthly_day: Option<i32>,
    today: NaiveDate,
) -> Option<NaiveDate> {
    match frequency {
        TemplateFrequency::Daily | TemplateFrequency::Weekly | TemplateFrequency::Biweekly => {
            let period = match frequency {
                TemplateFrequency::Daily => 1,
                TemplateFrequency::Weekly => 7,
                _ => 14,
            };
            let elapsed = (today - due).num_days().max(0);
            let days = u64::try_from((elapsed / period + 1) * period).ok()?;
            due.checked_add_days(Days::new(days))
        }
        TemplateFrequency::Monthly => {
            let day = u32::try_from(monthly_day?).ok()?;
            let months =
                (today.year() - due.year()) * 12 + today.month() as i32 - due.month() as i32;
            let first = due
                .with_day(1)?
                .checked_add_months(Months::new(u32::try_from(months.max(0)).ok()?))?;
            let candidate = monthly_date(first.year(), first.month(), day)?;
            if candidate > today {
                Some(candidate)
            } else {
                let next = first.checked_add_months(Months::new(1))?;
                monthly_date(next.year(), next.month(), day)
            }
        }
    }
}
