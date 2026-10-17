mod support;
use support::*;
#[path = "auth_factor_matrix/mod.rs"]
mod matrix;
use matrix::Matrix;

fn movement(matrix: &Matrix, quantity: i64, witness: Option<Uuid>) -> Value {
    let mut payload = matrix
        .operations
        .iter()
        .find(|operation| operation.name == "controlled receipt")
        .unwrap()
        .body
        .clone()
        .unwrap();
    payload["quantity_delta"] = json!(quantity);
    payload["movement_type"] = json!(if quantity < 0 { "dispense" } else { "receipt" });
    payload["witness_user_id"] = json!(witness);
    payload
}

async fn evidence(app: &TestApp) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('register',(SELECT count(*) FROM controlled_substance_register),'discrepancies',(SELECT count(*) FROM controlled_substance_discrepancies),'physical',(SELECT COALESCE(sum(quantity_on_hand),0) FROM stock_batches),'batches',(SELECT count(*) FROM stock_batches),'movements',(SELECT count(*) FROM stock_movements),'audit',(SELECT count(*) FROM audit_events WHERE event_type LIKE 'controlled_substance.%'))")
        .fetch_one(&app.db_pool().await).await.unwrap()
}

async fn checked(response: axum::response::Response, status: StatusCode) -> Value {
    let actual = response.status();
    let body = json_body(response).await;
    assert_eq!(
        actual,
        status,
        "safe controlled error {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    body
}

#[tokio::test]
async fn dedicated_type_only_controlled_receipt_requires_real_factor_and_preserves_coupling() {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let item = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,controlled) SELECT $1,$2,category_id,'SYN_CONTROLLED_TYPE_ONLY','Synthetic type-only fixture','controlled_substance','unit',false FROM inventory_items WHERE facility_id=$2 ORDER BY id LIMIT 1")
        .bind(item).bind(app.state().facility_id()).execute(&pool).await.unwrap();
    let mut payload = movement(&matrix, 7, Some(witness(app).await));
    payload["item_id"] = json!(item);
    let claims = access_claims(&token);
    sqlx::query("DELETE FROM auth_session_assurance WHERE session_id=$1")
        .bind(claims.session_id)
        .execute(&pool)
        .await
        .unwrap();
    app.state().invalidate_auth_cache_for_session(
        claims.facility_id,
        claims.sub,
        claims.session_id,
    );
    let before = evidence(app).await;
    checked(
        fixture_json_post(
            app,
            Some(&token),
            "/api/v2/pharmacy/controlled-substances/register",
            payload.clone(),
        )
        .await,
        StatusCode::FORBIDDEN,
    )
    .await;
    assert_eq!(evidence(app).await, before);
    let proved = step_up_test_session(app, &token, None).await;
    checked(
        fixture_json_post(
            app,
            Some(&proved),
            "/api/v2/pharmacy/controlled-substances/register",
            payload.clone(),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_balances(app, &payload, 7).await;
    let flag: bool = sqlx::query_scalar("SELECT controlled FROM inventory_items WHERE id=$1")
        .bind(item)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        !flag,
        "the dedicated action does not rewrite historical classification flags"
    );
}

async fn count(
    app: &TestApp,
    token: &str,
    register: Uuid,
    witness: Uuid,
    actual: i64,
) -> axum::response::Response {
    fixture_json_post(app, Some(token), &format!("/api/v2/pharmacy/controlled-substances/register/{register}/counts"), json!({"actual_count":actual,"witness_user_id":witness,"category":"missing","reason":"Synthetic reviewed count"})).await
}

async fn witness(app: &TestApp) -> Uuid {
    sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='factor-target@hms.local'",
    )
    .bind(app.state().facility_id())
    .fetch_one(&app.db_pool().await)
    .await
    .unwrap()
}

async fn assert_balances(app: &TestApp, payload: &Value, expected: i64) {
    let item = Uuid::parse_str(payload["item_id"].as_str().unwrap()).unwrap();
    let location = Uuid::parse_str(payload["location_id"].as_str().unwrap()).unwrap();
    let balances:(i64,i64,i64)=sqlx::query_as("SELECT COALESCE((SELECT balance_after FROM controlled_substance_register WHERE facility_id=$1 AND item_id=$2 AND location_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1),0),COALESCE((SELECT sum(quantity_delta)::bigint FROM controlled_substance_register WHERE facility_id=$1 AND item_id=$2 AND location_id=$3),0),COALESCE((SELECT sum(quantity_on_hand)::bigint FROM stock_batches WHERE facility_id=$1 AND item_id=$2 AND location_id=$3),0)")
        .bind(app.state().facility_id()).bind(item).bind(location).fetch_one(&app.db_pool().await).await.unwrap();
    assert_eq!(
        balances,
        (expected, expected, expected),
        "latest saved balance, actual deltas and physical stock agree"
    );
}

#[tokio::test]
async fn controlled_commands_require_real_local_location_and_distinct_active_witness() {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let owner = access_claims(&token).sub;
    let active_witness = witness(app).await;
    let first = movement(&matrix, 10, Some(active_witness));
    let saved = checked(
        fixture_json_post(
            app,
            Some(&token),
            "/api/v2/pharmacy/controlled-substances/register",
            first.clone(),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let register = Uuid::parse_str(saved["data"]["id"].as_str().unwrap()).unwrap();
    let foreign = Uuid::new_v4();
    let foreign_user = Uuid::new_v4();
    let inactive_user = Uuid::new_v4();
    let foreign_location = Uuid::new_v4();
    let inactive_location = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) SELECT $1,'SYN_CONTROLLED_FOREIGN','Synthetic foreign fixture',deployment_profile FROM facilities WHERE id=$2")
        .bind(foreign).bind(app.state().facility_id()).execute(&pool).await.unwrap();
    for (user, facility, active) in [
        (foreign_user, foreign, true),
        (inactive_user, app.state().facility_id(), false),
    ] {
        sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash,is_active) SELECT $1,$2,'synthetic-controlled@hms.local','Synthetic eligibility fixture',password_hash,$3 FROM users WHERE id=$4")
            .bind(user).bind(facility).bind(active).bind(owner).execute(&pool).await.unwrap();
    }
    for (location, facility, active) in [
        (foreign_location, foreign, true),
        (inactive_location, app.state().facility_id(), false),
    ] {
        sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name,is_active) VALUES($1,$2,'SYN_CONTROLLED_LOCATION','Synthetic location',$3)")
            .bind(location).bind(facility).bind(active).execute(&pool).await.unwrap();
    }
    for invalid in [owner, foreign_user, inactive_user] {
        let before = evidence(app).await;
        for quantity in [1, -1] {
            checked(
                fixture_json_post(
                    app,
                    Some(&token),
                    "/api/v2/pharmacy/controlled-substances/register",
                    movement(&matrix, quantity, Some(invalid)),
                )
                .await,
                StatusCode::BAD_REQUEST,
            )
            .await;
            assert_eq!(
                evidence(app).await,
                before,
                "invalid witness cannot change business evidence"
            );
        }
        checked(
            count(app, &token, register, invalid, 9).await,
            StatusCode::BAD_REQUEST,
        )
        .await;
        assert_eq!(
            evidence(app).await,
            before,
            "invalid count witness cannot change business evidence"
        );
    }
    for location in [foreign_location, inactive_location] {
        let before = evidence(app).await;
        let mut payload = movement(&matrix, 1, None);
        payload["location_id"] = json!(location);
        checked(
            fixture_json_post(
                app,
                Some(&token),
                "/api/v2/pharmacy/controlled-substances/register",
                payload,
            )
            .await,
            StatusCode::BAD_REQUEST,
        )
        .await;
        assert_eq!(
            evidence(app).await,
            before,
            "invalid location cannot change business evidence"
        );
    }
    checked(
        fixture_json_post(
            app,
            Some(&token),
            "/api/v2/pharmacy/controlled-substances/register",
            movement(&matrix, -1, Some(active_witness)),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    checked(
        count(app, &token, register, active_witness, 8).await,
        StatusCode::OK,
    )
    .await;
    assert_balances(app, &first, 8).await;
}

#[tokio::test]
async fn divergent_physical_stock_requires_review_even_for_a_zero_delta_count() {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let active_witness = witness(app).await;
    let payload = movement(&matrix, 10, None);
    let saved = checked(
        fixture_json_post(
            app,
            Some(&token),
            "/api/v2/pharmacy/controlled-substances/register",
            payload.clone(),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let register = Uuid::parse_str(saved["data"]["id"].as_str().unwrap()).unwrap();
    let item = Uuid::parse_str(payload["item_id"].as_str().unwrap()).unwrap();
    let location = Uuid::parse_str(payload["location_id"].as_str().unwrap()).unwrap();
    sqlx::query("UPDATE stock_batches SET quantity_on_hand=quantity_on_hand+1 WHERE id=(SELECT id FROM stock_batches WHERE facility_id=$1 AND item_id=$2 AND location_id=$3 ORDER BY id LIMIT 1)")
        .bind(app.state().facility_id()).bind(item).bind(location).execute(&app.db_pool().await).await.unwrap();
    let before = evidence(app).await;
    let denied = checked(
        count(app, &token, register, active_witness, 10).await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(
        denied["error"]["code"],
        "controlled_balance_review_required"
    );
    assert_eq!(
        evidence(app).await,
        before,
        "a zero-delta count cannot pretend divergent stock is reconciled"
    );
    let denied = checked(
        fixture_json_post(
            app,
            Some(&token),
            "/api/v2/pharmacy/controlled-substances/register",
            movement(&matrix, 1, None),
        )
        .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(
        denied["error"]["code"],
        "controlled_balance_review_required"
    );
    assert_eq!(
        evidence(app).await,
        before,
        "a receipt cannot infer an opening balance or double-add stock"
    );
}

#[tokio::test]
async fn unknown_controlled_write_failures_do_not_claim_a_definite_unsaved_outcome() {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let saved = checked(
        fixture_json_post(
            app,
            Some(&token),
            "/api/v2/pharmacy/controlled-substances/register",
            movement(&matrix, 10, None),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let register = Uuid::parse_str(saved["data"]["id"].as_str().unwrap()).unwrap();
    let witness = witness(app).await;
    let pool = app.db_pool().await;
    sqlx::raw_sql("CREATE FUNCTION reject_controlled_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic controlled audit failure'; END $$; CREATE TRIGGER reject_controlled_audit BEFORE INSERT ON audit_events FOR EACH ROW WHEN (NEW.event_type='controlled_substance.movement.recorded') EXECUTE FUNCTION reject_controlled_audit();").execute(&pool).await.unwrap();
    let before = evidence(app).await;
    let denied = checked(
        count(app, &token, register, witness, 9).await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(
        denied["error"]["code"],
        "controlled_count_write_unconfirmed"
    );
    assert_eq!(
        evidence(app).await,
        before,
        "actual attempted count and stock mutation roll back together"
    );
    let denied = checked(
        fixture_json_post(
            app,
            Some(&token),
            "/api/v2/pharmacy/controlled-substances/register",
            movement(&matrix, 1, None),
        )
        .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(
        denied["error"]["code"],
        "controlled_movement_write_unconfirmed"
    );
    assert_eq!(
        evidence(app).await,
        before,
        "actual attempted movement and stock mutation roll back together"
    );
}

async fn wait_for_lock(
    pool: &hms_db::PgPool,
    pid: i32,
    command: &tokio::task::JoinHandle<axum::response::Response>,
) {
    tokio::time::timeout(std::time::Duration::from_secs(3),async{loop{
        let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))").bind(pid).fetch_one(pool).await.unwrap();
        if waiting {break;}assert!(!command.is_finished(),"command must actually wait");tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }}).await.expect("command reaches held row");
}

#[tokio::test]
async fn controlled_ledger_serializes_opposite_witness_pairs_and_uses_actual_insert_time() {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let pool = app.db_pool().await;
    let second = witness(app).await;
    grant_test_permission(app, second, PermissionCode::ControlledSubstanceManage).await;
    grant_test_permission(app, second, PermissionCode::PatientDemographicsView).await;
    for feature in [FeatureKey::Patients, FeatureKey::Inventory] {
        grant_test_feature(app, second, feature).await;
    }
    grant_test_patient_visibility(app, second, PatientDataVisibility::Demographics).await;
    let (first_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (second_token, _, _) = login(app.clone(), "factor-target@hms.local").await;
    let payload = movement(&matrix, 2, None);
    let mut blocker = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
        .bind(second)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let pending_app = app.clone();
    let early_payload = payload.clone();
    let early_token = second_token.clone();
    let early = tokio::spawn(async move {
        fixture_json_post(
            &pending_app,
            Some(&early_token),
            "/api/v2/pharmacy/controlled-substances/register",
            early_payload,
        )
        .await
    });
    wait_for_lock(&pool, pid, &early).await;
    let first = checked(
        fixture_json_post(
            app,
            Some(&first_token),
            "/api/v2/pharmacy/controlled-substances/register",
            movement(&matrix, 10, None),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    blocker.commit().await.unwrap();
    let later = checked(early.await.unwrap(), StatusCode::OK).await;
    assert!(
        chrono::DateTime::parse_from_rfc3339(later["data"]["created_at"].as_str().unwrap())
            .unwrap()
            > chrono::DateTime::parse_from_rfc3339(first["data"]["created_at"].as_str().unwrap())
                .unwrap(),
        "item-serialized later write has the later saved insertion timestamp"
    );
    assert_balances(app, &payload, 12).await;
    checked(
        fixture_json_post(
            app,
            Some(&first_token),
            "/api/v2/pharmacy/controlled-substances/register",
            movement(&matrix, 3, None),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_balances(app, &payload, 15).await;
    // Both real actors can witness the other request. Their shared sorted user
    // prefix must serialize rather than each retaining one user and waiting on
    // the other. Queue both behind the first ID to exercise that exact prefix.
    let first_user = access_claims(&first_token).sub;
    let mut blocker = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
        .bind(first_user.min(second))
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let pending_app = app.clone();
    let left_payload = movement(&matrix, 1, Some(second));
    let left = tokio::spawn(async move {
        fixture_json_post(
            &pending_app,
            Some(&first_token),
            "/api/v2/pharmacy/controlled-substances/register",
            left_payload,
        )
        .await
    });
    let pending_app = app.clone();
    let right_payload = movement(&matrix, 1, Some(first_user));
    let right = tokio::spawn(async move {
        fixture_json_post(
            &pending_app,
            Some(&second_token),
            "/api/v2/pharmacy/controlled-substances/register",
            right_payload,
        )
        .await
    });
    let mut observed = (0_i64, 0_i64, 0_i64);
    tokio::time::timeout(std::time::Duration::from_secs(3),async {loop {
        // PostgreSQL may queue the second waiter behind the first, rather than
        // reporting both as directly blocked by our holder. Follow that actual
        // graph and require both requests to reach the intended user-lock SQL.
        observed=sqlx::query_as("WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid)) WHERE a.datname=current_database()) SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))),(SELECT count(*) FROM waiting),(SELECT count(*) FROM waiting w JOIN pg_stat_activity a USING(pid) WHERE a.query ILIKE '%users%' AND a.query ILIKE '%FOR NO KEY UPDATE%')")
            .bind(pid).fetch_one(&pool).await.unwrap();
        if observed.2>=2 {break;}
        assert!(!left.is_finished()&&!right.is_finished(),"reciprocal witness commands actually queue on the sorted user prefix");
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }}).await.unwrap_or_else(|_|panic!("reciprocal barrier: direct {}, transitive {}, intended user stage {}",observed.0,observed.1,observed.2));
    blocker.commit().await.unwrap();
    let (left, right) = tokio::time::timeout(std::time::Duration::from_secs(4), async {
        tokio::join!(left, right)
    })
    .await
    .expect("opposite witness pairs serialize without a user-lock cycle");
    checked(left.unwrap(), StatusCode::OK).await;
    checked(right.unwrap(), StatusCode::OK).await;
    assert_balances(app, &payload, 17).await;
}
