//! Actual supported privileged HTTP requests; no fabricated assurance evidence.
use super::*;
use axum::response::Response;

#[derive(Clone)]
pub(super) struct Operation {
    pub name: &'static str,
    pub method: Method,
    pub path: String,
    pub body: Option<Value>,
}
impl Operation {
    pub async fn send(&self, app: &TestApp, token: &str) -> Response {
        let mut request = Request::builder()
            .method(self.method.clone())
            .uri(&self.path)
            .header(AUTHORIZATION, format!("Bearer {token}"));
        if self.body.is_some() {
            request = request.header("content-type", "application/json");
        }
        app.clone()
            .oneshot(
                request
                    .body(
                        self.body
                            .as_ref()
                            .map(|v| Body::from(v.to_string()))
                            .unwrap_or_else(Body::empty),
                    )
                    .unwrap(),
            )
            .await
            .unwrap()
    }
}
pub(super) struct Matrix {
    pub app: TestApp,
    pub operations: Vec<Operation>,
    pub result: Uuid,
    pub discharge: Uuid,
}
impl Matrix {
    pub async fn new() -> Self {
        let app = app().await;
        let pool = app.db_pool().await;
        let facility = app.state().facility_id();
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        for permission in [
            PermissionCode::AdminAuthorityManage,
            PermissionCode::AdminFeatureEntitlementsManage,
            PermissionCode::AdminStaffManage,
            PermissionCode::SystemOpsView,
            PermissionCode::ControlledSubstanceManage,
            PermissionCode::LaboratoryResultVerify,
            PermissionCode::BillingManage,
            PermissionCode::NhisClaimManage,
            PermissionCode::ConsentManage,
            PermissionCode::PatientBreakGlassInvoke,
        ] {
            grant_test_permission(&app, owner, permission).await;
        }
        for visibility in [
            PatientDataVisibility::FullClinical,
            PatientDataVisibility::Laboratory,
            PatientDataVisibility::Prescription,
            PatientDataVisibility::Billing,
        ] {
            grant_test_patient_visibility(&app, owner, visibility).await;
        }
        let patient:Uuid=sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND record_status='registered' AND vital_status<>'deceased' ORDER BY id LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
        let item:Uuid=sqlx::query_scalar("SELECT id FROM inventory_items WHERE facility_id=$1 AND controlled AND is_active ORDER BY id LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
        let location:Uuid=sqlx::query_scalar("SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
        let target = Uuid::new_v4();
        let supervisor = Uuid::new_v4();
        let staff = Uuid::new_v4();
        for (id, email) in [
            (target, "factor-target@hms.local"),
            (supervisor, "factor-supervisor@hms.local"),
        ] {
            sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,facility_id,$2,'Synthetic factor fixture',password_hash FROM users WHERE id=$3").bind(id).bind(email).bind(owner).execute(&pool).await.unwrap();
        }
        sqlx::query(
            "INSERT INTO user_permissions(user_id,permission_code) VALUES($1,'billing.manage')",
        )
        .bind(supervisor)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES($1,$2,$3,'SYN_FACTOR','Synthetic','Synthetic',CURRENT_DATE)").bind(staff).bind(facility).bind(target).execute(&pool).await.unwrap();
        let invoice = Uuid::new_v4();
        let claim = Uuid::new_v4();
        let payment = Uuid::new_v4();
        sqlx::query("INSERT INTO invoices(id,facility_id,patient_id,invoice_number,status,gross_amount_minor,paid_amount_minor,issued_by_user_id) VALUES($1,$2,$3,'SYN_FACTOR','partially_paid',1000,100,$4)").bind(invoice).bind(facility).bind(patient).bind(owner).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO payments(id,facility_id,invoice_id,receipt_number,amount_minor,method,status,recorded_by_user_id) VALUES($1,$2,$3,'SYN_FACTOR',100,'cash','posted',$4)").bind(payment).bind(facility).bind(invoice).bind(owner).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO nhis_claims(id,facility_id,invoice_id,patient_id,claim_number,status,amount_minor,payer_receivable_minor,created_by_user_id) VALUES($1,$2,$3,$4,'SYN_FACTOR','draft',100,100,$5)").bind(claim).bind(facility).bind(invoice).bind(patient).bind(owner).execute(&pool).await.unwrap();
        let consent = Uuid::new_v4();
        sqlx::query("INSERT INTO consent_grants(id,facility_id,patient_id,scope,purpose,status,created_by_user_id) VALUES($1,$2,$3,'internal_care_team','Synthetic factor review','active',$4)").bind(consent).bind(facility).bind(patient).bind(owner).execute(&pool).await.unwrap();
        let order = Uuid::new_v4();
        sqlx::query("INSERT INTO lab_orders(id,facility_id,patient_id,priority,status,ordered_by_user_id) VALUES($1,$2,$3,'routine','result_entered',$4)").bind(order).bind(facility).bind(patient).bind(owner).execute(&pool).await.unwrap();
        let test: Uuid = sqlx::query_scalar(
            "SELECT id FROM lab_tests WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1",
        )
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO lab_order_tests(order_id,test_id) VALUES($1,$2)")
            .bind(order)
            .bind(test)
            .execute(&pool)
            .await
            .unwrap();
        let mut results = Vec::new();
        for _ in 0..2 {
            let specimen = Uuid::new_v4();
            let result = Uuid::new_v4();
            sqlx::query("INSERT INTO lab_specimens(id,facility_id,order_id,patient_id,specimen_type,status,collected_by_user_id) VALUES($1,$2,$3,$4,'blood','received',$5)").bind(specimen).bind(facility).bind(order).bind(patient).bind(owner).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO lab_results(id,facility_id,order_id,specimen_id,patient_id,test_id,value,status,entered_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'12','entered',$7)").bind(result).bind(facility).bind(order).bind(specimen).bind(patient).bind(test).bind(owner).execute(&pool).await.unwrap();
            results.push(result);
        }
        let ward: Uuid = sqlx::query_scalar(
            "SELECT id FROM wards WHERE facility_id=$1 AND status='active' ORDER BY id LIMIT 1",
        )
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
        let case:Option<Uuid>=sqlx::query_scalar("SELECT id FROM admission_cases WHERE facility_id=$1 AND patient_id=$2 AND status IN ('admitted','discharge_pending') ORDER BY id LIMIT 1").bind(facility).bind(patient).fetch_optional(&pool).await.unwrap();
        let case = if let Some(case) = case {
            case
        } else {
            sqlx::query_scalar("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES(gen_random_uuid(),$1,$2,$3,'admitted') RETURNING id").bind(facility).bind(patient).bind(ward).fetch_one(&pool).await.unwrap()
        };
        let discharge:Uuid=sqlx::query_scalar("INSERT INTO discharge_cases(id,facility_id,admission_case_id,patient_id,status,created_by_user_id) VALUES(gen_random_uuid(),$1,$2,$3,'requested',$4) ON CONFLICT(admission_case_id) DO UPDATE SET status='requested' RETURNING id").bind(facility).bind(case).bind(patient).bind(owner).fetch_one(&pool).await.unwrap();
        let operations = vec![
            Operation {
                name: "authority template",
                method: Method::POST,
                path: "/api/v2/admin/position-templates".into(),
                body: Some(
                    json!({"code":"SYN_FACTOR","title":"Synthetic factor template","description":"Synthetic","permission_codes":["patient.create"]}),
                ),
            },
            Operation {
                name: "feature entitlement",
                method: Method::PATCH,
                path: "/api/v2/admin/features/nursing".into(),
                body: Some(json!({"enabled":true})),
            },
            Operation {
                name: "staff deactivation",
                method: Method::POST,
                path: format!("/api/v2/admin/staff/{staff}/deactivate"),
                body: None,
            },
            Operation {
                name: "HMS Ops",
                method: Method::GET,
                path: "/api/v2/ops/overview".into(),
                body: None,
            },
            Operation {
                name: "controlled receipt",
                method: Method::POST,
                path: "/api/v2/pharmacy/controlled-substances/register".into(),
                body: Some(
                    json!({"item_id":item,"location_id":location,"movement_type":"receipt","quantity_delta":10,"witness_user_id":null}),
                ),
            },
            Operation {
                name: "laboratory verify",
                method: Method::POST,
                path: format!("/api/v2/laboratory/results/{}/verify", results[0]),
                body: None,
            },
            Operation {
                name: "laboratory bulk verify",
                method: Method::POST,
                path: "/api/v2/laboratory/results/bulk-verify".into(),
                body: Some(
                    json!({"result_ids":[results[1]],"order_id":null,"verification_notes":null}),
                ),
            },
            Operation {
                name: "billing finalization",
                method: Method::POST,
                path: format!("/api/v2/billing/invoices/{invoice}/finalize"),
                body: Some(
                    json!({"approval":{"supervisor_user_id":supervisor,"reason":"Synthetic reviewed approval"}}),
                ),
            },
            Operation {
                name: "payment reversal",
                method: Method::POST,
                path: format!("/api/v2/billing/payments/{payment}/reverse"),
                body: Some(
                    json!({"reversal_kind":"refund","amount_minor":1,"approval":{"supervisor_user_id":supervisor,"reason":"Synthetic reviewed correction"}}),
                ),
            },
            Operation {
                name: "NHIS receivable adjustment",
                method: Method::POST,
                path: format!("/api/v2/nhis/claims/{claim}/ar-adjustments"),
                body: Some(
                    json!({"adjustment_kind":"adjustment","amount_minor":1,"reason":"Synthetic reviewed adjustment"}),
                ),
            },
            Operation {
                name: "consent creation",
                method: Method::POST,
                path: "/api/v2/consents".into(),
                body: Some(
                    json!({"patient_id":patient,"scope":"referral_coordination","purpose":"Synthetic reviewed coordination","expires_at":Utc::now()+Duration::days(1)}),
                ),
            },
            Operation {
                name: "consent revocation",
                method: Method::POST,
                path: format!("/api/v2/consents/{consent}/revoke"),
                body: None,
            },
            Operation {
                name: "discharge blocker override",
                method: Method::POST,
                path: format!("/api/v2/discharges/{discharge}/blockers/override"),
                body: Some(
                    json!({"blocker_type":"discharge_summary","reason":"Synthetic reviewed override"}),
                ),
            },
            Operation {
                name: "break glass",
                method: Method::POST,
                path: format!("/api/v2/patients/{patient}/break-glass"),
                body: Some(json!({"category":"life_threatening_emergency","reason_text":null})),
            },
        ];
        Self {
            app,
            operations,
            result: results[0],
            discharge,
        }
    }
    /// Only business status/counts and stock quantities; never narrative or authentication secrets.
    pub async fn evidence(&self) -> Value {
        sqlx::query_scalar("SELECT jsonb_build_object('templates',(SELECT count(*) FROM position_templates),'features',(SELECT jsonb_object_agg(feature_key,enabled) FROM facility_feature_entitlements),'active_staff',(SELECT count(*) FROM users WHERE is_active),'controlled_rows',(SELECT count(*) FROM controlled_substance_register),'physical_stock',(SELECT COALESCE(sum(quantity_on_hand),0) FROM stock_batches),'stock_movements',(SELECT count(*) FROM stock_movements),'verified_results',(SELECT count(*) FROM lab_results WHERE verified_at IS NOT NULL),'finalized_invoices',(SELECT count(*) FROM invoices WHERE finalized_at IS NOT NULL),'reversals',(SELECT count(*) FROM payment_reversal_ledger),'adjustments',(SELECT count(*) FROM nhis_claim_ar_adjustments),'claim_receivable',(SELECT COALESCE(sum(payer_receivable_minor),0) FROM nhis_claims),'paid_amount',(SELECT COALESCE(sum(paid_amount_minor),0) FROM invoices),'consents',(SELECT count(*) FROM consent_grants),'revoked_consents',(SELECT count(*) FROM consent_grants WHERE revoked_at IS NOT NULL),'emergency_grants',(SELECT count(*) FROM patient_break_glass_grants),'discharge_overrides',(SELECT count(*) FROM discharge_blocker_overrides))")
            .fetch_one(&self.app.db_pool().await).await.expect("minimal business evidence reads")
    }
    pub async fn deny_all(&self, token: &str, stage: &'static str) {
        let before = self.evidence().await;
        for operation in &self.operations {
            let response = operation.send(&self.app, token).await;
            let status = response.status();
            let body = json_body(response).await;
            let code = body["error"]["code"].as_str().unwrap_or("no_typed_error");
            assert_eq!(
                status,
                StatusCode::FORBIDDEN,
                "{} {stage}; error code {code}",
                operation.name
            );
            assert_eq!(
                self.evidence().await,
                before,
                "{} {stage} must have no business effects",
                operation.name
            );
        }
    }
}
