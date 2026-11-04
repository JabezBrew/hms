use super::*;
use sqlx::types::Json;

#[derive(FromRow)]
struct Directory {
    id: Uuid,
    code: String,
    name: String,
    is_active: bool,
    version: i64,
    catalog_changed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

pub async fn list(
    pool: &PgPool,
    mut actor: LabCatalogActor,
    kind: LabCatalogKind,
    cursor: Option<LabCursor>,
    limit: i64,
    filters: LabCatalogFilters,
) -> anyhow::Result<Vec<LaboratoryCatalogAdministrationListItem>> {
    if !(1..=101).contains(&limit) || (kind == LabCatalogKind::Panel && filters.category.is_some())
    {
        return Err(LabCatalogError::Invalid.into());
    }
    let pattern = search(filters.search.as_deref())?;
    let mut tx = pool.begin().await?;
    budget(&mut tx).await?;
    let proof = authority(&mut tx, &mut actor, false).await?;
    let mut query = QueryBuilder::<Postgres>::new(format!(
        "SELECT id,code,name,is_active,version,catalog_changed_at,created_at FROM {} WHERE facility_id=",
        table(kind)));
    query.push_bind(actor.facility_id);
    for (column, value) in [
        ("is_active", filters.is_active),
        ("is_system_default", filters.is_system_default),
        ("is_facility_modified", filters.is_facility_modified),
    ] {
        if let Some(value) = value {
            query.push(" AND ").push(column).push("=").push_bind(value);
        }
    }
    if let Some(category) = filters.category {
        query.push(" AND category=").push_bind(category);
    }
    if let Some(pattern) = pattern {
        query
            .push(" AND lower(code||' '||name) LIKE lower(")
            .push_bind(pattern)
            .push(") ESCAPE '\\'");
    }
    if let Some(cursor) = cursor {
        query
            .push(" AND(created_at,id)>(")
            .push_bind(cursor.occurred_at)
            .push(",")
            .push_bind(cursor.id)
            .push(")");
    }
    query
        .push(" ORDER BY created_at,id LIMIT ")
        .push_bind(limit);
    let rows = hms_observability::observe_db_query(
        "laboratory.catalog.directory",
        query.build_query_as::<Directory>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows
        .into_iter()
        .map(|row| LaboratoryCatalogAdministrationListItem {
            id: row.id,
            code: row.code,
            name: row.name,
            is_active: row.is_active,
            version: row.version,
            catalog_changed_at: row.catalog_changed_at,
            created_at: row.created_at,
        })
        .collect();
    prescription_courses::check_authorization(&mut tx, &proof)
        .await
        .map_err(authority_error)?;
    tx.commit().await?;
    Ok(result)
}

pub(super) async fn state_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    kind: LabCatalogKind,
    id: Uuid,
) -> anyhow::Result<Option<LaboratoryCatalogAdministration>> {
    let result = match kind {
        LabCatalogKind::Test => {
            let definition: Option<Json<LaboratoryTestAdministrationDefinition>> = hms_observability::observe_db_query(
                "laboratory.catalog.test_detail", sqlx::query_scalar(r#"
                SELECT jsonb_build_object('id',r.id,'code',r.code,'name',r.name,'category',r.category,
                  'specimen_type',r.specimen_type,'result_unit',r.result_unit,'is_active',r.is_active,
                  'is_system_default',r.is_system_default,'is_facility_modified',r.is_facility_modified,
                  'created_at',r.created_at,'updated_at',r.updated_at,'version',r.version,
                  'catalog_changed_at',r.catalog_changed_at,'catalog_changed_by_user_id',r.catalog_changed_by_user_id)
                FROM lab_tests r WHERE r.facility_id=$1 AND r.id=$2
                "#).bind(facility).bind(id).fetch_optional(&mut **tx),
            ).await?;
            definition.map(|Json(definition)| {
                let blocked_by =
                    (!definition.is_active).then_some(LaboratoryCatalogOrderingBlocker::Inactive);
                LaboratoryCatalogAdministration::Test {
                    definition,
                    ordering: LaboratoryCatalogOrdering {
                        is_orderable: blocked_by.is_none(),
                        blocked_by,
                    },
                }
            })
        }
        LabCatalogKind::Panel => {
            let row: Option<(Json<LaboratoryPanelAdministrationDefinition>, i64)> = hms_observability::observe_db_query(
                "laboratory.catalog.panel_detail", sqlx::query_as(r#"
                SELECT jsonb_build_object('id',r.id,'code',r.code,'name',r.name,'is_active',r.is_active,
                  'is_system_default',r.is_system_default,'is_facility_modified',r.is_facility_modified,
                  'test_count',m.members,'created_at',r.created_at,'updated_at',r.updated_at,'version',r.version,
                  'catalog_changed_at',r.catalog_changed_at,'catalog_changed_by_user_id',r.catalog_changed_by_user_id),
                  m.unavailable
                FROM lab_panels r CROSS JOIN LATERAL(
                  SELECT count(*)::bigint members,count(*) FILTER(WHERE t.id IS NULL
                    OR t.facility_id<>r.facility_id OR NOT t.is_active)::bigint unavailable
                  FROM lab_panel_tests l LEFT JOIN lab_tests t ON t.id=l.test_id WHERE l.panel_id=r.id
                )m WHERE r.facility_id=$1 AND r.id=$2
                "#).bind(facility).bind(id).fetch_optional(&mut **tx),
            ).await?;
            row.map(|(Json(definition), unavailable)| {
                let blocked_by = if !definition.is_active {
                    Some(LaboratoryCatalogOrderingBlocker::Inactive)
                } else if definition.test_count == 0 {
                    Some(LaboratoryCatalogOrderingBlocker::EmptyPanel)
                } else if unavailable > 0 || definition.test_count > 500 {
                    Some(LaboratoryCatalogOrderingBlocker::UnavailableMembers)
                } else {
                    None
                };
                LaboratoryCatalogAdministration::Panel {
                    definition,
                    ordering: LaboratoryCatalogOrdering {
                        is_orderable: blocked_by.is_none(),
                        blocked_by,
                    },
                }
            })
        }
    };
    Ok(result)
}

pub async fn detail(
    pool: &PgPool,
    mut actor: LabCatalogActor,
    kind: LabCatalogKind,
    id: Uuid,
) -> anyhow::Result<Option<LaboratoryCatalogAdministration>> {
    let mut tx = pool.begin().await?;
    budget(&mut tx).await?;
    let proof = authority(&mut tx, &mut actor, false).await?;
    let result = state_tx(&mut tx, actor.facility_id, kind, id).await?;
    prescription_courses::check_authorization(&mut tx, &proof)
        .await
        .map_err(authority_error)?;
    tx.commit().await?;
    Ok(result)
}

#[derive(FromRow)]
struct History {
    id: Uuid,
    recorded_at: DateTime<Utc>,
    before_version: i64,
    after_version: i64,
    before_is_active: bool,
    after_is_active: bool,
    changed: bool,
}
pub async fn history(
    pool: &PgPool,
    mut actor: LabCatalogActor,
    kind: LabCatalogKind,
    id: Uuid,
    cursor: Option<LabCursor>,
    limit: i64,
) -> anyhow::Result<Option<Vec<LaboratoryCatalogHistoryItem>>> {
    if !(1..=101).contains(&limit) {
        return Err(LabCatalogError::Invalid.into());
    }
    let mut tx = pool.begin().await?;
    budget(&mut tx).await?;
    let proof = authority(&mut tx, &mut actor, false).await?;
    let found: Option<Uuid> = hms_observability::observe_db_query(
        "laboratory.catalog.history_subject",
        sqlx::query_scalar(&format!(
            "SELECT id FROM {} WHERE facility_id=$1 AND id=$2",
            table(kind)
        ))
        .bind(actor.facility_id)
        .bind(id)
        .fetch_optional(&mut *tx),
    )
    .await?;
    let result = if found.is_some() {
        let mut query = QueryBuilder::<Postgres>::new(
            r#"
        SELECT id,recorded_at,(receipt->'reviewed_input'->>'expected_version')::bigint before_version,
          (receipt->'subject'->'definition'->>'version')::bigint after_version,
          CASE WHEN(receipt->>'changed')::boolean THEN NOT(receipt->'reviewed_input'->>'is_active')::boolean
            ELSE(receipt->'reviewed_input'->>'is_active')::boolean END before_is_active,
          (receipt->'reviewed_input'->>'is_active')::boolean after_is_active,
          (receipt->>'changed')::boolean changed
        FROM laboratory_catalog_commands WHERE facility_id="#,
        );
        query
            .push_bind(actor.facility_id)
            .push(" AND subject_kind=")
            .push_bind(kind_text(kind))
            .push(" AND subject_id=")
            .push_bind(id);
        if let Some(cursor) = cursor {
            query
                .push(" AND(recorded_at,id)<(")
                .push_bind(cursor.occurred_at)
                .push(",")
                .push_bind(cursor.id)
                .push(")");
        }
        query
            .push(" ORDER BY recorded_at DESC,id DESC LIMIT ")
            .push_bind(limit);
        let rows = hms_observability::observe_db_query(
            "laboratory.catalog.history",
            query.build_query_as::<History>().fetch_all(&mut *tx),
        )
        .await?;
        Some(
            rows.into_iter()
                .map(|row| LaboratoryCatalogHistoryItem {
                    id: row.id,
                    action: LaboratoryCatalogAction::SetAvailability,
                    recorded_at: row.recorded_at,
                    before_version: row.before_version,
                    after_version: row.after_version,
                    before_is_active: row.before_is_active,
                    after_is_active: row.after_is_active,
                    changed: row.changed,
                })
                .collect(),
        )
    } else {
        None
    };
    prescription_courses::check_authorization(&mut tx, &proof)
        .await
        .map_err(authority_error)?;
    tx.commit().await?;
    Ok(result)
}
