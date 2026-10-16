//! Reviewed inventory basis for scheduled dosing. Clinical dosage text is never
//! interpreted as a physical quantity. Nullable legacy policy stays unreviewed.
use super::prescription_courses::{PrescriptionActor, PrescriptionAuthorization};
use hms_domain::clinical::{ScheduledStockPolicy, ScheduledStockPolicyRequest};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StockBasisError {
    ReviewRequired,
    UnitChanged,
    ItemNotActionable,
    ControlledItem,
    AdmissionInactive,
    InvalidPolicy,
    QuantityOverflow,
    InventoryUnitInUse,
    ReceiptUnitChanged,
    ControlledUnitImmutable,
}
impl StockBasisError {
    pub fn code(self) -> &'static str {
        match self {
            Self::ReviewRequired => "stock_policy_review_required",
            Self::UnitChanged => "prescription_stock_unit_changed",
            Self::ItemNotActionable => "prescription_stock_item_not_actionable",
            Self::ControlledItem => "controlled_item_requires_controlled_workflow",
            Self::AdmissionInactive => "admission_not_active",
            Self::InvalidPolicy => "invalid_scheduled_stock_policy",
            Self::QuantityOverflow => "stock_quantity_overflow",
            Self::InventoryUnitInUse => "inventory_unit_in_use",
            Self::ReceiptUnitChanged => "stock_receipt_unit_changed",
            Self::ControlledUnitImmutable => "controlled_stock_unit_immutable",
        }
    }
    pub fn message(self) -> &'static str {
        match self {
            Self::ReviewRequired => {
                "This scheduled prescription has no reviewed stock basis. Review a new course before scheduling or supplying doses."
            },
            Self::UnitChanged => {
                "The catalog unit differs from the reviewed stock basis. Review the stock item and a replacement course before continuing."
            },
            Self::ItemNotActionable => {
                "The stock item is no longer eligible for this medication workflow. Review an active local medication item."
            },
            Self::ControlledItem => {
                "Controlled stock requires its dedicated controlled-substance workflow; it cannot use generic scheduled supply."
            },
            Self::AdmissionInactive => {
                "The patient's admission is no longer active. Reload the current care context before continuing."
            },
            Self::InvalidPolicy => {
                "Enter explicit positive whole inventory units for one dose and review the current stock unit."
            },
            Self::InventoryUnitInUse => {
                "This item already has stock history. Use a new item and an explicit stock reconciliation to change its physical unit."
            },
            Self::ControlledUnitImmutable => {
                "Controlled stock units cannot be changed through generic catalog correction. A controlled-stock unit conversion is not supported by this workflow."
            },
            Self::ReceiptUnitChanged => {
                "The catalog unit changed after this receipt was reviewed. Reload the item and review the quantity and unit before saving."
            },
            Self::QuantityOverflow => {
                "The requested stock quantity exceeds the supported whole-unit range."
            }
 }
    }
}
impl std::fmt::Display for StockBasisError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}
impl std::error::Error for StockBasisError {}

pub async fn authorize(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    user: Uuid,
    proof: Option<PrescriptionAuthorization>,
) -> anyhow::Result<PrescriptionActor> {
    let mut actor = PrescriptionActor {
        facility_id: facility,
        user_id: user,
        request_id: None,
        authorization: proof,
    };
    super::prescription_courses::verify_actor(tx, &mut actor).await?;
    Ok(actor)
}
pub async fn check_authorization(
    tx: &mut Transaction<'_, Postgres>,
    actor: &PrescriptionActor,
) -> anyhow::Result<()> {
    super::prescription_courses::check_authorization(tx, actor).await
}

pub async fn lock_active_admission(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    admission: Uuid,
    patient: Uuid,
) -> anyhow::Result<()> {
    let row:Option<Uuid>=sqlx::query_scalar("SELECT patient_id FROM admission_cases WHERE facility_id=$1 AND id=$2 AND patient_id=$3 AND status IN ('admitted','discharge_pending') FOR SHARE").bind(facility).bind(admission).bind(patient).fetch_optional(&mut **tx).await?;
    if row.is_none() {
        return Err(StockBasisError::AdmissionInactive.into());
    }
    Ok(())
}
pub async fn lock_item_unit(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    item: Uuid,
) -> anyhow::Result<String> {
    let item:Option<(String,bool,String)>=sqlx::query_as("SELECT unit,controlled,item_type FROM inventory_items WHERE facility_id=$1 AND id=$2 AND is_active FOR SHARE").bind(facility).bind(item).fetch_optional(&mut **tx).await?;
    let (unit, controlled, kind) = item.ok_or(StockBasisError::ItemNotActionable)?;
    if controlled || kind == "controlled_substance" {
        return Err(StockBasisError::ControlledItem.into());
    }
    if kind != "medication" {
        return Err(StockBasisError::ItemNotActionable.into());
    }
    Ok(unit)
}
pub async fn capture_policy(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    item: Uuid,
    input: ScheduledStockPolicyRequest,
) -> anyhow::Result<ScheduledStockPolicy> {
    let input = input
        .normalized()
        .map_err(|_| StockBasisError::InvalidPolicy)?;
    let unit = lock_item_unit(tx, facility, item).await?;
    if unit != input.expected_stock_unit {
        return Err(StockBasisError::UnitChanged.into());
    }
    Ok(ScheduledStockPolicy {
        stock_unit: unit,
        stock_units_per_dose: input.stock_units_per_dose,
    })
}
pub async fn source_policy(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    source: Uuid,
) -> anyhow::Result<Option<ScheduledStockPolicy>> {
    let row: Option<sqlx::types::Json<ScheduledStockPolicy>> = sqlx::query_scalar(
        "SELECT scheduled_stock_policy FROM prescriptions WHERE facility_id=$1 AND id=$2",
    )
    .bind(facility)
    .bind(source)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.map(|r| r.0))
}
pub async fn validate_policy(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    item: Option<Uuid>,
    policy: Option<ScheduledStockPolicy>,
) -> anyhow::Result<ScheduledStockPolicy> {
    let policy = policy.ok_or(StockBasisError::ReviewRequired)?;
    let input = ScheduledStockPolicyRequest {
        expected_stock_unit: policy.stock_unit.clone(),
        stock_units_per_dose: policy.stock_units_per_dose,
    };
    let captured = capture_policy(
        tx,
        facility,
        item.ok_or(StockBasisError::ItemNotActionable)?,
        input,
    )
    .await?;
    Ok(captured)
}
pub fn stock_quantity(doses: i64, units: i64) -> anyhow::Result<i64> {
    if doses <= 0 || units <= 0 {
        return Err(StockBasisError::InvalidPolicy.into());
    }
    doses
        .checked_mul(units)
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or_else(|| StockBasisError::QuantityOverflow.into())
}
