use chrono::{DateTime, Utc};
use hms_domain::laboratory::{
    LabOrderListItem, LabOrderStatus, LabOrderTestItem, LabPanelListItem, LabPriority,
    LabResultListItem, LabResultStatus, LabTestCatalogItem, SpecimenListItem, SpecimenStatus,
};
use sqlx::types::Json;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct LabCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Debug)]
pub struct OrderContext {
    pub id: Uuid,
    pub patient_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct SpecimenContext {
    pub id: Uuid,
    pub order_id: Uuid,
    pub patient_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct ResultContext {
    pub id: Uuid,
    pub order_id: Uuid,
    pub patient_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewLabOrder {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub test_ids: Vec<Uuid>,
    pub panel_ids: Vec<Uuid>,
    pub priority: LabPriority,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewSpecimen {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub order_id: Uuid,
    pub patient_id: Uuid,
    pub specimen_type: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewLabResult {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub specimen_id: Uuid,
    pub order_id: Uuid,
    pub patient_id: Uuid,
    pub test_id: Uuid,
    pub value: String,
    pub unit: Option<String>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug, Default)]
pub struct LabOrderListFilters {
    pub status: Option<LabOrderStatus>,
}

#[derive(Clone, Debug, Default)]
pub struct LabResultListFilters {
    pub status: Option<LabResultStatus>,
    pub is_verified: Option<bool>,
}

#[derive(Clone, Debug, FromRow)]
struct TestRow {
    id: Uuid,
    code: String,
    name: String,
    specimen_type: String,
    result_unit: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
struct PanelRow {
    id: Uuid,
    code: String,
    name: String,
    test_count: i64,
}

#[derive(Clone, Debug, FromRow)]
struct OrderRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    priority: String,
    status: String,
    ordered_at: DateTime<Utc>,
    test_count: i64,
    order_tests: Json<Vec<LabOrderTestItem>>,
}

#[derive(Clone, Debug, FromRow)]
struct SpecimenRow {
    id: Uuid,
    order_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    specimen_type: String,
    status: String,
    collected_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ResultRow {
    id: Uuid,
    order_id: Uuid,
    specimen_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    test_id: Uuid,
    test_name: String,
    value: String,
    unit: Option<String>,
    status: String,
    entered_at: DateTime<Utc>,
    verified_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct ContextRow {
    id: Uuid,
    patient_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct SpecimenContextRow {
    id: Uuid,
    order_id: Uuid,
    patient_id: Uuid,
}

pub async fn list_test_catalog(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Vec<LabTestCatalogItem>> {
    let rows = sqlx::query_as::<_, TestRow>(
        r#"
        SELECT id, code, name, specimen_type, result_unit
        FROM lab_tests
        WHERE facility_id = $1 AND is_active = TRUE
        ORDER BY code ASC, id ASC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(test_from_row).collect())
}

pub async fn get_test_catalog_item(
    pool: &PgPool,
    facility_id: Uuid,
    test_id: Uuid,
) -> anyhow::Result<Option<LabTestCatalogItem>> {
    let row = sqlx::query_as::<_, TestRow>(
        r#"
        SELECT id, code, name, specimen_type, result_unit
        FROM lab_tests
        WHERE facility_id = $1 AND id = $2 AND is_active = TRUE
        "#,
    )
    .bind(facility_id)
    .bind(test_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(test_from_row))
}

pub async fn list_panels(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Vec<LabPanelListItem>> {
    let rows = sqlx::query_as::<_, PanelRow>(
        r#"
        SELECT lab_panels.id,
               lab_panels.code,
               lab_panels.name,
               COUNT(lab_panel_tests.test_id)::bigint AS test_count
        FROM lab_panels
        LEFT JOIN lab_panel_tests ON lab_panel_tests.panel_id = lab_panels.id
        WHERE lab_panels.facility_id = $1 AND lab_panels.is_active = TRUE
        GROUP BY lab_panels.id, lab_panels.code, lab_panels.name
        ORDER BY lab_panels.code ASC, lab_panels.id ASC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(panel_from_row).collect())
}

pub async fn get_panel_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    panel_id: Uuid,
) -> anyhow::Result<Option<LabPanelListItem>> {
    let row = sqlx::query_as::<_, PanelRow>(
        r#"
        SELECT lab_panels.id,
               lab_panels.code,
               lab_panels.name,
               COUNT(lab_panel_tests.test_id)::bigint AS test_count
        FROM lab_panels
        LEFT JOIN lab_panel_tests ON lab_panel_tests.panel_id = lab_panels.id
        WHERE lab_panels.facility_id = $1
          AND lab_panels.id = $2
          AND lab_panels.is_active = TRUE
        GROUP BY lab_panels.id, lab_panels.code, lab_panels.name
        "#,
    )
    .bind(facility_id)
    .bind(panel_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(panel_from_row))
}

pub async fn list_orders(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<LabCursor>,
    limit: i64,
    filters: LabOrderListFilters,
) -> anyhow::Result<Vec<LabOrderListItem>> {
    let mut query = order_query();
    query.push(" WHERE lab_orders.facility_id = ");
    query.push_bind(facility_id);
    if let Some(status) = filters.status {
        query.push(" AND lab_orders.status = ");
        query.push_bind(codec::encode(status)?);
    }
    apply_cursor(&mut query, "lab_orders.ordered_at", "lab_orders.id", cursor);
    query.push(
        r#"
        GROUP BY lab_orders.id, patients.patient_code
        ORDER BY lab_orders.ordered_at DESC, lab_orders.id DESC
        LIMIT
        "#,
    );
    query.push_bind(limit);
    let rows = query.build_query_as::<OrderRow>().fetch_all(pool).await?;
    rows.into_iter().map(order_from_row).collect()
}

pub async fn create_order(pool: &PgPool, order: NewLabOrder) -> anyhow::Result<LabOrderListItem> {
    let test_ids = resolve_order_test_ids(pool, &order).await?;
    if test_ids.is_empty() {
        anyhow::bail!("lab order requires at least one active test");
    }

    let mut transaction = pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO lab_orders (
            id, facility_id, patient_id, priority, status, ordered_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(order.id)
    .bind(order.facility_id)
    .bind(order.patient_id)
    .bind(codec::encode(order.priority)?)
    .bind(codec::encode(LabOrderStatus::Ordered)?)
    .bind(order.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    for test_id in test_ids {
        sqlx::query(
            r#"
            INSERT INTO lab_order_tests (order_id, test_id)
            VALUES ($1, $2)
            ON CONFLICT (order_id, test_id) DO NOTHING
            "#,
        )
        .bind(order.id)
        .bind(test_id)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    fetch_order_by_id(pool, order.facility_id, order.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created lab order was not found"))
}

pub async fn get_order_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Uuid,
) -> anyhow::Result<Option<LabOrderListItem>> {
    fetch_order_by_id(pool, facility_id, order_id).await
}

pub async fn get_order_context(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Uuid,
) -> anyhow::Result<Option<OrderContext>> {
    Ok(sqlx::query_as::<_, ContextRow>(
        "SELECT id, patient_id FROM lab_orders WHERE facility_id = $1 AND id = $2",
    )
    .bind(facility_id)
    .bind(order_id)
    .fetch_optional(pool)
    .await?
    .map(|row| OrderContext {
        id: row.id,
        patient_id: row.patient_id,
    }))
}

pub async fn submit_order(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Uuid,
) -> anyhow::Result<Option<LabOrderListItem>> {
    transition_order_status(
        pool,
        facility_id,
        order_id,
        LabOrderStatus::Ordered,
        &[LabOrderStatus::Ordered],
    )
    .await
}

pub async fn collect_order(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Uuid,
) -> anyhow::Result<Option<LabOrderListItem>> {
    transition_order_status(
        pool,
        facility_id,
        order_id,
        LabOrderStatus::SpecimenCollected,
        &[LabOrderStatus::Ordered, LabOrderStatus::SpecimenCollected],
    )
    .await
}

pub async fn start_order_processing(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Uuid,
) -> anyhow::Result<Option<LabOrderListItem>> {
    transition_order_status(
        pool,
        facility_id,
        order_id,
        LabOrderStatus::ResultEntered,
        &[
            LabOrderStatus::SpecimenCollected,
            LabOrderStatus::ResultEntered,
        ],
    )
    .await
}

pub async fn cancel_order(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Uuid,
    actor_user_id: Uuid,
    cancellation_reason: Option<String>,
) -> anyhow::Result<Option<LabOrderListItem>> {
    let current_status = current_order_status(pool, facility_id, order_id).await?;
    let Some(current_status) = current_status else {
        return Ok(None);
    };
    if !matches!(
        current_status,
        LabOrderStatus::Ordered
            | LabOrderStatus::SpecimenCollected
            | LabOrderStatus::ResultEntered
            | LabOrderStatus::Cancelled
    ) {
        anyhow::bail!("lab order cannot be cancelled from its current status");
    }

    sqlx::query(
        r#"
        UPDATE lab_orders
        SET status = $1,
            cancellation_reason = COALESCE($2, cancellation_reason),
            cancelled_by_user_id = COALESCE(cancelled_by_user_id, $3),
            cancelled_at = COALESCE(cancelled_at, now()),
            updated_at = now()
        WHERE facility_id = $4 AND id = $5
        "#,
    )
    .bind(codec::encode(LabOrderStatus::Cancelled)?)
    .bind(cancellation_reason)
    .bind(actor_user_id)
    .bind(facility_id)
    .bind(order_id)
    .execute(pool)
    .await?;

    fetch_order_by_id(pool, facility_id, order_id).await
}

pub async fn list_specimens(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<LabCursor>,
    limit: i64,
) -> anyhow::Result<Vec<SpecimenListItem>> {
    let mut query = specimen_query();
    query.push(" WHERE lab_specimens.facility_id = ");
    query.push_bind(facility_id);
    apply_cursor(
        &mut query,
        "lab_specimens.collected_at",
        "lab_specimens.id",
        cursor,
    );
    query.push(
        r#"
        ORDER BY lab_specimens.collected_at DESC, lab_specimens.id DESC
        LIMIT
        "#,
    );
    query.push_bind(limit);
    let rows = query
        .build_query_as::<SpecimenRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(specimen_from_row).collect()
}

pub async fn create_specimen(
    pool: &PgPool,
    specimen: NewSpecimen,
) -> anyhow::Result<SpecimenListItem> {
    let mut transaction = pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO lab_specimens (
            id, facility_id, order_id, patient_id, specimen_type, status, collected_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(specimen.id)
    .bind(specimen.facility_id)
    .bind(specimen.order_id)
    .bind(specimen.patient_id)
    .bind(&specimen.specimen_type)
    .bind(codec::encode(SpecimenStatus::Collected)?)
    .bind(specimen.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE lab_orders
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
    )
    .bind(codec::encode(LabOrderStatus::SpecimenCollected)?)
    .bind(specimen.facility_id)
    .bind(specimen.order_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    fetch_specimen_by_id(pool, specimen.facility_id, specimen.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created specimen was not found"))
}

pub async fn get_specimen_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    specimen_id: Uuid,
) -> anyhow::Result<Option<SpecimenListItem>> {
    fetch_specimen_by_id(pool, facility_id, specimen_id).await
}

pub async fn get_specimen_context(
    pool: &PgPool,
    facility_id: Uuid,
    specimen_id: Uuid,
) -> anyhow::Result<Option<SpecimenContext>> {
    Ok(sqlx::query_as::<_, SpecimenContextRow>(
        r#"
        SELECT id, order_id, patient_id
        FROM lab_specimens
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(specimen_id)
    .fetch_optional(pool)
    .await?
    .map(|row| SpecimenContext {
        id: row.id,
        order_id: row.order_id,
        patient_id: row.patient_id,
    }))
}

pub async fn receive_specimen(
    pool: &PgPool,
    facility_id: Uuid,
    specimen_id: Uuid,
) -> anyhow::Result<Option<SpecimenListItem>> {
    let current_status = sqlx::query_scalar::<_, String>(
        "SELECT status FROM lab_specimens WHERE facility_id = $1 AND id = $2",
    )
    .bind(facility_id)
    .bind(specimen_id)
    .fetch_optional(pool)
    .await?
    .map(|status| codec::decode::<SpecimenStatus>(&status))
    .transpose()?;

    let Some(current_status) = current_status else {
        return Ok(None);
    };
    if !matches!(
        current_status,
        SpecimenStatus::Collected | SpecimenStatus::Received
    ) {
        anyhow::bail!("specimen cannot be received from its current status");
    }

    sqlx::query(
        r#"
        UPDATE lab_specimens
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
    )
    .bind(codec::encode(SpecimenStatus::Received)?)
    .bind(facility_id)
    .bind(specimen_id)
    .execute(pool)
    .await?;

    fetch_specimen_by_id(pool, facility_id, specimen_id).await
}

pub async fn list_results(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<LabCursor>,
    limit: i64,
    filters: LabResultListFilters,
) -> anyhow::Result<Vec<LabResultListItem>> {
    let mut query = result_query();
    query.push(" WHERE lab_results.facility_id = ");
    query.push_bind(facility_id);
    if let Some(status) = filters.status {
        query.push(" AND lab_results.status = ");
        query.push_bind(codec::encode(status)?);
    }
    if let Some(is_verified) = filters.is_verified {
        if is_verified {
            query.push(" AND lab_results.verified_at IS NOT NULL");
        } else {
            query.push(" AND lab_results.verified_at IS NULL");
        }
    }
    apply_cursor(
        &mut query,
        "lab_results.entered_at",
        "lab_results.id",
        cursor,
    );
    query.push(
        r#"
        ORDER BY lab_results.entered_at DESC, lab_results.id DESC
        LIMIT
        "#,
    );
    query.push_bind(limit);
    let rows = query.build_query_as::<ResultRow>().fetch_all(pool).await?;
    rows.into_iter().map(result_from_row).collect()
}

pub async fn create_result(
    pool: &PgPool,
    result: NewLabResult,
) -> anyhow::Result<LabResultListItem> {
    let mut transaction = pool.begin().await?;
    let inserted_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO lab_results (
            id,
            facility_id,
            order_id,
            specimen_id,
            patient_id,
            test_id,
            value,
            unit,
            status,
            entered_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        WHERE EXISTS (
            SELECT 1
            FROM lab_order_tests
            WHERE lab_order_tests.order_id = $3
              AND lab_order_tests.test_id = $6
        )
        RETURNING id
        "#,
    )
    .bind(result.id)
    .bind(result.facility_id)
    .bind(result.order_id)
    .bind(result.specimen_id)
    .bind(result.patient_id)
    .bind(result.test_id)
    .bind(&result.value)
    .bind(&result.unit)
    .bind(codec::encode(LabResultStatus::Entered)?)
    .bind(result.actor_user_id)
    .fetch_optional(&mut *transaction)
    .await?;

    if inserted_id.is_none() {
        anyhow::bail!("lab result test is not part of the order");
    }

    sqlx::query(
        r#"
        UPDATE lab_orders
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
    )
    .bind(codec::encode(LabOrderStatus::ResultEntered)?)
    .bind(result.facility_id)
    .bind(result.order_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    fetch_result_by_id(pool, result.facility_id, result.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created lab result was not found"))
}

pub async fn create_results(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Uuid,
    results: Vec<NewLabResult>,
) -> anyhow::Result<Vec<LabResultListItem>> {
    if results.is_empty() {
        anyhow::bail!("bulk lab result creation requires at least one result");
    }

    let mut transaction = pool.begin().await?;
    let mut inserted_ids = Vec::with_capacity(results.len());
    for result in results {
        let inserted_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO lab_results (
                id,
                facility_id,
                order_id,
                specimen_id,
                patient_id,
                test_id,
                value,
                unit,
                status,
                entered_by_user_id
            )
            SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            WHERE EXISTS (
                SELECT 1
                FROM lab_order_tests
                WHERE lab_order_tests.order_id = $3
                  AND lab_order_tests.test_id = $6
            )
            RETURNING id
            "#,
        )
        .bind(result.id)
        .bind(result.facility_id)
        .bind(result.order_id)
        .bind(result.specimen_id)
        .bind(result.patient_id)
        .bind(result.test_id)
        .bind(&result.value)
        .bind(&result.unit)
        .bind(codec::encode(LabResultStatus::Entered)?)
        .bind(result.actor_user_id)
        .fetch_optional(&mut *transaction)
        .await?;

        let Some(inserted_id) = inserted_id else {
            anyhow::bail!("lab result test is not part of the order");
        };
        inserted_ids.push(inserted_id);
    }

    sqlx::query(
        r#"
        UPDATE lab_orders
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
    )
    .bind(codec::encode(LabOrderStatus::ResultEntered)?)
    .bind(facility_id)
    .bind(order_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    let mut created = Vec::with_capacity(inserted_ids.len());
    for result_id in inserted_ids {
        let Some(result) = fetch_result_by_id(pool, facility_id, result_id).await? else {
            anyhow::bail!("created lab result was not found");
        };
        created.push(result);
    }
    Ok(created)
}

pub async fn get_result_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    result_id: Uuid,
) -> anyhow::Result<Option<LabResultListItem>> {
    fetch_result_by_id(pool, facility_id, result_id).await
}

pub async fn get_result_context(
    pool: &PgPool,
    facility_id: Uuid,
    result_id: Uuid,
) -> anyhow::Result<Option<ResultContext>> {
    Ok(sqlx::query_as::<_, SpecimenContextRow>(
        r#"
        SELECT id, order_id, patient_id
        FROM lab_results
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(result_id)
    .fetch_optional(pool)
    .await?
    .map(|row| ResultContext {
        id: row.id,
        order_id: row.order_id,
        patient_id: row.patient_id,
    }))
}

pub async fn verify_result(
    pool: &PgPool,
    facility_id: Uuid,
    result_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<LabResultListItem>> {
    let mut transaction = pool.begin().await?;
    let order_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        UPDATE lab_results
        SET status = $1,
            verified_by_user_id = $2,
            verified_at = now(),
            updated_at = now()
        WHERE facility_id = $3 AND id = $4
        RETURNING order_id
        "#,
    )
    .bind(codec::encode(LabResultStatus::Verified)?)
    .bind(actor_user_id)
    .bind(facility_id)
    .bind(result_id)
    .fetch_optional(&mut *transaction)
    .await?;

    if let Some(order_id) = order_id {
        sqlx::query(
            r#"
            UPDATE lab_orders
            SET status = $1,
                updated_at = now()
            WHERE facility_id = $2 AND id = $3
            "#,
        )
        .bind(codec::encode(LabOrderStatus::Verified)?)
        .bind(facility_id)
        .bind(order_id)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    fetch_result_by_id(pool, facility_id, result_id).await
}

pub async fn verify_results(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Option<Uuid>,
    result_ids: &[Uuid],
    actor_user_id: Uuid,
) -> anyhow::Result<i64> {
    if order_id.is_none() && result_ids.is_empty() {
        anyhow::bail!("bulk verification requires an order id or result ids");
    }

    let mut transaction = pool.begin().await?;
    let order_ids = if let Some(order_id) = order_id {
        sqlx::query_scalar::<_, Uuid>(
            r#"
            UPDATE lab_results
            SET status = $1,
                verified_by_user_id = $2,
                verified_at = COALESCE(verified_at, now()),
                updated_at = now()
            WHERE facility_id = $3
              AND order_id = $4
              AND verified_at IS NULL
            RETURNING order_id
            "#,
        )
        .bind(codec::encode(LabResultStatus::Verified)?)
        .bind(actor_user_id)
        .bind(facility_id)
        .bind(order_id)
        .fetch_all(&mut *transaction)
        .await?
    } else {
        sqlx::query_scalar::<_, Uuid>(
            r#"
            UPDATE lab_results
            SET status = $1,
                verified_by_user_id = $2,
                verified_at = COALESCE(verified_at, now()),
                updated_at = now()
            WHERE facility_id = $3
              AND id = ANY($4)
              AND verified_at IS NULL
            RETURNING order_id
            "#,
        )
        .bind(codec::encode(LabResultStatus::Verified)?)
        .bind(actor_user_id)
        .bind(facility_id)
        .bind(result_ids)
        .fetch_all(&mut *transaction)
        .await?
    };

    let mut distinct_order_ids = order_ids.clone();
    distinct_order_ids.sort_unstable();
    distinct_order_ids.dedup();
    if !distinct_order_ids.is_empty() {
        sqlx::query(
            r#"
            UPDATE lab_orders
            SET status = $1,
                updated_at = now()
            WHERE facility_id = $2 AND id = ANY($3)
            "#,
        )
        .bind(codec::encode(LabOrderStatus::Verified)?)
        .bind(facility_id)
        .bind(&distinct_order_ids)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    Ok(order_ids.len() as i64)
}

async fn resolve_order_test_ids(pool: &PgPool, order: &NewLabOrder) -> anyhow::Result<Vec<Uuid>> {
    let mut ids = Vec::new();
    if !order.test_ids.is_empty() {
        let direct_ids = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT id
            FROM lab_tests
            WHERE facility_id = $1
              AND is_active = TRUE
              AND id = ANY($2)
            "#,
        )
        .bind(order.facility_id)
        .bind(&order.test_ids)
        .fetch_all(pool)
        .await?;
        if direct_ids.len() != order.test_ids.len() {
            anyhow::bail!("lab order contains inactive or unknown tests");
        }
        ids.extend(direct_ids);
    }

    if !order.panel_ids.is_empty() {
        let panel_test_ids = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT DISTINCT lab_panel_tests.test_id
            FROM lab_panel_tests
            INNER JOIN lab_panels ON lab_panels.id = lab_panel_tests.panel_id
            INNER JOIN lab_tests ON lab_tests.id = lab_panel_tests.test_id
            WHERE lab_panels.facility_id = $1
              AND lab_panels.is_active = TRUE
              AND lab_tests.is_active = TRUE
              AND lab_panels.id = ANY($2)
            "#,
        )
        .bind(order.facility_id)
        .bind(&order.panel_ids)
        .fetch_all(pool)
        .await?;
        ids.extend(panel_test_ids);
    }

    ids.sort_unstable();
    ids.dedup();
    Ok(ids)
}

async fn current_order_status(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Uuid,
) -> anyhow::Result<Option<LabOrderStatus>> {
    sqlx::query_scalar::<_, String>(
        "SELECT status FROM lab_orders WHERE facility_id = $1 AND id = $2",
    )
    .bind(facility_id)
    .bind(order_id)
    .fetch_optional(pool)
    .await?
    .map(|status| codec::decode::<LabOrderStatus>(&status))
    .transpose()
}

async fn transition_order_status(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Uuid,
    target_status: LabOrderStatus,
    allowed_statuses: &[LabOrderStatus],
) -> anyhow::Result<Option<LabOrderListItem>> {
    let current_status = current_order_status(pool, facility_id, order_id).await?;
    let Some(current_status) = current_status else {
        return Ok(None);
    };
    if !allowed_statuses.contains(&current_status) {
        anyhow::bail!("lab order cannot transition from its current status");
    }

    sqlx::query(
        r#"
        UPDATE lab_orders
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
    )
    .bind(codec::encode(target_status)?)
    .bind(facility_id)
    .bind(order_id)
    .execute(pool)
    .await?;

    fetch_order_by_id(pool, facility_id, order_id).await
}

async fn fetch_order_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Uuid,
) -> anyhow::Result<Option<LabOrderListItem>> {
    let mut query = order_query();
    query.push(" WHERE lab_orders.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND lab_orders.id = ");
    query.push_bind(order_id);
    query.push(" GROUP BY lab_orders.id, patients.patient_code");
    query
        .build_query_as::<OrderRow>()
        .fetch_optional(pool)
        .await?
        .map(order_from_row)
        .transpose()
}

async fn fetch_specimen_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    specimen_id: Uuid,
) -> anyhow::Result<Option<SpecimenListItem>> {
    let mut query = specimen_query();
    query.push(" WHERE lab_specimens.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND lab_specimens.id = ");
    query.push_bind(specimen_id);
    query
        .build_query_as::<SpecimenRow>()
        .fetch_optional(pool)
        .await?
        .map(specimen_from_row)
        .transpose()
}

async fn fetch_result_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    result_id: Uuid,
) -> anyhow::Result<Option<LabResultListItem>> {
    let mut query = result_query();
    query.push(" WHERE lab_results.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND lab_results.id = ");
    query.push_bind(result_id);
    query
        .build_query_as::<ResultRow>()
        .fetch_optional(pool)
        .await?
        .map(result_from_row)
        .transpose()
}

fn order_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT lab_orders.id,
               lab_orders.patient_id,
               patients.patient_code,
               lab_orders.priority,
               lab_orders.status,
               lab_orders.ordered_at,
               COUNT(lab_order_tests.test_id)::bigint AS test_count,
               COALESCE(
                   jsonb_agg(
                       jsonb_build_object(
                           'id', lab_tests.id,
                           'test_id', lab_tests.id,
                           'test', jsonb_build_object(
                               'id', lab_tests.id,
                               'code', lab_tests.code,
                               'name', lab_tests.name,
                               'short_name', lab_tests.name,
                               'specimen_type', lab_tests.specimen_type,
                               'unit', lab_tests.result_unit,
                               'result_unit', lab_tests.result_unit
                           ),
                           'result', NULL
                       )
                       ORDER BY lab_tests.code ASC, lab_tests.id ASC
                   ) FILTER (WHERE lab_tests.id IS NOT NULL),
                   '[]'::jsonb
               ) AS order_tests
        FROM lab_orders
        INNER JOIN patients ON patients.id = lab_orders.patient_id
        LEFT JOIN lab_order_tests ON lab_order_tests.order_id = lab_orders.id
        LEFT JOIN lab_tests ON lab_tests.id = lab_order_tests.test_id
        "#,
    )
}

fn specimen_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT lab_specimens.id,
               lab_specimens.order_id,
               lab_specimens.patient_id,
               patients.patient_code,
               lab_specimens.specimen_type,
               lab_specimens.status,
               lab_specimens.collected_at
        FROM lab_specimens
        INNER JOIN patients ON patients.id = lab_specimens.patient_id
        "#,
    )
}

fn result_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT lab_results.id,
               lab_results.order_id,
               lab_results.specimen_id,
               lab_results.patient_id,
               patients.patient_code,
               lab_results.test_id,
               lab_tests.name AS test_name,
               lab_results.value,
               lab_results.unit,
               lab_results.status,
               lab_results.entered_at,
               lab_results.verified_at
        FROM lab_results
        INNER JOIN patients ON patients.id = lab_results.patient_id
        INNER JOIN lab_tests ON lab_tests.id = lab_results.test_id
        "#,
    )
}

fn apply_cursor(
    query: &mut QueryBuilder<'static, Postgres>,
    time_column: &'static str,
    id_column: &'static str,
    cursor: Option<LabCursor>,
) {
    if let Some(cursor) = cursor {
        query.push(" AND (");
        query.push(time_column);
        query.push(", ");
        query.push(id_column);
        query.push(") < (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
}

fn test_from_row(row: TestRow) -> LabTestCatalogItem {
    LabTestCatalogItem {
        id: row.id,
        code: row.code,
        name: row.name,
        specimen_type: row.specimen_type,
        result_unit: row.result_unit,
    }
}

fn panel_from_row(row: PanelRow) -> LabPanelListItem {
    LabPanelListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        test_count: row.test_count,
    }
}

fn order_from_row(row: OrderRow) -> anyhow::Result<LabOrderListItem> {
    Ok(LabOrderListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        priority: codec::decode(&row.priority)?,
        status: codec::decode(&row.status)?,
        ordered_at: row.ordered_at,
        test_count: row.test_count,
        order_tests: row.order_tests.0,
    })
}

fn specimen_from_row(row: SpecimenRow) -> anyhow::Result<SpecimenListItem> {
    Ok(SpecimenListItem {
        id: row.id,
        order_id: row.order_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        specimen_type: row.specimen_type,
        status: codec::decode(&row.status)?,
        collected_at: row.collected_at,
    })
}

fn result_from_row(row: ResultRow) -> anyhow::Result<LabResultListItem> {
    Ok(LabResultListItem {
        id: row.id,
        order_id: row.order_id,
        specimen_id: row.specimen_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        test_id: row.test_id,
        test_name: row.test_name,
        value: row.value,
        unit: row.unit,
        status: codec::decode(&row.status)?,
        entered_at: row.entered_at,
        verified_at: row.verified_at,
    })
}
