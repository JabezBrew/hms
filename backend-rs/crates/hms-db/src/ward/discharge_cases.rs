use chrono::{DateTime, Utc};
use hms_domain::ward::{
    AdmissionStatus, BedStatus, DischargeBlocker, DischargeBlockerKind, DischargeBlockerStatus,
    DischargeCaseListItem, DischargeInvoiceSummary, DischargeStatus, DischargeWorkflowAction,
};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

use super::{AdmissionContext, WardCursor};

#[derive(Clone, Debug, FromRow)]
struct DischargeCaseRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    encounter_id: Option<Uuid>,
    visit_id: Option<Uuid>,
    patient_code: String,
    patient_display_name: String,
    ward_id: Uuid,
    ward_name: String,
    status: String,
    requested_at: DateTime<Utc>,
    discharged_at: Option<DateTime<Utc>>,
    nursing_release_education: Option<String>,
    nursing_release_instructions: Option<String>,
    nursing_released_at: Option<DateTime<Utc>>,
    pharmacy_required: bool,
    discharge_summary_posted_at: Option<DateTime<Utc>>,
    pharmacy_dispensed_at: Option<DateTime<Utc>>,
    invoice_count: i64,
    patient_balance_due_minor: i64,
    invoice_currency: Option<String>,
    discharge_summary_hold_reason: Option<String>,
    nursing_release_hold_reason: Option<String>,
    pharmacy_clearance_hold_reason: Option<String>,
    billing_clearance_hold_reason: Option<String>,
    discharge_summary_override_reason: Option<String>,
    nursing_release_override_reason: Option<String>,
    pharmacy_clearance_override_reason: Option<String>,
    billing_clearance_override_reason: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
struct DischargeContextRow {
    admission_case_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct DischargeCompletionContextRow {
    admission_case_id: Uuid,
    bed_id: Option<Uuid>,
}

pub async fn list_discharge_cases(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<DischargeCaseListItem>> {
    let mut query = discharge_query();
    query.push(" WHERE discharge_cases.facility_id = ");
    query.push_bind(facility_id);
    if let Some(cursor) = cursor {
        query.push(" AND (discharge_cases.requested_at, discharge_cases.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY discharge_cases.requested_at ASC, discharge_cases.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = observe_db_query(
        "ward.discharge_cases.list",
        query.build_query_as::<DischargeCaseRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(discharge_from_row).collect()
}

pub async fn get_discharge_case(
    pool: &PgPool,
    facility_id: Uuid,
    discharge_case_id: Uuid,
) -> anyhow::Result<Option<DischargeCaseListItem>> {
    let mut query = discharge_query();
    query.push(" WHERE discharge_cases.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND discharge_cases.id = ");
    query.push_bind(discharge_case_id);
    let row = observe_db_query(
        "ward.discharge_cases.get",
        query
            .build_query_as::<DischargeCaseRow>()
            .fetch_optional(pool),
    )
    .await?;
    row.map(discharge_from_row).transpose()
}

pub async fn request_discharge(
    pool: &PgPool,
    id: Uuid,
    facility_id: Uuid,
    admission: &AdmissionContext,
    encounter_id: Option<Uuid>,
    visit_id: Option<Uuid>,
    actor_user_id: Uuid,
) -> anyhow::Result<DischargeCaseListItem> {
    let mut transaction = pool.begin().await?;
    observe_db_query(
        "ward.discharge_cases.request.insert",
        sqlx::query(
            r#"
        INSERT INTO discharge_cases (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            encounter_id,
            visit_id,
            status,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (admission_case_id) DO UPDATE
        SET status = EXCLUDED.status,
            encounter_id = COALESCE(EXCLUDED.encounter_id, discharge_cases.encounter_id),
            visit_id = COALESCE(EXCLUDED.visit_id, discharge_cases.visit_id),
            updated_at = now()
        "#,
        )
        .bind(id)
        .bind(facility_id)
        .bind(admission.id)
        .bind(admission.patient_id)
        .bind(encounter_id.or(admission.encounter_id))
        .bind(visit_id.or(admission.visit_id))
        .bind(codec::encode(DischargeStatus::Requested)?)
        .bind(actor_user_id)
        .execute(&mut *transaction),
    )
    .await?;

    observe_db_query(
        "ward.discharge_cases.request.mark_admission_pending",
        sqlx::query(
            r#"
        UPDATE admission_cases
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
        )
        .bind(codec::encode(AdmissionStatus::DischargePending)?)
        .bind(facility_id)
        .bind(admission.id)
        .execute(&mut *transaction),
    )
    .await?;

    transaction.commit().await?;
    discharge_item_by_admission(pool, facility_id, admission.id).await
}

pub async fn record_nursing_release(
    pool: &PgPool,
    facility_id: Uuid,
    discharge_case_id: Uuid,
    education: String,
    instructions: String,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<DischargeCaseListItem>> {
    let row = observe_db_query(
        "ward.discharge_cases.nursing_release",
        sqlx::query_as::<_, DischargeContextRow>(
            r#"
        UPDATE discharge_cases
        SET nursing_release_education = $1,
            nursing_release_instructions = $2,
            nursing_released_at = now(),
            nursing_released_by_user_id = $3,
            updated_at = now()
        WHERE facility_id = $4
          AND id = $5
          AND status = $6
        RETURNING admission_case_id
        "#,
        )
        .bind(education)
        .bind(instructions)
        .bind(actor_user_id)
        .bind(facility_id)
        .bind(discharge_case_id)
        .bind(codec::encode(DischargeStatus::Requested)?)
        .fetch_optional(pool),
    )
    .await?;

    match row {
        Some(row) => Ok(Some(
            discharge_item_by_admission(pool, facility_id, row.admission_case_id).await?,
        )),
        None => Ok(None),
    }
}

pub async fn hold_discharge_blocker(
    pool: &PgPool,
    facility_id: Uuid,
    discharge_case_id: Uuid,
    blocker_type: DischargeBlockerKind,
    reason: String,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<DischargeCaseListItem>> {
    let blocker_type = codec::encode(blocker_type)?;
    let row = observe_db_query(
        "ward.discharge_cases.blocker_hold",
        sqlx::query_as::<_, DischargeContextRow>(
            r#"
        WITH target AS (
            SELECT admission_case_id
            FROM discharge_cases
            WHERE facility_id = $1
              AND id = $2
              AND status = $3
        ),
        upserted AS (
            INSERT INTO discharge_blocker_holds (
                id, facility_id, discharge_case_id, blocker_type, reason, held_by_user_id, released_at
            )
            SELECT $4, $1, $2, $5, $6, $7, NULL
            FROM target
            ON CONFLICT (discharge_case_id, blocker_type) DO UPDATE
            SET reason = EXCLUDED.reason,
                held_by_user_id = EXCLUDED.held_by_user_id,
                held_at = now(),
                released_at = NULL
            RETURNING discharge_case_id
        )
        SELECT target.admission_case_id
        FROM target
        JOIN upserted ON TRUE
        "#,
        )
        .bind(facility_id)
        .bind(discharge_case_id)
        .bind(codec::encode(DischargeStatus::Requested)?)
        .bind(Uuid::new_v4())
        .bind(blocker_type)
        .bind(reason)
        .bind(actor_user_id)
        .fetch_optional(pool),
    )
    .await?;

    match row {
        Some(row) => Ok(Some(
            discharge_item_by_admission(pool, facility_id, row.admission_case_id).await?,
        )),
        None => Ok(None),
    }
}

pub async fn override_discharge_blocker(
    pool: &PgPool,
    facility_id: Uuid,
    discharge_case_id: Uuid,
    blocker_type: DischargeBlockerKind,
    reason: String,
    actor_user_id: Uuid,
    reauth_verified_at: DateTime<Utc>,
) -> anyhow::Result<Option<DischargeCaseListItem>> {
    let blocker_type = codec::encode(blocker_type)?;
    let row = observe_db_query(
        "ward.discharge_cases.blocker_override",
        sqlx::query_as::<_, DischargeContextRow>(
            r#"
        WITH target AS (
            SELECT admission_case_id
            FROM discharge_cases
            WHERE facility_id = $1
              AND id = $2
              AND status = $3
        ),
        upserted AS (
            INSERT INTO discharge_blocker_overrides (
                id, facility_id, discharge_case_id, blocker_type, reason,
                overridden_by_user_id, reauth_verified_at
            )
            SELECT $4, $1, $2, $5, $6, $7, $8
            FROM target
            ON CONFLICT (discharge_case_id, blocker_type) DO UPDATE
            SET reason = EXCLUDED.reason,
                overridden_by_user_id = EXCLUDED.overridden_by_user_id,
                reauth_verified_at = EXCLUDED.reauth_verified_at,
                created_at = now()
            RETURNING discharge_case_id
        )
        SELECT target.admission_case_id
        FROM target
        JOIN upserted ON TRUE
        "#,
        )
        .bind(facility_id)
        .bind(discharge_case_id)
        .bind(codec::encode(DischargeStatus::Requested)?)
        .bind(Uuid::new_v4())
        .bind(blocker_type)
        .bind(reason)
        .bind(actor_user_id)
        .bind(reauth_verified_at)
        .fetch_optional(pool),
    )
    .await?;

    match row {
        Some(row) => Ok(Some(
            discharge_item_by_admission(pool, facility_id, row.admission_case_id).await?,
        )),
        None => Ok(None),
    }
}

pub async fn complete_discharge(
    pool: &PgPool,
    facility_id: Uuid,
    discharge_case_id: Uuid,
) -> anyhow::Result<Option<DischargeCaseListItem>> {
    let existing = get_discharge_case(pool, facility_id, discharge_case_id).await?;
    let Some(existing) = existing else {
        return Ok(None);
    };
    let open_blockers: Vec<_> = existing
        .blockers
        .iter()
        .filter(|blocker| blocker.blocking && blocker.status != DischargeBlockerStatus::Completed)
        .filter(|blocker| blocker.status != DischargeBlockerStatus::Overridden)
        .collect();
    if !open_blockers.is_empty() {
        anyhow::bail!("discharge blockers are still open");
    }

    let mut transaction = pool.begin().await?;
    let row = observe_db_query(
        "ward.discharge_cases.complete.mark_discharge",
        sqlx::query_as::<_, DischargeCompletionContextRow>(
            r#"
        UPDATE discharge_cases
        SET status = $1,
            discharged_at = COALESCE(discharge_cases.discharged_at, now()),
            updated_at = now()
        FROM admission_cases
        WHERE discharge_cases.facility_id = $2
          AND discharge_cases.id = $3
          AND discharge_cases.status = $4
          AND admission_cases.id = discharge_cases.admission_case_id
          AND admission_cases.facility_id = discharge_cases.facility_id
        RETURNING discharge_cases.admission_case_id,
                  admission_cases.bed_id
        "#,
        )
        .bind(codec::encode(DischargeStatus::Completed)?)
        .bind(facility_id)
        .bind(discharge_case_id)
        .bind(codec::encode(DischargeStatus::Requested)?)
        .fetch_optional(&mut *transaction),
    )
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    observe_db_query(
        "ward.discharge_cases.complete.mark_admission_discharged",
        sqlx::query(
            r#"
        UPDATE admission_cases
        SET status = $1,
            discharged_at = COALESCE(discharged_at, now()),
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
        )
        .bind(codec::encode(AdmissionStatus::Discharged)?)
        .bind(facility_id)
        .bind(row.admission_case_id)
        .execute(&mut *transaction),
    )
    .await?;

    if let Some(bed_id) = row.bed_id {
        observe_db_query(
            "ward.discharge_cases.complete.mark_bed_cleaning",
            sqlx::query(
                r#"
            UPDATE beds
            SET status = $1,
                cleaning_due_at = now()
                    + make_interval(mins => COALESCE(wards.bed_cleaning_minutes_override, 60)),
                updated_at = now()
            FROM wards
            WHERE beds.facility_id = $2
              AND beds.id = $3
              AND wards.id = beds.ward_id
              AND wards.facility_id = beds.facility_id
            "#,
            )
            .bind(codec::encode(BedStatus::Cleaning)?)
            .bind(facility_id)
            .bind(bed_id)
            .execute(&mut *transaction),
        )
        .await?;
    }

    transaction.commit().await?;
    Ok(Some(
        discharge_item_by_admission(pool, facility_id, row.admission_case_id).await?,
    ))
}

pub async fn cancel_discharge(
    pool: &PgPool,
    facility_id: Uuid,
    discharge_case_id: Uuid,
) -> anyhow::Result<Option<DischargeCaseListItem>> {
    let mut transaction = pool.begin().await?;
    let row = observe_db_query(
        "ward.discharge_cases.cancel.mark_discharge",
        sqlx::query_as::<_, DischargeContextRow>(
            r#"
        UPDATE discharge_cases
        SET status = $1,
            discharged_at = NULL,
            updated_at = now()
        WHERE facility_id = $2
          AND id = $3
          AND status <> $4
        RETURNING admission_case_id
        "#,
        )
        .bind(codec::encode(DischargeStatus::Cancelled)?)
        .bind(facility_id)
        .bind(discharge_case_id)
        .bind(codec::encode(DischargeStatus::Completed)?)
        .fetch_optional(&mut *transaction),
    )
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    observe_db_query(
        "ward.discharge_cases.cancel.restore_admission",
        sqlx::query(
            r#"
        UPDATE admission_cases
        SET status = $1,
            discharged_at = NULL,
            updated_at = now()
        WHERE facility_id = $2
          AND id = $3
          AND status <> $4
        "#,
        )
        .bind(codec::encode(AdmissionStatus::Admitted)?)
        .bind(facility_id)
        .bind(row.admission_case_id)
        .bind(codec::encode(AdmissionStatus::Discharged)?)
        .execute(&mut *transaction),
    )
    .await?;

    transaction.commit().await?;
    Ok(Some(
        discharge_item_by_admission(pool, facility_id, row.admission_case_id).await?,
    ))
}

fn discharge_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT discharge_cases.id,
               discharge_cases.admission_case_id,
               discharge_cases.patient_id,
               discharge_cases.encounter_id,
               discharge_cases.visit_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               admission_cases.ward_id,
               wards.name AS ward_name,
               discharge_cases.status,
               discharge_cases.requested_at,
               discharge_cases.discharged_at,
               discharge_cases.nursing_release_education,
               discharge_cases.nursing_release_instructions,
               discharge_cases.nursing_released_at,
               discharge_cases.pharmacy_required,
               summary_sources.completed_at AS discharge_summary_posted_at,
               pharmacy_sources.dispensed_at AS pharmacy_dispensed_at,
               COALESCE(invoice_sources.invoice_count, 0) AS invoice_count,
               COALESCE(invoice_sources.patient_balance_due_minor, 0) AS patient_balance_due_minor,
               invoice_sources.currency AS invoice_currency,
               holds.discharge_summary_hold_reason,
               holds.nursing_release_hold_reason,
               holds.pharmacy_clearance_hold_reason,
               holds.billing_clearance_hold_reason,
               overrides.discharge_summary_override_reason,
               overrides.nursing_release_override_reason,
               overrides.pharmacy_clearance_override_reason,
               overrides.billing_clearance_override_reason
        FROM discharge_cases
        JOIN patients
          ON patients.id = discharge_cases.patient_id
         AND patients.facility_id = discharge_cases.facility_id
        JOIN admission_cases
          ON admission_cases.id = discharge_cases.admission_case_id
         AND admission_cases.facility_id = discharge_cases.facility_id
        JOIN wards
          ON wards.id = admission_cases.ward_id
         AND wards.facility_id = admission_cases.facility_id
        LEFT JOIN LATERAL (
            SELECT max(updated_at) AS completed_at
            FROM clinical_notes
            WHERE clinical_notes.facility_id = discharge_cases.facility_id
              AND clinical_notes.patient_id = discharge_cases.patient_id
              AND clinical_notes.note_type = 'doctor_note'
              AND lower(clinical_notes.title) = 'discharge summary'
              AND clinical_notes.status IN ('signed', 'amended')
              AND (
                  (
                      COALESCE(discharge_cases.encounter_id, admission_cases.encounter_id) IS NOT NULL
                      AND clinical_notes.encounter_id = COALESCE(discharge_cases.encounter_id, admission_cases.encounter_id)
                  )
                  OR (
                      COALESCE(discharge_cases.encounter_id, admission_cases.encounter_id) IS NULL
                      AND COALESCE(discharge_cases.visit_id, admission_cases.visit_id) IS NOT NULL
                      AND EXISTS (
                          SELECT 1
                          FROM encounters
                          WHERE encounters.facility_id = discharge_cases.facility_id
                            AND encounters.id = clinical_notes.encounter_id
                            AND encounters.visit_id = COALESCE(discharge_cases.visit_id, admission_cases.visit_id)
                      )
                  )
              )
        ) summary_sources ON true
        LEFT JOIN LATERAL (
            SELECT max(pharmacy_fulfillments.dispensed_at) AS dispensed_at
            FROM pharmacy_fulfillments
            WHERE pharmacy_fulfillments.facility_id = discharge_cases.facility_id
              AND pharmacy_fulfillments.patient_id = discharge_cases.patient_id
              AND pharmacy_fulfillments.admission_case_id = discharge_cases.admission_case_id
              AND pharmacy_fulfillments.status = 'dispensed'
        ) pharmacy_sources ON true
        LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE invoices.status <> 'void') AS invoice_count,
                   COALESCE(sum(GREATEST(invoices.gross_amount_minor - invoices.paid_amount_minor, 0))
                       FILTER (WHERE invoices.status <> 'void'), 0)::bigint AS patient_balance_due_minor,
                   max(invoices.currency) FILTER (WHERE invoices.status <> 'void') AS currency
            FROM invoices
            WHERE invoices.facility_id = discharge_cases.facility_id
              AND invoices.patient_id = discharge_cases.patient_id
              AND (
                  invoices.admission_case_id = discharge_cases.admission_case_id
                  OR (
                      invoices.admission_case_id IS NULL
                      AND COALESCE(discharge_cases.encounter_id, admission_cases.encounter_id) IS NOT NULL
                      AND invoices.encounter_id = COALESCE(discharge_cases.encounter_id, admission_cases.encounter_id)
                  )
                  OR (
                      invoices.admission_case_id IS NULL
                      AND COALESCE(discharge_cases.encounter_id, admission_cases.encounter_id) IS NULL
                      AND COALESCE(discharge_cases.visit_id, admission_cases.visit_id) IS NOT NULL
                      AND invoices.visit_id = COALESCE(discharge_cases.visit_id, admission_cases.visit_id)
                  )
              )
        ) invoice_sources ON true
        LEFT JOIN (
            SELECT discharge_case_id,
                   max(reason) FILTER (WHERE blocker_type = 'discharge_summary' AND released_at IS NULL)
                       AS discharge_summary_hold_reason,
                   max(reason) FILTER (WHERE blocker_type = 'nursing_release' AND released_at IS NULL)
                       AS nursing_release_hold_reason,
                   max(reason) FILTER (WHERE blocker_type = 'pharmacy_clearance' AND released_at IS NULL)
                       AS pharmacy_clearance_hold_reason,
                   max(reason) FILTER (WHERE blocker_type = 'billing_clearance' AND released_at IS NULL)
                       AS billing_clearance_hold_reason
            FROM discharge_blocker_holds
            GROUP BY discharge_case_id
        ) holds ON holds.discharge_case_id = discharge_cases.id
        LEFT JOIN (
            SELECT discharge_case_id,
                   max(reason) FILTER (WHERE blocker_type = 'discharge_summary')
                       AS discharge_summary_override_reason,
                   max(reason) FILTER (WHERE blocker_type = 'nursing_release')
                       AS nursing_release_override_reason,
                   max(reason) FILTER (WHERE blocker_type = 'pharmacy_clearance')
                       AS pharmacy_clearance_override_reason,
                   max(reason) FILTER (WHERE blocker_type = 'billing_clearance')
                       AS billing_clearance_override_reason
            FROM discharge_blocker_overrides
            GROUP BY discharge_case_id
        ) overrides ON overrides.discharge_case_id = discharge_cases.id
        "#,
    )
}

async fn discharge_item_by_admission(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<DischargeCaseListItem> {
    let mut query = discharge_query();
    query.push(" WHERE discharge_cases.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND discharge_cases.admission_case_id = ");
    query.push_bind(admission_case_id);
    let row = observe_db_query(
        "ward.discharge_cases.get_by_admission",
        query.build_query_as::<DischargeCaseRow>().fetch_one(pool),
    )
    .await?;
    discharge_from_row(row)
}

fn discharge_from_row(row: DischargeCaseRow) -> anyhow::Result<DischargeCaseListItem> {
    let blockers = blockers_from_row(&row)?;
    let currency = row.invoice_currency.unwrap_or_else(|| "GHS".to_owned());
    Ok(DischargeCaseListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        encounter_id: row.encounter_id,
        visit_id: row.visit_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        ward_id: row.ward_id,
        ward_name: row.ward_name,
        status: codec::decode(&row.status)?,
        requested_at: row.requested_at,
        discharged_at: row.discharged_at,
        blockers,
        invoice_summary: DischargeInvoiceSummary {
            invoice_count: row.invoice_count,
            patient_balance_due: format_minor_amount(row.patient_balance_due_minor),
            patient_balance_due_minor: row.patient_balance_due_minor,
            currency,
        },
        schedule_follow_up_action: DischargeWorkflowAction {
            label: "Schedule follow-up".to_owned(),
            path: format!("/appointments/create?patient={}", row.patient_id),
        },
    })
}

fn blockers_from_row(row: &DischargeCaseRow) -> anyhow::Result<Vec<DischargeBlocker>> {
    let mut blockers = vec![
        blocker(
            row,
            DischargeBlockerKind::DischargeSummary,
            "Discharge summary",
            format!(
                "/patients/{}?action=add_note&note_type=doctor_note&title=Discharge%20summary",
                row.patient_id
            ),
            row.discharge_summary_posted_at,
            row.discharge_summary_hold_reason.clone(),
            row.discharge_summary_override_reason.clone(),
        )?,
        blocker(
            row,
            DischargeBlockerKind::NursingRelease,
            "Nursing release",
            format!(
                "/ward-board?view=discharge&patient={}&case={}",
                row.patient_id, row.id
            ),
            nursing_completed_at(row),
            row.nursing_release_hold_reason.clone(),
            row.nursing_release_override_reason.clone(),
        )?,
        blocker(
            row,
            DischargeBlockerKind::BillingClearance,
            "Billing clearance",
            format!("/billing/discharges?case={}", row.id),
            (row.patient_balance_due_minor <= 0).then_some(row.requested_at),
            row.billing_clearance_hold_reason.clone(),
            row.billing_clearance_override_reason.clone(),
        )?,
    ];

    if row.pharmacy_required {
        blockers.push(blocker(
            row,
            DischargeBlockerKind::PharmacyClearance,
            "Pharmacy dispense",
            format!(
                "/pharmacy/dispensing?patient={}&discharge={}",
                row.patient_id, row.id
            ),
            row.pharmacy_dispensed_at,
            row.pharmacy_clearance_hold_reason.clone(),
            row.pharmacy_clearance_override_reason.clone(),
        )?);
    }

    Ok(blockers)
}

fn nursing_completed_at(row: &DischargeCaseRow) -> Option<DateTime<Utc>> {
    let education_done = row
        .nursing_release_education
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty());
    let instructions_done = row
        .nursing_release_instructions
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty());
    (education_done && instructions_done)
        .then_some(row.nursing_released_at)
        .flatten()
}

fn blocker(
    row: &DischargeCaseRow,
    kind: DischargeBlockerKind,
    label: &str,
    path: String,
    completed_at: Option<DateTime<Utc>>,
    hold_reason: Option<String>,
    override_reason: Option<String>,
) -> anyhow::Result<DischargeBlocker> {
    let status = if completed_at.is_some() {
        DischargeBlockerStatus::Completed
    } else if override_reason.is_some() {
        DischargeBlockerStatus::Overridden
    } else if hold_reason.is_some()
        && matches!(
            kind,
            DischargeBlockerKind::BillingClearance | DischargeBlockerKind::PharmacyClearance
        )
    {
        DischargeBlockerStatus::Held
    } else {
        DischargeBlockerStatus::Pending
    };
    let encoded_kind = codec::encode(kind)?;
    Ok(DischargeBlocker {
        id: format!("{}:{encoded_kind}", row.id),
        blocker_type: kind,
        status,
        blocking: true,
        workflow_label: label.to_owned(),
        workflow_path: path,
        hold_reason,
        override_reason,
        completed_at,
        requires_reauth_for_override: true,
    })
}

fn format_minor_amount(value: i64) -> String {
    let major = value / 100;
    let minor = (value.abs() % 100) as u8;
    format!("{major}.{minor:02}")
}
