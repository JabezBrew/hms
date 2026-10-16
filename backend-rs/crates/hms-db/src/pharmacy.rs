use anyhow::Context;
use chrono::{DateTime, Duration, NaiveDate, Utc};
use hms_domain::clinical::{
    GenerateMedicationAdministrationResponse, PrescriptionStatus, PrnPolicy,
};
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

#[derive(Debug, FromRow)]
pub struct DispensingLocationRow {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

pub async fn list_dispensing_locations(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<PharmacyCursor>,
    limit: i64,
    search: Option<&str>,
) -> anyhow::Result<Vec<DispensingLocationRow>> {
    let mut query = QueryBuilder::<Postgres>::new(
        "SELECT id,code,name,created_at FROM storage_locations WHERE is_active AND facility_id=",
    );
    query.push_bind(facility_id);
    if let Some(search) = search.map(str::trim).filter(|value| !value.is_empty()) {
        let literal = search
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{literal}%");
        query
            .push(" AND (code ILIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR name ILIKE ")
            .push_bind(pattern)
            .push(" ESCAPE '\\')");
    }
    if let Some(cursor) = cursor {
        query
            .push(" AND (created_at,id)>(")
            .push_bind(cursor.occurred_at)
            .push(",")
            .push_bind(cursor.id)
            .push(")");
    }
    query
        .push(" ORDER BY created_at,id LIMIT ")
        .push_bind(limit.clamp(1, 101));
    Ok(observe_db_query(
        "pharmacy.dispensing_locations.list",
        query
            .build_query_as::<DispensingLocationRow>()
            .fetch_all(pool),
    )
    .await?)
}

#[derive(Clone, Debug)]
pub struct GenerateMarCommand {
    pub facility_id: Uuid,
    pub prescription_id: Uuid,
    pub admission_case_id: Uuid,
    pub days: u8,
    pub first_dose_at: Option<DateTime<Utc>>,
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
    prn_policy: Option<sqlx::types::Json<PrnPolicy>>,
    id: Uuid,
    patient_id: Uuid,
    medication_name: String,
    dose: String,
    route: String,
    frequency: String,
    inventory_item_id: Option<Uuid>,
    duration_days: Option<i32>,
    start_date: Option<NaiveDate>,
    first_dose_at: Option<DateTime<Utc>>,
    status: String,
}

#[derive(Clone, Debug, FromRow)]
struct AdmissionGenerationRow {
    patient_id: Uuid,
    status: String,
}

#[derive(Clone, Debug, FromRow)]
struct QueueRow {
    inventory_item_name: Option<String>,
    inventory_item_code: Option<String>,
    inventory_item_unit: Option<String>,
    prn_policy: Option<sqlx::types::Json<PrnPolicy>>,
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
    admission_case_id: Uuid,
    status: String,
    inventory_item_id: Option<Uuid>,
    dispensed_dose_count: i32,
    requested_dose_count: i32,
}

#[derive(Clone, Debug, FromRow)]
struct MedicationCourseForUpdate {
    prescription_prn_policy: Option<sqlx::types::Json<PrnPolicy>>,
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
    prescription_start_date: Option<NaiveDate>,
    prescription_duration_days: Option<i32>,
    prescription_first_dose_at: Option<DateTime<Utc>>,
}

pub async fn generate_mar_for_prescription(
    pool: &PgPool,
    command: GenerateMarCommand,
) -> anyhow::Result<GenerateMedicationAdministrationResponse> {
    let mut transaction = pool.begin().await?;
    let prescription = sqlx::query_as::<_, PrescriptionGenerationRow>(
        r#"
        SELECT id, patient_id, medication_name, dose, route, frequency, inventory_item_id, duration_days, start_date, first_dose_at, prn_policy, status
        FROM prescriptions
        WHERE facility_id = $1 AND id = $2
        FOR UPDATE
        "#,
    )
    .bind(command.facility_id)
    .bind(command.prescription_id)
    .fetch_optional(&mut *transaction)
    .await?
    .context("prescription_not_found")?;

    if codec::decode::<PrescriptionStatus>(&prescription.status)? != PrescriptionStatus::Active {
        anyhow::bail!("prescription_not_active");
    }

    if let Some(item_id) = prescription.inventory_item_id {
        let local_item = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM inventory_items WHERE facility_id = $1 AND id = $2)",
        )
        .bind(command.facility_id)
        .bind(item_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !local_item {
            anyhow::bail!("prescription_inventory_item_invalid");
        }
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
    .fetch_optional(&mut *transaction)
    .await?
    .context("admission_not_found")?;

    if admission.patient_id != prescription.patient_id {
        anyhow::bail!("admission_patient_mismatch");
    }
    if !matches!(admission.status.as_str(), "admitted" | "discharge_pending") {
        anyhow::bail!("admission_not_active");
    }

    let existing_course = sqlx::query_as::<_, MedicationCourseForUpdate>(
        r#"
        SELECT id, medication_name, dose, route, frequency, inventory_item_id, first_dose_at,
               interval_minutes, generation_window_start, generation_window_end,
               prescription_start_date, prescription_duration_days, prescription_first_dose_at, prescription_prn_policy
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

    // Resolve omitted first-dose timestamps while holding the source lock. A
    // retry reuses its original course, and future-dated orders cannot start now.
    let date_start = prescription.start_date.map(|date| {
        date.and_hms_opt(0, 0, 0)
            .expect("midnight is valid")
            .and_utc()
    });
    let first_dose_at = command
        .first_dose_at
        .or_else(|| existing_course.as_ref().map(|course| course.first_dose_at))
        .or(prescription.first_dose_at)
        .unwrap_or_else(|| date_start.map_or_else(Utc::now, |start| start.max(Utc::now())));
    if date_start.is_some_and(|start| first_dose_at < start)
        || prescription
            .first_dose_at
            .is_some_and(|start| first_dose_at < start)
    {
        anyhow::bail!("first_dose_before_prescription_start");
    }
    let schedule = MedicationSchedule::parse(&prescription.frequency)?;
    let window_start = first_dose_at;
    let mut window_end = first_dose_at
        .checked_add_signed(Duration::days(i64::from(command.days.clamp(1, 31))))
        .context("prescription_schedule_invalid")?;
    if let Some(days) = prescription.duration_days.filter(|days| *days > 0) {
        let anchor = prescription
            .first_dose_at
            .or(date_start)
            .unwrap_or(first_dose_at);
        window_end = window_end.min(
            anchor
                .checked_add_signed(Duration::days(i64::from(days)))
                .context("prescription_schedule_invalid")?,
        );
    }
    if first_dose_at >= window_end {
        anyhow::bail!("prescription_course_ended");
    }
    let dose_times = schedule.dose_times(first_dose_at, window_end);
    let requested_interval = schedule.interval_minutes();
    let course_id = if let Some(course) = existing_course {
        let course_active = sqlx::query_scalar::<_, bool>(
            "SELECT status = 'active' FROM medication_courses WHERE facility_id = $1 AND id = $2",
        )
        .bind(command.facility_id)
        .bind(course.id)
        .fetch_one(&mut *transaction)
        .await?;
        if !course_active {
            anyhow::bail!("prescription_course_closed");
        }
        if course.medication_name != prescription.medication_name
            || course.dose != prescription.dose
            || course.route != prescription.route
            || course.frequency != prescription.frequency
            || course.inventory_item_id != prescription.inventory_item_id
            || course.first_dose_at != first_dose_at
            || course.interval_minutes != requested_interval
            || course.generation_window_start != window_start
            || course.generation_window_end != window_end
            || course.prescription_start_date != prescription.start_date
            || course.prescription_duration_days != prescription.duration_days
            || course.prescription_prn_policy != prescription.prn_policy
            || course.prescription_first_dose_at != prescription.first_dose_at
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
            generation_window_start, generation_window_end, status, created_by_user_id,
            prescription_start_date, prescription_duration_days, prescription_first_dose_at, prescription_prn_policy
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'active', $15, $16, $17, $18, $19)
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
        .bind(first_dose_at)
        .bind(requested_interval)
        .bind(window_start)
        .bind(window_end)
        .bind(command.actor_user_id)
        .bind(prescription.start_date).bind(prescription.duration_days).bind(prescription.first_dose_at).bind(prescription.prn_policy.as_ref())
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
        SET id = pharmacy_fulfillments.id
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

    let requested_dose_count = sqlx::query_scalar::<_, i32>(
        "SELECT requested_dose_count FROM pharmacy_fulfillments WHERE facility_id = $1 AND id = $2",
    )
    .bind(command.facility_id)
    .bind(fulfillment_id)
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(GenerateMedicationAdministrationResponse {
        prescription_id: prescription.id,
        medication_course_id: course_id,
        pharmacy_fulfillment_id: Some(fulfillment_id),
        created_count,
        existing_count,
        requested_dose_count: i64::from(requested_dose_count),
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
    if status.is_none_or(|status| {
        matches!(
            status,
            PharmacyFulfillmentStatus::Pending | PharmacyFulfillmentStatus::PartiallyDispensed
        )
    }) {
        query.push(r#"
            AND EXISTS (
                SELECT 1 FROM prescriptions p
                JOIN medication_courses c ON c.prescription_id = p.id AND c.facility_id = p.facility_id
                WHERE p.facility_id = pharmacy_fulfillments.facility_id
                  AND p.id = pharmacy_fulfillments.prescription_id
                  AND p.patient_id = pharmacy_fulfillments.patient_id
                  AND c.id = pharmacy_fulfillments.medication_course_id
                  AND c.patient_id = p.patient_id AND c.admission_case_id = pharmacy_fulfillments.admission_case_id
                  AND c.status = 'active' AND p.status = 'active'
                  AND c.prescription_start_date IS NOT DISTINCT FROM p.start_date
                  AND c.prescription_duration_days IS NOT DISTINCT FROM p.duration_days
                  AND c.prescription_first_dose_at IS NOT DISTINCT FROM p.first_dose_at
                AND c.prescription_prn_policy IS NOT DISTINCT FROM p.prn_policy
                  AND c.medication_name = p.medication_name AND c.dose = p.dose
                  AND c.route = p.route AND c.frequency = p.frequency
                  AND c.inventory_item_id IS NOT DISTINCT FROM p.inventory_item_id
                  AND p.medication_name = pharmacy_fulfillments.medication_name
                  AND p.dose = pharmacy_fulfillments.dose AND p.route = pharmacy_fulfillments.route
                  AND p.frequency = pharmacy_fulfillments.frequency
                  AND p.inventory_item_id IS NOT DISTINCT FROM pharmacy_fulfillments.inventory_item_id
            )
        "#);
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
    // Read only the parent id first, then use the same source-before-child lock
    // order as prescription updates and MAR generation/administration.
    let prescription_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT prescription_id FROM pharmacy_fulfillments WHERE facility_id = $1 AND id = $2",
    )
    .bind(command.facility_id)
    .bind(command.fulfillment_id)
    .fetch_optional(&mut *transaction)
    .await?
    .context("fulfillment_not_found")?;
    let prescription =
        crate::clinical::lock_prescription(&mut transaction, command.facility_id, prescription_id)
            .await?
            .context("prescription_not_found")?;
    if prescription.status != PrescriptionStatus::Active {
        anyhow::bail!("prescription_not_active");
    }
    let current_regimen = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM pharmacy_fulfillments f
            JOIN medication_courses c ON c.id = f.medication_course_id
                AND c.facility_id = f.facility_id AND c.prescription_id = f.prescription_id
                AND c.patient_id = f.patient_id AND c.admission_case_id = f.admission_case_id
            JOIN prescriptions p ON p.id = f.prescription_id
                AND p.facility_id = f.facility_id AND p.patient_id = f.patient_id
            WHERE f.facility_id = $1 AND f.id = $2 AND c.status = 'active'
                AND f.medication_name = p.medication_name AND f.dose = p.dose
                AND f.route = p.route AND f.frequency = p.frequency
                AND f.inventory_item_id IS NOT DISTINCT FROM p.inventory_item_id
                AND c.medication_name = p.medication_name AND c.dose = p.dose
                AND c.route = p.route AND c.frequency = p.frequency
                AND c.inventory_item_id IS NOT DISTINCT FROM p.inventory_item_id
                AND c.prescription_start_date IS NOT DISTINCT FROM p.start_date
                AND c.prescription_duration_days IS NOT DISTINCT FROM p.duration_days
                AND c.prescription_first_dose_at IS NOT DISTINCT FROM p.first_dose_at
                AND c.prescription_prn_policy IS NOT DISTINCT FROM p.prn_policy
        )
        "#,
    )
    .bind(command.facility_id)
    .bind(command.fulfillment_id)
    .fetch_one(&mut *transaction)
    .await?;
    if !current_regimen {
        anyhow::bail!("prescription_regimen_stale");
    }
    let fulfillment = sqlx::query_as::<_, FulfillmentForUpdate>(
        r#"
        SELECT id, patient_id, admission_case_id, status, inventory_item_id, dispensed_dose_count, requested_dose_count
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

    let stock_quantity = if prescription.frequency.trim().eq_ignore_ascii_case("prn") {
        let at = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(&mut *transaction)
            .await?;
        let policy = crate::ward::prn::validate_prn_source(
            &mut transaction,
            command.facility_id,
            fulfillment.admission_case_id,
            &prescription,
            at,
        )
        .await?;
        // Supply is measured in doses; stock and dispensing evidence use the
        // explicit inventory units captured by the prescriber.
        command
            .quantity
            .checked_mul(policy.stock_units_per_dose)
            .context("prn_stock_quantity_overflow")?
    } else {
        command.quantity
    };
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
          AND (expires_on IS NULL OR expires_on >= (clock_timestamp() AT TIME ZONE 'UTC')::date)
          AND EXISTS (SELECT 1 FROM storage_locations l WHERE l.id=$3 AND l.facility_id=$1 AND l.is_active)
        ORDER BY expires_on ASC NULLS LAST, received_at ASC, id ASC
        LIMIT 1
        FOR UPDATE
        "#,
    )
    .bind(command.facility_id)
    .bind(command.item_id)
    .bind(command.location_id)
    .bind(stock_quantity)
    .fetch_optional(&mut *transaction)
    .await?
    .context("insufficient_stock")?;
    let balance_after = quantity_on_hand - stock_quantity;
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
    .bind(-stock_quantity)
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
    .bind(stock_quantity)
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
        SELECT stock.name AS inventory_item_name,stock.code AS inventory_item_code,stock.unit AS inventory_item_unit,
               courses.prescription_prn_policy AS prn_policy, pharmacy_fulfillments.id,
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
        INNER JOIN patients ON patients.id = pharmacy_fulfillments.patient_id AND patients.facility_id = pharmacy_fulfillments.facility_id
        INNER JOIN medication_courses courses ON courses.id = pharmacy_fulfillments.medication_course_id AND courses.facility_id = pharmacy_fulfillments.facility_id
        LEFT JOIN inventory_items stock ON stock.id=pharmacy_fulfillments.inventory_item_id AND stock.facility_id=pharmacy_fulfillments.facility_id
        "#,
    )
}

fn queue_item_from_row(row: QueueRow) -> anyhow::Result<PharmacyQueueItem> {
    Ok(PharmacyQueueItem {
        prn_policy: row.prn_policy.map(|p| p.0),
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
        inventory_item_name: row.inventory_item_name,
        inventory_item_code: row.inventory_item_code,
        inventory_item_unit: row.inventory_item_unit,
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
                    let Some(following) = next.checked_add_signed(Duration::minutes(minutes))
                    else {
                        break;
                    };
                    next = following;
                    if times.len() >= 512 {
                        break;
                    }
                }
                times
            }
        }
    }
}
