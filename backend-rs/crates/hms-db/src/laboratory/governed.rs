//! Current clinical catalog reads and protected order publication.
use super::*;
use crate::care::lifecycle::{self, CareActor};
use hms_domain::care::VisitStatus;
use hms_domain::deployment::{FeatureKey, PermissionCode};
use sqlx::Transaction;

fn purpose(actor: &CareActor) -> anyhow::Result<()> {
    lifecycle::purpose(
        actor,
        PermissionCode::LaboratoryOrderManage,
        FeatureKey::Laboratory,
    )
}
async fn begin<'a>(
    pool: &'a PgPool,
    actor: &mut CareActor,
) -> anyhow::Result<Transaction<'a, Postgres>> {
    purpose(actor)?;
    let mut tx = pool.begin().await?;
    crate::laboratory_catalog::budget(&mut tx).await?;
    lifecycle::authority_tx(&mut tx, actor).await?;
    Ok(tx)
}

pub async fn list_test_catalog_page_authorized(
    pool: &PgPool,
    mut actor: CareActor,
    cursor: Option<LabCursor>,
    limit: i64,
    filters: LabCatalogFilters,
) -> anyhow::Result<Vec<LabTestCatalogItem>> {
    let mut tx = begin(pool, &mut actor).await?;
    let mut query = QueryBuilder::<Postgres>::new("SELECT id,code,name,category,specimen_type,result_unit,is_active,is_system_default,is_facility_modified,created_at FROM lab_tests WHERE facility_id=");
    query.push_bind(actor.identity.facility_id);
    push_catalog_filters(&mut query, "lab_tests", &filters, true);
    apply_cursor(&mut query, "lab_tests.created_at", "lab_tests.id", cursor);
    query
        .push(" ORDER BY created_at DESC,id DESC LIMIT ")
        .push_bind(limit);
    let rows = hms_observability::observe_db_query(
        "laboratory.clinical_catalog.tests",
        query.build_query_as::<TestRow>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows.into_iter().map(test_from_row).collect();
    lifecycle::deadline_tx(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn get_test_catalog_item_authorized(
    pool: &PgPool,
    mut actor: CareActor,
    id: Uuid,
) -> anyhow::Result<Option<LabTestCatalogItem>> {
    let mut tx = begin(pool, &mut actor).await?;
    let row = hms_observability::observe_db_query("laboratory.clinical_catalog.test",
        sqlx::query_as::<_, TestRow>("SELECT id,code,name,category,specimen_type,result_unit,is_active,is_system_default,is_facility_modified,created_at FROM lab_tests WHERE facility_id=$1 AND id=$2 AND is_active")
            .bind(actor.identity.facility_id).bind(id).fetch_optional(&mut *tx)).await?;
    let result = row.map(test_from_row);
    lifecycle::deadline_tx(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn list_panels_page_authorized(
    pool: &PgPool,
    mut actor: CareActor,
    cursor: Option<LabCursor>,
    limit: i64,
    filters: LabCatalogFilters,
) -> anyhow::Result<Vec<LabPanelListItem>> {
    let mut tx = begin(pool, &mut actor).await?;
    let mut query = QueryBuilder::<Postgres>::new("SELECT lab_panels.id,lab_panels.code,lab_panels.name,lab_panels.is_active,lab_panels.is_system_default,lab_panels.is_facility_modified,(SELECT count(*) FROM lab_panel_tests WHERE panel_id=lab_panels.id)::bigint test_count,lab_panels.created_at FROM lab_panels WHERE facility_id=");
    query.push_bind(actor.identity.facility_id);
    push_catalog_filters(&mut query, "lab_panels", &filters, false);
    apply_cursor(&mut query, "lab_panels.created_at", "lab_panels.id", cursor);
    query
        .push(" ORDER BY lab_panels.created_at DESC,lab_panels.id DESC LIMIT ")
        .push_bind(limit);
    let rows = hms_observability::observe_db_query(
        "laboratory.clinical_catalog.panels",
        query.build_query_as::<PanelRow>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows.into_iter().map(panel_from_row).collect();
    lifecycle::deadline_tx(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn get_panel_authorized(
    pool: &PgPool,
    mut actor: CareActor,
    id: Uuid,
) -> anyhow::Result<Option<LabPanelListItem>> {
    let mut tx = begin(pool, &mut actor).await?;
    let row = hms_observability::observe_db_query("laboratory.clinical_catalog.panel",
        sqlx::query_as::<_, PanelRow>("SELECT r.id,r.code,r.name,r.is_active,r.is_system_default,r.is_facility_modified,(SELECT count(*) FROM lab_panel_tests WHERE panel_id=r.id)::bigint test_count,r.created_at FROM lab_panels r WHERE r.facility_id=$1 AND r.id=$2 AND r.is_active")
            .bind(actor.identity.facility_id).bind(id).fetch_optional(&mut *tx)).await?;
    let result = row.map(panel_from_row);
    lifecycle::deadline_tx(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}

pub async fn create_order_authorized(
    pool: &PgPool,
    mut actor: CareActor,
    mut order: NewLabOrder,
) -> anyhow::Result<LabOrderListItem> {
    if actor.identity.facility_id != order.facility_id
        || actor.identity.user_id != order.actor_user_id
    {
        return Err(lifecycle::CareLifecycleError::Unavailable.into());
    }
    let mut tx = begin(pool, &mut actor).await?;
    lifecycle::local_patient_tx(&mut tx, order.facility_id, order.patient_id).await?;
    if let Some(encounter) = order.encounter_id {
        let context = lifecycle::lock_encounter_context_tx(
            &mut tx,
            order.facility_id,
            order.patient_id,
            encounter,
            order.visit_id,
            true,
        )
        .await?;
        if context.status != "in_progress"
            || order
                .visit_id
                .zip(context.visit_id)
                .is_some_and(|(a, b)| a != b)
        {
            return Err(lifecycle::CareLifecycleError::ContextChanged.into());
        }
        order.visit_id = order.visit_id.or(context.visit_id);
    }
    if let Some(visit) = order.visit_id {
        let context =
            lifecycle::lock_visit_tx(&mut tx, order.facility_id, order.patient_id, visit, true)
                .await?;
        if matches!(
            context.status,
            VisitStatus::CheckedOut | VisitStatus::Cancelled | VisitStatus::NoShow
        ) {
            return Err(lifecycle::CareLifecycleError::VisitUnavailable.into());
        }
    }
    let result = insert_order_tx(&mut tx, order).await?;
    lifecycle::deadline_tx(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
