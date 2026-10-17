//! Shared transaction and imported-evidence contracts through production repositories.
use chrono::{Datelike, Duration, Utc};
use hms_db::{referrals::response_records as responses, test_support::TestDb};
use hms_domain::{deployment::DeploymentProfile, referrals::*};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;
fn must<T, E>(v: Result<T, E>, message: &'static str) -> T {
    v.unwrap_or_else(|_| panic!("{message}"))
}
async fn actor(db: &TestDb) -> responses::ReferralResponseActor {
    let user = db.owner_user_id();
    let (sv, pv): (i64, i64) = must(
        sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
            .bind(user)
            .fetch_one(db.pool())
            .await,
        "actor version loads",
    );
    let session = Uuid::new_v4();
    let now = Utc::now();
    must(
        hms_db::auth::insert_refresh_session(
            db.pool(),
            &hms_db::auth::NewRefreshSession {
                token_hash: session.to_string(),
                session_id: session,
                session_family_id: session,
                rotated_from_session_id: None,
                user_id: user,
                facility_id: db.facility_id(),
                session_version: sv,
                permission_version_at_issue: pv,
                csrf_token_hash: "synthetic-csrf".into(),
                expires_at: now + Duration::hours(1),
                session_started_at: now,
                idle_expires_at: now + Duration::hours(1),
                absolute_expires_at: now + Duration::hours(1),
                device_label: None,
            },
        )
        .await,
        "real synthetic session persists",
    );
    must(sqlx::query("INSERT INTO user_patient_visibility(user_id,visibility) VALUES($1,'full_clinical'),($1,'demographics') ON CONFLICT DO NOTHING").bind(user).execute(db.pool()).await,"explicit patient visibility persists");
    responses::ReferralResponseActor {
        facility_id: db.facility_id(),
        user_id: user,
        request_id: None,
        authorization: hms_db::clinical::prescription_courses::PrescriptionAuthorization {
            session_id: session,
            session_version: sv,
            permission_version: pv,
            active_profile: DeploymentProfile::Hospital,
            valid_until: now + Duration::minutes(10),
            resolved_network_policy_version: Some(
                must(
                    hms_db::network::get_policy(db.pool(), db.facility_id()).await,
                    "current publication loads",
                )
                .version,
            ),
        },
    }
}
async fn root(db: &TestDb, actor: &responses::ReferralResponseActor, patient: Uuid) -> Uuid {
    let id = Uuid::new_v4();
    must(sqlx::query("INSERT INTO referrals(id,facility_id,patient_id,to_service,priority,status,sla_due_at,created_by_user_id) VALUES($1,$2,$3,'Synthetic review','routine','accepted',clock_timestamp()+interval '1 day',$4)").bind(id).bind(db.facility_id()).bind(patient).bind(actor.user_id).execute(db.pool()).await,"explicit referral source inserts");
    id
}
#[tokio::test]
async fn atomic_referral_booking_uses_a_single_connection_even_without_a_default_active_clinic() {
    let db = must(TestDb::hospital().await, "isolated database starts");
    let actor = actor(&db).await;
    let patient = must(
        db.scenario("synthetic-single-connection-referral")
            .registered_patient()
            .await,
        "synthetic patient exists",
    )
    .id;
    let id = root(&db, &actor, patient).await;
    must(
        sqlx::query("UPDATE clinics SET is_active=false WHERE facility_id=$1")
            .bind(db.facility_id())
            .execute(db.pool())
            .await,
        "no active default clinic fixture sets",
    );
    let pool = must(
        PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(1))
            .connect_with(db.pool().connect_options().as_ref().clone())
            .await,
        "one-connection pool opens",
    );
    let start = Utc::now() + Duration::hours(2);
    let pending = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        responses::schedule(
            &pool,
            actor,
            id,
            ScheduleReferralAppointmentRequest {
                starts_at: start,
                ends_at: start + Duration::minutes(30),
                session_id: None,
                service_id: None,
                clinic_id: None,
                practitioner_user_id: None,
                overbook_reason: None,
                manual_booking_reason: Some("Synthetic one-connection manual booking".into()),
            },
        ),
    )
    .await;
    let saved = must(
        must(
            pending,
            "single retained connection never waits on a second pool acquisition",
        ),
        "one-transaction schedule persists",
    );
    assert!(saved.status == ReferralStatus::Scheduled && saved.scheduled_appointment_id.is_some());
    pool.close().await;
}
#[tokio::test]
async fn imported_legacy_snapshot_survives_first_governed_amendment_without_invented_author_or_time(
) {
    let db = must(TestDb::hospital().await, "isolated database starts");
    let actor = actor(&db).await;
    let patient = must(
        db.scenario("synthetic-import-response")
            .registered_patient()
            .await,
        "synthetic patient exists",
    )
    .id;
    let id = root(&db, &actor, patient).await;
    must(sqlx::query("UPDATE referrals SET status='completed',specialist_notes='  SYNTHETIC_IMPORT_EXACT\n ',recommendations=NULL,completed_at=NULL,updated_at='2000-01-01' WHERE id=$1").bind(id).execute(db.pool()).await,"trusted imported current snapshot persists");
    let before = must(
        responses::context(db.pool(), actor.clone(), patient, id).await,
        "protected import context loads",
    );
    let original = before
        .response
        .expect("actual imported body has observed revision");
    assert!(
        before.version == 1
            && original.history.imported_legacy
            && original.history.operation == ReferralResponseVersionKind::LegacyObserved
            && original.history.recorded_by_user_id.is_none()
            && original.history.recorded_by_display_name.is_none()
            && original.recommendations.is_none()
            && original.history.completed_at.is_none()
    );
    assert!(original.specialist_notes.as_deref() == Some("  SYNTHETIC_IMPORT_EXACT\n "));
    assert!(
        original.history.recorded_at.year() > 2000,
        "observation time is not inferred original authorship"
    );
    let command = ReferralResponseCommandRequest {
        client_request_id: Uuid::new_v4(),
        expected_version: before.version,
        expected_context_token: before.context_token,
        operation: ReferralResponseCommandKind::Amend,
        specialist_notes: "Synthetic explicit imported amendment".into(),
        recommendations: "".into(),
        amendment_reason: Some("Synthetic record correction".into()),
    };
    let saved = must(
        responses::command(db.pool(), actor.clone(), patient, id, command).await,
        "explicit amendment persists",
    );
    assert!(saved.response.history.version == 2 && saved.response.history.completed_at.is_none());
    let old = must(
        responses::get_version(db.pool(), actor, patient, id, original.history.id).await,
        "original exact import revision reads",
    );
    assert!(
        old.specialist_notes == original.specialist_notes
            && old.recommendations.is_none()
            && old.history.recorded_by_user_id.is_none()
    );
    let mut tx = must(db.pool().begin().await, "invalid pointer probe starts");
    let denied = sqlx::query("UPDATE referrals SET response_version=1 WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await;
    assert!(
        denied.is_err(),
        "root pointer cannot downgrade to matching older evidence"
    );
    must(tx.rollback().await, "invalid pointer probe rolls back");
}

#[tokio::test]
async fn command_commit_rejects_wrong_root_null_result_and_mismatched_receipt_identity() {
    use sha2::{Digest, Sha256};
    let db = must(TestDb::hospital().await, "isolated database starts");
    let actor = actor(&db).await;
    let patient = must(
        db.scenario("synthetic-receipt-scope")
            .registered_patient()
            .await,
        "synthetic patient exists",
    )
    .id;
    let a = root(&db, &actor, patient).await;
    let b = root(&db, &actor, patient).await;
    let mut receipts = Vec::new();
    for id in [a, b] {
        let c = must(
            responses::context(db.pool(), actor.clone(), patient, id).await,
            "actual source context loads",
        );
        let receipt = must(
            responses::command(
                db.pool(),
                actor.clone(),
                patient,
                id,
                ReferralResponseCommandRequest {
                    client_request_id: Uuid::new_v4(),
                    expected_version: c.version,
                    expected_context_token: c.context_token,
                    operation: ReferralResponseCommandKind::SaveDraft,
                    specialist_notes: "Synthetic actual immutable response".into(),
                    recommendations: "".into(),
                    amendment_reason: None,
                },
            )
            .await,
            "actual governed response persists",
        );
        receipts.push(receipt);
    }
    let mut rejected = Vec::new();
    for case in 0..4 {
        let key = Uuid::new_v4();
        let mut receipt = if case == 0 || case == 2 {
            receipts[1].clone()
        } else {
            receipts[0].clone()
        };
        receipt.client_request_id = key;
        let value = if case == 3 {
            serde_json::json!([true])
        } else {
            must(
                serde_json::to_value(receipt),
                "bounded receipt fixture encodes",
            )
        };
        let result = if case == 1 {
            None
        } else if case == 0 {
            Some(receipts[1].response.history.id)
        } else {
            Some(receipts[0].response.history.id)
        };
        let mut tx = must(db.pool().begin().await, "scope probe transaction starts");
        must(sqlx::query("INSERT INTO referral_response_commands(facility_id,request_key_hash,patient_id,referral_id,actor_user_id,operation,payload_digest,result_id,receipt) VALUES($1,$2,$3,$4,$5,'save_draft',$6,$7,$8)").bind(db.facility_id()).bind(Sha256::digest(key.as_bytes()).to_vec()).bind(patient).bind(a).bind(actor.user_id).bind(vec![0u8;32]).bind(result).bind(sqlx::types::Json(value)).execute(&mut *tx).await,"syntactically admitted scope probe inserts");
        rejected.push(tx.commit().await.is_err());
    }
    assert!(rejected.iter().all(|value|*value),"durable command evidence must reject foreign-root result, null result, wrong receipt identity and malformed receipt at commit");
}

#[tokio::test]
async fn scoped_response_reads_count_all_sql_and_seek_history_with_an_actual_bounded_index_plan() {
    let db = must(
        TestDb::hospital().await,
        "isolated measured database starts",
    );
    let actor = actor(&db).await;
    let patient = must(
        db.scenario("synthetic-response-query-budget")
            .registered_patient()
            .await,
        "measured synthetic patient exists",
    )
    .id;
    let id = root(&db, &actor, patient).await;
    must(sqlx::query("UPDATE referrals SET specialist_notes='Synthetic first imported budget response' WHERE id=$1").bind(id).execute(db.pool()).await,"first immutable observed response establishes nonempty comparison");
    let (small_context, small_context_count) = hms_observability::with_request_query_counter(
        responses::context(db.pool(), actor.clone(), patient, id),
    )
    .await;
    let small_context = must(small_context, "small protected current response reads");
    let (small_history, small_history_count) = hms_observability::with_request_query_counter(
        responses::history(db.pool(), actor.clone(), patient, id, None, 101),
    )
    .await;
    assert_eq!(
        must(small_history, "small protected metadata page reads").len(),
        1
    );
    // This is an isolated trusted-import fixture, not a second product write
    // path. Every update uses the actual immutable observation/root guards.
    for number in 2..=106 {
        must(
            sqlx::query("UPDATE referrals SET specialist_notes=$2 WHERE id=$1")
                .bind(id)
                .bind(format!("Synthetic imported budget response {number}"))
                .execute(db.pool())
                .await,
            "larger guarded immutable response history grows",
        );
    }
    must(sqlx::query("INSERT INTO referrals(id,facility_id,patient_id,to_service,priority,status,sla_due_at,specialist_notes) SELECT gen_random_uuid(),$1,$2,'Synthetic other referral','routine','completed',clock_timestamp(),'Synthetic unrelated imported response' FROM generate_series(1,1000)").bind(db.facility_id()).bind(patient).execute(db.pool()).await,"unrelated imported roots exercise indexed scope filtering");
    let (large_context, large_context_count) = hms_observability::with_request_query_counter(
        responses::context(db.pool(), actor.clone(), patient, id),
    )
    .await;
    let large_context = must(large_context, "large protected current response reads");
    let (large_history, large_history_count) = hms_observability::with_request_query_counter(
        responses::history(db.pool(), actor.clone(), patient, id, None, 101),
    )
    .await;
    let large_history = must(large_history, "bounded large protected history page reads");
    assert!(
        small_context.version == 1 && large_context.version == 106 && large_history.len() == 101
    );
    assert!(large_history
        .iter()
        .all(|row| row.referral_id == id && row.patient_id == patient));
    assert!(large_history
        .windows(2)
        .all(|pair| pair[0].version > pair[1].version));
    let before = large_history.last().unwrap().version;
    let (next, next_count) = hms_observability::with_request_query_counter(responses::history(
        db.pool(),
        actor.clone(),
        patient,
        id,
        Some(before),
        101,
    ))
    .await;
    let next = must(
        next,
        "seek continuation reads without count or per-row followups",
    );
    assert!(
        before == 6
            && next.len() == 5
            && next.first().unwrap().version == 5
            && next.last().unwrap().version == 1
    );
    let exact = small_context.response.unwrap().history.id;
    let (old, exact_count) = hms_observability::with_request_query_counter(responses::get_version(
        db.pool(),
        actor.clone(),
        patient,
        id,
        exact,
    ))
    .await;
    assert_eq!(
        must(old, "exact original response reads").history.version,
        1
    );
    let (denied, denied_count) = hms_observability::with_request_query_counter(responses::history(
        db.pool(),
        actor.clone(),
        Uuid::new_v4(),
        id,
        None,
        101,
    ))
    .await;
    assert!(
        denied
            .err()
            .is_some_and(|e| e.is::<responses::ResponseError>())
            && denied_count == 1
    );
    // All explicit SQL in the new repository is individually instrumented.
    // Existing identity/session/network/feature proof SQL contributes as well;
    // BEGIN/COMMIT use the existing counter convention and are excluded.
    assert!(small_context_count >= 13 && small_context_count <= 14);
    assert_eq!(small_context_count, large_context_count);
    assert_eq!(small_history_count, large_history_count);
    assert_eq!(small_context_count, small_history_count);
    assert_eq!(small_history_count, next_count);
    assert_eq!(small_context_count, exact_count);
    must(
        sqlx::query("ANALYZE referral_response_revisions")
            .execute(db.pool())
            .await,
        "isolated history planner statistics refresh",
    );
    let plan:serde_json::Value=must(sqlx::query_scalar("EXPLAIN (ANALYZE, FORMAT JSON) SELECT id,patient_id,referral_id,version,operation,status,to_service,priority,NULL::text AS specialist_notes,NULL::text AS recommendations,NULL::text AS amendment_reason,completed_at,recorded_by_user_id,recorded_by_display_name,recorded_at,imported_legacy FROM referral_response_revisions WHERE facility_id=$1 AND referral_id=$2 AND patient_id=$3 AND ($4::bigint IS NULL OR version<$4) ORDER BY version DESC LIMIT 101").bind(db.facility_id()).bind(id).bind(patient).bind(107i64).fetch_one(db.pool()).await,"actual bounded indexed history plan reads only in memory");
    let top = &plan[0]["Plan"];
    fn scoped_index(node: &serde_json::Value) -> bool {
        let index = node["Node Type"]
            .as_str()
            .is_some_and(|v| matches!(v, "Index Scan" | "Index Only Scan" | "Bitmap Index Scan"));
        let known = node["Index Name"].as_str().is_some_and(|v| {
            matches!(
                v,
                "referral_response_history_idx"
                    | "referral_response_revisions_referral_id_version_key"
            )
        });
        let scoped = node["Index Cond"]
            .as_str()
            .is_some_and(|v| v.contains("referral_id") && v.contains("version"));
        (index && known && scoped)
            || node["Plans"]
                .as_array()
                .is_some_and(|rows| rows.iter().any(scoped_index))
    }
    assert!(
        top["Node Type"] == "Limit"
            && top["Actual Rows"].as_u64() == Some(101)
            && scoped_index(top),
        "actual seek plan uses a scoped version index below a bounded limit"
    );
    // Aggregate-only evidence: never print plan strings containing bound IDs.
    eprintln!("response_query_budget context_small={small_context_count} context_large={large_context_count} history_small={small_history_count} history_large={large_history_count} history_seek={next_count} exact={exact_count} denied={denied_count} indexed_limit=true");
}
