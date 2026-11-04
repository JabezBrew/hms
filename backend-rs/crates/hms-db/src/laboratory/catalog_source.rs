//! One complete retained source selection for every laboratory order producer.
use crate::laboratory_catalog::{sql_error, LabCatalogError};
use sqlx::{FromRow, Postgres, Transaction};
use std::collections::BTreeSet;
use uuid::Uuid;

#[derive(Clone, Debug, FromRow)]
pub(crate) struct CatalogTest {
    pub id: Uuid,
    pub name: String,
    pub code: String,
    pub version: i64,
}
#[derive(Clone, Debug, FromRow)]
pub(crate) struct CatalogPanel {
    pub id: Uuid,
    pub name: String,
    pub code: String,
    pub version: i64,
}
pub(crate) struct CatalogSelection {
    pub tests: Vec<CatalogTest>,
    pub panels: Vec<CatalogPanel>,
}

pub(crate) async fn select(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    direct: &[Uuid],
    panels: &[Uuid],
) -> anyhow::Result<CatalogSelection> {
    if direct.len() > 500 || panels.len() > 100 || direct.iter().chain(panels).any(Uuid::is_nil) {
        return Err(LabCatalogError::OrderUnavailable.into());
    }
    let direct: Vec<Uuid> = direct
        .iter()
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let panels: Vec<Uuid> = panels
        .iter()
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if direct.is_empty() && panels.is_empty() {
        return Err(LabCatalogError::OrderUnavailable.into());
    }
    // Intrinsic membership writers use the conflicting exclusive gate. FK row
    // locks alone cannot prevent a new member phantom after this observation.
    hms_observability::observe_db_query(
        "laboratory.order.panel_gates",
        sqlx::query("SELECT laboratory_catalog_panel_gates($1,true)")
            .bind(&panels)
            .execute(&mut **tx),
    )
    .await
    .map_err(sql_error)?;
    let selected_panels = hms_observability::observe_db_query("laboratory.order.panels",
        sqlx::query_as::<_, CatalogPanel>("SELECT id,name,code,version FROM lab_panels WHERE facility_id=$1 AND is_active AND id=ANY($2) ORDER BY id FOR SHARE NOWAIT")
            .bind(facility).bind(&panels).fetch_all(&mut **tx)).await.map_err(sql_error)?;
    if selected_panels.iter().map(|row| row.id).collect::<Vec<_>>() != panels {
        return Err(LabCatalogError::OrderUnavailable.into());
    }
    let counts: Vec<i64> = hms_observability::observe_db_query("laboratory.order.member_counts",
        sqlx::query_scalar("SELECT count(m.test_id)::bigint FROM unnest($1::uuid[])p(id) LEFT JOIN LATERAL(SELECT test_id FROM lab_panel_tests WHERE panel_id=p.id ORDER BY test_id LIMIT 501)m ON true GROUP BY p.id ORDER BY p.id")
            .bind(&panels).fetch_all(&mut **tx)).await?;
    if counts.len() != panels.len() || counts.iter().any(|count| *count == 0 || *count > 500) {
        return Err(LabCatalogError::OrderUnavailable.into());
    }
    let ids: Vec<Uuid> = hms_observability::observe_db_query("laboratory.order.complete_union",
        sqlx::query_scalar("SELECT id FROM(SELECT unnest($1::uuid[])id UNION SELECT test_id FROM lab_panel_tests WHERE panel_id=ANY($2))s ORDER BY id LIMIT 501")
            .bind(&direct).bind(&panels).fetch_all(&mut **tx)).await?;
    if ids.is_empty() || ids.len() > 500 || ids.iter().any(Uuid::is_nil) {
        return Err(LabCatalogError::OrderUnavailable.into());
    }
    let tests = hms_observability::observe_db_query("laboratory.order.test_gates",
        sqlx::query_as::<_, CatalogTest>("SELECT id,name,code,version FROM lab_tests WHERE facility_id=$1 AND is_active AND id=ANY($2) ORDER BY id FOR SHARE NOWAIT")
            .bind(facility).bind(&ids).fetch_all(&mut **tx)).await.map_err(sql_error)?;
    if tests.iter().map(|row| row.id).collect::<Vec<_>>() != ids {
        return Err(LabCatalogError::OrderUnavailable.into());
    }
    Ok(CatalogSelection {
        tests,
        panels: selected_panels,
    })
}
