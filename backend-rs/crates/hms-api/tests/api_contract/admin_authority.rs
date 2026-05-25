use super::*;

#[tokio::test]
async fn admin_authority_workflows_are_permission_scoped_and_audited() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let limited_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/org-units?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admin denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let units = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/org-units?limit=5")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org units list succeeds");
    assert_eq!(units.status(), StatusCode::OK);
    let units_body = json_body(units).await;
    assert!(
        units_body["data"]
            .as_array()
            .expect("units are array")
            .len()
            <= 5
    );
    assert!(units_body["page"]["limit"].as_u64().unwrap() <= 5);

    let facility_units = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/org-units?unit_type=facility&is_active=true&limit=10")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("facility org units list succeeds");
    assert_eq!(facility_units.status(), StatusCode::OK);
    let facility_units_body = json_body(facility_units).await;
    let facility_units_data = facility_units_body["data"]
        .as_array()
        .expect("facility units are array");
    assert!(!facility_units_data.is_empty());
    assert!(facility_units_data.iter().all(|unit| {
        unit["unit_type"] == "facility" && unit["is_active"].as_bool() == Some(true)
    }));

    let org_unit = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/org-units")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_ADMIN",
                        "name": "Laboratory Administration",
                        "unit_type": "department",
                        "parent_unit_id": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("org unit create succeeds");
    assert_eq!(org_unit.status(), StatusCode::OK);
    let org_unit_body = json_body(org_unit).await;
    let org_unit_id = org_unit_body["data"]["id"].as_str().expect("org unit id");

    let org_unit_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admin/org-units/{org_unit_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org unit detail succeeds");
    assert_eq!(org_unit_detail.status(), StatusCode::OK);
    let org_unit_detail_body = json_body(org_unit_detail).await;
    assert_eq!(org_unit_detail_body["data"]["id"], org_unit_id);

    let child_org_unit = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/org-units")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_ADMIN_CHILD",
                        "name": "Laboratory Administration Child",
                        "unit_type": "service",
                        "parent_unit_id": org_unit_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("child org unit create succeeds");
    assert_eq!(child_org_unit.status(), StatusCode::OK);
    let child_org_unit_body = json_body(child_org_unit).await;
    let child_org_unit_id = child_org_unit_body["data"]["id"]
        .as_str()
        .expect("child org unit id");

    let grandchild_org_unit = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/org-units")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_ADMIN_GRANDCHILD",
                        "name": "Laboratory Administration Grandchild",
                        "unit_type": "ward",
                        "parent_unit_id": child_org_unit_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("grandchild org unit create succeeds");
    assert_eq!(grandchild_org_unit.status(), StatusCode::OK);
    let grandchild_org_unit_body = json_body(grandchild_org_unit).await;
    let grandchild_org_unit_id = grandchild_org_unit_body["data"]["id"]
        .as_str()
        .expect("grandchild org unit id");

    let org_unit_children = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/admin/org-units/{org_unit_id}/children?limit=5"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org unit children succeeds");
    assert_eq!(org_unit_children.status(), StatusCode::OK);
    let org_unit_children_body = json_body(org_unit_children).await;
    assert!(org_unit_children_body["data"]
        .as_array()
        .expect("org unit children are an array")
        .iter()
        .any(|child| child["id"] == child_org_unit_id));

    let org_unit_ancestors = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/admin/org-units/{grandchild_org_unit_id}/ancestors?limit=5"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org unit ancestors succeeds");
    assert_eq!(org_unit_ancestors.status(), StatusCode::OK);
    let org_unit_ancestors_body = json_body(org_unit_ancestors).await;
    let ancestor_ids: Vec<&str> = org_unit_ancestors_body["data"]
        .as_array()
        .expect("org unit ancestors are an array")
        .iter()
        .map(|ancestor| ancestor["id"].as_str().expect("ancestor id"))
        .collect();
    assert_eq!(ancestor_ids, vec![org_unit_id, child_org_unit_id]);

    let org_unit_descendants = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/admin/org-units/{org_unit_id}/descendants?limit=5"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org unit descendants succeeds");
    assert_eq!(org_unit_descendants.status(), StatusCode::OK);
    let org_unit_descendants_body = json_body(org_unit_descendants).await;
    let descendant_ids: Vec<&str> = org_unit_descendants_body["data"]
        .as_array()
        .expect("org unit descendants are an array")
        .iter()
        .map(|descendant| descendant["id"].as_str().expect("descendant id"))
        .collect();
    assert_eq!(
        descendant_ids,
        vec![child_org_unit_id, grandchild_org_unit_id]
    );

    let org_unit_detail_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admin/org-units/{org_unit_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org unit detail denial succeeds");
    assert_eq!(org_unit_detail_denied.status(), StatusCode::FORBIDDEN);

    let template = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/position-templates")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_MANAGER",
                        "title": "Laboratory Manager",
                        "description": "Manages laboratory workflow authority.",
                        "permission_codes": ["laboratory.order.manage", "laboratory.result.verify"]
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("position template create succeeds");
    assert_eq!(template.status(), StatusCode::OK);
    let template_body = json_body(template).await;
    let template_id = template_body["data"]["id"].as_str().expect("template id");

    let position = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/positions")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_MANAGER_01",
                        "title": "Laboratory Manager",
                        "org_unit_id": org_unit_id,
                        "template_id": template_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("position create succeeds");
    assert_eq!(position.status(), StatusCode::OK);
    let position_body = json_body(position).await;
    let position_id = position_body["data"]["id"].as_str().expect("position id");

    let appointment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/authority-appointments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "position_id": position_id,
                        "user_id": limited_id,
                        "appointment_type": "acting",
                        "starts_at": null,
                        "ends_at": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("authority appointment create succeeds");
    assert_eq!(appointment.status(), StatusCode::OK);

    let unsupported_ops_assignment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": limited_id,
                        "permission_code": "system.ops.view",
                        "scope_type": "facility",
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "ops_dashboard_platform_boundary_test"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("unsupported ops permission assignment request succeeds");
    let unsupported_ops_status = unsupported_ops_assignment.status();
    let unsupported_ops_body = json_body(unsupported_ops_assignment).await;
    assert_eq!(
        unsupported_ops_status,
        StatusCode::BAD_REQUEST,
        "{unsupported_ops_body}"
    );
    assert_eq!(
        unsupported_ops_body["error"]["code"],
        "unsupported_permission"
    );

    let assignment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": limited_id,
                        "permission_code": "dashboard.view",
                        "scope_type": "facility",
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "baseline_test"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("permission assignment create succeeds");
    assert_eq!(assignment.status(), StatusCode::OK);

    let committee = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/committees")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_QA",
                        "name": "Laboratory Quality Committee",
                        "mandate": "Reviews laboratory quality incidents and corrective actions."
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("committee create succeeds");
    assert_eq!(committee.status(), StatusCode::OK);

    let delegation = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/delegations")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "delegator_user_id": owner_id,
                        "delegate_user_id": limited_id,
                        "permission_code": "patient.demographics.view",
                        "starts_at": null,
                        "ends_at": null,
                        "reason": "Duty cover"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("delegation create succeeds");
    assert_eq!(delegation.status(), StatusCode::OK);

    let audit_events = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/audit-events?limit=10")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("audit list succeeds");
    assert_eq!(audit_events.status(), StatusCode::OK);
    let audit_body = json_body(audit_events).await;
    let event_types: Vec<_> = audit_body["data"]
        .as_array()
        .expect("audit events are array")
        .iter()
        .filter_map(|event| event["event_type"].as_str())
        .collect();
    assert!(event_types.contains(&"admin.permission_assignment.created"));
    assert!(event_types.contains(&"admin.delegation.created"));

    let filtered_audit_events = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/audit-events?limit=10&search=delegation&category=ADMIN&action=CREATE")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("filtered audit list succeeds");
    assert_eq!(filtered_audit_events.status(), StatusCode::OK);
    let filtered_audit_body = json_body(filtered_audit_events).await;
    let filtered_event_types: Vec<_> = filtered_audit_body["data"]
        .as_array()
        .expect("filtered audit events are array")
        .iter()
        .filter_map(|event| event["event_type"].as_str())
        .collect();
    assert_eq!(filtered_event_types, vec!["admin.delegation.created"]);
}
