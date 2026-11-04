//! STATIC/UNCOMPILED/UNRUN proposal. Real repository and intrinsic SQL controls.
use chrono::{Duration, Utc};
use hms_db::{
    laboratory::{self, NewLabOrder},
    laboratory_catalog::{self as catalog, LabCatalogActor, LabCatalogError, LabCatalogFilters},
    test_support::TestDb,
};
use hms_domain::{deployment::DeploymentProfile, laboratory::LabPriority, laboratory_catalog::*};
use uuid::Uuid;

struct F {
    db: TestDb,
    actor: LabCatalogActor,
    test: Uuid,
    patient: Uuid,
}
impl F {
    async fn new() -> Self {
        let db = TestDb::hospital().await.unwrap();
        let pool = db.pool();
        let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
        // A real ordinary no-patient manager: no demographic/order/Chronicle grants.
        sqlx::query("UPDATE users SET password_change_required=false WHERE id=$1")
            .bind(user)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM user_permissions WHERE user_id=$1")
            .bind(user)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM user_patient_visibility WHERE user_id=$1")
            .bind(user)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO user_permissions(user_id,permission_code) VALUES($1,'laboratory.catalog.manage')").bind(user).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO user_features(user_id,feature_key) VALUES($1,'laboratory') ON CONFLICT DO NOTHING").bind(user).execute(pool).await.unwrap();
        let (sv, pv): (i64, i64) =
            sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
                .bind(user)
                .fetch_one(pool)
                .await
                .unwrap();
        let now = sqlx::query_scalar::<_, chrono::DateTime<Utc>>("SELECT clock_timestamp()")
            .fetch_one(pool)
            .await
            .unwrap();
        let session = Uuid::new_v4();
        hms_db::auth::insert_refresh_session(
            pool,
            &hms_db::auth::NewRefreshSession {
                token_hash: session.to_string(),
                session_id: session,
                session_family_id: session,
                rotated_from_session_id: None,
                user_id: user,
                facility_id: db.facility_id(),
                session_version: sv,
                permission_version_at_issue: pv,
                csrf_token_hash: "synthetic-lab33".into(),
                expires_at: now + Duration::hours(1),
                session_started_at: now,
                idle_expires_at: now + Duration::hours(1),
                absolute_expires_at: now + Duration::hours(1),
                device_label: None,
            },
        )
        .await
        .unwrap();
        let verified = sqlx::query_scalar::<_, chrono::DateTime<Utc>>(
            "SELECT password_verified_at FROM refresh_sessions WHERE session_id=$1",
        )
        .bind(session)
        .fetch_one(pool)
        .await
        .unwrap();
        let actor = LabCatalogActor {
            facility_id: db.facility_id(),
            user_id: user,
            request_id: "synthetic-lab33".into(),
            authorization: hms_db::clinical::prescription_courses::PrescriptionAuthorization {
                ordinary_reauth_required: true,
                original_password_verified_at: Some(verified),
                session_id: session,
                session_version: sv,
                permission_version: pv,
                active_profile: DeploymentProfile::Hospital,
                valid_until: verified + Duration::minutes(15),
                resolved_network_policy_version: Some(
                    hms_db::network::get_policy(pool, db.facility_id())
                        .await
                        .unwrap()
                        .version,
                ),
            },
        };
        let test = Uuid::new_v4();
        sqlx::query("INSERT INTO lab_tests(id,facility_id,code,name,specimen_type,result_unit) VALUES($1,$2,'LAB33_LITERAL_%','Synthetic source','blood','synthetic-unit')").bind(test).bind(db.facility_id()).execute(pool).await.unwrap();
        let patient =
            sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 ORDER BY id LIMIT 1")
                .bind(db.facility_id())
                .fetch_one(pool)
                .await
                .unwrap();
        Self {
            db,
            actor,
            test,
            patient,
        }
    }
    fn input(
        &self,
        id: Uuid,
        kind: LabCatalogKind,
        version: i64,
        active: bool,
    ) -> LaboratoryCatalogReviewedInput {
        LaboratoryCatalogReviewedInput {
            action: LaboratoryCatalogAction::SetAvailability,
            subject_kind: kind,
            subject_id: id,
            client_request_id: Uuid::new_v4(),
            expected_version: version,
            is_active: active,
            reason: "Synthetic availability review".into(),
        }
    }
    fn order(&self, tests: Vec<Uuid>, panels: Vec<Uuid>) -> NewLabOrder {
        NewLabOrder {
            id: Uuid::new_v4(),
            facility_id: self.db.facility_id(),
            patient_id: self.patient,
            encounter_id: None,
            visit_id: None,
            test_ids: tests,
            panel_ids: panels,
            priority: LabPriority::Routine,
            actor_user_id: self.db.owner_user_id(),
        }
    }
    async fn panel(&self) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO lab_panels(id,facility_id,code,name) VALUES($1,$2,$3,'Synthetic panel')",
        )
        .bind(id)
        .bind(self.db.facility_id())
        .bind(id.to_string())
        .execute(self.db.pool())
        .await
        .unwrap();
        sqlx::query("INSERT INTO lab_panel_tests(panel_id,test_id) VALUES($1,$2)")
            .bind(id)
            .bind(self.test)
            .execute(self.db.pool())
            .await
            .unwrap();
        id
    }
    async fn counts(&self) -> (i64, i64, i64, i64) {
        sqlx::query_as("SELECT(SELECT count(*) FROM laboratory_catalog_commands),(SELECT count(*) FROM lab_orders),(SELECT count(*) FROM lab_order_tests),(SELECT count(*) FROM audit_events)").fetch_one(self.db.pool()).await.unwrap()
    }
}
fn error<T>(value: anyhow::Result<T>, expected: LabCatalogError) {
    match value {
        Err(e) => assert_eq!(e.downcast_ref::<LabCatalogError>(), Some(&expected)),
        Ok(_) => panic!("catalog operation unexpectedly published"),
    }
}

#[tokio::test]
async fn lab33_ordinary_no_patient_reads_fresh_commands_originals_noops_and_history() {
    let f = F::new().await;
    let p = f.db.pool();
    let mut reader = f.actor.clone();
    reader.authorization.ordinary_reauth_required = false;
    reader.authorization.original_password_verified_at = None;
    let rows = catalog::list(
        p,
        reader.clone(),
        LabCatalogKind::Test,
        None,
        101,
        LabCatalogFilters {
            search: Some("LITERAL_%".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        serde_json::to_value(&rows[0])
            .unwrap()
            .as_object()
            .unwrap()
            .len(),
        7
    );
    let before = catalog::detail(p, reader.clone(), LabCatalogKind::Test, f.test)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(before.version(), 1);
    let input = f.input(f.test, LabCatalogKind::Test, 1, false);
    error(
        catalog::command(p, reader.clone(), input.clone()).await,
        LabCatalogError::Authority,
    );
    let first = catalog::command(p, f.actor.clone(), input.clone())
        .await
        .unwrap();
    assert!(first.changed);
    assert_eq!(first.subject.version(), 2);
    let doc:(Uuid,chrono::DateTime<Utc>,bool,bool)=sqlx::query_as("SELECT id,indexed_at,requires_patient_demographics,patient_id IS NULL AND patient_code IS NULL AND patient_name IS NULL AND patient_date_of_birth IS NULL FROM search_documents WHERE facility_id=$1 AND resource_type='laboratory' AND resource_id=$2").bind(f.db.facility_id()).bind(f.test).fetch_one(p).await.unwrap();
    assert!(doc.2 && doc.3);
    let noop = catalog::command(
        p,
        f.actor.clone(),
        f.input(f.test, LabCatalogKind::Test, 2, false),
    )
    .await
    .unwrap();
    assert!(!noop.changed);
    assert!(
        serde_json::to_value(&first.subject).unwrap()
            == serde_json::to_value(&noop.subject).unwrap()
    );
    let after:(Uuid,chrono::DateTime<Utc>)=sqlx::query_as("SELECT id,indexed_at FROM search_documents WHERE facility_id=$1 AND resource_type='laboratory' AND resource_id=$2").bind(f.db.facility_id()).bind(f.test).fetch_one(p).await.unwrap();
    assert_eq!((doc.0, doc.1), after);
    catalog::command(
        p,
        f.actor.clone(),
        f.input(f.test, LabCatalogKind::Test, 2, true),
    )
    .await
    .unwrap();
    let replay = catalog::command(p, f.actor.clone(), input).await.unwrap();
    let recovered = catalog::receipt(p, f.actor.clone(), first.client_request_id)
        .await
        .unwrap()
        .unwrap();
    assert!(serde_json::to_value(&first).unwrap() == serde_json::to_value(replay).unwrap());
    assert!(serde_json::to_value(&first).unwrap() == serde_json::to_value(recovered).unwrap());
    error(
        catalog::command(
            p,
            f.actor.clone(),
            f.input(f.test, LabCatalogKind::Test, 1, false),
        )
        .await,
        LabCatalogError::VersionConflict,
    );
    let history = catalog::history(p, reader, LabCatalogKind::Test, f.test, None, 101)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(history.len(), 3);
    for row in history {
        let v = serde_json::to_value(row).unwrap();
        assert_eq!(v.as_object().unwrap().len(), 8);
        for hidden in [
            "reason",
            "actor_user_id",
            "recorded_by_user_id",
            "definition",
            "subject",
            "reviewed_input",
        ] {
            assert!(v.get(hidden).is_none());
        }
    }
}

#[tokio::test]
async fn lab33_current_revocation_and_expiry_refuse_reads_commands_and_original_recovery() {
    let f = F::new().await;
    let p = f.db.pool();
    let first = catalog::command(
        p,
        f.actor.clone(),
        f.input(f.test, LabCatalogKind::Test, 1, false),
    )
    .await
    .unwrap();
    let before = f.counts().await;
    let mut expired = f.actor.clone();
    expired.authorization.valid_until = Utc::now() - Duration::seconds(1);
    let mut stale_original = f.actor.clone();
    stale_original.authorization.original_password_verified_at =
        Some(Utc::now() - Duration::minutes(16));
    error(
        catalog::command(
            p,
            stale_original,
            f.input(f.test, LabCatalogKind::Test, 2, true),
        )
        .await,
        LabCatalogError::Authority,
    );
    error(
        catalog::detail(p, expired.clone(), LabCatalogKind::Test, f.test).await,
        LabCatalogError::Authority,
    );
    error(
        catalog::receipt(p, expired, first.client_request_id).await,
        LabCatalogError::Authority,
    );
    sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='laboratory.catalog.manage'").bind(f.actor.user_id).execute(p).await.unwrap();
    error(
        catalog::detail(p, f.actor.clone(), LabCatalogKind::Test, f.test).await,
        LabCatalogError::Authority,
    );
    error(
        catalog::receipt(p, f.actor.clone(), first.client_request_id).await,
        LabCatalogError::Authority,
    );
    error(
        catalog::command(
            p,
            f.actor.clone(),
            f.input(f.test, LabCatalogKind::Test, 2, true),
        )
        .await,
        LabCatalogError::Authority,
    );
    assert_eq!(before, f.counts().await);
}

#[tokio::test]
async fn lab33_cross_kind_uuid_reuse_and_changed_intent_are_not_original_replay() {
    let f = F::new().await;
    let p = f.db.pool();
    let panel = f.panel().await;
    let first = catalog::command(
        p,
        f.actor.clone(),
        f.input(f.test, LabCatalogKind::Test, 1, false),
    )
    .await
    .unwrap();
    let version: i64 = sqlx::query_scalar("SELECT version FROM lab_panels WHERE id=$1")
        .bind(panel)
        .fetch_one(p)
        .await
        .unwrap();
    let mut other = f.input(panel, LabCatalogKind::Panel, version, false);
    other.client_request_id = first.client_request_id;
    error(
        catalog::command(p, f.actor.clone(), other).await,
        LabCatalogError::RequestConflict,
    );
    let mut changed = first.reviewed_input.clone();
    changed.reason = "Different explicit review".into();
    error(
        catalog::command(p, f.actor.clone(), changed).await,
        LabCatalogError::RequestConflict,
    );
}

#[tokio::test]
async fn lab33_projection_ownership_refuses_atomically_without_receipt_audit_or_source_change() {
    let f = F::new().await;
    let p = f.db.pool();
    sqlx::query("UPDATE search_documents SET metadata=jsonb_build_object('source_table','synthetic_other_owner') WHERE facility_id=$1 AND resource_type='laboratory' AND resource_id=$2").bind(f.db.facility_id()).bind(f.test).execute(p).await.unwrap();
    let before = f.counts().await;
    error(
        catalog::command(
            p,
            f.actor.clone(),
            f.input(f.test, LabCatalogKind::Test, 1, false),
        )
        .await,
        LabCatalogError::ProjectionConflict,
    );
    error(
        catalog::command(
            p,
            f.actor.clone(),
            f.input(f.test, LabCatalogKind::Test, 1, true),
        )
        .await,
        LabCatalogError::ProjectionConflict,
    );
    assert_eq!(before, f.counts().await);
    let state: (bool, i64) = sqlx::query_as("SELECT is_active,version FROM lab_tests WHERE id=$1")
        .bind(f.test)
        .fetch_one(p)
        .await
        .unwrap();
    assert_eq!(state, (true, 1));
}

#[tokio::test]
async fn lab33_member_availability_does_not_fan_in_panel_version_or_rewrite_original_ordering() {
    let f = F::new().await;
    let p = f.db.pool();
    let panel = f.panel().await;
    let before = catalog::detail(p, f.actor.clone(), LabCatalogKind::Panel, panel)
        .await
        .unwrap()
        .unwrap();
    catalog::command(
        p,
        f.actor.clone(),
        f.input(f.test, LabCatalogKind::Test, 1, false),
    )
    .await
    .unwrap();
    let noop = catalog::command(
        p,
        f.actor.clone(),
        f.input(panel, LabCatalogKind::Panel, before.version(), true),
    )
    .await
    .unwrap();
    assert!(!noop.changed);
    let old = serde_json::to_value(before).unwrap();
    let original = serde_json::to_value(&noop.subject).unwrap();
    assert!(old["definition"] == original["definition"]);
    assert_eq!(old["ordering"]["is_orderable"], true);
    assert_eq!(original["ordering"]["blocked_by"], "unavailable_members");
    catalog::command(
        p,
        f.actor.clone(),
        f.input(f.test, LabCatalogKind::Test, 2, true),
    )
    .await
    .unwrap();
    let recovered = catalog::receipt(p, f.actor.clone(), noop.client_request_id)
        .await
        .unwrap()
        .unwrap();
    assert!(serde_json::to_value(recovered).unwrap() == serde_json::to_value(noop).unwrap());
}

#[tokio::test]
async fn lab33_membership_generation_counts_real_transitions_only_and_never_authorizes_a_panel() {
    let f = F::new().await;
    let p = f.db.pool();
    let panel = f.panel().await;
    let snapshot = || {
        sqlx::query_as::<_, (i64, i64)>(
            "SELECT version,membership_generation FROM lab_panels WHERE id=$1",
        )
        .bind(panel)
        .fetch_one(p)
    };
    assert_eq!(snapshot().await.unwrap(), (2, 1));
    sqlx::query(
        "INSERT INTO lab_panel_tests(panel_id,test_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    )
    .bind(panel)
    .bind(f.test)
    .execute(p)
    .await
    .unwrap();
    sqlx::query("UPDATE lab_panel_tests SET test_id=test_id WHERE panel_id=$1")
        .bind(panel)
        .execute(p)
        .await
        .unwrap();
    assert_eq!(snapshot().await.unwrap(), (2, 1));
    assert!(sqlx::query("UPDATE lab_panels SET membership_generation=membership_generation+2,version=version+1,updated_at=clock_timestamp(),catalog_changed_at=clock_timestamp() WHERE id=$1").bind(panel).execute(p).await.is_err());
    sqlx::query("DELETE FROM lab_panel_tests WHERE panel_id=$1")
        .bind(panel)
        .execute(p)
        .await
        .unwrap();
    assert_eq!(snapshot().await.unwrap(), (3, 2));
    let result = laboratory::create_order(p, f.order(vec![f.test], vec![panel])).await;
    assert!(
        result.is_err(),
        "empty requested panel cannot disappear beside valid direct selection"
    );
}

#[tokio::test]
async fn lab33_existing_inactive_link_noop_retains_exact_tuple_against_delete_both_orders() {
    let f = F::new().await;
    let p = f.db.pool();
    let order = laboratory::create_order(p, f.order(vec![f.test], vec![]))
        .await
        .unwrap();
    catalog::command(
        p,
        f.actor.clone(),
        f.input(f.test, LabCatalogKind::Test, 1, false),
    )
    .await
    .unwrap();
    let mut noop = p.begin().await.unwrap();
    sqlx::query(
        "INSERT INTO lab_order_tests(order_id,test_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    )
    .bind(order.id)
    .bind(f.test)
    .execute(&mut *noop)
    .await
    .unwrap();
    let mut delete = p.begin().await.unwrap();
    sqlx::query("SET LOCAL lock_timeout='100ms'")
        .execute(&mut *delete)
        .await
        .unwrap();
    let refused = sqlx::query("DELETE FROM lab_order_tests WHERE order_id=$1 AND test_id=$2")
        .bind(order.id)
        .bind(f.test)
        .execute(&mut *delete)
        .await;
    let code = refused.err().and_then(|e| {
        e.as_database_error()
            .and_then(|d| d.code())
            .map(|v| v.to_string())
    });
    delete.rollback().await.unwrap();
    noop.commit().await.unwrap();
    assert_eq!(code.as_deref(), Some("55P03"));
    let mut delete = p.begin().await.unwrap();
    sqlx::query("DELETE FROM lab_order_tests WHERE order_id=$1 AND test_id=$2")
        .bind(order.id)
        .bind(f.test)
        .execute(&mut *delete)
        .await
        .unwrap();
    let attempt = sqlx::query(
        "INSERT INTO lab_order_tests(order_id,test_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    )
    .bind(order.id)
    .bind(f.test)
    .execute(p)
    .await;
    let refused = attempt.is_err();
    delete.commit().await.unwrap();
    assert!(
        refused,
        "deletion-first cannot become an unlocked inactive-history exception"
    );
    assert!(sqlx::query(
        "INSERT INTO lab_order_tests(order_id,test_id) VALUES($1,$2) ON CONFLICT DO NOTHING"
    )
    .bind(order.id)
    .bind(f.test)
    .execute(p)
    .await
    .is_err());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM lab_order_tests WHERE order_id=$1")
        .bind(order.id)
        .fetch_one(p)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn lab33_retained_real_order_selection_refuses_availability_and_membership_phantoms() {
    let f = F::new().await;
    let p = f.db.pool();
    let panel = f.panel().await;
    let mut table = p.begin().await.unwrap();
    let blocker: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *table)
        .await
        .unwrap();
    sqlx::query("LOCK TABLE lab_orders IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *table)
        .await
        .unwrap();
    let pool = p.clone();
    let input = f.order(vec![], vec![panel]);
    let order_id = input.id;
    let request = tokio::spawn(async move { laboratory::create_order(&pool, input).await });
    let started = std::time::Instant::now();
    let mut observed = false;
    while started.elapsed() < std::time::Duration::from_millis(500) && !request.is_finished() {
        observed=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%INSERT INTO lab_orders%')").bind(blocker).fetch_one(p).await.unwrap();
        if observed {
            break;
        }
        tokio::task::yield_now().await;
    }
    let mut change = p.begin().await.unwrap();
    sqlx::query("SET LOCAL lock_timeout='25ms'")
        .execute(&mut *change)
        .await
        .unwrap();
    let availability=sqlx::query("WITH point AS MATERIALIZED(SELECT clock_timestamp() at) UPDATE lab_tests SET is_active=false,version=version+1,updated_at=point.at,catalog_changed_at=point.at,catalog_changed_by_user_id=NULL FROM point WHERE id=$1").bind(f.test).execute(&mut *change).await;
    let availability_refused = availability.is_err();
    change.rollback().await.unwrap();
    let mut membership = p.begin().await.unwrap();
    let phantom = sqlx::query("DELETE FROM lab_panel_tests WHERE panel_id=$1 AND test_id=$2")
        .bind(panel)
        .bind(f.test)
        .execute(&mut *membership)
        .await;
    let phantom_refused = phantom.is_err();
    membership.rollback().await.unwrap();
    table.rollback().await.unwrap();
    let published = request.await.unwrap();
    assert!(observed, "must observe real INSERT blocker, not timing");
    assert!(availability_refused && phantom_refused);
    assert!(published.is_ok());
    let links: i64 =
        sqlx::query_scalar("SELECT count(*) FROM lab_order_tests WHERE order_id=$1 AND test_id=$2")
            .bind(order_id)
            .bind(f.test)
            .fetch_one(p)
            .await
            .unwrap();
    assert_eq!(links, 1);
    catalog::command(
        p,
        f.actor.clone(),
        f.input(f.test, LabCatalogKind::Test, 1, false),
    )
    .await
    .unwrap();
    let later = f.order(vec![], vec![panel]);
    let id = later.id;
    assert!(laboratory::create_order(p, later).await.is_err());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM lab_orders WHERE id=$1")
        .bind(id)
        .fetch_one(p)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn lab33_existing_order_can_collect_enter_and_verify_after_source_disable() {
    let f = F::new().await;
    let p = f.db.pool();
    let order = laboratory::create_order(p, f.order(vec![f.test], vec![]))
        .await
        .unwrap();
    catalog::command(
        p,
        f.actor.clone(),
        f.input(f.test, LabCatalogKind::Test, 1, false),
    )
    .await
    .unwrap();
    let specimen = laboratory::create_specimen(
        p,
        laboratory::NewSpecimen {
            id: Uuid::new_v4(),
            facility_id: f.db.facility_id(),
            order_id: order.id,
            patient_id: f.patient,
            specimen_type: "blood".into(),
            actor_user_id: f.db.owner_user_id(),
        },
    )
    .await
    .unwrap();
    let result = laboratory::create_result(
        p,
        laboratory::NewLabResult {
            id: Uuid::new_v4(),
            facility_id: f.db.facility_id(),
            specimen_id: specimen.id,
            order_id: order.id,
            patient_id: f.patient,
            test_id: f.test,
            value: "synthetic-result".into(),
            unit: None,
            actor_user_id: f.db.owner_user_id(),
        },
    )
    .await
    .unwrap();
    assert!(
        laboratory::verify_result(p, f.db.facility_id(), result.id, f.db.owner_user_id())
            .await
            .unwrap()
            .is_some()
    );
    let witness:(i64,bool,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM lab_order_tests WHERE order_id=$1 AND test_id=$2),(SELECT NOT is_active FROM lab_tests WHERE id=$2),(SELECT count(*) FROM lab_results WHERE id=$3 AND verified_at IS NOT NULL)").bind(order.id).bind(f.test).bind(result.id).fetch_one(p).await.unwrap();
    assert_eq!(witness, (1, true, 1));
}
