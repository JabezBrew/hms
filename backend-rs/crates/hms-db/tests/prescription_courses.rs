use chrono::Utc;
use hms_db::{
    clinical::{self, prescription_courses::*, NewPrescription},
    test_support::TestDb,
};
use hms_domain::clinical::*;
use uuid::Uuid;

struct Fixture {
    db: TestDb,
    source: Uuid,
    patient: Uuid,
}
impl Fixture {
    async fn new() -> Self {
        let db = TestDb::hospital().await.unwrap();
        let patient = db
            .scenario("synthetic-prescription-courses")
            .registered_patient()
            .await
            .unwrap()
            .id;
        let source = Uuid::new_v4();
        create_with_documentation(
            db.pool(),
            NewPrescription {
                id: source,
                facility_id: db.facility_id(),
                patient_id: patient,
                encounter_id: None,
                visit_id: None,
                discharge_case_id: None,
                medication_name: "Synthetic original medication".into(),
                dose: "1 tablet".into(),
                route: "oral".into(),
                frequency: "daily".into(),
                inventory_item_id: None,
                start_date: Some(Utc::now().date_naive()),
                duration_days: Some(7),
                first_dose_at: None,
                actor_user_id: db.owner_user_id(),
            },
            None,
            PrescriptionDocumentation {
                instructions: "Synthetic original instructions".into(),
                reason: "Synthetic original indication".into(),
            },
            None,
            None,
        )
        .await
        .unwrap();
        Self {
            db,
            source,
            patient,
        }
    }
    fn actor(&self) -> PrescriptionActor {
        PrescriptionActor {
            facility_id: self.db.facility_id(),
            user_id: self.db.owner_user_id(),
            request_id: None,
            authorization: None,
        }
    }
    async fn detail(&self) -> PrescriptionDetail {
        get_detail(self.db.pool(), self.db.facility_id(), self.source)
            .await
            .unwrap()
            .unwrap()
    }
    async fn status(&self, status: PrescriptionStatus) {
        clinical::update_prescription(
            self.db.pool(),
            self.db.facility_id(),
            self.source,
            serde_json::from_value(serde_json::json!({"status":status})).unwrap(),
        )
        .await
        .unwrap();
    }
    async fn input(&self, relation: PrescriptionCourseRelation) -> NewPrescriptionCourseRequest {
        let source = self.detail().await;
        NewPrescriptionCourseRequest {
            scheduled_stock_policy: None,
            client_request_id: Uuid::new_v4(),
            expected_snapshot_token: source.snapshot_token,
            relation,
            change_reason: "Synthetic explicit course decision".into(),
            medication_name: "Synthetic reviewed new medication".into(),
            dose: "2 tablets".into(),
            route: "oral".into(),
            frequency: "bid".into(),
            instructions: "Synthetic new instructions".into(),
            reason: "Synthetic new indication".into(),
            start_date: Utc::now().date_naive(),
            duration_days: Some(4),
            first_dose_at: None,
            encounter_id: None,
            visit_id: None,
            inventory_item_id: None,
            expected_stock_unit: None,
            prn_policy: None,
        }
    }
}

#[tokio::test]
async fn documentation_is_detailed_bounded_cas_guarded_and_receipts_are_immutable() {
    let f = Fixture::new().await;
    let detail = f.detail().await;
    assert_eq!(detail.instructions, "Synthetic original instructions");
    assert_eq!(detail.reason, "Synthetic original indication");
    let list = clinical::list_prescriptions(f.db.pool(), f.db.facility_id(), f.patient, None, 2)
        .await
        .unwrap();
    let list = serde_json::to_value(list).unwrap();
    assert!(list[0].get("instructions").is_none());
    assert!(list[0].get("reason").is_none());
    let request = UpdatePrescriptionDocumentationRequest {
        client_request_id: Uuid::new_v4(),
        expected_snapshot_token: detail.snapshot_token.clone(),
        instructions: "Synthetic corrected instructions".into(),
        reason: "Synthetic corrected indication".into(),
    };
    let saved = update_documentation(f.db.pool(), f.actor(), f.source, request.clone())
        .await
        .unwrap();
    assert_eq!(saved.prescription.instructions, request.instructions);
    assert_ne!(saved.prescription.snapshot_token, detail.snapshot_token);
    f.status(PrescriptionStatus::Stopped).await;
    let replay = update_documentation(f.db.pool(), f.actor(), f.source, request.clone())
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(
        serde_json::to_value(replay.prescription).unwrap(),
        serde_json::to_value(saved.prescription).unwrap()
    );
    let mut altered = request;
    altered.instructions = "Synthetic altered retry".into();
    assert_eq!(
        update_documentation(f.db.pool(), f.actor(), f.source, altered)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&PrescriptionCourseError::RequestConflict)
    );
    let current = f.detail().await;
    let locked = UpdatePrescriptionDocumentationRequest {
        client_request_id: Uuid::new_v4(),
        expected_snapshot_token: current.snapshot_token,
        instructions: "".into(),
        reason: "".into(),
    };
    assert_eq!(
        update_documentation(f.db.pool(), f.actor(), f.source, locked)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&PrescriptionCourseError::DocumentationLocked)
    );
}

#[tokio::test]
async fn stopped_and_completed_orders_without_generated_mar_cannot_resurrect_or_change_regimen() {
    for status in [PrescriptionStatus::Stopped, PrescriptionStatus::Completed] {
        let f = Fixture::new().await;
        f.status(status).await;
        for patch in [
            serde_json::json!({"status":"active"}),
            serde_json::json!({"dose":"Synthetic historical mutation"}),
        ] {
            let result = clinical::update_prescription(
                f.db.pool(),
                f.db.facility_id(),
                f.source,
                serde_json::from_value(patch).unwrap(),
            )
            .await;
            assert_eq!(
                result.unwrap_err().to_string(),
                "prescription_course_closed"
            );
        }
        assert_eq!(f.detail().await.prescription.status, status);
    }
}

#[tokio::test]
async fn terminal_renewal_is_an_independent_reviewed_course_without_generated_work_or_source_reactivation(
) {
    let f = Fixture::new().await;
    f.status(PrescriptionStatus::Stopped).await;
    let source = f.detail().await;
    let input = f.input(PrescriptionCourseRelation::Renewal).await;
    let saved = create_new_course(f.db.pool(), f.actor(), f.source, input.clone())
        .await
        .unwrap();
    assert_ne!(saved.prescription.prescription.id, f.source);
    assert_eq!(saved.source_status_after, PrescriptionStatus::Stopped);
    assert_eq!(f.detail().await.snapshot_token, source.snapshot_token);
    assert_eq!(saved.prescription.prescription.dose, "2 tablets");
    assert_eq!(saved.prescription.instructions, input.instructions);
    assert_eq!(
        saved
            .prescription
            .provenance
            .as_ref()
            .unwrap()
            .source_prescription_id,
        f.source
    );
    let generated:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM medication_courses),(SELECT count(*) FROM pharmacy_fulfillments)").fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(generated, (0, 0));
    let new_id = saved.prescription.prescription.id;
    clinical::update_prescription(
        f.db.pool(),
        f.db.facility_id(),
        new_id,
        serde_json::from_value(serde_json::json!({"status":"completed"})).unwrap(),
    )
    .await
    .unwrap();
    let replay = create_new_course(f.db.pool(), f.actor(), f.source, input.clone())
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(
        replay.prescription.prescription.status,
        PrescriptionStatus::Active
    );
    let loaded = get_new_course_receipt(f.db.pool(), &f.actor(), f.source, input.client_request_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(loaded.prescription.prescription.id, new_id);
    assert_eq!(
        get_detail(f.db.pool(), f.db.facility_id(), new_id)
            .await
            .unwrap()
            .unwrap()
            .prescription
            .status,
        PrescriptionStatus::Completed
    );
    let mut wrong = f.actor();
    wrong.user_id = Uuid::new_v4();
    assert!(
        get_new_course_receipt(f.db.pool(), &wrong, f.source, input.client_request_id)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        create_new_course(
            f.db.pool(),
            f.actor(),
            f.source,
            f.input(PrescriptionCourseRelation::Renewal).await
        )
        .await
        .unwrap_err()
        .downcast_ref(),
        Some(&PrescriptionCourseError::SuccessorExists)
    );
    let audits: Vec<serde_json::Value> = sqlx::query_scalar(
        "SELECT metadata FROM audit_events WHERE event_type LIKE 'prescription.%'",
    )
    .fetch_all(f.db.pool())
    .await
    .unwrap();
    assert!(audits
        .iter()
        .all(|value| !value.to_string().contains("Synthetic")));
}

#[tokio::test]
async fn simultaneous_replacement_keys_create_one_successor_and_same_key_returns_same_receipt() {
    let f = Fixture::new().await;
    let request = f.input(PrescriptionCourseRelation::Replacement).await;
    let (a, b) = tokio::join!(
        create_new_course(f.db.pool(), f.actor(), f.source, request.clone()),
        create_new_course(f.db.pool(), f.actor(), f.source, request.clone())
    );
    let (a, b) = (a.unwrap(), b.unwrap());
    assert_eq!(
        a.prescription.prescription.id,
        b.prescription.prescription.id
    );
    assert_ne!(a.replayed, b.replayed);
    assert_eq!(
        f.detail().await.prescription.status,
        PrescriptionStatus::Stopped
    );
    let mut altered = request;
    altered.change_reason = "Synthetic changed command".into();
    assert_eq!(
        create_new_course(f.db.pool(), f.actor(), f.source, altered)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&PrescriptionCourseError::RequestConflict)
    );
    let g = Fixture::new().await;
    let (a, b) = tokio::join!(
        create_new_course(
            g.db.pool(),
            g.actor(),
            g.source,
            g.input(PrescriptionCourseRelation::Replacement).await
        ),
        create_new_course(
            g.db.pool(),
            g.actor(),
            g.source,
            g.input(PrescriptionCourseRelation::Replacement).await
        )
    );
    assert_ne!(a.is_ok(), b.is_ok());
    assert_eq!(
        a.err().or(b.err()).unwrap().downcast_ref(),
        Some(&PrescriptionCourseError::SuccessorExists)
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM prescriptions")
        .fetch_one(g.db.pool())
        .await
        .unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
async fn rollback_restores_source_and_leaves_no_successor_or_command_after_audit_failure() {
    let f = Fixture::new().await;
    let request = f.input(PrescriptionCourseRelation::Replacement).await;
    sqlx::raw_sql("CREATE FUNCTION reject_course_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='prescription.course.created' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_course_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_course_audit();").execute(f.db.pool()).await.unwrap();
    assert!(
        create_new_course(f.db.pool(), f.actor(), f.source, request.clone())
            .await
            .is_err()
    );
    assert_eq!(
        f.detail().await.prescription.status,
        PrescriptionStatus::Active
    );
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM prescriptions),(SELECT count(*) FROM prescription_course_provenance),(SELECT count(*) FROM prescription_commands)").fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(counts, (1, 0, 0));
    sqlx::query("DROP TRIGGER reject_course_audit ON audit_events")
        .execute(f.db.pool())
        .await
        .unwrap();
    assert!(create_new_course(f.db.pool(), f.actor(), f.source, request)
        .await
        .is_ok());
}

#[tokio::test]
async fn changed_source_stock_review_wrong_status_and_mixed_treatment_fail_without_closing_source()
{
    let f = Fixture::new().await;
    let stale = f.input(PrescriptionCourseRelation::Replacement).await;
    clinical::update_prescription(
        f.db.pool(),
        f.db.facility_id(),
        f.source,
        serde_json::from_value(serde_json::json!({"dose":"Synthetic revised source"})).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(
        create_new_course(f.db.pool(), f.actor(), f.source, stale)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&PrescriptionCourseError::SourceChanged)
    );
    assert_eq!(
        create_new_course(
            f.db.pool(),
            f.actor(),
            f.source,
            f.input(PrescriptionCourseRelation::Renewal).await
        )
        .await
        .unwrap_err()
        .downcast_ref(),
        Some(&PrescriptionCourseError::InvalidSourceStatus)
    );
    let mut request = f.input(PrescriptionCourseRelation::Replacement).await;
    let (item,unit):(Uuid,String)=sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND item_type='medication' AND NOT controlled LIMIT 1").bind(f.db.facility_id()).fetch_one(f.db.pool()).await.unwrap();
    request.inventory_item_id = Some(item);
    request.expected_stock_unit = Some(format!("{unit}-stale"));
    request.scheduled_stock_policy = Some(ScheduledStockPolicyRequest {
        expected_stock_unit: format!("{unit}-stale"),
        stock_units_per_dose: 1,
    });
    assert_eq!(
        create_new_course(f.db.pool(), f.actor(), f.source, request)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&PrescriptionCourseError::StockChanged)
    );
    assert_eq!(
        f.detail().await.prescription.status,
        PrescriptionStatus::Active
    );
}

#[tokio::test]
async fn documentation_character_bounds_reject_without_partial_update_or_command() {
    let f = Fixture::new().await;
    let original = f.detail().await;
    for (instructions, reason) in [
        ("é".repeat(4001), String::new()),
        (String::new(), "é".repeat(2001)),
    ] {
        let request = UpdatePrescriptionDocumentationRequest {
            client_request_id: Uuid::new_v4(),
            expected_snapshot_token: original.snapshot_token.clone(),
            instructions,
            reason,
        };
        assert_eq!(
            update_documentation(f.db.pool(), f.actor(), f.source, request)
                .await
                .unwrap_err()
                .downcast_ref(),
            Some(&PrescriptionCourseError::InvalidDocumentation)
        );
    }
    let unchanged = f.detail().await;
    assert_eq!(unchanged.instructions, original.instructions);
    assert_eq!(unchanged.reason, original.reason);
    assert_eq!(unchanged.snapshot_token, original.snapshot_token);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM prescription_commands")
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(count, 0);
    let saved = update_documentation(
        f.db.pool(),
        f.actor(),
        f.source,
        UpdatePrescriptionDocumentationRequest {
            client_request_id: Uuid::new_v4(),
            expected_snapshot_token: original.snapshot_token,
            instructions: "é".repeat(4000),
            reason: "é".repeat(2000),
        },
    )
    .await
    .unwrap();
    assert_eq!(saved.prescription.instructions.chars().count(), 4000);
    assert_eq!(saved.prescription.reason.chars().count(), 2000);
}

#[tokio::test]
async fn waiting_new_course_rechecks_checked_out_visit_without_closing_source_or_saving_command() {
    let f = Fixture::new().await;
    let visit = Uuid::new_v4();
    sqlx::query("INSERT INTO visits(id,facility_id,patient_id,status,created_by_user_id) VALUES($1,$2,$3,'in_consultation',$4)").bind(visit).bind(f.db.facility_id()).bind(f.patient).bind(f.db.owner_user_id()).execute(f.db.pool()).await.unwrap();
    let mut request = f.input(PrescriptionCourseRelation::Replacement).await;
    request.visit_id = Some(visit);
    let mut checkout = f.db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *checkout)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE visits SET status='checked_out',checked_out_at=clock_timestamp() WHERE id=$1",
    )
    .bind(visit)
    .execute(&mut *checkout)
    .await
    .unwrap();
    let pool = f.db.pool().clone();
    let actor = f.actor();
    let source = f.source;
    let write = tokio::spawn(async move { create_new_course(&pool, actor, source, request).await });
    tokio::time::timeout(std::time::Duration::from_secs(2),async {loop {
        let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))").bind(pid).fetch_one(f.db.pool()).await.unwrap();
        if waiting {break;} assert!(!write.is_finished(),"reviewed visit must be locked before successor creation"); tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }}).await.expect("new course reaches the held visit status row");
    checkout.commit().await.unwrap();
    assert_eq!(
        write.await.unwrap().unwrap_err().downcast_ref(),
        Some(&PrescriptionCourseError::InvalidContext)
    );
    assert_eq!(
        f.detail().await.prescription.status,
        PrescriptionStatus::Active
    );
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM prescriptions),(SELECT count(*) FROM prescription_course_provenance),(SELECT count(*) FROM prescription_commands)").fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(counts, (1, 0, 0));
    for status in ["cancelled", "no_show", "synthetic_unknown"] {
        sqlx::query("UPDATE visits SET status=$2 WHERE id=$1")
            .bind(visit)
            .bind(status)
            .execute(f.db.pool())
            .await
            .unwrap();
        let mut request = f.input(PrescriptionCourseRelation::Replacement).await;
        request.visit_id = Some(visit);
        assert_eq!(
            create_new_course(f.db.pool(), f.actor(), f.source, request)
                .await
                .unwrap_err()
                .downcast_ref(),
            Some(&PrescriptionCourseError::InvalidContext)
        );
    }
}
