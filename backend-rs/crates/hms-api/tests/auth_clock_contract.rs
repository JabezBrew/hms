mod support;
use support::*;

#[tokio::test]
async fn real_cached_context_uses_fresh_existing_probe_without_added_query() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let first = app
        .state()
        .request_context_facts_for_claims(&claims, "clock.test")
        .await
        .unwrap()
        .unwrap();
    let (second, count) = hms_observability::with_request_query_counter(
        app.state()
            .request_context_facts_for_claims(&claims, "clock.test"),
    )
    .await;
    let second = second.unwrap().unwrap();
    assert_eq!(
        count, 1,
        "the existing indexed session version probe is the only DB query on a real cache hit"
    );
    assert!(second.authorization_clock.observed_at() >= first.authorization_clock.observed_at());
    assert_eq!(
        second.user.auth_security.assurance_version,
        first.user.auth_security.assurance_version
    );
    assert_eq!(
        second.user.auth_security.session_assurance.verified_at,
        first.user.auth_security.session_assurance.verified_at
    );
    assert_eq!(second.cache_expires_at, first.cache_expires_at);
    assert_eq!(second.session_expires_at, first.session_expires_at);
    let serialized = serde_json::to_value(&second.user).unwrap();
    assert!(serialized.get("authorization_clock").is_none());
    println!("actual cache hit: queries=1, fresh_db_observation=true, proof_and_deadlines_unchanged=true");
}

#[tokio::test]
async fn future_at_database_and_expired_genuine_factor_are_refused_by_projection_and_retained_proof(
) {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    for future in [true, false] {
        step_up_test_session(&app, &token, None).await;
        if future {
            sqlx::query("WITH point AS(SELECT clock_timestamp() AS at) UPDATE auth_session_assurance SET verified_at=point.at+interval '1 hour',expires_at=point.at+interval '1 hour 15 minutes' FROM point WHERE session_id=$1").bind(claims.session_id).execute(&pool).await.unwrap();
        } else {
            sqlx::query("WITH point AS(SELECT clock_timestamp() AS at) UPDATE auth_session_assurance SET verified_at=point.at-interval '16 minutes',expires_at=point.at-interval '1 minute' FROM point WHERE session_id=$1").bind(claims.session_id).execute(&pool).await.unwrap();
        }
        app.state().invalidate_auth_cache_for_session(
            claims.facility_id,
            claims.sub,
            claims.session_id,
        );
        let facts = app
            .state()
            .request_context_facts_for_claims(&claims, "clock.test")
            .await
            .unwrap()
            .unwrap();
        assert!(facts.user.auth_security.session_assurance.method.is_none());
        assert!(!facts.user.auth_security.privileged_actions_allowed);
        let mut actor = hms_db::auth::WebAuthnActor {
            facility_id: claims.facility_id,
            user_id: claims.sub,
            session_id: claims.session_id,
            session_version: claims.session_version,
            permission_version: claims.permission_version,
            active_profile: facts.user.active_profile,
            request_id: "clock-test".into(),
            valid_until: facts.session_expires_at,
        };
        let mut tx = pool.begin().await.unwrap();
        let error = hms_db::auth::assurance::require_privileged_tx(&mut tx, &mut actor)
            .await
            .err()
            .expect("retained proof refuses invalid evidence");
        assert!(matches!(
            error.downcast_ref::<hms_db::auth::assurance::FactorError>(),
            Some(hms_db::auth::assurance::FactorError::FactorRequired)
        ));
        tx.rollback().await.unwrap();
    }
}

#[tokio::test]
async fn intact_schema_rejects_overlong_factor_window_and_real_current_factor_remains_valid() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let rejected=sqlx::query("UPDATE auth_session_assurance SET expires_at=verified_at+interval '16 minutes' WHERE session_id=$1").bind(claims.session_id).execute(&pool).await;
    assert!(
        rejected.is_err(),
        "actual existing022 CHECK is preserved; no guards disabled"
    );
    let facts = app
        .state()
        .request_context_facts_for_claims(&claims, "clock.test")
        .await
        .unwrap()
        .unwrap();
    let mut actor = hms_db::auth::WebAuthnActor {
        facility_id: claims.facility_id,
        user_id: claims.sub,
        session_id: claims.session_id,
        session_version: claims.session_version,
        permission_version: claims.permission_version,
        active_profile: facts.user.active_profile,
        request_id: "clock-test".into(),
        valid_until: facts.session_expires_at,
    };
    let mut tx = pool.begin().await.unwrap();
    hms_db::auth::assurance::require_privileged_tx(&mut tx, &mut actor)
        .await
        .expect("actual current ceremony still passes retained admission");
    tx.rollback().await.unwrap();
}

#[tokio::test]
async fn real_cached_facts_refuse_fresh_probe_at_cutoff_or_before_original_observation() {
    use hms_domain::authorization_clock::AuthorizationClock;
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let facts = app
        .state()
        .request_context_facts_for_claims(&claims, "clock.test")
        .await
        .unwrap()
        .unwrap();
    assert!(facts.cache_is_current_at(facts.authorization_clock));
    let backwards = AuthorizationClock::new(
        facts.authorization_clock.observed_at() - Duration::nanoseconds(1),
        std::time::Instant::now(),
    );
    assert!(!facts.cache_is_current_at(backwards));
    let at_cutoff = AuthorizationClock::new(facts.cache_expires_at, std::time::Instant::now());
    assert!(!facts.cache_is_current_at(at_cutoff));
    let aged = AuthorizationClock::new(
        facts.cache_expires_at - Duration::seconds(1),
        std::time::Instant::now() - std::time::Duration::from_secs(2),
    );
    assert!(!facts.cache_is_current_at(aged));
}

#[tokio::test]
async fn original_high_resolution_future_password_cannot_hide_behind_old_jwt_floor() {
    let app = app_with_request_context_probe().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let call = || {
        app.clone().oneshot(
            Request::builder()
                .uri("/__test/request-context")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
    };
    let aligned = call().await.unwrap();
    assert_eq!(aligned.status(), StatusCode::OK);
    assert_eq!(json_body(aligned).await["reauth_fresh"], true);
    let pool = app.db_pool().await;
    sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()+interval '1 hour' WHERE session_id=$1").bind(claims.session_id).execute(&pool).await.unwrap();
    app.state().invalidate_auth_cache_for_session(
        claims.facility_id,
        claims.sub,
        claims.session_id,
    );
    let invalid = call().await.unwrap();
    assert_eq!(
        invalid.status(),
        StatusCode::OK,
        "invalid ordinary proof need not end ordinary read session"
    );
    assert_eq!(
        json_body(invalid).await["reauth_fresh"],
        false,
        "a real old JWT cannot hide the original stored future proof"
    );
}

#[tokio::test]
async fn scoped_ordinary_retained_and_final_lower_bounds_preserve_clinical_default_policy() {
    use hms_db::clinical::{prescription_courses::PrescriptionAuthorization, stock_basis};
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let facts = app
        .state()
        .request_context_facts_for_claims(&claims, "clock.test")
        .await
        .unwrap()
        .unwrap();
    let policy = hms_db::network::get_policy(&pool, claims.facility_id)
        .await
        .unwrap()
        .version;
    let raw = facts.password_verified_at;
    let proof = PrescriptionAuthorization {
        session_id: claims.session_id,
        session_version: claims.session_version,
        permission_version: claims.permission_version,
        active_profile: facts.user.active_profile,
        valid_until: facts.session_expires_at.min(raw + Duration::minutes(15)),
        resolved_network_policy_version: Some(policy),
        ordinary_reauth_required: true,
        original_password_verified_at: Some(raw),
    };
    let mut tx = pool.begin().await.unwrap();
    let actor =
        stock_basis::authorize(&mut tx, claims.facility_id, claims.sub, Some(proof.clone()))
            .await
            .expect("actual current raw proof admits original ordinary scope");
    stock_basis::check_authorization(&mut tx, &actor)
        .await
        .unwrap();
    let mut invalid = actor.clone();
    invalid
        .authorization
        .as_mut()
        .unwrap()
        .original_password_verified_at = Some(raw + Duration::hours(1));
    assert!(stock_basis::check_authorization(&mut tx, &invalid)
        .await
        .is_err());
    invalid
        .authorization
        .as_mut()
        .unwrap()
        .original_password_verified_at = None;
    assert!(stock_basis::check_authorization(&mut tx, &invalid)
        .await
        .is_err());
    sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()+interval '1 hour' WHERE session_id=$1").bind(claims.session_id).execute(&mut *tx).await.unwrap();
    assert!(
        stock_basis::check_authorization(&mut tx, &actor)
            .await
            .is_err(),
        "final existing query independently sees invalid actual raw proof"
    );
    let mut clinical = actor.clone();
    clinical
        .authorization
        .as_mut()
        .unwrap()
        .ordinary_reauth_required = false;
    clinical
        .authorization
        .as_mut()
        .unwrap()
        .original_password_verified_at = None;
    stock_basis::check_authorization(&mut tx, &clinical)
        .await
        .expect("generic onsite clinical purpose does not invent ordinary reauth");
    tx.rollback().await.unwrap();
    for invalid in [Some(raw + Duration::hours(1)), None] {
        let mut proof = proof.clone();
        proof.original_password_verified_at = invalid;
        let mut tx = pool.begin().await.unwrap();
        assert!(
            stock_basis::authorize(&mut tx, claims.facility_id, claims.sub, Some(proof))
                .await
                .is_err()
        );
        tx.rollback().await.unwrap();
    }
    let unchanged: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT password_verified_at FROM refresh_sessions WHERE session_id=$1")
            .bind(claims.session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        unchanged, raw,
        "negative final controls commit no proof rewrite"
    );
}

#[tokio::test]
async fn clock_output_contract_setup_pending_forwards_actual_grant_observation() {
    let app = app().await;
    let response = raw_password_login(&app, "owner@hms.local", "ChangeMe123!", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!response.headers().contains_key(SET_COOKIE));
    let body = json_body(response).await;
    assert_eq!(body["data"]["status"], "setup_required");
    assert!(
        body["data"]["auth_clock"].is_object(),
        "actual setup pending wire must forward raw grant clock"
    );
    assert!(body["data"]["auth_clock"]["access_token_remaining_ms"].is_null());
}
#[tokio::test]
async fn clock_output_contract_factor_pending_forwards_actual_grant_observation() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let response = raw_password_login(&app, "owner@hms.local", "ChangeMe123!", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!response.headers().contains_key(SET_COOKIE));
    let body = json_body(response).await;
    assert_eq!(body["data"]["status"], "factor_required");
    assert!(
        body["data"]["auth_clock"].is_object(),
        "actual factor pending wire must forward raw grant clock"
    );
    assert!(body["data"]["auth_clock"]["access_token_remaining_ms"].is_null());
}
async fn me_clock(cold: bool) {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    if cold {
        app.state().invalidate_auth_cache_for_session(
            claims.facility_id,
            claims.sub,
            claims.session_id,
        );
    }
    let marker: chrono::DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&app.db_pool().await)
        .await
        .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let clock = &body["data"]["auth_security"]["auth_clock"];
    assert!(
        clock.is_object(),
        "actual own-session me output needs a trusted current observation"
    );
    let point: chrono::DateTime<Utc> =
        serde_json::from_value(clock["database_observed_at"].clone()).unwrap();
    assert!(
        point >= marker,
        "own-session output must use this request's fresh DB probe instead of prior token response"
    );
    let issuer: chrono::DateTime<Utc> =
        serde_json::from_value(clock["issuer_observed_at"].clone()).unwrap();
    let end = chrono::DateTime::<Utc>::from_timestamp(claims.exp as i64, 0).unwrap();
    assert_eq!(
        clock["access_token_remaining_ms"].as_u64(),
        Some((end - issuer).num_milliseconds() as u64)
    );
}
#[tokio::test]
async fn clock_output_contract_me_cold_has_actual_current_bearer_observation() {
    me_clock(true).await;
}
#[tokio::test]
async fn clock_output_contract_me_cache_hit_has_actual_current_bearer_observation() {
    me_clock(false).await;
}

#[tokio::test]
async fn controlled_final_publication_points_roll_back_real_proof_and_audit_rows() {
    // The invalid future point is a controlled transaction fixture. This does
    // not change OS/DB clocks or claim a genuine system-clock rollback.
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let before:(chrono::DateTime<Utc>,chrono::DateTime<Utc>,chrono::DateTime<Utc>,i64,String,Option<Uuid>)=sqlx::query_as("SELECT r.password_verified_at,a.verified_at,a.expires_at,r.assurance_version,a.method,a.credential_id FROM refresh_sessions r JOIN auth_session_assurance a USING(session_id) WHERE r.session_id=$1").bind(claims.session_id).fetch_one(&pool).await.unwrap();
    for proof in ["password", "passkey", "recovery"] {
        let result:Result<(),anyhow::Error>=async {
            let mut tx=pool.begin().await?;
            let future:chrono::DateTime<Utc>=sqlx::query_scalar("SELECT clock_timestamp()+interval '1 hour'").fetch_one(&mut *tx).await?;
            if proof == "recovery" {
                sqlx::query("UPDATE auth_session_assurance SET method='recovery',credential_id=NULL,verified_at=$2,expires_at=$2+interval '15 minutes' WHERE session_id=$1").bind(claims.session_id).bind(future).execute(&mut *tx).await?;
            }else if proof == "passkey" {
                sqlx::query("UPDATE auth_session_assurance SET verified_at=$2,expires_at=$2+interval '15 minutes' WHERE session_id=$1").bind(claims.session_id).bind(future).execute(&mut *tx).await?;
            }else{
                sqlx::query("UPDATE refresh_sessions SET password_verified_at=$2 WHERE session_id=$1").bind(claims.session_id).bind(future).execute(&mut *tx).await?;
            }
            sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,'auth.clock.controlled_final_point','auth_session',$3,'{}'::jsonb)").bind(claims.facility_id).bind(claims.sub).bind(claims.session_id).execute(&mut *tx).await?;
            hms_db::auth::assurance::check_proof_publication_tx(&mut tx,Some(future),future+Duration::minutes(15)).await?;
            tx.commit().await?;Ok(())
        }.await;
        assert!(matches!(
            result
                .unwrap_err()
                .downcast_ref::<hms_db::auth::assurance::FactorError>(),
            Some(hms_db::auth::assurance::FactorError::AuthorizationExpired)
        ));
        let after:(chrono::DateTime<Utc>,chrono::DateTime<Utc>,chrono::DateTime<Utc>,i64,String,Option<Uuid>)=sqlx::query_as("SELECT r.password_verified_at,a.verified_at,a.expires_at,r.assurance_version,a.method,a.credential_id FROM refresh_sessions r JOIN auth_session_assurance a USING(session_id) WHERE r.session_id=$1").bind(claims.session_id).fetch_one(&pool).await.unwrap();
        assert_eq!(after, before);
        let audits:i64=sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='auth.clock.controlled_final_point'").bind(claims.session_id).fetch_one(&pool).await.unwrap();
        assert_eq!(audits, 0);
    }
    let mut tx = pool.begin().await.unwrap();
    hms_db::auth::assurance::check_proof_publication_tx(&mut tx, Some(before.1), before.2)
        .await
        .expect("real existing current proof is independently accepted");
    tx.rollback().await.unwrap();
}

#[tokio::test]
async fn future_password_absent_at_hydration_cannot_mature_on_real_cache_hit() {
    let app = app_with_request_context_probe().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let call = || {
        app.clone().oneshot(
            Request::builder()
                .uri("/__test/request-context")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
    };
    let aligned = call().await.unwrap();
    assert_eq!(aligned.status(), StatusCode::OK);
    assert_eq!(json_body(aligned).await["reauth_fresh"], true);
    let pool = app.db_pool().await;
    // Invalid stored-future proof fixture; no OS/DB clock is changed. A later
    // version-probe clock must not synthesize previously absent cache evidence.
    let future:chrono::DateTime<Utc>=sqlx::query_scalar("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()+interval '2 seconds' WHERE session_id=$1 RETURNING password_verified_at")
        .bind(claims.session_id).fetch_one(&pool).await.unwrap();
    app.state().invalidate_auth_cache_for_session(
        claims.facility_id,
        claims.sub,
        claims.session_id,
    );
    let invalid = call().await.unwrap();
    assert_eq!(invalid.status(), StatusCode::OK);
    let initial_fresh = json_body(invalid).await["reauth_fresh"] == true;
    let original = app
        .state()
        .request_context_facts_for_claims(&claims, "clock.sticky")
        .await
        .unwrap()
        .unwrap();
    assert!(original.authorization_clock.observed_at() < future);
    sqlx::query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM($1::timestamptz-clock_timestamp())))+0.03)",
    )
    .bind(future)
    .execute(&pool)
    .await
    .unwrap();
    let (cached, count) = hms_observability::with_request_query_counter(
        app.state()
            .request_context_facts_for_claims(&claims, "clock.sticky"),
    )
    .await;
    let cached = cached.unwrap().unwrap();
    assert_eq!(
        count, 1,
        "actual cache hit uses only the existing version probe"
    );
    assert_eq!(cached.password_verified_at, original.password_verified_at);
    assert_eq!(cached.cache_expires_at, original.cache_expires_at);
    assert!(cached.authorization_clock.observed_at() >= future);
    let warm = call().await.unwrap();
    assert_eq!(warm.status(), StatusCode::OK);
    let warm_fresh = json_body(warm).await["reauth_fresh"] == true;
    app.state().invalidate_auth_cache_for_session(
        claims.facility_id,
        claims.sub,
        claims.session_id,
    );
    let cold = call().await.unwrap();
    assert_eq!(cold.status(), StatusCode::OK);
    let cold_fresh = json_body(cold).await["reauth_fresh"] == true;
    println!("controlled future fixture: aligned=true initial_future_fresh={initial_fresh} actual_cache_query_count={count} later_warm_fresh={warm_fresh} explicit_cold_current_fresh={cold_fresh}");
    assert!(!initial_fresh);
    assert!(
        cold_fresh,
        "new source hydration may independently admit now-current raw proof"
    );
    assert!(
        !warm_fresh,
        "fresh probe must not mature previously missing cached password evidence"
    );
}
