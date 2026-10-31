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
        let app = app_with_imported_inventory(&[
            (Uuid::new_v4(), "SYN_IMPORTED_FLAG", "medication", true),
            (
                Uuid::new_v4(),
                "SYN_IMPORTED_TYPE",
                "controlled_substance",
                false,
            ),
        ])
        .await;
        Self::from_app(app).await
    }
    async fn from_app(app: TestApp) -> Self {
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
        if controlled != (kind == "controlled_substance") {
            let code = if controlled {
                "SYN_IMPORTED_FLAG"
            } else {
                "SYN_IMPORTED_TYPE"
            };
            let (id,actual_type,actual_flag):(Uuid,String,bool)=sqlx::query_as("SELECT id,item_type,controlled FROM inventory_items WHERE facility_id=$1 AND code=$2").bind(self.app.state().facility_id()).bind(code).fetch_one(&self.app.db_pool().await).await.unwrap();
            assert_eq!(
                (actual_type.as_str(), actual_flag),
                (kind, controlled),
                "genuine pre030 classification retained without rewriting"
            );
            return id;
        }
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
async fn receipt_refuses_both_imported_controlled_classifications_after_actual_item_wait() {
    let f = Fixture::new().await;
    let pool = f.app.db_pool().await;
    for (controlled, kind) in [(true, "medication"), (false, "controlled_substance")] {
        let item = f.item(controlled, kind).await;
        let refused =
            sqlx::query("UPDATE inventory_items SET controlled=$2,item_type='supply' WHERE id=$1")
                .bind(item)
                .bind(!controlled)
                .execute(&pool)
                .await
                .unwrap_err();
        assert_eq!(
            refused.as_database_error().unwrap().message(),
            "inventory_item_identity_immutable",
            "current classification rewrite is intrinsically refused"
        );
        let before = f.evidence().await;
        let mut classification = pool.begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *classification)
            .await
            .unwrap();
        sqlx::query("SELECT id FROM inventory_items WHERE id=$1 FOR UPDATE")
            .bind(item)
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
        .expect("actual receipt waits on retained imported controlled item");
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
async fn standing_issue_refuses_imported_type_only_controlled_request_without_moving_stock() {
    use hms_db::inventory::*;
    use hms_domain::inventory_standing::*;
    let item = Uuid::new_v4();
    let (app, request) = app_with_inventory_import(
        &[(item, "SYN_IMPORTED_STANDING", "medication", false)],
        move |pool, facility| async move {
            let actor = || TemplateActor {
                facility_id: facility,
                user_id: Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
                request_id: Some("synthetic-pre030-standing-import".into()),
            };
            let source = Uuid::from_u128(hms_db::provision::DEFAULT_MAIN_STORE_ID);
            let target = Uuid::from_u128(hms_db::provision::DEFAULT_PHARMACY_STORE_ID);
            create_batch(
                &pool,
                NewStockBatch {
                    authorization: None,
                    expected_unit: "unit".into(),
                    id: Uuid::new_v4(),
                    facility_id: facility,
                    item_id: item,
                    location_id: source,
                    batch_number: "SYN_IMPORTED_STANDING".into(),
                    expires_on: None,
                    quantity_received: 10,
                    actor_user_id: actor().user_id,
                },
            )
            .await
            .unwrap();
            let template = create_standing_template(
                &pool,
                actor(),
                CreateStandingTemplateRequest {
                    name: "Synthetic imported standing request".into(),
                    requesting_location_id: target,
                    fulfilling_location_id: source,
                    frequency: TemplateFrequency::Daily,
                    next_run_on: Utc::now().date_naive(),
                    monthly_day: None,
                    notes: None,
                    items: vec![StandingTemplateItemInput {
                        item_id: item,
                        quantity: 2,
                        expected_unit: "unit".into(),
                    }],
                },
            )
            .await
            .unwrap();
            let request = generate_standing_template_run(
                &pool,
                actor(),
                template.summary.id,
                GenerateStandingTemplateRequest {
                    expected_version: 1,
                    scheduled_for: template.summary.next_run_on,
                },
            )
            .await
            .unwrap()
            .unwrap();
            approve_standing_request(
                &pool,
                actor(),
                request.id,
                StandingRequestAction {
                    expected_source_version: 1,
                },
            )
            .await
            .unwrap()
            .unwrap();
            // Only this genuine pre030 import records the historical operator change.
            sqlx::query("UPDATE inventory_items SET item_type='controlled_substance' WHERE id=$1")
                .bind(item)
                .execute(&pool)
                .await
                .unwrap();
            request.id
        },
    )
    .await;
    let f = Fixture::from_app(app).await;
    let before = f.evidence().await;
    response(
        f.post(
            &format!("/api/v2/inventory/requisitions/{request}/issue"),
            json!({"expected_source_version":1}),
        )
        .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(
        f.evidence().await,
        before,
        "current issue of imported type-only demand cannot move stock or change evidence"
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

#[tokio::test]
async fn current_intrinsic_guard_refuses_contradictory_new_classifications_without_rows() {
    let f = Fixture::new().await;
    let pool = f.app.db_pool().await;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_items")
        .fetch_one(&pool)
        .await
        .unwrap();
    let before = f.evidence().await;
    for (controlled, kind) in [(true, "medication"), (false, "controlled_substance")] {
        let id = Uuid::new_v4();
        let error=sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,controlled)SELECT $1,$2,id,$3,'Synthetic refused new classification',$4,'unit',$5 FROM inventory_categories WHERE facility_id=$2 ORDER BY id LIMIT 1").bind(id).bind(f.app.state().facility_id()).bind(format!("SYN_REFUSED_{}",id.simple())).bind(kind).bind(controlled).execute(&pool).await.unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().message(),
            "inventory_item_invalid_source"
        );
    }
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_items")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(after, count);
    assert_eq!(f.evidence().await, before);
    let _ordinary = f.item(false, "medication").await;
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_items")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        after,
        count + 1,
        "independent current ordinary item positive remains supported"
    );
}
