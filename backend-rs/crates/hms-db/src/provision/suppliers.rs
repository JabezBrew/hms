//! Missing-only permanent supplier defaults; retained configuration is never repaired.
use super::*;

pub(super) async fn retain_defaults(pool: &PgPool, facility: Uuid) -> anyhow::Result<()> {
    let mut defaults = [
        (
            Uuid::from_u128(DEFAULT_SUPPLIER_ACME_ID),
            "ACME",
            "Acme Medical Supplies",
            "Procurement Desk",
            "+233 30 000 1000",
            "orders@acme-med.local",
        ),
        (
            Uuid::from_u128(DEFAULT_SUPPLIER_CITY_ID),
            "CITY",
            "City Medical Depot",
            "Sales Desk",
            "+233 30 000 2000",
            "orders@city-med.local",
        ),
    ];
    defaults.sort_by_key(|row| row.0);
    let mut tx = pool
        .begin()
        .await
        .map_err(inventory_supplier_provisioning_error)?;
    sqlx::query("SELECT set_config('lock_timeout','100ms',true),set_config('statement_timeout','1000ms',true)").execute(&mut *tx).await.map_err(inventory_supplier_provisioning_error)?;
    // Explicit historical fixtures may provision before032. Current binaries
    // require the complete032 schema before baseline provisioning is reachable.
    let governed: bool = sqlx::query_scalar(
        "SELECT to_regprocedure('public.inventory_supplier_identity_gate(uuid)') IS NOT NULL",
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(inventory_supplier_provisioning_error)?;
    if governed {
        for (id, ..) in &defaults {
            sqlx::query("SELECT inventory_supplier_identity_gate($1)")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(inventory_supplier_provisioning_error)?;
        }
    }
    for (id, code, name, contact, phone, email) in defaults {
        let owner: Option<Uuid> = sqlx::query_scalar(
            "SELECT facility_id FROM inventory_suppliers WHERE id=$1 FOR SHARE NOWAIT",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(inventory_supplier_provisioning_error)?;
        if let Some(owner) = owner {
            anyhow::ensure!(
                owner == facility,
                InventorySupplierProvisioningError::OperatorReview
            );
            // Permanent identity wins even after its code was configured. Do
            // not claim a reused former shipped code or touch any row column.
            continue;
        }
        if governed {
            sqlx::query("SELECT inventory_supplier_code_gate($1,$2)")
                .bind(facility)
                .bind(code)
                .execute(&mut *tx)
                .await
                .map_err(inventory_supplier_provisioning_error)?;
        }
        let collision: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM inventory_suppliers WHERE facility_id=$1 AND code=$2)",
        )
        .bind(facility)
        .bind(code)
        .fetch_one(&mut *tx)
        .await
        .map_err(inventory_supplier_provisioning_error)?;
        anyhow::ensure!(
            !collision,
            InventorySupplierProvisioningError::OperatorReview
        );
        // Common pre032 columns only. New provenance remains truthfully unknown.
        sqlx::query("INSERT INTO inventory_suppliers(id,facility_id,code,name,contact_name,phone,email) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING")
            .bind(id).bind(facility).bind(code).bind(name).bind(contact).bind(phone).bind(email).execute(&mut *tx).await.map_err(inventory_supplier_provisioning_error)?;
        let actual: Option<Uuid> = sqlx::query_scalar(
            "SELECT facility_id FROM inventory_suppliers WHERE id=$1 FOR SHARE NOWAIT",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(inventory_supplier_provisioning_error)?;
        anyhow::ensure!(
            actual == Some(facility),
            InventorySupplierProvisioningError::OperatorReview
        );
    }
    // Preserve the accepted NULL-only permanent item binding. An inactive or
    // unavailable exact optional supplier writes nothing: no substitute,
    // reactivation, item timestamp/version rewrite or new binding hard failure.
    for (item, supplier) in [
        (
            DEFAULT_INVENTORY_ITEM_PARACETAMOL_ID,
            DEFAULT_SUPPLIER_ACME_ID,
        ),
        (DEFAULT_INVENTORY_ITEM_MORPHINE_ID, DEFAULT_SUPPLIER_CITY_ID),
    ] {
        sqlx::query("UPDATE inventory_items i SET primary_supplier_id=s.id,updated_at=clock_timestamp() FROM inventory_suppliers s WHERE i.facility_id=$1 AND i.id=$2 AND i.primary_supplier_id IS NULL AND s.facility_id=i.facility_id AND s.id=$3 AND s.is_active")
            .bind(facility).bind(Uuid::from_u128(item)).bind(Uuid::from_u128(supplier)).execute(&mut *tx).await.map_err(inventory_supplier_provisioning_error)?;
    }
    tx.commit().await?;
    Ok(())
}
