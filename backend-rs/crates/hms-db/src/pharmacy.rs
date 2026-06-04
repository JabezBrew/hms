use anyhow::Context;
use chrono::{DateTime, Duration, Utc};
use hms_domain::clinical::{GenerateMedicationAdministrationResponse, PrescriptionStatus};
use hms_domain::inventory::DispenseStatus;
use hms_domain::pharmacy::{
    PharmacyFulfillmentDispenseResult, PharmacyFulfillmentStatus, PharmacyQueueItem,
};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct PharmacyCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Debug)]
pub struct GenerateMarCommand {
    pub facility_id: Uuid,
    pub prescription_id: Uuid,
    pub admission_case_id: Uuid,
    pub days: u8,
    pub first_dose_at: DateTime<Utc>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct DispenseFulfillmentCommand {
    pub facility_id: Uuid,
    pub fulfillment_id: Uuid,
    pub item_id: Uuid,
    pub location_id: Uuid,
    pub quantity: i64,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct PrescriptionGenerationRow {
    id: Uuid,
    patient_id: Uuid,
    medication_name: String,
    dose: String,
    route: String,
    frequency: String,
    inventory_item_id: Option<Uuid>,
    duration_days: Option<i32>,
    status: String,
}

#[derive(Clone, Debug, FromRow)]
struct AdmissionGenerationRow {
    patient_id: Uuid,
    status: String,
}

#[derive(Clone, Debug, FromRow)]
struct QueueRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    admission_case_id: Uuid,
    prescription_id: Uuid,
    medication_course_id: Uuid,
    medication_name: String,
    dose: String,
    route: String,
    frequency: String,
    status: String,
    coverage_start: DateTime<Utc>,
    coverage_end: DateTime<Utc>,
    next_due_at: Option<DateTime<Utc>>,
    overdue_count: i64,
    requested_dose_count: i32,
    dispensed_dose_count: i32,
    inventory_item_id: Option<Uuid>,
    dispensing_location_id: Option<Uuid>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct FulfillmentForUpdate {
    id: Uuid,
    patient_id: Uuid,
    status: String,
    inventory_item_id: Option<Uuid>,
    dispensed_dose_count: i32,
    requested_dose_count: i32,
}

#[derive(Clone, Debug, FromRow)]
struct MedicationCourseForUpdate {
    id: Uuid,
    medication_name: String,
    dose: String,
    route: String,
    frequency: String,
    inventory_item_id: Option<Uuid>,
    first_dose_at: DateTime<Utc>,
    interval_minutes: Option<i32>,
    generation_window_start: DateTime<Utc>,
    generation_window_end: DateTime<Utc>,
}

pub async fn generate_mar_for_prescription(
    pool: &PgPool,
    command: GenerateMarCommand,
) -> anyhow::Result<GenerateMedicationAdministrationResponse> {
    let prescription = sqlx::query_as::<_, PrescriptionGenerationRow>(
        r#"
        SELECT id, patient_id, medication_name, dose, route, frequency, inventory_item_id, duration_days, status
        FROM prescriptions
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(command.facility_id)
    .bind(command.prescription_id)
    .fetch_optional(pool)
    .await?
    .context("prescription_not_found")?;

    if codec::decode::<PrescriptionStatus>(&prescription.status)? != PrescriptionStatus::Active {
        anyhow::bail!("prescription_not_active");
    }

    let admission = sqlx::query_as::<_, AdmissionGenerationRow>(
        r#"
        SELECT patient_id, status
        FROM admission_cases
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(command.facility_id)
    .bind(command.admission_case_id)
    .fetch_optional(pool)
    .await?
    .context("admission_not_found")?;

    if admission.patient_id != prescription.patient_id {
        anyhow::bail!("admission_patient_mismatch");
    }
    if !matches!(admission.status.as_str(), "admitted" | "discharge_pending") {
        anyhow::bail!("admission_not_active");
    }

    let schedule = MedicationSchedule::parse(&prescription.frequency)?;
    let bounded_days = i64::from(command.days.clamp(1, 31));
    let duration_days = prescription
        .duration_days
        .filter(|days| *days > 0)
        .map(i64::from);
    let actual_days = duration_days
        .map(|days| days.min(bounded_days))
        .unwrap_or(bounded_days)
        .max(1);
    let window_start = command.first_dose_at;
    let window_end = command.first_dose_at + Duration::days(actual_days);
    let dose_times = schedule.dose_times(command.first_dose_at, window_end);

    let mut transaction = pool.begin().await?;
    let existing_course = sqlx::query_as::<_, MedicationCourseForUpdate>(
        r#"
        SELECT id, medication_name, dose, route, frequency, inventory_item_id, first_dose_at,
               interval_minutes, generation_window_start, generation_window_end
        FROM medication_courses
        WHERE facility_id = $1 AND prescription_id = $2 AND admission_case_id = $3
        FOR UPDATE
        "#,
    )
    .bind(command.facility_id)
    .bind(prescription.id)
    .bind(command.admission_case_id)
    .fetch_optional(&mut *transaction)
    .await?;

    let requested_interval = schedule.interval_minutes();
    let course_id = if let Some(course) = existing_course {
        if course.medication_name != prescription.medication_name
            || course.dose != prescription.dose
            || course.route != prescription.route
            || course.frequency != prescription.frequency
            || course.inventory_item_id != prescription.inventory_item_id
            || course.first_dose_at != command.first_dose_at
            || course.interval_minutes != requested_interval
            || course.generation_window_start != window_start
            || course.generation_window_end != window_end
        {
            anyhow::bail!("mar_generation_parameters_locked");
        }
        course.id
    } else {
        let course_id = Uuid::new_v4();
        sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO medication_courses (
            id, facility_id, patient_id, admission_case_id, prescription_id,
            medication_name, dose, route, frequency, inventory_item_id, first_dose_at, interval_minutes,
            generation_window_start, generation_window_end, status, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'active', $15)
        RETURNING id
        "#,
        )
        .bind(course_id)
        .bind(command.facility_id)
        .bind(prescription.patient_id)
        .bind(command.admission_case_id)
        .bind(prescription.id)
        .bind(&prescription.medication_name)
        .bind(&prescription.dose)
        .bind(&prescription.route)
        .bind(&prescription.frequency)
        .bind(prescription.inventory_item_id)
        .bind(command.first_dose_at)
        .bind(requested_interval)
        .bind(window_start)
        .bind(window_end)
        .bind(command.actor_user_id)
        .fetch_one(&mut *transaction)
        .await?
    };

    if schedule.is_prn() {
        transaction.commit().await?;
        return Ok(GenerateMedicationAdministrationResponse {
            prescription_id: prescription.id,
            medication_course_id: course_id,
            pharmacy_fulfillment_id: None,
            created_count: 0,
            existing_count: 0,
            requested_dose_count: 0,
            window_start,
            window_end,
            skipped_reason: Some("prn".to_owned()),
        });
    }

    let fulfillment_id = Uuid::new_v4();
    let fulfillment_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO pharmacy_fulfillments (
            id, facility_id, patient_id, admission_case_id, prescription_id, medication_course_id,
            status, medication_name, dose, route, frequency, inventory_item_id, coverage_start, coverage_end,
            requested_dose_count, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (facility_id, medication_course_id) DO UPDATE
        SET medication_name = EXCLUDED.medication_name,
            dose = EXCLUDED.dose,
            route = EXCLUDED.route,
            frequency = EXCLUDED.frequency,
            inventory_item_id = EXCLUDED.inventory_item_id,
            coverage_start = EXCLUDED.coverage_start,
            coverage_end = EXCLUDED.coverage_end,
            requested_dose_count = EXCLUDED.requested_dose_count,
            updated_at = now()
        RETURNING id
        "#,
    )
    .bind(fulfillment_id)
    .bind(command.facility_id)
    .bind(prescription.patient_id)
    .bind(command.admission_case_id)
    .bind(prescription.id)
    .bind(course_id)
    .bind(&prescription.medication_name)
    .bind(&prescription.dose)
    .bind(&prescription.route)
    .bind(&prescription.frequency)
    .bind(prescription.inventory_item_id)
    .bind(window_start)
    .bind(window_end)
    .bind(i32::try_from(dose_times.len()).unwrap_or(i32::MAX))
    .bind(command.actor_user_id)
    .fetch_one(&mut *transaction)
    .await?;

    let mut created_count = 0_i64;
    let mut existing_count = 0_i64;
    for (index, scheduled_at) in dose_times.iter().enumerate() {
        let medication_id = Uuid::new_v4();
        let dose_sequence = i32::try_from(index + 1).unwrap_or(i32::MAX);
        let result = sqlx::query(
            r#"
            INSERT INTO medication_administrations (
                id, facility_id, admission_case_id, patient_id, prescription_id,
                medication_course_id, pharmacy_fulfillment_id, medication_name, dose, route,
                frequency, dose_sequence, scheduled_at, status, created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'scheduled', $14)
            ON CONFLICT (facility_id, medication_course_id, scheduled_at, dose_sequence)
            WHERE medication_course_id IS NOT NULL
            DO NOTHING
            "#,
        )
        .bind(medication_id)
        .bind(command.facility_id)
        .bind(command.admission_case_id)
        .bind(prescription.patient_id)
        .bind(prescription.id)
        .bind(course_id)
        .bind(fulfillment_id)
        .bind(&prescription.medication_name)
        .bind(&prescription.dose)
        .bind(&prescription.route)
        .bind(&prescription.frequency)
        .bind(dose_sequence)
        .bind(*scheduled_at)
        .bind(command.actor_user_id)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() == 1 {
            created_count += 1;
        } else {
            existing_count += 1;
        }

        let medication_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT id
            FROM medication_administrations
            WHERE facility_id = $1
              AND medication_course_id = $2
              AND scheduled_at = $3
              AND dose_sequence = $4
            "#,
        )
        .bind(command.facility_id)
        .bind(course_id)
        .bind(*scheduled_at)
        .bind(dose_sequence)
        .fetch_one(&mut *transaction)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO pharmacy_fulfillment_mar_entries (fulfillment_id, medication_administration_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(fulfillment_id)
        .bind(medication_id)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    Ok(GenerateMedicationAdministrationResponse {
        prescription_id: prescription.id,
        medication_course_id: course_id,
        pharmacy_fulfillment_id: Some(fulfillment_id),
        created_count,
        existing_count,
        requested_dose_count: i64::try_from(dose_times.len()).unwrap_or(i64::MAX),
        window_start,
        window_end,
        skipped_reason: None,
    })
}

pub async fn list_fulfillment_queue(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<PharmacyCursor>,
    limit: i64,
    patient_id: Option<Uuid>,
    status: Option<PharmacyFulfillmentStatus>,
) -> anyhow::Result<Vec<PharmacyQueueItem>> {
    let mut query = queue_query();
    query.push(" WHERE pharmacy_fulfillments.facility_id = ");
    query.push_bind(facility_id);
    if let Some(patient_id) = patient_id {
        query.push(" AND pharmacy_fulfillments.patient_id = ");
        query.push_bind(patient_id);
    }
    if let Some(status) = status {
        query.push(" AND pharmacy_fulfillments.status = ");
        query.push_bind(codec::encode(status)?);
    } else {
        query.push(" AND pharmacy_fulfillments.status IN ('pending', 'partially_dispensed')");
    }
    if let Some(cursor) = cursor {
        query.push(" AND (pharmacy_fulfillments.coverage_start, pharmacy_fulfillments.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(
        " ORDER BY pharmacy_fulfillments.coverage_start ASC, pharmacy_fulfillments.id ASC LIMIT ",
    );
    query.push_bind(limit);
    let rows = observe_db_query(
        "pharmacy.fulfillments.queue",
        query.build_query_as::<QueueRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(queue_item_from_row).collect()
}

pub async fn get_fulfillment(
    pool: &PgPool,
    facility_id: Uuid,
    fulfillment_id: Uuid,
) -> anyhow::Result<Option<PharmacyQueueItem>> {
    let mut query = queue_query();
    query.push(" WHERE pharmacy_fulfillments.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND pharmacy_fulfillments.id = ");
    query.push_bind(fulfillment_id);
    observe_db_query(
        "pharmacy.fulfillments.get",
        query.build_query_as::<QueueRow>().fetch_optional(pool),
    )
    .await?
    .map(queue_item_from_row)
    .transpose()
}

pub async fn dispense_fulfillment(
    pool: &PgPool,
    command: DispenseFulfillmentCommand,
) -> anyhow::Result<PharmacyFulfillmentDispenseResult> {
    let mut transaction = pool.begin().await?;
    let fulfillment = sqlx::query_as::<_, FulfillmentForUpdate>(
        r#"
        SELECT id, patient_id, status, inventory_item_id, dispensed_dose_count, requested_dose_count
        FROM pharmacy_fulfillments
        WHERE facility_id = $1 AND id = $2
        FOR UPDATE
        "#,
    )
    .bind(command.facility_id)
    .bind(command.fulfillment_id)
    .fetch_optional(&mut *transaction)
    .await?
    .context("fulfillment_not_found")?;

    if !matches!(
        fulfillment.status.as_str(),
        "pending" | "partially_dispensed"
    ) {
        anyhow::bail!("fulfillment_not_pending");
    }
    if command.quantity <= 0 {
        anyhow::bail!("quantity_must_be_positive");
    }
    match fulfillment.inventory_item_id {
        Some(expected_item_id) if expected_item_id == command.item_id => {}
        Some(_) => anyhow::bail!("inventory_item_mismatch"),
        None => anyhow::bail!("inventory_item_not_bound"),
    }

    let item = sqlx::query_as::<_, (bool,)>(
        "SELECT controlled FROM inventory_items WHERE facility_id = $1 AND id = $2",
    )
    .bind(command.facility_id)
    .bind(command.item_id)
    .fetch_optional(&mut *transaction)
    .await?
    .context("inventory_item_not_found")?;
    if item.0 {
        anyhow::bail!("controlled_item_requires_controlled_workflow");
    }

    let (batch_id, quantity_on_hand) = sqlx::query_as::<_, (Uuid, i64)>(
        r#"
        SELECT id, quantity_on_hand
        FROM stock_batches
        WHERE facility_id = $1
          AND item_id = $2
          AND location_id = $3
          AND quantity_on_hand >= $4
        ORDER BY expires_on ASC NULLS LAST, received_at ASC, id ASC
        LIMIT 1
        FOR UPDATE
        "#,
    )
    .bind(command.facility_id)
    .bind(command.item_id)
    .bind(command.location_id)
    .bind(command.quantity)
    .fetch_optional(&mut *transaction)
    .await?
    .context("insufficient_stock")?;
    let balance_after = quantity_on_hand - command.quantity;
    sqlx::query("UPDATE stock_batches SET quantity_on_hand = $1, updated_at = now() WHERE id = $2")
        .bind(balance_after)
        .bind(batch_id)
        .execute(&mut *transaction)
        .await?;

    sqlx::query(
        r#"
        INSERT INTO stock_movements (
            id, facility_id, item_id, batch_id, location_id, movement_type,
            quantity, balance_after, reason, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, 'dispense', $6, $7, 'pharmacy_fulfillment', $8)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(command.facility_id)
    .bind(command.item_id)
    .bind(batch_id)
    .bind(command.location_id)
    .bind(-command.quantity)
    .bind(balance_after)
    .bind(command.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO pharmacy_dispenses (
            id, facility_id, patient_id, item_id, location_id, quantity, status, dispensed_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(command.facility_id)
    .bind(fulfillment.patient_id)
    .bind(command.item_id)
    .bind(command.location_id)
    .bind(command.quantity)
    .bind(codec::encode(DispenseStatus::Dispensed)?)
    .bind(command.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    let medication_ids = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT medication_administrations.id
        FROM medication_administrations
        WHERE medication_administrations.facility_id = $1
          AND medication_administrations.pharmacy_fulfillment_id = $2
          AND medication_administrations.is_dispensed = false
          AND medication_administrations.status = 'scheduled'
        ORDER BY medication_administrations.scheduled_at ASC, medication_administrations.id ASC
        LIMIT $3
        FOR UPDATE
        "#,
    )
    .bind(command.facility_id)
    .bind(command.fulfillment_id)
    .bind(command.quantity)
    .fetch_all(&mut *transaction)
    .await?;
    if medication_ids.len() < usize::try_from(command.quantity).unwrap_or(usize::MAX) {
        anyhow::bail!("quantity_exceeds_pending_doses");
    }

    let dispensed_now = i32::try_from(medication_ids.len()).unwrap_or(i32::MAX);
    sqlx::query(
        r#"
        UPDATE medication_administrations
        SET is_dispensed = true,
            dispensed_at = now(),
            dispensed_by_user_id = $3,
            updated_at = now()
        WHERE facility_id = $1 AND id = ANY($2)
        "#,
    )
    .bind(command.facility_id)
    .bind(&medication_ids)
    .bind(command.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    let total_dispensed = fulfillment.dispensed_dose_count + dispensed_now;
    let new_status = if total_dispensed >= fulfillment.requested_dose_count {
        PharmacyFulfillmentStatus::Dispensed
    } else {
        PharmacyFulfillmentStatus::PartiallyDispensed
    };
    sqlx::query(
        r#"
        UPDATE pharmacy_fulfillments
        SET status = $3,
            dispensed_dose_count = $4,
            inventory_item_id = $5,
            dispensing_location_id = $6,
            dispensed_by_user_id = $7,
            dispensed_at = CASE WHEN $3 = 'dispensed' THEN now() ELSE dispensed_at END,
            updated_at = now()
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(command.facility_id)
    .bind(command.fulfillment_id)
    .bind(codec::encode(new_status)?)
    .bind(total_dispensed)
    .bind(command.item_id)
    .bind(command.location_id)
    .bind(command.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    let fulfillment = get_fulfillment(pool, command.facility_id, fulfillment.id)
        .await?
        .context("fulfillment_missing_after_dispense")?;
    Ok(PharmacyFulfillmentDispenseResult {
        remaining_dose_count: i64::from(fulfillment.requested_dose_count)
            - i64::from(fulfillment.dispensed_dose_count),
        fulfillment,
        dispensed_dose_count: i64::from(dispensed_now),
    })
}

fn queue_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT pharmacy_fulfillments.id,
               pharmacy_fulfillments.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               pharmacy_fulfillments.admission_case_id,
               pharmacy_fulfillments.prescription_id,
               pharmacy_fulfillments.medication_course_id,
               pharmacy_fulfillments.medication_name,
               pharmacy_fulfillments.dose,
               pharmacy_fulfillments.route,
               pharmacy_fulfillments.frequency,
               pharmacy_fulfillments.status,
               pharmacy_fulfillments.coverage_start,
               pharmacy_fulfillments.coverage_end,
               (
                 SELECT min(medication_administrations.scheduled_at)
                 FROM medication_administrations
                 WHERE medication_administrations.pharmacy_fulfillment_id = pharmacy_fulfillments.id
                   AND medication_administrations.facility_id = pharmacy_fulfillments.facility_id
                   AND medication_administrations.is_dispensed = false
                   AND medication_administrations.status = 'scheduled'
               ) AS next_due_at,
               (
                 SELECT count(*)
                 FROM medication_administrations
                 WHERE medication_administrations.pharmacy_fulfillment_id = pharmacy_fulfillments.id
                   AND medication_administrations.facility_id = pharmacy_fulfillments.facility_id
                   AND medication_administrations.is_dispensed = false
                   AND medication_administrations.status = 'scheduled'
                   AND medication_administrations.scheduled_at <= now()
               ) AS overdue_count,
               pharmacy_fulfillments.requested_dose_count,
               pharmacy_fulfillments.dispensed_dose_count,
               pharmacy_fulfillments.inventory_item_id,
               pharmacy_fulfillments.dispensing_location_id,
               pharmacy_fulfillments.created_at
        FROM pharmacy_fulfillments
        INNER JOIN patients ON patients.id = pharmacy_fulfillments.patient_id
        "#,
    )
}

fn queue_item_from_row(row: QueueRow) -> anyhow::Result<PharmacyQueueItem> {
    Ok(PharmacyQueueItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        admission_case_id: row.admission_case_id,
        prescription_id: row.prescription_id,
        medication_course_id: row.medication_course_id,
        medication_name: row.medication_name,
        dose: row.dose,
        route: row.route,
        frequency: row.frequency,
        status: codec::decode(&row.status)?,
        coverage_start: row.coverage_start,
        coverage_end: row.coverage_end,
        next_due_at: row.next_due_at,
        overdue_count: row.overdue_count,
        requested_dose_count: i64::from(row.requested_dose_count),
        dispensed_dose_count: i64::from(row.dispensed_dose_count),
        inventory_item_id: row.inventory_item_id,
        dispensing_location_id: row.dispensing_location_id,
        created_at: row.created_at,
    })
}

#[derive(Clone, Copy, Debug)]
enum MedicationSchedule {
    Prn,
    Once,
    Interval { minutes: i64 },
}

impl MedicationSchedule {
    fn parse(frequency: &str) -> anyhow::Result<Self> {
        let normalized = frequency
            .trim()
            .to_ascii_lowercase()
            .replace([' ', '-', '_'], "");
        match normalized.as_str() {
            "prn" => Ok(Self::Prn),
            "stat" | "once" => Ok(Self::Once),
            "daily" | "q24h" | "od" => Ok(Self::Interval { minutes: 1_440 }),
            "bid" | "bd" | "q12h" => Ok(Self::Interval { minutes: 720 }),
            "tid" | "tds" | "q8h" => Ok(Self::Interval { minutes: 480 }),
            "qid" | "qds" | "q6h" => Ok(Self::Interval { minutes: 360 }),
            "q4h" => Ok(Self::Interval { minutes: 240 }),
            "qhs" => Ok(Self::Interval { minutes: 1_440 }),
            _ => anyhow::bail!("unsupported_frequency"),
        }
    }

    fn is_prn(self) -> bool {
        matches!(self, Self::Prn)
    }

    fn interval_minutes(self) -> Option<i32> {
        match self {
            Self::Interval { minutes } => i32::try_from(minutes).ok(),
            _ => None,
        }
    }

    fn dose_times(
        self,
        first_dose_at: DateTime<Utc>,
        window_end: DateTime<Utc>,
    ) -> Vec<DateTime<Utc>> {
        match self {
            Self::Prn => Vec::new(),
            Self::Once => vec![first_dose_at],
            Self::Interval { minutes } => {
                let mut times = Vec::new();
                let mut next = first_dose_at;
                while next < window_end {
                    times.push(next);
                    next += Duration::minutes(minutes);
                    if times.len() >= 512 {
                        break;
                    }
                }
                times
            }
        }
    }
}
