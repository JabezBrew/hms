use super::*;
use hms_domain::inventory::SupplierListItem;

pub async fn detail(
    pool: &PgPool,
    mut actor: InventorySupplierReadActor,
    id: Uuid,
) -> anyhow::Result<Option<InventorySupplierAdministration>> {
    let mut tx = pool.begin().await?;
    let proof = read_authority(&mut tx, &mut actor).await?;
    let supplier = state_tx(&mut tx, actor.facility_id, id, false).await?;
    let result = if let Some(supplier) = supplier {
        let referenced: bool = hms_observability::observe_db_query(
            "inventory.supplier.admin.eligibility",
            sqlx::query_scalar("SELECT inventory_supplier_has_item_reference($1)")
                .bind(id)
                .fetch_one(&mut *tx),
        )
        .await?;
        Some(InventorySupplierAdministration {
            supplier,
            eligibility: InventorySupplierEligibility {
                lifecycle_blocked_by: referenced
                    .then_some(InventorySupplierEligibilityBlocker::ItemReference),
            },
        })
    } else {
        None
    };
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(result)
}
fn pattern(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            format!(
                "%{}%",
                value
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            )
        })
}
#[derive(FromRow)]
struct Directory {
    id: Uuid,
    code: String,
    name: String,
    is_active: bool,
    version: i64,
    catalog_changed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}
pub async fn list(
    pool: &PgPool,
    mut actor: InventorySupplierReadActor,
    cursor: Option<super::super::InventoryCursor>,
    limit: i64,
    filters: InventorySupplierAdministrationQuery,
) -> anyhow::Result<Vec<InventorySupplierAdministrationListItem>> {
    let mut tx = pool.begin().await?;
    let proof = read_authority(&mut tx, &mut actor).await?;
    let mut query = QueryBuilder::<Postgres>::new("SELECT id,code,name,is_active,version,catalog_changed_at,created_at FROM inventory_suppliers WHERE facility_id=");
    query.push_bind(actor.facility_id);
    if let Some(active) = filters.is_active {
        query.push(" AND is_active=").push_bind(active);
    }
    if let Some(pattern) = pattern(filters.search.as_deref()) {
        query
            .push(" AND(name ILIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR code ILIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR contact_name ILIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR phone ILIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR email ILIKE ")
            .push_bind(pattern)
            .push(" ESCAPE '\\')");
    }
    super::super::apply_forward_cursor(&mut query, "created_at", "id", cursor);
    query
        .push(" ORDER BY created_at ASC,id ASC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = hms_observability::observe_db_query(
        "inventory.supplier.admin.page",
        query.build_query_as::<Directory>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows
        .into_iter()
        .map(|row| InventorySupplierAdministrationListItem {
            id: row.id,
            code: row.code,
            name: row.name,
            is_active: row.is_active,
            version: row.version,
            catalog_changed_at: row.catalog_changed_at,
            created_at: row.created_at,
        })
        .collect();
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
    contact_name_changed: bool,
    phone_changed: bool,
    email_changed: bool,
    address_changed: bool,
    active_changed: bool,
}
pub async fn history(
    pool: &PgPool,
    mut actor: InventorySupplierReadActor,
    id: Uuid,
    cursor: Option<super::super::InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<InventorySupplierHistoryRow>> {
    let mut tx = pool.begin().await?;
    let proof = read_authority(&mut tx, &mut actor).await?;
    let exists: bool = hms_observability::observe_db_query(
        "inventory.supplier.history.source",
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM inventory_suppliers WHERE facility_id=$1 AND id=$2)",
        )
        .bind(actor.facility_id)
        .bind(id)
        .fetch_one(&mut *tx),
    )
    .await?;
    if !exists {
        prescription_courses::check_authorization(&mut tx, &proof).await?;
        tx.commit().await?;
        return Err(InventorySupplierError::NotFound.into());
    }
    let mut query = QueryBuilder::<Postgres>::new("SELECT id,action,recorded_at,(receipt->'before'->>'version')::bigint AS before_version,(receipt->'supplier'->>'version')::bigint AS after_version,(receipt->'before'->>'name' IS DISTINCT FROM receipt->'supplier'->>'name') AS name_changed,(receipt->'before'->>'contact_name' IS DISTINCT FROM receipt->'supplier'->>'contact_name') AS contact_name_changed,(receipt->'before'->>'phone' IS DISTINCT FROM receipt->'supplier'->>'phone') AS phone_changed,(receipt->'before'->>'email' IS DISTINCT FROM receipt->'supplier'->>'email') AS email_changed,(receipt->'before'->>'address' IS DISTINCT FROM receipt->'supplier'->>'address') AS address_changed,(receipt->'before'->>'is_active' IS DISTINCT FROM receipt->'supplier'->>'is_active') AS active_changed FROM inventory_supplier_commands WHERE facility_id=");
    query
        .push_bind(actor.facility_id)
        .push(" AND supplier_id=")
        .push_bind(id);
    super::super::apply_cursor(&mut query, "recorded_at", "id", cursor);
    query
        .push(" ORDER BY recorded_at DESC,id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = hms_observability::observe_db_query(
        "inventory.supplier.history.page",
        query.build_query_as::<History>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows
        .into_iter()
        .map(|row| InventorySupplierHistoryRow {
            id: row.id,
            action: row.action,
            recorded_at: row.recorded_at,
            before_version: row.before_version,
            after_version: row.after_version,
            name_changed: row.name_changed,
            contact_name_changed: row.contact_name_changed,
            phone_changed: row.phone_changed,
            email_changed: row.email_changed,
            address_changed: row.address_changed,
            active_changed: row.active_changed,
        })
        .collect();
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(result)
}
#[derive(FromRow)]
struct LegacySupplier {
    id: Uuid,
    code: String,
    name: String,
    contact_name: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    is_active: bool,
    created_at: DateTime<Utc>,
}
/// The original eight-field contact list retains its exact scope/search/order.
pub async fn list_legacy(
    pool: &PgPool,
    mut actor: InventorySupplierReadActor,
    cursor: Option<super::super::InventoryCursor>,
    limit: i64,
    filters: super::super::SupplierFilters,
) -> anyhow::Result<Vec<SupplierListItem>> {
    let mut tx = pool.begin().await?;
    let proof = read_authority(&mut tx, &mut actor).await?;
    let mut query=QueryBuilder::<Postgres>::new("SELECT id,code,name,contact_name,phone,email,is_active,created_at FROM inventory_suppliers WHERE facility_id=");
    query.push_bind(actor.facility_id);
    if let Some(active) = filters.is_active {
        query.push(" AND is_active=").push_bind(active);
    }
    if let Some(pattern) = pattern(filters.search.as_deref()) {
        query
            .push(" AND(name ILIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR code ILIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR contact_name ILIKE ")
            .push_bind(pattern)
            .push(" ESCAPE '\\')");
    }
    super::super::apply_forward_cursor(&mut query, "created_at", "id", cursor);
    query
        .push(" ORDER BY created_at ASC,id ASC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = hms_observability::observe_db_query(
        "inventory.supplier.legacy.page",
        query.build_query_as::<LegacySupplier>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows
        .into_iter()
        .map(|row| SupplierListItem {
            id: row.id,
            code: row.code,
            name: row.name,
            contact_name: row.contact_name,
            phone: row.phone,
            email: row.email,
            is_active: row.is_active,
            created_at: row.created_at,
        })
        .collect();
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(result)
}
