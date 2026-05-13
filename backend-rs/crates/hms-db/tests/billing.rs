use hms_db::billing::{NewClaim, NewInvoice, NewPayment};
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::billing::PaymentMethod;
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

    let invoice_detail = hms_db::billing::get_invoice(&pool, facility_id, invoice.id)
        .await
        .expect("invoice detail lookup succeeds")
        .expect("invoice exists");
    assert_eq!(invoice_detail.id, invoice.id);
    assert_eq!(invoice_detail.patient_id, patient_id);
    assert!(
        hms_db::billing::get_invoice(&pool, uuid::Uuid::new_v4(), invoice.id)
            .await
            .expect("cross-facility invoice detail lookup succeeds")
            .is_none()
    );

    let claim = hms_db::billing::create_claim(
        &pool,
        NewClaim {
            id: uuid::Uuid::new_v4(),
            facility_id,
            invoice_id: invoice.id,
            claim_number: "CLM-TEST-1".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("claim is created");
    let claim_detail = hms_db::billing::get_claim(&pool, facility_id, claim.id)
        .await
        .expect("claim detail lookup succeeds")
        .expect("claim exists");
    assert_eq!(claim_detail.id, claim.id);
    assert_eq!(claim_detail.patient_id, patient_id);
    assert_eq!(claim_detail.invoice_id, invoice.id);
    assert!(
        hms_db::billing::get_claim(&pool, uuid::Uuid::new_v4(), claim.id)
            .await
            .expect("cross-facility claim detail lookup succeeds")
            .is_none()
    );

    let payment = hms_db::billing::create_payment(
        &pool,
        NewPayment {
            id: uuid::Uuid::new_v4(),
            facility_id,
            invoice_id: invoice.id,
            receipt_id: uuid::Uuid::new_v4(),
            receipt_number: "RCT-TEST-1".to_owned(),
            amount_minor: invoice.gross_amount_minor,
            method: PaymentMethod::MobileMoney,
            cash_session_id: None,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("payment is created");
    let receipt = hms_db::billing::get_receipt_by_payment(&pool, facility_id, payment.id)
        .await
        .expect("receipt by payment lookup succeeds")
        .expect("receipt exists for payment");
    assert_eq!(receipt.payment_id, payment.id);
    assert_eq!(receipt.invoice_id, invoice.id);
    assert_eq!(receipt.receipt_number, payment.receipt_number);
    assert_eq!(receipt.amount_minor, invoice.gross_amount_minor);
    let receipt_by_id = hms_db::billing::get_receipt(&pool, facility_id, receipt.id)
        .await
        .expect("receipt detail lookup succeeds")
        .expect("receipt exists");
    assert_eq!(receipt_by_id.id, receipt.id);
    let receipt_by_number =
        hms_db::billing::get_receipt_by_number(&pool, facility_id, &payment.receipt_number)
            .await
            .expect("receipt by number lookup succeeds")
            .expect("receipt exists by number");
    assert_eq!(receipt_by_number.id, receipt.id);
    assert!(
        hms_db::billing::get_receipt(&pool, uuid::Uuid::new_v4(), receipt.id)
            .await
            .expect("cross-facility receipt lookup succeeds")
            .is_none()
    );

    let patient_invoices =
        hms_db::billing::list_invoices(&pool, facility_id, Some(patient_id), None, 25)
            .await
            .expect("patient invoice list succeeds");

    assert_eq!(patient_invoices.len(), 1);
    assert_eq!(patient_invoices[0].id, invoice.id);
    assert_ne!(patient_invoices[0].id, other_invoice.id);
}
