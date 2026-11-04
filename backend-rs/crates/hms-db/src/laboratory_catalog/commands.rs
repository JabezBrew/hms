use super::*;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::types::Json;

fn hash(value: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(value).to_vec()
}
fn normalized(
    mut input: LaboratoryCatalogReviewedInput,
) -> anyhow::Result<LaboratoryCatalogReviewedInput> {
    input.reason = input.reason.trim().to_owned();
    if input.client_request_id.is_nil()
        || input.subject_id.is_nil()
        || input.expected_version < 1
        || input.reason.is_empty()
        || input.reason.len() > 4000
        || input.reason.chars().count() > 1000
        || input.reason.chars().any(char::is_control)
    {
        return Err(LabCatalogError::Invalid.into());
    }
    Ok(input)
}

#[derive(FromRow)]
struct Saved {
    actor_user_id: Uuid,
    payload_digest: Vec<u8>,
    receipt: Json<LaboratoryCatalogCommandReceipt>,
}

pub async fn command(
    pool: &PgPool,
    actor: LabCatalogActor,
    input: LaboratoryCatalogReviewedInput,
) -> anyhow::Result<LaboratoryCatalogCommandReceipt> {
    command_inner(pool, actor, input)
        .await
        .map_err(repository_error)
}
async fn command_inner(
    pool: &PgPool,
    mut actor: LabCatalogActor,
    input: LaboratoryCatalogReviewedInput,
) -> anyhow::Result<LaboratoryCatalogCommandReceipt> {
    let input = normalized(input)?;
    let payload_digest = hash(serde_json::to_vec(&serde_json::to_value(&input)?)?);
    let key_hash = hash(input.client_request_id.as_bytes());
    let mut tx = pool.begin().await?;
    budget(&mut tx).await?;
    let proof = authority(&mut tx, &mut actor, true).await?;
    sqlx::query("SELECT laboratory_catalog_request_gate($1,$2)")
        .bind(actor.facility_id)
        .bind(input.client_request_id)
        .execute(&mut *tx)
        .await?;
    let saved: Option<Saved> = hms_observability::observe_db_query("laboratory.catalog.original",
        sqlx::query_as("SELECT actor_user_id,payload_digest,receipt FROM laboratory_catalog_commands WHERE facility_id=$1 AND request_key_hash=$2")
            .bind(actor.facility_id).bind(&key_hash).fetch_optional(&mut *tx)).await?;
    if let Some(saved) = saved {
        if saved.actor_user_id != actor.user_id || saved.payload_digest != payload_digest {
            return Err(LabCatalogError::RequestConflict.into());
        }
        // The immutable original precedes every later catalog/CAS observation.
        prescription_courses::check_authorization(&mut tx, &proof)
            .await
            .map_err(authority_error)?;
        tx.commit().await?;
        return Ok(saved.receipt.0);
    }
    if input.subject_kind == LabCatalogKind::Panel {
        sqlx::query("SELECT laboratory_catalog_panel_gates($1,false)")
            .bind(vec![input.subject_id])
            .execute(&mut *tx)
            .await?;
    }
    let target: Option<Uuid> = hms_observability::observe_db_query(
        "laboratory.catalog.target_gate",
        sqlx::query_scalar(&format!(
            "SELECT id FROM {} WHERE facility_id=$1 AND id=$2 FOR UPDATE NOWAIT",
            table(input.subject_kind)
        ))
        .bind(actor.facility_id)
        .bind(input.subject_id)
        .fetch_optional(&mut *tx),
    )
    .await?;
    target.ok_or(LabCatalogError::NotFound)?;
    if input.subject_kind == LabCatalogKind::Panel {
        // Count>500 is already unorderable. For a bounded panel, retain all
        // observed member availability through the immutable receipt snapshot.
        let _: Vec<Uuid> = hms_observability::observe_db_query("laboratory.catalog.member_gate",
            sqlx::query_scalar("SELECT id FROM lab_tests WHERE id IN(SELECT test_id FROM lab_panel_tests WHERE panel_id=$1 ORDER BY test_id LIMIT 501) ORDER BY id FOR SHARE NOWAIT")
                .bind(input.subject_id).fetch_all(&mut *tx)).await?;
    }
    let before = reads::state_tx(
        &mut tx,
        actor.facility_id,
        input.subject_kind,
        input.subject_id,
    )
    .await?
    .ok_or(LabCatalogError::NotFound)?;
    if before.version() != input.expected_version {
        return Err(LabCatalogError::VersionConflict.into());
    }
    let changed = before.is_active() != input.is_active;
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await?;
    if changed {
        before
            .version()
            .checked_add(1)
            .ok_or(LabCatalogError::VersionExhausted)?;
        let updated = hms_observability::observe_db_query("laboratory.catalog.availability",
            sqlx::query(&format!("UPDATE {} SET is_active=$3,version=version+1,catalog_changed_at=$4,updated_at=$4,catalog_changed_by_user_id=$5 WHERE facility_id=$1 AND id=$2 AND version=$6", table(input.subject_kind)))
                .bind(actor.facility_id).bind(input.subject_id).bind(input.is_active).bind(now)
                .bind(actor.user_id).bind(input.expected_version).execute(&mut *tx)).await?;
        if updated.rows_affected() != 1 {
            return Err(LabCatalogError::VersionConflict.into());
        }
        // The intrinsic AFTER trigger refreshes exactly this source document in
        // the same transaction, including non-HTTP trusted source writers.
    } else {
        // A healthy no-op preserves projection identity/time too. Still retain
        // and verify the exact owner; missing/privacy-stale owned documents may
        // be repaired, while a different source owner refuses atomically.
        sqlx::query("SELECT laboratory_catalog_refresh_document($1,$2,$3)")
            .bind(actor.facility_id)
            .bind(kind_text(input.subject_kind))
            .bind(input.subject_id)
            .execute(&mut *tx)
            .await?;
    }
    let subject = if changed {
        reads::state_tx(
            &mut tx,
            actor.facility_id,
            input.subject_kind,
            input.subject_id,
        )
        .await?
        .ok_or(LabCatalogError::NotFound)?
    } else {
        before
    };
    let command_id = Uuid::new_v4();
    let receipt = LaboratoryCatalogCommandReceipt {
        command_id,
        client_request_id: input.client_request_id,
        input_digest: payload_digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        reviewed_input: input,
        subject,
        recorded_at: now,
        recorded_by_user_id: actor.user_id,
        changed,
    };
    sqlx::query("INSERT INTO laboratory_catalog_commands(id,facility_id,request_key_hash,actor_user_id,subject_kind,subject_id,test_id,panel_id,payload_digest,receipt,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(command_id).bind(actor.facility_id).bind(&key_hash).bind(actor.user_id)
        .bind(kind_text(receipt.reviewed_input.subject_kind)).bind(receipt.subject.id())
        .bind((receipt.reviewed_input.subject_kind == LabCatalogKind::Test).then_some(receipt.subject.id()))
        .bind((receipt.reviewed_input.subject_kind == LabCatalogKind::Panel).then_some(receipt.subject.id()))
        .bind(&payload_digest).bind(Json(&receipt)).bind(now).execute(&mut *tx).await?;
    crate::admin::insert_audit_event_tx(&mut tx, crate::admin::NewAuditEvent {
        facility_id: actor.facility_id, actor_user_id: Some(actor.user_id), request_id: Some(actor.request_id),
        event_type: "laboratory.catalog.set_availability".into(), resource_type: "laboratory_catalog".into(),
        resource_id: Some(receipt.subject.id()),
        metadata: json!({"kind":kind_text(receipt.reviewed_input.subject_kind),"version":receipt.subject.version(),"changed":changed,"command_id":command_id}),
    }).await?;
    prescription_courses::check_authorization(&mut tx, &proof)
        .await
        .map_err(authority_error)?;
    tx.commit().await?;
    Ok(receipt)
}

pub async fn receipt(
    pool: &PgPool,
    mut actor: LabCatalogActor,
    key: Uuid,
) -> anyhow::Result<Option<LaboratoryCatalogCommandReceipt>> {
    if key.is_nil() {
        return Err(LabCatalogError::Invalid.into());
    }
    let mut tx = pool.begin().await?;
    budget(&mut tx).await?;
    let proof = authority(&mut tx, &mut actor, true).await?;
    let value: Option<Json<LaboratoryCatalogCommandReceipt>> = hms_observability::observe_db_query(
        "laboratory.catalog.own_receipt", sqlx::query_scalar("SELECT receipt FROM laboratory_catalog_commands WHERE facility_id=$1 AND request_key_hash=$2 AND actor_user_id=$3")
            .bind(actor.facility_id).bind(hash(key.as_bytes())).bind(actor.user_id).fetch_optional(&mut *tx),
    ).await?;
    prescription_courses::check_authorization(&mut tx, &proof)
        .await
        .map_err(authority_error)?;
    tx.commit().await?;
    Ok(value.map(|Json(value)| value))
}
