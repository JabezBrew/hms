use super::validation::{digest, facts, hash, normalize, validate_identity};
use super::*;
use serde_json::json;
use sqlx::types::Json;

async fn budget(tx: &mut Tx<'_>) -> anyhow::Result<()> {
    sqlx::query("SELECT set_config('lock_timeout','100ms',true),set_config('statement_timeout','1000ms',true)").execute(&mut **tx).await?;
    Ok(())
}
async fn request_gate(tx: &mut Tx<'_>, facility: Uuid, key: Uuid) -> anyhow::Result<()> {
    let mut value = b"hms.inventory-supplier.request.v1".to_vec();
    value.extend_from_slice(facility.as_bytes());
    value.extend_from_slice(key.as_bytes());
    let digest = hash(value);
    let lock = i64::from_be_bytes(digest[..8].try_into()?);
    let obtained: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(lock)
        .fetch_one(&mut **tx)
        .await?;
    if !obtained {
        return Err(InventorySupplierError::Busy.into());
    }
    Ok(())
}
async fn unused(tx: &mut Tx<'_>, id: Uuid) -> anyhow::Result<()> {
    let referenced: bool = sqlx::query_scalar("SELECT inventory_supplier_has_item_reference($1)")
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
    if referenced {
        return Err(InventorySupplierError::ItemReference.into());
    }
    Ok(())
}
#[derive(FromRow)]
struct Saved {
    actor_user_id: Uuid,
    payload_digest: Vec<u8>,
    receipt: Json<InventorySupplierCommandReceipt>,
}

pub async fn command(
    pool: &PgPool,
    actor: InventorySupplierActor,
    input: InventorySupplierReviewedInput,
) -> anyhow::Result<InventorySupplierCommandReceipt> {
    command_inner(pool, actor, input)
        .await
        .map_err(repository_error)
}
async fn command_inner(
    pool: &PgPool,
    mut actor: InventorySupplierActor,
    input: InventorySupplierReviewedInput,
) -> anyhow::Result<InventorySupplierCommandReceipt> {
    validate_identity(&input)?;
    let (key, id, expected, action) = facts(&input);
    let key_hash = hash(key.as_bytes());
    let mut tx = pool.begin().await?;
    budget(&mut tx).await?;
    let proof = authority(&mut tx, &mut actor).await?;
    request_gate(&mut tx, actor.facility_id, key).await?;
    let saved=sqlx::query_as::<_,Saved>("SELECT actor_user_id,payload_digest,receipt FROM inventory_supplier_commands WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(&key_hash).fetch_optional(&mut *tx).await?;
    if let Some(saved) = saved {
        if saved.actor_user_id != actor.user_id
            || facts(&saved.receipt.0.reviewed_input).3 != action
        {
            return Err(InventorySupplierError::RequestConflict.into());
        }
        let normalized = normalize(input, saved.receipt.0.before.as_ref())?;
        if digest(&normalized)? != saved.payload_digest {
            return Err(InventorySupplierError::RequestConflict.into());
        }
        prescription_courses::check_authorization(&mut tx, &proof).await?;
        tx.commit().await?;
        return Ok(saved.receipt.0);
    }
    let before = match id {
        Some(id) => Some(
            state_tx(&mut tx, actor.facility_id, id, true)
                .await?
                .ok_or(InventorySupplierError::NotFound)?,
        ),
        None => None,
    };
    if let (Some(expected), Some(before)) = (expected, before.as_ref()) {
        if expected != before.version {
            return Err(InventorySupplierError::VersionConflict.into());
        }
    }
    let input = normalize(input, before.as_ref())?;
    let payload_digest = digest(&input)?;
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await?;
    let (supplier, changed) = match &input {
        InventorySupplierReviewedInput::Create {
            code,
            name,
            contact_name,
            phone,
            email,
            address,
            ..
        } => {
            let id = Uuid::new_v4();
            // This same global UUID and facility/code try gate is intrinsic to
            // every supplier INSERT, including canonical defaults and raw SQL.
            sqlx::query("SELECT inventory_supplier_publication_gate($1,$2,$3)")
                .bind(actor.facility_id)
                .bind(id)
                .bind(code)
                .execute(&mut *tx)
                .await?;
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM inventory_suppliers WHERE facility_id=$1 AND code=$2)",
            )
            .bind(actor.facility_id)
            .bind(code)
            .fetch_one(&mut *tx)
            .await?;
            if exists {
                return Err(InventorySupplierError::CodeConflict.into());
            }
            sqlx::query("INSERT INTO inventory_suppliers(id,facility_id,code,name,contact_name,phone,email,address,is_active,version,catalog_changed_at,created_at,updated_at,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,1,$9,$9,$9,$10,$10)")
                .bind(id).bind(actor.facility_id).bind(code).bind(name).bind(contact_name).bind(phone).bind(email).bind(address).bind(now).bind(actor.user_id).execute(&mut *tx).await?;
            (
                state_tx(&mut tx, actor.facility_id, id, false)
                    .await?
                    .ok_or(InventorySupplierError::NotFound)?,
                true,
            )
        }
        InventorySupplierReviewedInput::Correct {
            name,
            contact_name,
            phone,
            email,
            address,
            ..
        } => {
            let before = before
                .as_ref()
                .ok_or(InventorySupplierError::InvalidSource)?;
            let changed = before.name != *name
                || before.contact_name != *contact_name
                || before.phone != *phone
                || before.email != *email
                || before.address != *address;
            if changed {
                sqlx::query("UPDATE inventory_suppliers SET name=$3,contact_name=$4,phone=$5,email=$6,address=$7,version=version+1,catalog_changed_at=$8,updated_at=$8,updated_by_user_id=$9 WHERE facility_id=$1 AND id=$2")
                    .bind(actor.facility_id).bind(before.id).bind(name).bind(contact_name).bind(phone).bind(email).bind(address).bind(now).bind(actor.user_id).execute(&mut *tx).await?;
            }
            (
                state_tx(&mut tx, actor.facility_id, before.id, false)
                    .await?
                    .ok_or(InventorySupplierError::NotFound)?,
                changed,
            )
        }
        InventorySupplierReviewedInput::Retire { .. }
        | InventorySupplierReviewedInput::Reactivate { .. } => {
            let before = before
                .as_ref()
                .ok_or(InventorySupplierError::InvalidSource)?;
            unused(&mut tx, before.id).await?;
            let active = action == "reactivate";
            let changed = before.is_active != active;
            if changed {
                sqlx::query("UPDATE inventory_suppliers SET is_active=$3,version=version+1,catalog_changed_at=$4,updated_at=$4,updated_by_user_id=$5 WHERE facility_id=$1 AND id=$2")
                    .bind(actor.facility_id).bind(before.id).bind(active).bind(now).bind(actor.user_id).execute(&mut *tx).await?;
            }
            (
                state_tx(&mut tx, actor.facility_id, before.id, false)
                    .await?
                    .ok_or(InventorySupplierError::NotFound)?,
                changed,
            )
        }
    };
    let receipt = InventorySupplierCommandReceipt {
        client_request_id: key,
        input_digest: payload_digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        reviewed_input: input,
        recorded_by_user_id: actor.user_id,
        supplier,
        before,
        changed,
        recorded_at: now,
    };
    let command_id = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_supplier_commands(id,facility_id,request_key_hash,actor_user_id,supplier_id,action,payload_digest,receipt,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(command_id).bind(actor.facility_id).bind(&key_hash).bind(actor.user_id).bind(receipt.supplier.id).bind(action).bind(&payload_digest).bind(Json(&receipt)).bind(now).execute(&mut *tx).await?;
    crate::admin::insert_audit_event_tx(&mut tx,crate::admin::NewAuditEvent { facility_id:actor.facility_id,actor_user_id:Some(actor.user_id),request_id:Some(actor.request_id),event_type:format!("inventory.supplier.{action}"),resource_type:"inventory_supplier".into(),resource_id:Some(receipt.supplier.id),metadata:json!({"action":action,"version":receipt.supplier.version,"changed":changed,"command_id":command_id}) }).await?;
    // Supplier-row search publication is intrinsic and atomic. This clock is
    // checked after it and audit waits, before any receipt can be returned.
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(receipt)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: InventorySupplierActor,
    key: Uuid,
) -> anyhow::Result<InventorySupplierCommandReceipt> {
    if key.is_nil() {
        return Err(InventorySupplierError::Invalid.into());
    }
    let mut tx = pool.begin().await?;
    budget(&mut tx).await?;
    let proof = authority(&mut tx, &mut actor).await?;
    let value:Option<Json<InventorySupplierCommandReceipt>>=sqlx::query_scalar("SELECT receipt FROM inventory_supplier_commands WHERE facility_id=$1 AND request_key_hash=$2 AND actor_user_id=$3")
        .bind(actor.facility_id).bind(hash(key.as_bytes())).bind(actor.user_id).fetch_optional(&mut *tx).await?;
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    let receipt = value.ok_or(InventorySupplierError::NotFound)?;
    tx.commit().await?;
    Ok(receipt.0)
}
