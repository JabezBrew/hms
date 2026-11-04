//! Shared retained current InventoryView proof for exact and contact-bearing reads.
use crate::clinical::prescription_courses;
use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;
type Tx<'a> = Transaction<'a, Postgres>;
/// Ordinary reads retain current authority without exercising management or
/// imposing credential confirmation on onsite inventory viewers.
#[derive(Clone)]
pub struct InventoryReadActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: String,
    pub authorization: prescription_courses::PrescriptionAuthorization,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InventoryReadError {
    Authority,
}
impl std::fmt::Display for InventoryReadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Current inventory read authority is required.")
    }
}
impl std::error::Error for InventoryReadError {}
pub(crate) async fn authority(
    tx: &mut Tx<'_>,
    actor: &mut InventoryReadActor,
) -> anyhow::Result<prescription_courses::PrescriptionActor> {
    let mut proof = prescription_courses::PrescriptionActor {
        facility_id: actor.facility_id,
        user_id: actor.user_id,
        request_id: Some(actor.request_id.clone()),
        authorization: Some(actor.authorization.clone()),
    };
    // Shared facility -> user -> session -> network order. These retained
    // SHARE locks make authority publication serialize with this read.
    prescription_courses::verify_actor(tx, &mut proof).await?;
    actor.authorization = proof
        .authorization
        .clone()
        .ok_or(InventoryReadError::Authority)?;
    crate::clinical::medication_access::require_current_features_tx(
        tx,
        actor.facility_id,
        actor.authorization.active_profile,
        &[hms_domain::deployment::FeatureKey::Inventory],
    )
    .await?;
    let (allowed, boundary): (bool, Option<DateTime<Utc>>) =
        hms_observability::observe_db_query(
            "inventory.read.permissions",
            sqlx::query_as(
                r#"
 WITH point AS MATERIALIZED(SELECT clock_timestamp() at),effective AS(
 SELECT permission_code FROM user_permissions WHERE user_id=$2
 UNION SELECT permission_code FROM permission_assignments p CROSS JOIN point n WHERE p.facility_id=$1 AND p.grantee_user_id=$2 AND p.scope_type='facility' AND p.scope_id IS NULL AND p.status='active' AND p.starts_at<=n.at AND(p.ends_at IS NULL OR p.ends_at>n.at)
 UNION SELECT permission_code FROM delegations d CROSS JOIN point n WHERE d.facility_id=$1 AND d.delegate_user_id=$2 AND d.status='active' AND d.starts_at<=n.at AND(d.ends_at IS NULL OR d.ends_at>n.at))
 SELECT(SELECT count(*) FROM effective WHERE permission_code IN('inventory.view','patient.demographics.view'))=2
 AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='demographics')
 AND EXISTS(SELECT 1 FROM user_features WHERE user_id=$2 AND feature_key='inventory'),
 (SELECT min(boundary) FROM user_authority_boundaries b CROSS JOIN LATERAL(VALUES(b.starts_at),(b.ends_at)) boundaries(boundary) CROSS JOIN point n WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
 "#,
            )
            .bind(actor.facility_id)
            .bind(actor.user_id)
            .fetch_one(&mut **tx),
        )
        .await?;
    if !allowed {
        return Err(InventoryReadError::Authority.into());
    }
    if let Some(boundary) = boundary {
        actor.authorization.valid_until = actor.authorization.valid_until.min(boundary);
    }
    proof.authorization = Some(actor.authorization.clone());
    prescription_courses::check_authorization(tx, &proof).await?;
    Ok(proof)
}
