//! Atomic, line-bound internal stock issue with paired lot movements.
use super::{standing_orders::review_tx, TemplateActor};
use crate::PgPool;
use chrono::{NaiveDate, Utc};
use hms_domain::{
    inventory::RequisitionStatus,
    inventory_standing::{RequisitionReview, StandingRequestAction},
};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

pub async fn cancel_standing_request(
    pool: &PgPool,
    actor: TemplateActor,
    id: Uuid,
    action: StandingRequestAction,
) -> anyhow::Result<Option<RequisitionReview>> {
    let mut tx = pool.begin().await?;
    let Some(saved) = lock_review(
        &mut tx,
        actor.facility_id,
        id,
        action.expected_source_version,
    )
    .await?
    else {
        return Ok(None);
    };
    if saved.status == RequisitionStatus::Cancelled {
        tx.commit().await?;
        return Ok(Some(saved));
    }
    if !matches!(
        saved.status,
        RequisitionStatus::Requested | RequisitionStatus::Pending | RequisitionStatus::Approved
    ) || saved.items.iter().any(|i| i.quantity_issued != 0)
    {
        return Err(StandingRequestError::NotActionable.into());
    }
    sqlx::query("UPDATE stock_requisitions SET status='cancelled',cancelled_at=clock_timestamp() WHERE facility_id=$1 AND id=$2")
        .bind(actor.facility_id).bind(id).execute(&mut *tx).await?;
    audit(&mut tx,&actor,id,"inventory.standing_request.cancelled",serde_json::json!({"template_version":saved.template_version,"line_count":saved.items.len()})).await?;
    let result = review_tx(&mut tx, actor.facility_id, id).await?;
    tx.commit().await?;
    Ok(result)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StandingRequestError {
    VersionConflict,
    NotActionable,
    NotApproved,
    ReferencesUnavailable,
    UnitChanged,
    InsufficientStock,
    TooFragmented,
    IncompleteEvidence,
}
impl StandingRequestError {
    pub fn message(self) -> &'static str {
        match self {
            Self::VersionConflict => {
                "The saved request version does not match this review. Reload before continuing."
            }
            Self::NotActionable => {
                "This request can no longer be approved or issued from its current state."
            }
            Self::NotApproved => "Approve the reviewed line items before issuing this request.",
            Self::ReferencesUnavailable => {
                "The saved locations and items must still be active in this facility. Controlled stock needs its dedicated workflow."
            }
            Self::UnitChanged => {
                "An item unit changed after this request was generated. Cancel this request and generate a reviewed replacement."
            }
            Self::InsufficientStock => {
                "There is not enough unexpired stock at the saved source location to issue the full request. No stock was moved."
            }
            Self::TooFragmented => {
                "The request needs more than 500 source batch allocations. Review inventory before issuing it."
            }
            Self::IncompleteEvidence => {
                "The request does not have complete stock issue evidence and requires review."
            }
        }
    }
}
impl std::fmt::Display for StandingRequestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}
impl std::error::Error for StandingRequestError {}
#[derive(FromRow)]
struct LiveItem {
    id: Uuid,
    unit: String,
}
#[derive(FromRow)]
struct SourceBatch {
    id: Uuid,
    batch_number: String,
    expires_on: Option<NaiveDate>,
    quantity_on_hand: i64,
}
struct Allocation {
    line: Uuid,
    item: Uuid,
    source: Uuid,
    destination: Uuid,
    number: String,
    expiry: Option<NaiveDate>,
    quantity: i64,
    source_after: i64,
    out_move: Uuid,
    in_move: Uuid,
}

async fn lock_review(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
    version: i64,
) -> anyhow::Result<Option<RequisitionReview>> {
    let exists = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM stock_requisitions WHERE facility_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(facility)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?;
    if exists.is_none() {
        return Ok(None);
    }
    let Some(saved) = review_tx(tx, facility, id).await? else {
        return Ok(None);
    };
    if saved.template_version != version {
        return Err(StandingRequestError::VersionConflict.into());
    }
    Ok(Some(saved))
}
async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    actor: &TemplateActor,
    id: Uuid,
    event: &str,
    metadata: serde_json::Value,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'stock_requisition',$6,$7)")
        .bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(event).bind(id).bind(metadata).execute(&mut **tx).await?;
    Ok(())
}
pub async fn approve_standing_request(
    pool: &PgPool,
    actor: TemplateActor,
    id: Uuid,
    action: StandingRequestAction,
) -> anyhow::Result<Option<RequisitionReview>> {
    let mut tx = pool.begin().await?;
    let Some(saved) = lock_review(
        &mut tx,
        actor.facility_id,
        id,
        action.expected_source_version,
    )
    .await?
    else {
        return Ok(None);
    };
    if saved.status == RequisitionStatus::Approved && saved.approved_at.is_some() {
        tx.commit().await?;
        return Ok(Some(saved));
    }
    if !matches!(
        saved.status,
        RequisitionStatus::Requested | RequisitionStatus::Pending | RequisitionStatus::Approved
    ) {
        return Err(StandingRequestError::NotActionable.into());
    }
    if saved.items.iter().any(|i| i.quantity_issued != 0) {
        return Err(StandingRequestError::IncompleteEvidence.into());
    }
    sqlx::query("UPDATE stock_requisitions SET status='approved',approved_at=clock_timestamp(),approved_by_user_id=$3 WHERE facility_id=$1 AND id=$2")
        .bind(actor.facility_id).bind(id).bind(actor.user_id).execute(&mut *tx).await?;
    audit(&mut tx,&actor,id,"inventory.standing_request.approved",serde_json::json!({"template_version":saved.template_version,"line_count":saved.items.len()})).await?;
    let result = review_tx(&mut tx, actor.facility_id, id).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn issue_standing_request(
    pool: &PgPool,
    actor: TemplateActor,
    id: Uuid,
    action: StandingRequestAction,
) -> anyhow::Result<Option<RequisitionReview>> {
    let mut tx = pool.begin().await?;
    let Some(saved) = lock_review(
        &mut tx,
        actor.facility_id,
        id,
        action.expected_source_version,
    )
    .await?
    else {
        return Ok(None);
    };
    if saved.status == RequisitionStatus::Fulfilled {
        if saved.fulfilled_at.is_none()
            || saved
                .items
                .iter()
                .any(|i| i.quantity_issued != i.quantity_requested)
        {
            return Err(StandingRequestError::IncompleteEvidence.into());
        }
        let issued:Vec<(Uuid,i64)>=sqlx::query_as("SELECT requisition_item_id,SUM(quantity)::bigint FROM stock_requisition_issue_allocations WHERE facility_id=$1 AND requisition_id=$2 GROUP BY requisition_item_id")
            .bind(actor.facility_id).bind(id).fetch_all(&mut *tx).await?;
        if issued.len() != saved.items.len()
            || saved.items.iter().any(|i| {
                !issued
                    .iter()
                    .any(|(line, qty)| *line == i.id && *qty == i.quantity_issued)
            })
        {
            return Err(StandingRequestError::IncompleteEvidence.into());
        }
        tx.commit().await?;
        return Ok(Some(saved));
    }
    if saved.status != RequisitionStatus::Approved || saved.approved_at.is_none() {
        return Err(StandingRequestError::NotApproved.into());
    }
    if saved.items.iter().any(|i| i.quantity_issued != 0) {
        return Err(StandingRequestError::IncompleteEvidence.into());
    }
    let locations:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM storage_locations WHERE facility_id=$1 AND id=ANY($2) AND is_active ORDER BY id FOR SHARE")
        .bind(actor.facility_id).bind(vec![saved.requesting_location_id,saved.fulfilling_location_id]).fetch_all(&mut *tx).await?;
    let live=sqlx::query_as::<_,LiveItem>("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND id=ANY($2) AND is_active AND NOT controlled AND item_type<>'controlled_substance' ORDER BY id FOR SHARE")
        .bind(actor.facility_id).bind(saved.items.iter().map(|i|i.item_id).collect::<Vec<_>>()).fetch_all(&mut *tx).await?;
    if locations.len() != 2 || live.len() != saved.items.len() {
        return Err(StandingRequestError::ReferencesUnavailable.into());
    }
    if saved.items.iter().any(|i| {
        !live
            .iter()
            .any(|item| item.id == i.item_id && item.unit == i.unit)
    }) {
        return Err(StandingRequestError::UnitChanged.into());
    }
    // Item order matches other stock issue writers. Lock only the FEFO prefix
    // needed for the saved quantity; numeric window sums cannot overflow i64.
    let mut allocations = vec![];
    for line in &saved.items {
        let today = Utc::now().date_naive();
        let batches=sqlx::query_as::<_,SourceBatch>(r#"WITH candidates AS (
            SELECT id,SUM(quantity_on_hand) OVER(ORDER BY expires_on ASC NULLS LAST,received_at,id)-quantity_on_hand AS prior_quantity
            FROM stock_batches WHERE facility_id=$1 AND item_id=$2 AND location_id=$3
                AND quantity_on_hand>0 AND (expires_on IS NULL OR expires_on >= $4)
        ) SELECT batch.id,batch.batch_number,batch.expires_on,batch.quantity_on_hand
          FROM stock_batches batch JOIN candidates c ON c.id=batch.id WHERE c.prior_quantity<$5
          ORDER BY batch.expires_on ASC NULLS LAST,batch.received_at,batch.id LIMIT 501 FOR UPDATE OF batch"#)
            .bind(actor.facility_id).bind(line.item_id).bind(saved.fulfilling_location_id).bind(today).bind(line.quantity_requested).fetch_all(&mut *tx).await?;
        let mut remaining = line.quantity_requested;
        for batch in batches {
            if remaining == 0 {
                break;
            }
            if batch.quantity_on_hand <= 0
                || batch
                    .expires_on
                    .is_some_and(|date| date < Utc::now().date_naive())
            {
                continue;
            }
            let quantity = remaining.min(batch.quantity_on_hand);
            remaining -= quantity;
            allocations.push(Allocation {
                line: line.id,
                item: line.item_id,
                source: batch.id,
                destination: Uuid::new_v4(),
                number: batch.batch_number,
                expiry: batch.expires_on,
                quantity,
                source_after: batch.quantity_on_hand - quantity,
                out_move: Uuid::new_v4(),
                in_move: Uuid::new_v4(),
            });
            if allocations.len() > 500 {
                return Err(StandingRequestError::TooFragmented.into());
            }
        }
        if remaining > 0 {
            return Err(StandingRequestError::InsufficientStock.into());
        }
    }
    write_allocations(&mut tx, &actor, &saved, &allocations).await?;
    sqlx::query("UPDATE stock_requisition_items SET quantity_issued=quantity_requested WHERE facility_id=$1 AND requisition_id=$2")
        .bind(actor.facility_id).bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE stock_requisitions SET status='fulfilled',fulfilled_at=clock_timestamp(),fulfilled_by_user_id=$3 WHERE facility_id=$1 AND id=$2")
        .bind(actor.facility_id).bind(id).bind(actor.user_id).execute(&mut *tx).await?;
    audit(&mut tx,&actor,id,"inventory.standing_request.issued",serde_json::json!({"template_version":saved.template_version,"line_count":saved.items.len(),"allocation_count":allocations.len()})).await?;
    let result = review_tx(&mut tx, actor.facility_id, id).await?;
    tx.commit().await?;
    Ok(result)
}
async fn write_allocations(
    tx: &mut Transaction<'_, Postgres>,
    actor: &TemplateActor,
    request: &RequisitionReview,
    rows: &[Allocation],
) -> anyhow::Result<()> {
    let source: Vec<Uuid> = rows.iter().map(|a| a.source).collect();
    let after: Vec<i64> = rows.iter().map(|a| a.source_after).collect();
    let changed=sqlx::query("UPDATE stock_batches b SET quantity_on_hand=line.balance,updated_at=now() FROM UNNEST($2::uuid[],$3::bigint[]) AS line(id,balance) WHERE b.facility_id=$1 AND b.id=line.id")
        .bind(actor.facility_id).bind(&source).bind(after).execute(&mut **tx).await?;
    if changed.rows_affected() != rows.len() as u64 {
        return Err(StandingRequestError::IncompleteEvidence.into());
    }
    let destination: Vec<Uuid> = rows.iter().map(|a| a.destination).collect();
    let items: Vec<Uuid> = rows.iter().map(|a| a.item).collect();
    let numbers: Vec<String> = rows.iter().map(|a| a.number.clone()).collect();
    let expiry: Vec<Option<NaiveDate>> = rows.iter().map(|a| a.expiry).collect();
    let quantity: Vec<i64> = rows.iter().map(|a| a.quantity).collect();
    sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,expires_on,quantity_on_hand) SELECT line.id,$1,line.item,$2,line.number,line.expiry,line.quantity FROM UNNEST($3::uuid[],$4::uuid[],$5::text[],$6::date[],$7::bigint[]) AS line(id,item,number,expiry,quantity)")
        .bind(actor.facility_id).bind(request.requesting_location_id).bind(&destination).bind(&items).bind(numbers).bind(expiry).bind(&quantity).execute(&mut **tx).await?;
    let mut move_ids = vec![];
    let mut move_items = vec![];
    let mut move_batches = vec![];
    let mut move_locations = vec![];
    let mut move_types = vec![];
    let mut move_quantity = vec![];
    let mut move_balance = vec![];
    for a in rows {
        for (id, batch, location, kind, qty, balance) in [
            (
                a.out_move,
                a.source,
                request.fulfilling_location_id,
                "transfer_out",
                -a.quantity,
                a.source_after,
            ),
            (
                a.in_move,
                a.destination,
                request.requesting_location_id,
                "transfer_in",
                a.quantity,
                a.quantity,
            ),
        ] {
            move_ids.push(id);
            move_items.push(a.item);
            move_batches.push(batch);
            move_locations.push(location);
            move_types.push(kind);
            move_quantity.push(qty);
            move_balance.push(balance);
        }
    }
    sqlx::query("INSERT INTO stock_movements(id,facility_id,item_id,batch_id,location_id,movement_type,quantity,balance_after,reason,created_by_user_id) SELECT line.id,$1,line.item,line.batch,line.location,line.kind,line.quantity,line.balance,'standing_requisition_issue',$2 FROM UNNEST($3::uuid[],$4::uuid[],$5::uuid[],$6::uuid[],$7::text[],$8::bigint[],$9::bigint[]) AS line(id,item,batch,location,kind,quantity,balance)")
        .bind(actor.facility_id).bind(actor.user_id).bind(move_ids).bind(move_items).bind(move_batches).bind(move_locations).bind(move_types).bind(move_quantity).bind(move_balance).execute(&mut **tx).await?;
    let ids: Vec<Uuid> = rows.iter().map(|_| Uuid::new_v4()).collect();
    let lines: Vec<Uuid> = rows.iter().map(|a| a.line).collect();
    let out: Vec<Uuid> = rows.iter().map(|a| a.out_move).collect();
    let incoming: Vec<Uuid> = rows.iter().map(|a| a.in_move).collect();
    sqlx::query("INSERT INTO stock_requisition_issue_allocations(id,facility_id,requisition_id,requisition_item_id,source_batch_id,destination_batch_id,out_movement_id,in_movement_id,quantity) SELECT line.id,$1,$2,line.item,line.source,line.destination,line.out_move,line.in_move,line.quantity FROM UNNEST($3::uuid[],$4::uuid[],$5::uuid[],$6::uuid[],$7::uuid[],$8::uuid[],$9::bigint[]) AS line(id,item,source,destination,out_move,in_move,quantity)")
        .bind(actor.facility_id).bind(request.id).bind(ids).bind(lines).bind(source).bind(destination).bind(out).bind(incoming).bind(quantity).execute(&mut **tx).await?;
    Ok(())
}
