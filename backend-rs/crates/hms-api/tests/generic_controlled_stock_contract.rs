mod support;
use support::*;

struct Fixture {
    app: TestApp,
    token: String,
    user: Uuid,
    locations: Vec<Uuid>,
}
impl Fixture {
    async fn new() -> Self {
        let app = app().await;
        let pool = app.db_pool().await;
        let user = Uuid::new_v4();
        sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,facility_id,'inventory-only@hms.local','Synthetic inventory actor',password_hash FROM users WHERE id=$2")
            .bind(user).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).execute(&pool).await.unwrap();
        for p in [
            PermissionCode::InventoryView,
            PermissionCode::InventoryManage,
            PermissionCode::PharmacyDispense,
            PermissionCode::PatientDemographicsView,
        ] {
            grant_test_permission(&app, user, p).await;
        }
        for f in [
            FeatureKey::Inventory,
            FeatureKey::Patients,
            FeatureKey::Pharmacy,
        ] {
            grant_test_feature(&app, user, f).await;
        }
        for v in [
            PatientDataVisibility::Demographics,
            PatientDataVisibility::Prescription,
        ] {
            grant_test_patient_visibility(&app, user, v).await;
        }
        let (token, _, _) = login(app.clone(), "inventory-only@hms.local").await;
        let account = hms_db::auth::user_by_id(&pool, user)
            .await
            .unwrap()
            .unwrap();
        assert!(account
            .permissions
            .iter()
            .all(|p| !hms_domain::auth::is_privileged_permission(p)));
        assert!(!account.auth_security.passkey_enrolled);
        let locations=sqlx::query_scalar("SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 2").bind(app.state().facility_id()).fetch_all(&pool).await.unwrap();
        Self {
            app,
            token,
            user,
            locations,
        }
    }
    async fn item(&self, controlled: bool, kind: &str) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,controlled) SELECT $1,$2,id,$3,'Synthetic stock fixture',$4,'unit',$5 FROM inventory_categories WHERE facility_id=$2 ORDER BY id LIMIT 1")
            .bind(id).bind(self.app.state().facility_id()).bind(format!("SYN_{}",id.simple())).bind(kind).bind(controlled).execute(&self.app.db_pool().await).await.unwrap();
        id
    }
    async fn post(&self, path: &str, body: Value) -> axum::response::Response {
        fixture_json_post(&self.app, Some(&self.token), path, body).await
    }
    async fn seed_stock(&self, item: Uuid, location: Uuid) {
        sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand,received_unit) VALUES(gen_random_uuid(),$1,$2,$3,'SYN_IMPORTED',10,'unit')")
            .bind(self.app.state().facility_id()).bind(item).bind(location).execute(&self.app.db_pool().await).await.unwrap();
    }
    async fn evidence(&self) -> Value {
        sqlx::query_scalar("SELECT jsonb_build_object('stock',(SELECT COALESCE(sum(quantity_on_hand),0) FROM stock_batches),'batches',(SELECT count(*) FROM stock_batches),'movements',(SELECT count(*) FROM stock_movements),'register',(SELECT count(*) FROM controlled_substance_register),'dispenses',(SELECT count(*) FROM pharmacy_dispenses),'supply',(SELECT count(*) FROM supply_request_dispenses),'allocations',(SELECT count(*) FROM stock_requisition_issue_allocations),'request_status',(SELECT jsonb_object_agg(id,status) FROM stock_requisitions),'audit',(SELECT count(*) FROM audit_events))")
            .fetch_one(&self.app.db_pool().await).await.unwrap()
    }
    fn template(&self, item: Uuid) -> Value {
        json!({"name":"Synthetic stock review","requesting_location_id":self.locations[0],"fulfilling_location_id":self.locations[1],"frequency":"daily","next_run_on":Utc::now().date_naive(),"monthly_day":null,"notes":null,"items":[{"item_id":item,"quantity":2,"expected_unit":"unit"}]})
    }
}

#[tokio::test]
async fn legacy_supply_rejects_more_than_one_hundred_lines_before_any_write() {
    let f = Fixture::new().await;
    let item = f.item(false, "medication").await;
    response(f.post("/api/v2/inventory/stock-batches",json!({"item_id":item,"location_id":f.locations[0],"expected_unit":"unit","batch_number":"SYN_BOUNDED","quantity_received":200,"expires_on":null})).await,StatusCode::OK).await;
    let request:Uuid=sqlx::query_scalar("INSERT INTO stock_requisitions(id,facility_id,requesting_location_id,status,created_by_user_id) VALUES(gen_random_uuid(),$1,$2,'approved',$3) RETURNING id")
        .bind(f.app.state().facility_id()).bind(f.locations[0]).bind(f.user).fetch_one(&f.app.db_pool().await).await.unwrap();
    let line = json!({"item_id":item,"location_id":f.locations[0],"quantity":1});
    let before = f.evidence().await;
    let denied = response(
        f.post(
            &format!("/api/v2/inventory/requisitions/{request}/dispense"),
            json!({"lines":vec![line;101]}),
        )
        .await,
        StatusCode::BAD_REQUEST,
    )
    .await;
    assert_eq!(
        denied["error"]["code"],
        "supply_request_line_limit_exceeded"
    );
    assert_eq!(
        f.evidence().await,
        before,
        "oversized supply leaves stock, request status and all evidence unchanged"
    );
}

#[tokio::test]
async fn receipt_rechecks_both_controlled_classifications_after_the_item_lock_wait() {
    let f = Fixture::new().await;
    let pool = f.app.db_pool().await;
    for (controlled, kind) in [(true, "medication"), (false, "controlled_substance")] {
        let item = f.item(false, "medication").await;
        let before = f.evidence().await;
        let mut classification = pool.begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *classification)
            .await
            .unwrap();
        sqlx::query("UPDATE inventory_items SET controlled=$2,item_type=$3 WHERE id=$1")
            .bind(item)
            .bind(controlled)
            .bind(kind)
            .execute(&mut *classification)
            .await
            .unwrap();
        let app = f.app.clone();
        let token = f.token.clone();
        let location = f.locations[0];
        let write = tokio::spawn(async move {
            fixture_json_post(
                &app,
                Some(&token),
                "/api/v2/inventory/stock-batches",
                json!({"item_id":item,"location_id":location,"expected_unit":"unit","batch_number":"SYN_WAIT","quantity_received":3,"expires_on":null}),
            )
            .await
        });
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT unit,controlled,item_type FROM inventory_items%')")
                    .bind(pid).fetch_one(&pool).await.unwrap();
                if waiting {
                    break;
                }
                assert!(!write.is_finished(), "receipt reaches the held item parent");
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("actual receipt waits for current item classification");
        classification.commit().await.unwrap();
        let denied = response(write.await.unwrap(), StatusCode::CONFLICT).await;
        assert_eq!(
            denied["error"]["code"],
            "controlled_stock_workflow_required"
        );
        assert_eq!(f.evidence().await, before);
    }
}

async fn response(response: axum::response::Response, status: StatusCode) -> Value {
    let actual = response.status();
    let body = json_body(response).await;
    assert_eq!(
        actual,
        status,
        "safe stock code {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    body
}

#[tokio::test]
async fn generic_receipt_cannot_bypass_either_controlled_classification() {
    let f = Fixture::new().await;
    for (controlled, kind) in [(true, "medication"), (false, "controlled_substance")] {
        let item = f.item(controlled, kind).await;
        let current = f
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v2/inventory/items/{item}"))
                    .header(AUTHORIZATION, format!("Bearer {}", f.token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let current = response(current, StatusCode::OK).await;
        assert_eq!(current["data"]["controlled"], true);
        assert_eq!(
            current["data"]["is_controlled"], true,
            "picker classification reflects both actual stored classifications"
        );
        let before = f.evidence().await;
        let denied=response(f.post("/api/v2/inventory/stock-batches",json!({"item_id":item,"location_id":f.locations[0],"expected_unit":"unit","batch_number":"SYN_DENIED","quantity_received":5,"expires_on":null})).await,StatusCode::CONFLICT).await;
        assert_eq!(
            denied["error"]["code"],
            "controlled_stock_workflow_required"
        );
        assert_eq!(
            f.evidence().await,
            before,
            "unsupported controlled receipt writes no physical/register/audit evidence"
        );
    }
    let ordinary = f.item(false, "medication").await;
    response(f.post("/api/v2/inventory/stock-batches",json!({"item_id":ordinary,"location_id":f.locations[0],"expected_unit":"unit","batch_number":"SYN_ALLOWED","quantity_received":5,"expires_on":null})).await,StatusCode::OK).await;
}

#[tokio::test]
async fn legacy_supply_cannot_deduct_controlled_stock_outside_its_register() {
    let f = Fixture::new().await;
    for (controlled, kind) in [
        (true, "medication"),
        (false, "controlled_substance"),
        (false, "medication"),
    ] {
        let item = f.item(controlled, kind).await;
        f.seed_stock(item, f.locations[0]).await;
        let requisition:Uuid=sqlx::query_scalar("INSERT INTO stock_requisitions(id,facility_id,requesting_location_id,status,created_by_user_id) VALUES(gen_random_uuid(),$1,$2,'approved',$3) RETURNING id")
            .bind(f.app.state().facility_id()).bind(f.locations[0]).bind(f.user).fetch_one(&f.app.db_pool().await).await.unwrap();
        let before = f.evidence().await;
        let result = f
            .post(
                &format!("/api/v2/inventory/requisitions/{requisition}/dispense"),
                json!({"lines":[{"item_id":item,"location_id":f.locations[0],"quantity":2}]}),
            )
            .await;
        if controlled || kind == "controlled_substance" {
            let denied = response(result, StatusCode::CONFLICT).await;
            assert_eq!(
                denied["error"]["code"],
                "controlled_stock_workflow_required"
            );
            assert_eq!(
                f.evidence().await,
                before,
                "rejected supply preserves request status and all physical evidence"
            );
        } else {
            response(result, StatusCode::OK).await;
        }
    }
}

#[tokio::test]
async fn standing_configuration_rejects_type_only_controlled_items() {
    let f = Fixture::new().await;
    let forbidden = f.item(false, "controlled_substance").await;
    let before = f.evidence().await;
    response(
        f.post(
            "/api/v2/inventory/standing-order-templates",
            f.template(forbidden),
        )
        .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(f.evidence().await, before);
}

#[tokio::test]
async fn standing_issue_rechecks_type_only_controlled_classification() {
    let f = Fixture::new().await;
    let item = f.item(false, "medication").await;
    f.seed_stock(item, f.locations[1]).await;
    let created = response(
        f.post(
            "/api/v2/inventory/standing-order-templates",
            f.template(item),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let id = created["data"]["id"].as_str().unwrap();
    let request = response(
        f.post(
            &format!("/api/v2/inventory/standing-order-templates/{id}/runs"),
            json!({"expected_version":1,"scheduled_for":Utc::now().date_naive()}),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let request_id = request["data"]["id"].as_str().unwrap();
    let action = json!({"expected_source_version":1});
    response(
        f.post(
            &format!("/api/v2/inventory/requisitions/{request_id}/review/approve"),
            action.clone(),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    // Represents a populated legacy/operator classification, not a supported
    // public recategorization command. Issue must recheck actual locked rows.
    sqlx::query("UPDATE inventory_items SET item_type='controlled_substance' WHERE id=$1")
        .bind(item)
        .execute(&f.app.db_pool().await)
        .await
        .unwrap();
    let before = f.evidence().await;
    response(
        f.post(
            &format!("/api/v2/inventory/requisitions/{request_id}/issue"),
            action,
        )
        .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(
        f.evidence().await,
        before,
        "live type-only change cannot silently move stock"
    );
}

#[tokio::test]
async fn generic_manual_pharmacy_uses_the_same_definite_controlled_denial() {
    let f = Fixture::new().await;
    let patient:Uuid=sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND record_status='registered' ORDER BY id LIMIT 1").bind(f.app.state().facility_id()).fetch_one(&f.app.db_pool().await).await.unwrap();
    for (controlled, kind) in [
        (true, "medication"),
        (false, "controlled_substance"),
        (false, "medication"),
    ] {
        let item = f.item(controlled, kind).await;
        f.seed_stock(item, f.locations[0]).await;
        let before = f.evidence().await;
        let result=f.post("/api/v2/pharmacy/dispenses",json!({"patient_id":patient,"item_id":item,"location_id":f.locations[0],"quantity":1})).await;
        if controlled || kind == "controlled_substance" {
            let denied = response(result, StatusCode::CONFLICT).await;
            assert_eq!(
                denied["error"]["code"],
                "controlled_stock_workflow_required"
            );
            assert_eq!(f.evidence().await, before);
        } else {
            response(result, StatusCode::OK).await;
        }
    }
}
