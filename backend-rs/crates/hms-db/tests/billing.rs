use hms_db::billing::NewInvoice;
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::deployment::DeploymentProfile;

#[tokio::test]
async fn invoice_repository_filters_patient_invoices_inside_facility() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");
    let owner_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");
    let patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("patient exists");
    let other_patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 AND id <> $2 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .expect("second patient exists");
    let service_price_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM service_prices WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("service price exists");

    let invoice = hms_db::billing::create_invoice(
        &pool,
        NewInvoice {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            service_price_id,
            quantity: 1,
            invoice_number: "INV-TEST-1".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("invoice is created");
    let other_invoice = hms_db::billing::create_invoice(
        &pool,
        NewInvoice {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id: other_patient_id,
            service_price_id,
            quantity: 1,
            invoice_number: "INV-TEST-2".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("other invoice is created");

    let patient_invoices =
        hms_db::billing::list_invoices(&pool, facility_id, Some(patient_id), None, 25)
            .await
            .expect("patient invoice list succeeds");

    assert_eq!(patient_invoices.len(), 1);
    assert_eq!(patient_invoices[0].id, invoice.id);
    assert_ne!(patient_invoices[0].id, other_invoice.id);
}
