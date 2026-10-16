use chrono::{DateTime, Utc};
use hms_domain::inventory::{DispenseStatus, PharmacyDispenseListItem, StockMovementType};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use super::{apply_cursor, insert_movement, InventoryCursor, NewPharmacyDispense};
use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug, FromRow)]
struct DispenseRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    item_id: Uuid,
    item_name: String,
    location_id: Uuid,
    quantity: i64,
    status: String,
    dispensed_at: DateTime<Utc>,
}

pub async fn list_dispenses(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PharmacyDispenseListItem>> {
    let mut query = dispense_query();
    query.push(" WHERE pharmacy_dispenses.facility_id = ");
    query.push_bind(facility_id);
    apply_cursor(
        &mut query,
        "pharmacy_dispenses.dispensed_at",
        "pharmacy_dispenses.id",
        cursor,
    );
    query.push(" ORDER BY pharmacy_dispenses.dispensed_at DESC, pharmacy_dispenses.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = hms_observability::observe_db_query(
        "inventory.pharmacy.dispenses.list",
        query.build_query_as::<DispenseRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(dispense_from_row).collect()
}

pub async fn create_dispense(
    pool: &PgPool,
    dispense: NewPharmacyDispense,
) -> anyhow::Result<PharmacyDispenseListItem> {
    let mut transaction = pool.begin().await?;
    let actor = crate::clinical::stock_basis::authorize(
        &mut transaction,
        dispense.facility_id,
        dispense.actor_user_id,
        dispense.authorization.clone(),
    )
    .await?;
    let item:Option<(bool,String)>=sqlx::query_as("SELECT controlled,item_type FROM inventory_items WHERE facility_id=$1 AND id=$2 AND is_active FOR SHARE")
        .bind(dispense.facility_id).bind(dispense.item_id).fetch_optional(&mut *transaction).await?;
    match item {
        Some((false, kind)) if kind != "controlled_substance" => {}
        Some(_) => {
            anyhow::bail!("controlled items require controlled-substance register workflow")
        }
        None => anyhow::bail!("inventory_item_not_actionable"),
    }
    if dispense.quantity <= 0 {
        anyhow::bail!("invalid_dispense_quantity");
    }
    let location: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM storage_locations WHERE facility_id=$1 AND id=$2 AND is_active FOR SHARE",
    )
    .bind(dispense.facility_id)
    .bind(dispense.location_id)
    .fetch_optional(&mut *transaction)
    .await?;
    if location.is_none() {
        anyhow::bail!("dispensing_location_not_actionable");
    }
    let batch = hms_observability::observe_db_query(
        "inventory.pharmacy.dispenses.select_batch",
        sqlx::query_as::<_, (Uuid, i64)>(
            r#"
        SELECT id, quantity_on_hand
        FROM stock_batches
        WHERE facility_id = $1
          AND item_id = $2
          AND location_id = $3
          AND quantity_on_hand >= $4
          AND (expires_on IS NULL OR expires_on >= (clock_timestamp() AT TIME ZONE 'UTC')::date)
        ORDER BY expires_on ASC NULLS LAST, received_at ASC, id ASC
        LIMIT 1
        FOR UPDATE
        "#,
        )
        .bind(dispense.facility_id)
        .bind(dispense.item_id)
        .bind(dispense.location_id)
        .bind(dispense.quantity)
        .fetch_optional(&mut *transaction),
    )
    .await?;
    let Some((batch_id, quantity_on_hand)) = batch else {
        anyhow::bail!("insufficient stock for dispense");
    };
    let balance_after = quantity_on_hand - dispense.quantity;
    hms_observability::observe_db_query(
        "inventory.pharmacy.dispenses.update_batch",
        sqlx::query(
            "UPDATE stock_batches SET quantity_on_hand = $1, updated_at = now() WHERE id = $2",
        )
        .bind(balance_after)
        .bind(batch_id)
        .execute(&mut *transaction),
    )
    .await?;

    insert_movement(
        &mut transaction,
        dispense.facility_id,
        dispense.item_id,
        Some(batch_id),
        dispense.location_id,
        StockMovementType::Dispense,
        -dispense.quantity,
        balance_after,
        "pharmacy_dispense",
        dispense.actor_user_id,
    )
    .await?;

    hms_observability::observe_db_query(
        "inventory.pharmacy.dispenses.insert",
        sqlx::query(
            r#"
        INSERT INTO pharmacy_dispenses (
            id, facility_id, patient_id, item_id, location_id, quantity, status, dispensed_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
        )
        .bind(dispense.id)
        .bind(dispense.facility_id)
        .bind(dispense.patient_id)
        .bind(dispense.item_id)
        .bind(dispense.location_id)
        .bind(dispense.quantity)
        .bind(codec::encode(DispenseStatus::Dispensed)?)
        .bind(dispense.actor_user_id)
        .execute(&mut *transaction),
    )
    .await?;

    crate::clinical::stock_basis::check_authorization(&mut transaction, &actor).await?;
    transaction.commit().await?;
    fetch_dispense_by_id(pool, dispense.facility_id, dispense.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created dispense was not found"))
}

async fn fetch_dispense_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PharmacyDispenseListItem>> {
    let mut query = dispense_query();
    query.push(" WHERE pharmacy_dispenses.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND pharmacy_dispenses.id = ");
    query.push_bind(id);
    hms_observability::observe_db_query(
        "inventory.pharmacy.dispenses.fetch_by_id",
        query.build_query_as::<DispenseRow>().fetch_optional(pool),
    )
    .await?
    .map(dispense_from_row)
    .transpose()
}

fn dispense_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT pharmacy_dispenses.id,
               pharmacy_dispenses.patient_id,
               patients.patient_code,
               pharmacy_dispenses.item_id,
               inventory_items.name AS item_name,
               pharmacy_dispenses.location_id,
               pharmacy_dispenses.quantity,
               pharmacy_dispenses.status,
               pharmacy_dispenses.dispensed_at
        FROM pharmacy_dispenses
        INNER JOIN patients ON patients.id = pharmacy_dispenses.patient_id
        INNER JOIN inventory_items ON inventory_items.id = pharmacy_dispenses.item_id
        "#,
    )
}

fn dispense_from_row(row: DispenseRow) -> anyhow::Result<PharmacyDispenseListItem> {
    Ok(PharmacyDispenseListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        item_id: row.item_id,
        item_name: row.item_name,
        location_id: row.location_id,
        quantity: row.quantity,
        status: codec::decode(&row.status)?,
        dispensed_at: row.dispensed_at,
    })
}
