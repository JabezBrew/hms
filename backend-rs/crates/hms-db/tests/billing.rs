use hms_db::billing::{
    BillingRuleFilters, CashSessionFilters, ClaimListFilters, InvoiceListFilters, NewCashSession,
    NewClaim, NewInvoice, NewNhisArAdjustment, NewNhisServiceMapping, NewPayment,
    NewPaymentReversal, NhisBatchExportCommand, PaymentListFilters, ServiceCatalogFilters,
};
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::billing::{
    BillingRuleType, CashSessionStatus, ClaimStatus, InvoiceStatus, NhisArAdjustmentKind,
    PaymentMethod, ReversalKind,
};
use hms_domain::deployment::DeploymentProfile;

#[tokio::test]
async fn service_catalog_list_is_bounded_and_includes_active_price() {
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

    let rows = hms_db::billing::list_service_catalog(
        &pool,
        facility_id,
        None,
        1,
        ServiceCatalogFilters {
            search: None,
            is_active: Some(true),
        },
    )
    .await
    .expect("service catalog lists");

    assert_eq!(rows.len(), 1);
    assert!(rows[0].active);
    assert!(rows[0].active_price_id.is_some());
    assert!(rows[0].active_price_amount_minor.unwrap_or_default() > 0);
}

#[tokio::test]
async fn billing_rule_detail_is_facility_scoped() {
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

    let rule_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM billing_rules WHERE facility_id = $1 ORDER BY code LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("billing rule exists");

    let rule = hms_db::billing::get_billing_rule(&pool, facility_id, rule_id)
        .await
        .expect("billing rule detail lookup succeeds")
        .expect("billing rule exists");
    assert_eq!(rule.id, rule_id);

    assert!(
        hms_db::billing::get_billing_rule(&pool, uuid::Uuid::new_v4(), rule_id)
            .await
            .expect("cross-facility billing rule lookup succeeds")
            .is_none()
    );
}

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

    let patient_invoices = hms_db::billing::list_invoices(
        &pool,
        facility_id,
        InvoiceListFilters {
            patient_id: Some(patient_id),
            ..Default::default()
        },
        None,
        25,
    )
    .await
    .expect("patient invoice list succeeds");

    assert_eq!(patient_invoices.len(), 1);
    assert_eq!(patient_invoices[0].id, invoice.id);
    assert_ne!(patient_invoices[0].id, other_invoice.id);

    let searched_paid_invoices = hms_db::billing::list_invoices(
        &pool,
        facility_id,
        InvoiceListFilters {
            search: Some("INV-TEST-1".to_owned()),
            status: Some(InvoiceStatus::Paid),
            ..Default::default()
        },
        None,
        25,
    )
    .await
    .expect("invoice search and status filters succeed");
    assert_eq!(searched_paid_invoices.len(), 1);
    assert_eq!(searched_paid_invoices[0].id, invoice.id);

    let mobile_payments = hms_db::billing::list_payments(
        &pool,
        facility_id,
        PaymentListFilters {
            patient_id: Some(patient_id),
            search: Some("RCT-TEST-1".to_owned()),
            payment_method: Some(PaymentMethod::MobileMoney),
            ..Default::default()
        },
        None,
        25,
    )
    .await
    .expect("payment search and method filters succeed");
    assert_eq!(mobile_payments.len(), 1);
    assert_eq!(mobile_payments[0].id, payment.id);
    assert_eq!(mobile_payments[0].invoice_number, invoice.invoice_number);
    assert_eq!(mobile_payments[0].patient_id, patient_id);

    let draft_claims = hms_db::billing::list_claims(
        &pool,
        facility_id,
        ClaimListFilters {
            patient_id: Some(patient_id),
            search: Some("CLM-TEST-1".to_owned()),
            status: Some(ClaimStatus::Draft),
            ..Default::default()
        },
        None,
        25,
    )
    .await
    .expect("claim search and status filters succeed");
    assert_eq!(draft_claims.len(), 1);
    assert_eq!(draft_claims[0].id, claim.id);
}

#[tokio::test]
async fn billing_dashboard_summary_uses_facility_scoped_aggregates() {
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
            quantity: 2,
            invoice_number: "INV-DASH-1".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("invoice is created");
    let payment_amount = invoice.gross_amount_minor / 2;
    hms_db::billing::create_payment(
        &pool,
        NewPayment {
            id: uuid::Uuid::new_v4(),
            facility_id,
            invoice_id: invoice.id,
            receipt_id: uuid::Uuid::new_v4(),
            receipt_number: "RCT-DASH-1".to_owned(),
            amount_minor: payment_amount,
            method: PaymentMethod::MobileMoney,
            cash_session_id: None,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("payment is created");
    hms_db::billing::create_claim(
        &pool,
        NewClaim {
            id: uuid::Uuid::new_v4(),
            facility_id,
            invoice_id: invoice.id,
            claim_number: "CLM-DASH-1".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("claim is created");

    let summary = hms_db::billing::billing_dashboard_summary(&pool, facility_id)
        .await
        .expect("dashboard summary aggregates");

    assert_eq!(summary.revenue_today_minor, payment_amount);
    assert_eq!(summary.revenue_this_week_minor, payment_amount);
    assert_eq!(
        summary.outstanding_amount_minor,
        invoice.gross_amount_minor - payment_amount
    );
    assert_eq!(summary.outstanding_invoices, 1);
    assert_eq!(summary.pending_claims, 1);
    assert_eq!(
        summary.pending_claims_amount_minor,
        invoice.gross_amount_minor
    );
    assert_eq!(summary.invoices_created_today, 1);
    assert_eq!(summary.payments_received_today, 1);
    assert_eq!(summary.unique_patients_billed, 1);
    assert_eq!(
        summary.average_invoice_amount_minor,
        invoice.gross_amount_minor
    );
}

#[tokio::test]
async fn billing_rules_can_be_filtered_and_bounded() {
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

    let rules = hms_db::billing::list_billing_rules(
        &pool,
        facility_id,
        BillingRuleFilters {
            rule_type: Some(BillingRuleType::CashRequired),
            is_active: Some(true),
        },
        1,
    )
    .await
    .expect("billing rules list succeeds");

    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].rule_type, BillingRuleType::CashRequired);
    assert!(rules[0].active);
}

#[tokio::test]
async fn cash_session_repository_filters_open_sessions_and_loads_details() {
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
    let drawer_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM cash_drawers WHERE facility_id = $1 ORDER BY code LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("cash drawer exists");

    let closed = hms_db::billing::open_cash_session(
        &pool,
        NewCashSession {
            id: uuid::Uuid::new_v4(),
            facility_id,
            drawer_id,
            opening_float_minor: 1_000,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("closed fixture session opens");
    hms_db::billing::close_cash_session(&pool, facility_id, closed.id, 1_000, owner_id)
        .await
        .expect("session closes")
        .expect("closed session exists");
    let open = hms_db::billing::open_cash_session(
        &pool,
        NewCashSession {
            id: uuid::Uuid::new_v4(),
            facility_id,
            drawer_id,
            opening_float_minor: 2_500,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("open fixture session opens");

    let open_rows = hms_db::billing::list_cash_sessions(
        &pool,
        facility_id,
        None,
        10,
        CashSessionFilters {
            status: Some(CashSessionStatus::Open),
            search: None,
            is_flagged: None,
        },
    )
    .await
    .expect("open cash sessions list");
    assert!(open_rows.iter().any(|row| row.id == open.id));
    assert!(!open_rows.iter().any(|row| row.id == closed.id));

    let detail = hms_db::billing::get_cash_session(&pool, facility_id, open.id)
        .await
        .expect("cash session detail lookup succeeds")
        .expect("cash session exists");
    assert_eq!(detail.id, open.id);
    assert_eq!(detail.status, CashSessionStatus::Open);
    assert!(
        hms_db::billing::get_cash_session(&pool, uuid::Uuid::new_v4(), open.id)
            .await
            .expect("cross-facility cash session detail lookup succeeds")
            .is_none()
    );
}

#[tokio::test]
async fn invoice_locks_after_payment_claim_export_and_finalization() {
    let fixture = BillingFixture::create().await;
    let invoice = fixture.create_invoice("INV-LOCK-1", 1).await;

    assert!(
        hms_db::billing::invoice_lock_state(&fixture.pool, fixture.facility_id, invoice.id)
            .await
            .expect("lock state query succeeds")
            .is_none()
    );

    hms_db::billing::create_payment(
        &fixture.pool,
        NewPayment {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            invoice_id: invoice.id,
            receipt_id: uuid::Uuid::new_v4(),
            receipt_number: "RCT-LOCK-1".to_owned(),
            amount_minor: invoice.gross_amount_minor / 2,
            method: PaymentMethod::MobileMoney,
            cash_session_id: None,
            actor_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("payment creates and locks invoice");
    let payment_lock =
        hms_db::billing::invoice_lock_state(&fixture.pool, fixture.facility_id, invoice.id)
            .await
            .expect("payment lock state query succeeds")
            .expect("invoice is locked after payment");
    assert_eq!(
        payment_lock.locked_reason.as_deref(),
        Some("payment_recorded")
    );

    let claim_invoice = fixture.create_invoice("INV-LOCK-2", 1).await;
    let claim = hms_db::billing::create_claim(
        &fixture.pool,
        NewClaim {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            invoice_id: claim_invoice.id,
            claim_number: "CLM-LOCK-1".to_owned(),
            actor_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("claim creates and locks invoice");
    let claim_lock =
        hms_db::billing::invoice_lock_state(&fixture.pool, fixture.facility_id, claim_invoice.id)
            .await
            .expect("claim lock state query succeeds")
            .expect("invoice is locked after claim");
    assert_eq!(claim_lock.locked_reason.as_deref(), Some("claim_created"));

    let batch = hms_db::billing::create_nhis_batch(
        &fixture.pool,
        hms_db::billing::NewNhisBatch {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            batch_number: "NHB-LOCK-1".to_owned(),
            claim_ids: vec![claim.id],
            actor_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("batch creates");
    hms_db::billing::export_nhis_batch(
        &fixture.pool,
        NhisBatchExportCommand {
            facility_id: fixture.facility_id,
            batch_id: batch.id,
            actor_user_id: fixture.owner_id,
            request_id: Some("nhis-export-db-test".to_owned()),
        },
    )
    .await
    .expect("batch exports")
    .expect("batch exists");
    let export_lock =
        hms_db::billing::invoice_lock_state(&fixture.pool, fixture.facility_id, claim_invoice.id)
            .await
            .expect("export lock state query succeeds")
            .expect("invoice remains locked");
    assert_eq!(
        export_lock.locked_reason.as_deref(),
        Some("nhis_batch_exported")
    );
    let export_audit_request_id = sqlx::query_scalar::<_, String>(
        r#"
        SELECT request_id
        FROM audit_events
        WHERE facility_id = $1
          AND event_type = 'billing.nhis_batch.exported'
          AND resource_type = 'nhis_batch'
          AND resource_id = $2
        "#,
    )
    .bind(fixture.facility_id)
    .bind(batch.id)
    .fetch_one(&fixture.pool)
    .await
    .expect("NHIS export audit event is recorded");
    assert_eq!(export_audit_request_id, "nhis-export-db-test");

    let final_invoice = fixture.create_invoice("INV-LOCK-3", 1).await;
    hms_db::billing::finalize_invoice(
        &fixture.pool,
        fixture.facility_id,
        final_invoice.id,
        fixture.owner_id,
        fixture.supervisor_id,
        chrono::Utc::now(),
    )
    .await
    .expect("finalization succeeds")
    .expect("invoice exists");
    let final_lock =
        hms_db::billing::invoice_lock_state(&fixture.pool, fixture.facility_id, final_invoice.id)
            .await
            .expect("finalization lock state query succeeds")
            .expect("invoice is locked after finalization");
    assert_eq!(final_lock.locked_reason.as_deref(), Some("finalized"));
    assert!(final_lock.finalized_at.is_some());
}

#[tokio::test]
async fn void_and_refund_are_append_only_reversals_with_supervisor_approval() {
    let fixture = BillingFixture::create().await;
    let invoice = fixture.create_invoice("INV-REV-1", 1).await;
    let payment = hms_db::billing::create_payment(
        &fixture.pool,
        NewPayment {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            invoice_id: invoice.id,
            receipt_id: uuid::Uuid::new_v4(),
            receipt_number: "RCT-REV-1".to_owned(),
            amount_minor: invoice.gross_amount_minor,
            method: PaymentMethod::MobileMoney,
            cash_session_id: None,
            actor_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("payment creates");

    let self_approved = hms_db::billing::record_payment_reversal(
        &fixture.pool,
        NewPaymentReversal {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            payment_id: payment.id,
            reversal_kind: ReversalKind::Refund,
            amount_minor: 100,
            reason: "duplicate charge".to_owned(),
            approved_by_user_id: fixture.owner_id,
            recorded_by_user_id: fixture.owner_id,
            reauthorized_at: chrono::Utc::now(),
            request_id: Some("self-approved-reversal-db-test".to_owned()),
        },
    )
    .await;
    assert!(self_approved.is_err(), "self-approval must be rejected");

    let refund = hms_db::billing::record_payment_reversal(
        &fixture.pool,
        NewPaymentReversal {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            payment_id: payment.id,
            reversal_kind: ReversalKind::Refund,
            amount_minor: 100,
            reason: "partial refund".to_owned(),
            approved_by_user_id: fixture.supervisor_id,
            recorded_by_user_id: fixture.owner_id,
            reauthorized_at: chrono::Utc::now(),
            request_id: Some("refund-reversal-db-test".to_owned()),
        },
    )
    .await
    .expect("refund reversal records");
    assert_eq!(refund.reversal_kind, ReversalKind::Refund);

    let void = hms_db::billing::record_payment_reversal(
        &fixture.pool,
        NewPaymentReversal {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            payment_id: payment.id,
            reversal_kind: ReversalKind::Void,
            amount_minor: payment.amount_minor - 100,
            reason: "void remaining payment".to_owned(),
            approved_by_user_id: fixture.supervisor_id,
            recorded_by_user_id: fixture.owner_id,
            reauthorized_at: chrono::Utc::now(),
            request_id: Some("void-reversal-db-test".to_owned()),
        },
    )
    .await
    .expect("void reversal records");
    assert_eq!(void.reversal_kind, ReversalKind::Void);

    let ledger =
        hms_db::billing::payment_reversal_ledger(&fixture.pool, fixture.facility_id, payment.id)
            .await
            .expect("ledger lists");
    assert_eq!(ledger.len(), 2);
    assert!(ledger.iter().any(|entry| entry.id == refund.id));
    assert!(ledger.iter().any(|entry| entry.id == void.id));

    let audit_events = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT event_type, request_id
        FROM audit_events
        WHERE facility_id = $1
          AND resource_type = 'payment'
          AND resource_id = $2
        ORDER BY occurred_at ASC
        "#,
    )
    .bind(fixture.facility_id)
    .bind(payment.id)
    .fetch_all(&fixture.pool)
    .await
    .expect("payment reversal audit events load");
    assert_eq!(
        audit_events,
        vec![
            (
                "billing.payment_refund.recorded".to_owned(),
                "refund-reversal-db-test".to_owned()
            ),
            (
                "billing.payment_void.recorded".to_owned(),
                "void-reversal-db-test".to_owned()
            ),
        ]
    );
}

#[tokio::test]
async fn nhis_claim_captures_effective_mapping_version_and_ar_adjustments() {
    let fixture = BillingFixture::create().await;
    let service_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT service_id FROM service_prices WHERE facility_id = $1 AND id = $2",
    )
    .bind(fixture.facility_id)
    .bind(fixture.service_price_id)
    .fetch_one(&fixture.pool)
    .await
    .expect("service id exists");
    let old_mapping = hms_db::billing::create_nhis_service_mapping(
        &fixture.pool,
        NewNhisServiceMapping {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            payer_id: None,
            service_id,
            nhis_code: "OLD-CODE".to_owned(),
            effective_from: chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            effective_until: Some(chrono::NaiveDate::from_ymd_opt(2026, 5, 1).unwrap()),
            actor_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("old mapping creates");
    let current_mapping = hms_db::billing::create_nhis_service_mapping(
        &fixture.pool,
        NewNhisServiceMapping {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            payer_id: None,
            service_id,
            nhis_code: "NHIS-CURRENT".to_owned(),
            effective_from: chrono::NaiveDate::from_ymd_opt(2026, 5, 1).unwrap(),
            effective_until: None,
            actor_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("current mapping creates");
    assert_eq!(old_mapping.version_number, 1);
    assert_eq!(current_mapping.version_number, 2);

    let invoice = fixture.create_invoice("INV-NHIS-AR-1", 1).await;
    let claim = hms_db::billing::create_claim(
        &fixture.pool,
        NewClaim {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            invoice_id: invoice.id,
            claim_number: "CLM-NHIS-AR-1".to_owned(),
            actor_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("claim creates");
    assert_eq!(claim.nhis_service_mapping_id, Some(current_mapping.id));
    assert_eq!(
        claim.nhis_service_mapping_version,
        Some(current_mapping.version_number)
    );
    assert_eq!(claim.nhis_service_code.as_deref(), Some("NHIS-CURRENT"));
    assert_eq!(claim.payer_receivable_minor, invoice.gross_amount_minor);
    assert_eq!(claim.patient_liability_minor, 0);

    hms_db::billing::record_nhis_ar_adjustment(
        &fixture.pool,
        NewNhisArAdjustment {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            claim_id: claim.id,
            adjustment_kind: NhisArAdjustmentKind::WriteOff,
            amount_minor: 200,
            reason: "NHIS short payment accepted".to_owned(),
            recorded_by_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("write off records");
    let ar = hms_db::billing::nhis_claim_ar_state(&fixture.pool, fixture.facility_id, claim.id)
        .await
        .expect("ar state loads")
        .expect("claim exists");
    assert_eq!(ar.payer_receivable_minor, invoice.gross_amount_minor - 200);
    assert_eq!(ar.written_off_minor, 200);
    assert_eq!(ar.patient_liability_minor, 0);

    hms_db::billing::record_nhis_ar_adjustment(
        &fixture.pool,
        NewNhisArAdjustment {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            claim_id: claim.id,
            adjustment_kind: NhisArAdjustmentKind::Reconciliation,
            amount_minor: invoice.gross_amount_minor - 200,
            reason: "NHIS remittance matched".to_owned(),
            recorded_by_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("reconciliation records");
    let reconciled =
        hms_db::billing::nhis_claim_ar_state(&fixture.pool, fixture.facility_id, claim.id)
            .await
            .expect("reconciled ar state loads")
            .expect("claim exists");
    assert_eq!(reconciled.payer_receivable_minor, 0);
    assert_eq!(reconciled.patient_liability_minor, 0);
    assert!(reconciled.reconciled_at.is_some());
}

#[tokio::test]
async fn discharge_billing_clearance_requires_no_patient_liability() {
    let fixture = BillingFixture::create().await;
    let invoice = fixture.create_invoice("INV-CLEAR-1", 1).await;

    let blocked = hms_db::billing::record_discharge_billing_clearance(
        &fixture.pool,
        fixture.facility_id,
        fixture.patient_id,
        fixture.owner_id,
    )
    .await
    .expect("blocked clearance records");
    assert!(!blocked.cleared);
    assert_eq!(blocked.outstanding_invoice_count, 1);
    assert_eq!(blocked.outstanding_amount_minor, invoice.gross_amount_minor);

    hms_db::billing::create_payment(
        &fixture.pool,
        NewPayment {
            id: uuid::Uuid::new_v4(),
            facility_id: fixture.facility_id,
            invoice_id: invoice.id,
            receipt_id: uuid::Uuid::new_v4(),
            receipt_number: "RCT-CLEAR-1".to_owned(),
            amount_minor: invoice.gross_amount_minor,
            method: PaymentMethod::MobileMoney,
            cash_session_id: None,
            actor_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("payment creates");

    let cleared = hms_db::billing::record_discharge_billing_clearance(
        &fixture.pool,
        fixture.facility_id,
        fixture.patient_id,
        fixture.owner_id,
    )
    .await
    .expect("clearance records");
    assert!(cleared.cleared);
    assert_eq!(cleared.outstanding_invoice_count, 0);
    assert_eq!(cleared.outstanding_amount_minor, 0);
}

struct BillingFixture {
    _database: hms_db::test_support::TestDatabase,
    pool: hms_db::PgPool,
    facility_id: uuid::Uuid,
    owner_id: uuid::Uuid,
    supervisor_id: uuid::Uuid,
    patient_id: uuid::Uuid,
    service_price_id: uuid::Uuid,
}

impl BillingFixture {
    async fn create() -> Self {
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
        let supervisor_id = sqlx::query_scalar::<_, uuid::Uuid>(
            "SELECT id FROM users WHERE facility_id = $1 AND id <> $2 ORDER BY created_at, id LIMIT 1",
        )
        .bind(facility_id)
        .bind(owner_id)
        .fetch_one(&pool)
        .await
        .expect("supervisor exists");
        let patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
            "SELECT id FROM patients WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
        )
        .bind(facility_id)
        .fetch_one(&pool)
        .await
        .expect("patient exists");
        let service_price_id = sqlx::query_scalar::<_, uuid::Uuid>(
            "SELECT id FROM service_prices WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
        )
        .bind(facility_id)
        .fetch_one(&pool)
        .await
        .expect("service price exists");

        Self {
            _database: database,
            pool,
            facility_id,
            owner_id,
            supervisor_id,
            patient_id,
            service_price_id,
        }
    }

    async fn create_invoice(
        &self,
        invoice_number: &str,
        quantity: i64,
    ) -> hms_domain::billing::InvoiceListItem {
        hms_db::billing::create_invoice(
            &self.pool,
            NewInvoice {
                id: uuid::Uuid::new_v4(),
                facility_id: self.facility_id,
                patient_id: self.patient_id,
                service_price_id: self.service_price_id,
                quantity,
                invoice_number: invoice_number.to_owned(),
                actor_user_id: self.owner_id,
            },
        )
        .await
        .expect("invoice creates")
    }
}
