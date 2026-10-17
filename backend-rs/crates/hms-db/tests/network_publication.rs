use chrono::{Duration, Utc};
use hms_db::{network::*, test_support::TestDb};
use hms_domain::network::{NetworkOffsiteMode, UpdateNetworkPolicyRequest};
use uuid::Uuid;

fn must<T, E>(result: Result<T, E>, message: &'static str) -> T {
    match result {
        Ok(value) => value,
        Err(_) => panic!("{message}"),
    }
}
async fn publish(pool: &hms_db::PgPool, facility: Uuid, expected: i64) {
    must(
        update_policy(
            pool,
            NetworkPolicyActor {
                facility_id: facility,
                user_id: None,
                request_id: None,
                reauth_deadline: None,
                auth_versions: None,
                session_id: None,
                active_profile: None,
                resolved_policy_version: None,
            },
            UpdateNetworkPolicyRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: expected,
                onsite_cidrs: vec!["127.0.0.1/32".into()],
                offsite_mode: NetworkOffsiteMode::Deny,
                reason: "Synthetic explicit publication".into(),
            },
            None,
        )
        .await,
        "canonical operator publication succeeds",
    );
}

#[tokio::test]
async fn default_sentinel_preserves_readonly_zero_without_fabricating_history_and_serializes_first_publication(
) {
    let db = must(TestDb::hospital().await, "isolated database initializes");
    let mut tx = must(db.pool().begin().await, "business read transaction begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *tx)
            .await,
        "business backend identified privately",
    );
    must(
        require_publication_tx(&mut tx, db.facility_id(), 0).await,
        "true default read proof acquired",
    );
    let row:(i64,Vec<String>,String,Option<chrono::DateTime<Utc>>,Option<Uuid>) = must(sqlx::query_as("SELECT version,onsite_cidrs::text[],offsite_mode,updated_at,updated_by_user_id FROM facility_network_policies WHERE facility_id=$1").bind(db.facility_id()).fetch_one(&mut *tx).await, "unchanged default sentinel reads");
    assert!(
        row.0 == 0 && row.1.is_empty() && row.2 == "readonly" && row.3.is_none() && row.4.is_none(),
        "sentinel is the exact unconfigured readonly state"
    );
    let historical:i64 = must(sqlx::query_scalar("SELECT (SELECT count(*) FROM facility_network_policy_versions WHERE facility_id=$1)+(SELECT count(*) FROM facility_network_policy_commands WHERE facility_id=$1)+(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type LIKE 'network.%')").bind(db.facility_id()).fetch_one(&mut *tx).await, "default publication evidence count reads");
    assert_eq!(
        historical, 0,
        "read proof does not fabricate a configuration command, history or audit"
    );
    let pool = db.pool().clone();
    let facility = db.facility_id();
    let mut writer = tokio::spawn(async move { publish(&pool, facility, 0).await });
    let observed=tokio::time::timeout(std::time::Duration::from_secs(3),async{loop{
        let blocked:bool=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,'facility_network_policies')>0 AND wait_event_type='Lock')").bind(pid).fetch_one(db.pool()).await,"first-publication wait graph reads");
        if blocked{return true;} if writer.is_finished(){return false;}
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }}).await;
    must(
        tx.commit().await,
        "release default proof before joining publisher",
    );
    match tokio::time::timeout(std::time::Duration::from_secs(6), &mut writer).await {
        Ok(joined) => must(joined, "operator joins after default proof release"),
        Err(_) => {
            writer.abort();
            panic!("released publisher must terminate");
        }
    }
    assert!(
        matches!(observed, Ok(true)),
        "first operator publication actually waits behind the default proof"
    );
    let current = must(
        get_policy(db.pool(), db.facility_id()).await,
        "published policy reads",
    );
    assert!(
        current.configured
            && current.version == 1
            && current.offsite_mode == NetworkOffsiteMode::Deny
    );
}

#[tokio::test]
async fn operator_first_publication_wins_before_default_proof_without_replacing_its_snapshot() {
    let db = must(TestDb::hospital().await, "isolated database initializes");
    publish(db.pool(), db.facility_id(), 0).await;
    let mut tx = must(db.pool().begin().await, "stale default proof begins");
    let error = must(
        require_publication_tx(&mut tx, db.facility_id(), 0)
            .await
            .err()
            .ok_or(()),
        "stale default version rejects",
    );
    assert_eq!(
        error.downcast_ref::<NetworkPublicationError>(),
        Some(&NetworkPublicationError::PolicyChanged)
    );
    must(tx.rollback().await, "stale proof rolls back");
    let current = must(
        get_policy(db.pool(), db.facility_id()).await,
        "original published snapshot reads",
    );
    assert!(
        current.configured
            && current.version == 1
            && current.offsite_mode == NetworkOffsiteMode::Deny
    );
}

#[tokio::test]
async fn configured_proof_is_select_only_and_negative_version_fails_closed() {
    let db = must(TestDb::hospital().await, "isolated database initializes");
    publish(db.pool(), db.facility_id(), 0).await;
    must(sqlx::raw_sql("CREATE FUNCTION publication_test_no_policy_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'unexpected policy insertion'; END $$; CREATE TRIGGER publication_test_no_policy_insert BEFORE INSERT ON facility_network_policies FOR EACH ROW EXECUTE FUNCTION publication_test_no_policy_insert();").execute(db.pool()).await,"configured-insert regression guard installed");
    let mut tx = must(
        db.pool().begin().await,
        "configured proof transaction begins",
    );
    must(
        require_publication_tx(&mut tx, db.facility_id(), 1).await,
        "configured proof never attempts INSERT",
    );
    let error = must(
        require_publication_tx(&mut tx, db.facility_id(), -1)
            .await
            .err()
            .ok_or(()),
        "negative proof rejects",
    );
    assert_eq!(
        error.downcast_ref::<NetworkPublicationError>(),
        Some(&NetworkPublicationError::MissingProof)
    );
    must(tx.commit().await, "configured read proof finishes");
}

#[tokio::test]
async fn protected_prescribing_commands_reject_none_and_missing_version_before_business_writes() {
    use hms_db::clinical::prescription_courses::*;
    use hms_domain::{clinical::*, deployment::DeploymentProfile};
    let db = must(TestDb::hospital().await, "isolated database initializes");
    let patient = must(
        db.scenario("publication-proof-negative")
            .registered_patient()
            .await,
        "synthetic registered patient created",
    )
    .id;
    let source:Uuid=must(sqlx::query_scalar("INSERT INTO prescriptions(id,facility_id,patient_id,medication_name,dose,route,frequency,status,created_by_user_id) VALUES(gen_random_uuid(),$1,$2,'Synthetic proof review','Reviewed dose','oral','daily','active',$3) RETURNING id").bind(db.facility_id()).bind(patient).bind(db.owner_user_id()).fetch_one(db.pool()).await,"source prescription fixture inserted");
    let detail = must(
        must(
            get_detail(db.pool(), db.facility_id(), source).await,
            "source detail reads",
        )
        .ok_or(()),
        "source exists",
    );
    let session = Uuid::new_v4();
    let now = Utc::now();
    let (sv, pv): (i64, i64) = must(
        sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
            .bind(db.owner_user_id())
            .fetch_one(db.pool())
            .await,
        "actual actor versions read",
    );
    must(
        hms_db::auth::insert_refresh_session(
            db.pool(),
            &hms_db::auth::NewRefreshSession {
                token_hash: Uuid::new_v4().to_string(),
                session_id: session,
                session_family_id: session,
                rotated_from_session_id: None,
                user_id: db.owner_user_id(),
                facility_id: db.facility_id(),
                session_version: sv,
                permission_version_at_issue: pv,
                csrf_token_hash: "synthetic proof fixture".into(),
                expires_at: now + Duration::hours(1),
                session_started_at: now,
                idle_expires_at: now + Duration::hours(1),
                absolute_expires_at: now + Duration::hours(1),
                device_label: None,
            },
        )
        .await,
        "actual bound clinical session inserted",
    );
    for authorization in [
        None,
        Some(PrescriptionAuthorization {
            session_id: session,
            session_version: sv,
            permission_version: pv,
            active_profile: DeploymentProfile::Hospital,
            valid_until: now + Duration::minutes(15),
            resolved_network_policy_version: None,
        }),
    ] {
        let actor = PrescriptionActor {
            facility_id: db.facility_id(),
            user_id: db.owner_user_id(),
            request_id: None,
            authorization,
        };
        let docs = UpdatePrescriptionDocumentationRequest {
            client_request_id: Uuid::new_v4(),
            expected_snapshot_token: detail.snapshot_token.clone(),
            instructions: "Synthetic reviewed instructions".into(),
            reason: "Synthetic explicit indication".into(),
        };
        let error = must(
            update_documentation_authorized(db.pool(), actor.clone(), source, docs)
                .await
                .err()
                .ok_or(()),
            "missing command proof rejects",
        );
        assert_eq!(
            error.downcast_ref::<NetworkPublicationError>(),
            Some(&NetworkPublicationError::MissingProof)
        );
        let course: NewPrescriptionCourseRequest = must(
            serde_json::from_value(
                serde_json::json!({"client_request_id":Uuid::new_v4(),"expected_snapshot_token":detail.snapshot_token,"relation":"replacement","change_reason":"Synthetic explicit review","medication_name":"Synthetic successor","dose":"Reviewed dose","route":"oral","frequency":"daily","instructions":"Synthetic instruction","reason":"Synthetic indication","start_date":now.date_naive(),"duration_days":2}),
            ),
            "reviewed successor fixture parses",
        );
        let error = must(
            create_new_course_authorized(db.pool(), actor, source, course)
                .await
                .err()
                .ok_or(()),
            "missing successor proof rejects",
        );
        assert_eq!(
            error.downcast_ref::<NetworkPublicationError>(),
            Some(&NetworkPublicationError::MissingProof)
        );
    }
    let counts:(i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM prescription_commands WHERE facility_id=$1 AND source_prescription_id=$2),(SELECT count(*) FROM prescription_course_provenance WHERE facility_id=$1 AND source_prescription_id=$2)").bind(db.facility_id()).bind(source).fetch_one(db.pool()).await,"rejected command evidence reads");
    assert_eq!(counts, (0, 0));
    let current = must(
        must(
            get_detail(db.pool(), db.facility_id(), source).await,
            "unchanged source reads",
        )
        .ok_or(()),
        "source remains present",
    );
    assert!(
        current.snapshot_token == detail.snapshot_token,
        "missing proof causes no source mutation"
    );
}
