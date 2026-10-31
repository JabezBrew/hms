//! Genuine imported inventory premises are persisted under the actual prior
//! schema, then all current guards are applied before constructing the router.
use super::*;
pub(crate) async fn app_with_imported_inventory(items: &[(Uuid, &str, &str, bool)]) -> TestApp {
    app_with_inventory_import(items, |_, _| async {}).await.0
}
pub(crate) async fn app_with_inventory_import<T, F, Fut>(
    items: &[(Uuid, &str, &str, bool)],
    import: F,
) -> (TestApp, T)
where
    F: FnOnce(hms_db::PgPool, Uuid) -> Fut,
    Fut: std::future::Future<Output = T>,
{
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610300030)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let baseline = hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    hms_db::provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    for (id, code, item_type, controlled) in items {
        sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,controlled) SELECT $1,$2,category_id,$3,'Synthetic imported inventory',$4,'unit',$5 FROM inventory_items WHERE facility_id=$2 ORDER BY id LIMIT 1")
            .bind(id).bind(baseline.facility_id).bind(code).bind(item_type).bind(controlled).execute(&pool).await.unwrap();
    }
    let imported = import(pool.clone(), baseline.facility_id).await;
    hms_db::migrate::run(&pool).await.unwrap();
    hms_db::schema_compatibility::require_runtime_schema(&pool)
        .await
        .unwrap();
    pool.close().await;
    let app = app_with_config(
        Config::for_tests_with_database_url(database.database_url().to_owned()),
        database,
    )
    .await;
    (app, imported)
}
