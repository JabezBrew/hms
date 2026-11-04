//! Governed supplier metadata and original commands, separate from PO names.
use crate::{clinical::prescription_courses, PgPool};
use chrono::{DateTime, Utc};
use hms_domain::inventory_suppliers::*;
use sqlx::{FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

mod commands;
mod reads;
mod validation;
pub use commands::{command, receipt};
pub use reads::{detail, history, list, list_legacy};
type Tx<'a> = Transaction<'a, Postgres>;
pub type InventorySupplierActor = super::items::InventoryItemActor;
pub type InventorySupplierReadActor = super::read_access::InventoryReadActor;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InventorySupplierError {
    Invalid,
    InvalidSource,
    NotFound,
    VersionConflict,
    RequestConflict,
    CodeConflict,
    ItemReference,
    Authority,
    Busy,
    ProjectionConflict,
}
impl std::fmt::Display for InventorySupplierError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Current supplier review is required.")
    }
}
impl std::error::Error for InventorySupplierError {}
pub fn database_error(error: &sqlx::Error) -> Option<InventorySupplierError> {
    let database = error.as_database_error()?;
    if matches!(database.code().as_deref(), Some("55P03" | "57014")) {
        return Some(InventorySupplierError::Busy);
    }
    if database.code().as_deref() == Some("23505")
        && database.constraint() == Some("inventory_suppliers_facility_id_code_key")
    {
        return Some(InventorySupplierError::CodeConflict);
    }
    match database.message() {
        "inventory_supplier_code_conflict" => Some(InventorySupplierError::CodeConflict),
        "inventory_supplier_item_reference" => Some(InventorySupplierError::ItemReference),
        "inventory_supplier_source_unavailable" => Some(InventorySupplierError::InvalidSource),
        "inventory_supplier_projection_conflict" => {
            Some(InventorySupplierError::ProjectionConflict)
        }
        "inventory_supplier_invalid" => Some(InventorySupplierError::Invalid),
        _ => None,
    }
}
fn sql_error(error: sqlx::Error) -> anyhow::Error {
    database_error(&error)
        .map(Into::into)
        .unwrap_or_else(|| error.into())
}
fn repository_error(error: anyhow::Error) -> anyhow::Error {
    if let Some(database) = error.downcast_ref::<sqlx::Error>() {
        if let Some(kind) = database_error(database) {
            return kind.into();
        }
    }
    error
}
#[derive(FromRow)]
struct Row {
    id: Uuid,
    code: String,
    name: String,
    contact_name: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
    is_active: bool,
    version: i64,
    catalog_changed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    created_by_user_id: Option<Uuid>,
    updated_by_user_id: Option<Uuid>,
}
impl From<Row> for GovernedInventorySupplier {
    fn from(row: Row) -> Self {
        Self {
            id: row.id,
            code: row.code,
            name: row.name,
            contact_name: row.contact_name,
            phone: row.phone,
            email: row.email,
            address: row.address,
            is_active: row.is_active,
            version: row.version,
            catalog_changed_at: row.catalog_changed_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            created_by_user_id: row.created_by_user_id,
            updated_by_user_id: row.updated_by_user_id,
        }
    }
}
const COLUMNS: &str = "s.id,s.code,s.name,s.contact_name,s.phone,s.email,s.address,s.is_active,s.version,s.catalog_changed_at,s.created_at,s.updated_at,s.created_by_user_id,s.updated_by_user_id";
fn base_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(format!(
        "SELECT {COLUMNS} FROM inventory_suppliers s WHERE s.facility_id="
    ))
}
async fn state_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    id: Uuid,
    lock: bool,
) -> anyhow::Result<Option<GovernedInventorySupplier>> {
    let mut query = base_query();
    query.push_bind(facility).push(" AND s.id=").push_bind(id);
    if lock {
        query.push(" FOR UPDATE OF s NOWAIT");
    }
    Ok(hms_observability::observe_db_query(
        "inventory.supplier.state",
        query.build_query_as::<Row>().fetch_optional(&mut **tx),
    )
    .await
    .map_err(sql_error)?
    .map(Into::into))
}
async fn read_authority(
    tx: &mut Tx<'_>,
    actor: &mut InventorySupplierReadActor,
) -> anyhow::Result<prescription_courses::PrescriptionActor> {
    super::read_access::authority(tx, actor)
        .await
        .map_err(|error| {
            if error.downcast_ref::<super::read_access::InventoryReadError>()
                == Some(&super::read_access::InventoryReadError::Authority)
            {
                InventorySupplierError::Authority.into()
            } else {
                error
            }
        })
}
async fn authority(
    tx: &mut Tx<'_>,
    actor: &mut InventorySupplierActor,
) -> anyhow::Result<prescription_courses::PrescriptionActor> {
    super::items::authority(tx, actor).await.map_err(|error| {
        if error.downcast_ref::<super::items::InventoryItemError>()
            == Some(&super::items::InventoryItemError::Authority)
        {
            InventorySupplierError::Authority.into()
        } else {
            error
        }
    })
}
