//! Synthetic category commands cross the same proof-bearing repository as production.
#[path = "support_item_governance/mod.rs"]
mod governed;
use hms_db::{inventory::category_governance as categories, test_support::TestDb, PgPool};
use hms_domain::inventory_categories::*;
use uuid::Uuid;
async fn read_actor(pool: &PgPool, facility: Uuid) -> categories::InventoryCategoryReadActor {
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code)VALUES($1,'inventory.view') ON CONFLICT DO NOTHING")
        .bind(user).execute(pool).await.unwrap();
    let writer = governed::actor(pool, facility).await;
    let mut authorization = writer.authorization;
    authorization.ordinary_reauth_required = false;
    authorization.original_password_verified_at = None;
    authorization.valid_until = sqlx::query_scalar("SELECT LEAST(expires_at,idle_expires_at,absolute_expires_at) FROM refresh_sessions WHERE session_id=$1")
        .bind(authorization.session_id).fetch_one(pool).await.unwrap();
    categories::InventoryCategoryReadActor {
        facility_id: facility,
        user_id: writer.user_id,
        request_id: writer.request_id,
        authorization,
    }
}
async fn create(
    pool: &PgPool,
    f: Uuid,
    code: &str,
    parent: Option<&GovernedInventoryCategory>,
) -> InventoryCategoryCommandReceipt {
    categories::command(
        pool,
        governed::actor(pool, f).await,
        InventoryCategoryReviewedInput::Create {
            client_request_id: Uuid::new_v4(),
            code: code.into(),
            name: "Synthetic category".into(),
            description: None,
            parent: parent.map(|p| InventoryCategoryParentSelection {
                parent_id: p.id,
                expected_parent_version: p.version,
            }),
        },
    )
    .await
    .unwrap()
}
fn correct(
    c: &GovernedInventoryCategory,
    name: &str,
    parent_change: InventoryCategoryParentChange,
) -> InventoryCategoryReviewedInput {
    InventoryCategoryReviewedInput::Correct {
        client_request_id: Uuid::new_v4(),
        category_id: c.id,
        expected_version: c.version,
        name: name.into(),
        description: c.description.clone(),
        parent_change,
        reason: "Synthetic reviewed metadata correction".into(),
    }
}
fn error(e: anyhow::Error, expected: categories::InventoryCategoryError) {
    assert_eq!(
        e.downcast_ref::<categories::InventoryCategoryError>(),
        Some(&expected)
    );
}
#[tokio::test]
async fn category25_original_receipts_replay_before_later_cas_noops_and_history_hide_private_actor_reason(
) {
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let actor = governed::actor(p, f).await;
    let created = create(p, f, "S25_REPLAY", None).await;
    let input = correct(
        &created.category,
        "Reviewed current category",
        InventoryCategoryParentChange::Retain,
    );
    let changed = categories::command(p, actor.clone(), input.clone())
        .await
        .unwrap();
    assert!(changed.changed);
    assert_eq!(changed.category.version, 2);
    assert_eq!(
        changed.category.catalog_changed_at,
        Some(changed.recorded_at)
    );
    let noop = categories::command(
        p,
        actor.clone(),
        correct(
            &changed.category,
            &changed.category.name,
            InventoryCategoryParentChange::Retain,
        ),
    )
    .await
    .unwrap();
    assert!(!noop.changed);
    assert_eq!(noop.category.version, 2);
    assert_eq!(
        noop.category.catalog_changed_at,
        changed.category.catalog_changed_at
    );
    let later = categories::command(
        p,
        actor.clone(),
        correct(
            &noop.category,
            "Later category name",
            InventoryCategoryParentChange::Retain,
        ),
    )
    .await
    .unwrap();
    assert_eq!(later.category.version, 3);
    let replay = categories::command(p, actor.clone(), input).await.unwrap();
    assert_eq!(
        serde_json::to_value(replay).unwrap(),
        serde_json::to_value(&changed).unwrap()
    );
    let receipt = categories::receipt(p, actor.clone(), changed.client_request_id)
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(receipt).unwrap(),
        serde_json::to_value(&changed).unwrap()
    );
    let history = categories::history(p, read_actor(p, f).await, created.category.id, None, 101)
        .await
        .unwrap();
    assert_eq!(history.len(), 4);
    let value = serde_json::to_value(history).unwrap().to_string();
    assert!(!value.contains("recorded_by_user_id"));
    assert!(!value.contains("Synthetic reviewed metadata correction"));
    assert!(!value.contains("created_by_user_id"));
    let counts:(i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM inventory_category_commands WHERE category_id=$1),(SELECT count(*) FROM audit_events WHERE resource_type='inventory_category' AND resource_id=$1)").bind(created.category.id).fetch_one(p).await.unwrap();
    assert_eq!(counts, (4, 4));
    let stale = correct(
        &created.category,
        "Rejected stale state",
        InventoryCategoryParentChange::Retain,
    );
    error(
        categories::command(p, actor, stale).await.unwrap_err(),
        categories::InventoryCategoryError::VersionConflict,
    );
}
#[tokio::test]
async fn category25_used_rename_and_parent_relink_do_not_move_items_and_lifecycle_uses_all_retained_references(
) {
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let actor = governed::actor(p, f).await;
    let parent = create(p, f, "S25_PARENT", None).await.category;
    let c = create(p, f, "S25_USED", None).await.category;
    let item = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,is_active)VALUES($1,$2,$3,'S25_USED_ITEM','Synthetic retained item','supply','piece',false)").bind(item).bind(f).bind(c.id).execute(p).await.unwrap();
    let renamed = categories::command(
        p,
        actor.clone(),
        correct(
            &c,
            "Used category correction",
            InventoryCategoryParentChange::Set {
                parent_id: parent.id,
                expected_parent_version: parent.version,
            },
        ),
    )
    .await
    .unwrap();
    assert_eq!(renamed.category.parent_id, Some(parent.id));
    let retained: Uuid = sqlx::query_scalar("SELECT category_id FROM inventory_items WHERE id=$1")
        .bind(item)
        .fetch_one(p)
        .await
        .unwrap();
    assert_eq!(retained, c.id);
    let blocked = categories::command(
        p,
        actor.clone(),
        InventoryCategoryReviewedInput::Retire {
            client_request_id: Uuid::new_v4(),
            category_id: c.id,
            expected_version: renamed.category.version,
        },
    )
    .await
    .unwrap_err();
    error(blocked, categories::InventoryCategoryError::ItemReference);
    let blocked = categories::command(
        p,
        actor.clone(),
        InventoryCategoryReviewedInput::Retire {
            client_request_id: Uuid::new_v4(),
            category_id: parent.id,
            expected_version: parent.version,
        },
    )
    .await
    .unwrap_err();
    error(blocked, categories::InventoryCategoryError::ChildReference);
    let cleared = categories::command(
        p,
        actor.clone(),
        correct(
            &renamed.category,
            &renamed.category.name,
            InventoryCategoryParentChange::Clear,
        ),
    )
    .await
    .unwrap();
    assert!(cleared.category.parent_id.is_none());
    // Old immutable observations are not a current child pointer.
    let retired = categories::command(
        p,
        actor.clone(),
        InventoryCategoryReviewedInput::Retire {
            client_request_id: Uuid::new_v4(),
            category_id: parent.id,
            expected_version: parent.version,
        },
    )
    .await
    .unwrap();
    assert!(!retired.category.is_active);
    let replay = categories::receipt(p, actor, renamed.client_request_id)
        .await
        .unwrap();
    assert_eq!(replay.category.parent.unwrap().id, parent.id);
    assert!(replay.category.parent_id.is_some());
}
#[tokio::test]
async fn category25_complete_parent_chain_cycle_depth_and_exact_version_are_retained() {
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let actor = governed::actor(p, f).await;
    let root = create(p, f, "S25_CHAIN_ROOT", None).await.category;
    let child = create(p, f, "S25_CHAIN_CHILD", Some(&root)).await.category;
    error(
        categories::command(
            p,
            actor.clone(),
            correct(
                &root,
                &root.name,
                InventoryCategoryParentChange::Set {
                    parent_id: child.id,
                    expected_parent_version: child.version,
                },
            ),
        )
        .await
        .unwrap_err(),
        categories::InventoryCategoryError::InvalidSource,
    );
    error(
        categories::command(
            p,
            actor.clone(),
            correct(
                &child,
                &child.name,
                InventoryCategoryParentChange::Set {
                    parent_id: root.id,
                    expected_parent_version: root.version + 1,
                },
            ),
        )
        .await
        .unwrap_err(),
        categories::InventoryCategoryError::InvalidSource,
    );
    let mut chain = root;
    for n in 1..=64 {
        chain = create(p, f, &format!("S25_CHAIN_{n:03}"), Some(&chain))
            .await
            .category;
    }
    let input = InventoryCategoryReviewedInput::Create {
        client_request_id: Uuid::new_v4(),
        code: "S25_CHAIN_OVERFLOW".into(),
        name: "Overflow refuses".into(),
        description: None,
        parent: Some(InventoryCategoryParentSelection {
            parent_id: chain.id,
            expected_parent_version: chain.version,
        }),
    };
    error(
        categories::command(p, actor, input).await.unwrap_err(),
        categories::InventoryCategoryError::InvalidSource,
    );
}
#[tokio::test]
async fn category25_intrinsic_graph_and_item_share_locks_refuse_partial_lifecycle_or_cycle() {
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let c = create(p, f, "S25_LOCK", None).await.category;
    let actor = governed::actor(p, f).await;
    let mut held = p.begin().await.unwrap();
    sqlx::query("SELECT inventory_category_graph_gate($1)")
        .bind(f)
        .execute(&mut *held)
        .await
        .unwrap();
    error(
        categories::command(
            p,
            actor.clone(),
            correct(
                &c,
                "Must refuse busy graph",
                InventoryCategoryParentChange::Retain,
            ),
        )
        .await
        .unwrap_err(),
        categories::InventoryCategoryError::Busy,
    );
    held.rollback().await.unwrap();
    let mut held = p.begin().await.unwrap();
    sqlx::query("SELECT id FROM inventory_categories WHERE id=$1 FOR SHARE")
        .bind(c.id)
        .fetch_one(&mut *held)
        .await
        .unwrap();
    error(
        categories::command(
            p,
            actor.clone(),
            InventoryCategoryReviewedInput::Retire {
                client_request_id: Uuid::new_v4(),
                category_id: c.id,
                expected_version: c.version,
            },
        )
        .await
        .unwrap_err(),
        categories::InventoryCategoryError::Busy,
    );
    held.rollback().await.unwrap();
    let current = categories::detail(p, read_actor(p, f).await, c.id)
        .await
        .unwrap()
        .unwrap()
        .category;
    assert_eq!(current.version, c.version);
    assert!(current.is_active);
    let mut held = p.begin().await.unwrap();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit)VALUES($1,$2,$3,'S25_PENDING_ITEM','Synthetic pending item','supply','piece')").bind(Uuid::new_v4()).bind(f).bind(c.id).execute(&mut *held).await.unwrap();
    error(
        categories::command(
            p,
            actor,
            InventoryCategoryReviewedInput::Retire {
                client_request_id: Uuid::new_v4(),
                category_id: c.id,
                expected_version: c.version,
            },
        )
        .await
        .unwrap_err(),
        categories::InventoryCategoryError::Busy,
    );
    held.rollback().await.unwrap();
}
#[tokio::test]
async fn category25_new_limits_unicode_controls_description_distinctions_and_audit_failure_are_atomic(
) {
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let actor = governed::actor(p, f).await;
    let mut input = InventoryCategoryReviewedInput::Create {
        client_request_id: Uuid::new_v4(),
        code: " S25_UNICODE ".into(),
        name: "é".repeat(100),
        description: Some("\t\n\r".into()),
        parent: None,
    };
    let c = categories::command(p, actor.clone(), input.clone())
        .await
        .unwrap();
    assert_eq!(c.category.code, "S25_UNICODE");
    assert_eq!(c.category.name.chars().count(), 100);
    assert_eq!(c.category.description, Some("\t\n\r".into()));
    if let InventoryCategoryReviewedInput::Create {
        client_request_id,
        name,
        ..
    } = &mut input
    {
        *client_request_id = Uuid::new_v4();
        *name = "é".repeat(101)
    }
    error(
        categories::command(p, actor.clone(), input)
            .await
            .unwrap_err(),
        categories::InventoryCategoryError::Invalid,
    );
    let mut update = correct(
        &c.category,
        &c.category.name,
        InventoryCategoryParentChange::Retain,
    );
    if let InventoryCategoryReviewedInput::Correct { description, .. } = &mut update {
        *description = Some(String::new())
    }
    let empty = categories::command(p, actor.clone(), update).await.unwrap();
    assert_eq!(empty.category.description, Some(String::new()));
    let bad = InventoryCategoryReviewedInput::Create {
        client_request_id: Uuid::new_v4(),
        code: "S25_CONTROL".into(),
        name: "Synthetic name".into(),
        description: Some("unsafe\u{0085}".into()),
        parent: None,
    };
    error(
        categories::command(p, actor.clone(), bad)
            .await
            .unwrap_err(),
        categories::InventoryCategoryError::Invalid,
    );
    sqlx::query("CREATE FUNCTION synthetic_category_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.resource_type='inventory_category' THEN RAISE EXCEPTION 'synthetic_audit_failure';END IF;RETURN NEW;END$$").execute(p).await.unwrap();
    sqlx::query("CREATE TRIGGER synthetic_category_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_category_audit_failure()").execute(p).await.unwrap();
    let update = correct(
        &empty.category,
        "Must roll back",
        InventoryCategoryParentChange::Retain,
    );
    let key = match &update {
        InventoryCategoryReviewedInput::Correct {
            client_request_id, ..
        } => *client_request_id,
        _ => unreachable!(),
    };
    assert!(categories::command(p, actor.clone(), update).await.is_err());
    let current = categories::detail(p, read_actor(p, f).await, empty.category.id)
        .await
        .unwrap()
        .unwrap()
        .category;
    assert_eq!(current.name, empty.category.name);
    assert_eq!(current.version, empty.category.version);
    error(
        categories::receipt(p, actor, key).await.unwrap_err(),
        categories::InventoryCategoryError::NotFound,
    );
}
#[tokio::test]
async fn category25_directory_detail_history_have_constant_queries_and_bounded_pages() {
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name)SELECT gen_random_uuid(),$1,'S25_PAGE_'||lpad(n::text,4,'0'),'Synthetic bounded category' FROM generate_series(1,1000)n").bind(f).execute(p).await.unwrap();
    let c = create(p, f, "S25_PAGE_HISTORY", None).await.category;
    let reader = read_actor(p, f).await;
    for limit in [1, 25, 100] {
        let (rows, count) = hms_observability::with_request_query_counter(categories::list(
            p,
            reader.clone(),
            None,
            limit,
            InventoryCategoryAdministrationQuery::default(),
        ))
        .await;
        assert_eq!(rows.unwrap().len(), limit as usize);
        assert_eq!(count, 11);
        let (rows, count) = hms_observability::with_request_query_counter(categories::history(
            p,
            reader.clone(),
            c.id,
            None,
            limit,
        ))
        .await;
        assert_eq!(rows.unwrap().len(), 1);
        assert_eq!(count, 12);
    }
    let (_, count) =
        hms_observability::with_request_query_counter(categories::detail(p, reader.clone(), c.id))
            .await;
    assert_eq!(count, 12);
    let mut seen = std::collections::HashSet::new();
    let mut cursor = None;
    loop {
        let rows = categories::list(
            p,
            reader.clone(),
            cursor,
            100,
            InventoryCategoryAdministrationQuery {
                search: Some("S25_PAGE_".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        for c in &rows {
            assert!(seen.insert(c.id))
        }
        if rows.len() < 100 {
            break;
        }
        let last = rows.last().unwrap();
        cursor = Some(hms_db::inventory::InventoryCursor {
            occurred_at: last.created_at,
            id: last.id,
        });
    }
    assert_eq!(seen.len(), 1001);
}
fn through030() -> sqlx::migrate::Migrator {
    sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610310031)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    }
}
#[tokio::test]
async fn category25_actual030_import_preserves_legacy_text_and_unknown_provenance_for_unrelated_correction(
) {
    let db = TestDb::with_profile_and_migrator(
        hms_domain::deployment::DeploymentProfile::Hospital,
        &through030(),
    )
    .await
    .unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let id = Uuid::new_v4();
    // This is an honest030 import. No031 guard is disabled or bypassed.
    sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name,is_active,created_at)VALUES($1,$2,'  RETAINED LEGACY CODE  ',$3,false,'2001-01-02T03:04:05Z')").bind(id).bind(f).bind(" ".repeat(200)).execute(p).await.unwrap();
    hms_db::migrate::run(p).await.unwrap();
    let c = categories::detail(p, read_actor(p, f).await, id)
        .await
        .unwrap()
        .unwrap()
        .category;
    assert_eq!(c.version, 1);
    assert!(c.catalog_changed_at.is_none());
    assert!(c.created_by_user_id.is_none());
    assert!(c.updated_by_user_id.is_none());
    assert_eq!(c.name, " ".repeat(200));
    assert_eq!(c.code, "  RETAINED LEGACY CODE  ");
    let actor = governed::actor(p, f).await;
    let mut input = correct(&c, &c.name, InventoryCategoryParentChange::Retain);
    if let InventoryCategoryReviewedInput::Correct { description, .. } = &mut input {
        *description = Some("Synthetic description only".into())
    };
    let result = categories::command(p, actor.clone(), input).await.unwrap();
    assert_eq!(result.category.name, c.name);
    assert_eq!(result.category.code, c.code);
    assert_eq!(result.category.created_at, c.created_at);
    assert_eq!(result.category.created_by_user_id, None);
    let active = categories::command(
        p,
        actor,
        InventoryCategoryReviewedInput::Reactivate {
            client_request_id: Uuid::new_v4(),
            category_id: id,
            expected_version: result.category.version,
        },
    )
    .await
    .unwrap();
    assert!(active.category.is_active);
    assert_eq!(active.category.name, c.name);
}
async fn inventory_matches(
    p: &PgPool,
    f: Uuid,
    q: &str,
) -> Vec<hms_domain::search::OmniSearchItem> {
    use hms_domain::{
        auth::PatientDataVisibility,
        deployment::{FeatureKey, PermissionCode},
        search::SearchResourceType,
    };
    hms_db::search::omni_search(
        p,
        hms_db::search::OmniSearchFilters {
            facility_id: f,
            user_id: Uuid::from_u128(hms_db::provision::LIMITED_USER_ID),
            query: Some(q.into()),
            types: vec![SearchResourceType::Inventory],
            limit_per_group: 25,
            permission_codes: vec![
                PermissionCode::InventoryView,
                PermissionCode::PatientDemographicsView,
            ],
            feature_keys: vec![FeatureKey::Inventory],
            patient_visibility: vec![PatientDataVisibility::Demographics],
        },
    )
    .await
    .unwrap()
    .groups
    .inventory
}
#[tokio::test]
async fn category25_migration_repairs_both_foreign_search_channels_without_optional_rebuild_and_preserves_document_identity(
) {
    let db = TestDb::with_profile_and_migrator(
        hms_domain::deployment::DeploymentProfile::Hospital,
        &governed::before030(),
    )
    .await
    .unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let foreign = Uuid::new_v4();
    let foreign_category = Uuid::new_v4();
    let item = Uuid::new_v4();
    let document = Uuid::new_v4();
    let unrelated = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'S25_OTHER','Synthetic foreign facility','hospital')").bind(foreign).execute(p).await.unwrap();
    sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name)VALUES($1,$2,'S25_FOREIGN','qxforeignsentinel')").bind(foreign_category).bind(foreign).execute(p).await.unwrap();
    // Foreign category edges can only be imported before030's publication guard.
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit)VALUES($1,$2,$3,'S25_SAFE_CODE','Synthetic imported item','supply','piece')").bind(item).bind(f).bind(foreign_category).execute(p).await.unwrap();
    through030().run(p).await.unwrap();
    // The exact checkpoint030 item producer used an id-only INNER category join.
    // Materialize that producer projection before031; no current guard is changed.
    sqlx::query("INSERT INTO search_documents(id,facility_id,resource_type,resource_id,title,subtitle,route_path,status_label,feature_key,permission_code,search_text,rank_boost,source_updated_at,occurred_at,metadata,is_active)SELECT $1,i.facility_id,'inventory',i.id,i.name,i.code||' · '||i.unit,'/inventory/items/'||i.id::text,CASE WHEN i.is_active THEN 'active' ELSE 'inactive' END,'inventory',CASE WHEN i.controlled THEN 'controlled_substance.manage' ELSE 'inventory.view' END,concat_ws(' ',i.code,i.name,i.item_type,i.unit,c.name),55,i.updated_at,i.updated_at,jsonb_build_object('source_table','inventory_items','code',i.code,'item_type',i.item_type,'controlled',i.controlled,'category',c.name,'sentinel_extra','retained'),i.is_active FROM inventory_items i INNER JOIN inventory_categories c ON c.id=i.category_id WHERE i.id=$2").bind(document).bind(item).execute(p).await.unwrap();
    sqlx::query("INSERT INTO search_documents(id,facility_id,resource_type,resource_id,title,route_path,feature_key,permission_code,search_text,metadata)VALUES($1,$2,'inventory',$3,'Synthetic unrelated location','/inventory/items','inventory','inventory.view','qxunrelated',jsonb_build_object('source_table','storage_locations','category','unrelated retained category'))").bind(unrelated).bind(f).bind(Uuid::new_v4()).execute(p).await.unwrap();
    assert!(inventory_matches(p, f, "qxforeignsentinel")
        .await
        .iter()
        .any(|v| v.id == item));
    assert!(inventory_matches(p, f, "qx")
        .await
        .iter()
        .any(|v| v.id == item));
    let operational_before: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1")
            .bind(item)
            .fetch_one(p)
            .await
            .unwrap();
    let unrelated_before: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(d) FROM search_documents d WHERE id=$1")
            .bind(unrelated)
            .fetch_one(p)
            .await
            .unwrap();
    let started = std::time::Instant::now();
    hms_db::migrate::run(p).await.unwrap();
    let elapsed = started.elapsed();
    // No rebuild function is called before either negative control.
    assert!(!inventory_matches(p, f, "qxforeignsentinel")
        .await
        .iter()
        .any(|v| v.id == item));
    assert!(!inventory_matches(p, f, "qx")
        .await
        .iter()
        .any(|v| v.id == item));
    assert!(inventory_matches(p, f, "S25_SAFE_CODE")
        .await
        .iter()
        .any(|v| v.id == item));
    let repaired:serde_json::Value=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'category',metadata->'category','extra',metadata->'sentinel_extra','text',search_text) FROM search_documents WHERE resource_id=$1 AND metadata->>'source_table'='inventory_items'").bind(item).fetch_one(p).await.unwrap();
    assert_eq!(repaired["id"], document.to_string());
    assert!(repaired["category"].is_null());
    assert_eq!(repaired["extra"], "retained");
    assert!(!repaired["text"]
        .as_str()
        .unwrap()
        .contains("qxforeignsentinel"));
    let operational_after: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1")
            .bind(item)
            .fetch_one(p)
            .await
            .unwrap();
    assert_eq!(operational_after, operational_before);
    let unrelated_after: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(d) FROM search_documents d WHERE id=$1")
            .bind(unrelated)
            .fetch_one(p)
            .await
            .unwrap();
    assert_eq!(unrelated_after, unrelated_before);
    hms_db::search::rebuild_search_index_for_facility(p, f)
        .await
        .unwrap();
    assert!(!inventory_matches(p, f, "qxforeignsentinel")
        .await
        .iter()
        .any(|v| v.id == item));
    assert!(inventory_matches(p, f, "S25_SAFE_CODE")
        .await
        .iter()
        .any(|v| v.id == item));
    println!("CATEGORY25 mandatory031 search repair completed in {:?} on one producer-backed imported item document; this is not a scale or constant-time claim",elapsed);
}
#[tokio::test]
async fn category25_final_database_clock_rejects_authority_expiring_during_audit_wait() {
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let c = create(p, f, "S25_EXPIRES", None).await.category;
    let mut actor = governed::actor(p, f).await;
    sqlx::query("CREATE FUNCTION synthetic_category_audit_wait() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.resource_type='inventory_category' THEN PERFORM pg_sleep(1.2);END IF;RETURN NEW;END$$").execute(p).await.unwrap();
    sqlx::query("CREATE TRIGGER synthetic_category_audit_wait BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_category_audit_wait()").execute(p).await.unwrap();
    let now: chrono::DateTime<chrono::Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(p)
        .await
        .unwrap();
    actor.authorization.valid_until = now + chrono::Duration::seconds(1);
    let result = categories::command(
        p,
        actor,
        correct(
            &c,
            "Must fail final clock",
            InventoryCategoryParentChange::Retain,
        ),
    )
    .await;
    assert!(result.is_err());
    let current = categories::detail(p, read_actor(p, f).await, c.id)
        .await
        .unwrap()
        .unwrap()
        .category;
    assert_eq!(current.version, c.version);
    assert_eq!(current.name, c.name);
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM inventory_category_commands WHERE category_id=$1")
            .bind(c.id)
            .fetch_one(p)
            .await
            .unwrap();
    assert_eq!(count, 1);
}
#[tokio::test]
async fn category25_intrinsic_guard_preserves_identity_and_refuses_forged_receipt_without_current_state_or_audit(
) {
    use sha2::{Digest, Sha256};
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let c = create(p, f, "S25_INTRINSIC", None).await;
    let actor = governed::actor(p, f).await;
    for statement in [
        "UPDATE inventory_categories SET code='S25_CHANGED_IDENTITY' WHERE id=$1",
        "DELETE FROM inventory_categories WHERE id=$1",
        "UPDATE inventory_categories SET version=version+1 WHERE id=$1",
    ] {
        assert!(sqlx::query(statement)
            .bind(c.category.id)
            .execute(p)
            .await
            .is_err());
    }
    let mut forged = c.clone();
    forged.client_request_id = Uuid::new_v4();
    forged.reviewed_input = correct(
        &c.category,
        &c.category.name,
        InventoryCategoryParentChange::Retain,
    );
    if let InventoryCategoryReviewedInput::Correct {
        client_request_id, ..
    } = &mut forged.reviewed_input
    {
        *client_request_id = forged.client_request_id
    }
    forged.before = Some(c.category.clone());
    forged.changed = false;
    let payload = Sha256::digest(
        serde_json::to_vec(&serde_json::to_value(&forged.reviewed_input).unwrap()).unwrap(),
    )
    .to_vec();
    forged.input_digest = payload.iter().map(|v| format!("{v:02x}")).collect();
    let key = Sha256::digest(forged.client_request_id.as_bytes()).to_vec();
    let mut tx = p.begin().await.unwrap();
    sqlx::query("INSERT INTO inventory_category_commands(id,facility_id,request_key_hash,actor_user_id,category_id,action,payload_digest,receipt,recorded_at)VALUES($1,$2,$3,$4,$5,'correct',$6,$7,$8)").bind(Uuid::new_v4()).bind(f).bind(key).bind(actor.user_id).bind(c.category.id).bind(payload).bind(sqlx::types::Json(forged)).bind(c.recorded_at).execute(&mut *tx).await.unwrap();
    assert!(
        tx.commit().await.is_err(),
        "deferred completeness refuses a forged no-op receipt with no matching audit"
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM inventory_category_commands WHERE category_id=$1")
            .bind(c.category.id)
            .fetch_one(p)
            .await
            .unwrap();
    assert_eq!(count, 1);
}
#[tokio::test]
async fn category25_retained_foreign_item_reference_blocks_local_lifecycle_and_foreign_label_is_null(
) {
    let db = TestDb::with_profile_and_migrator(
        hms_domain::deployment::DeploymentProfile::Hospital,
        &governed::before030(),
    )
    .await
    .unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let foreign = Uuid::new_v4();
    let local_category = Uuid::new_v4();
    let foreign_category = Uuid::new_v4();
    let local_item = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'S25_REDUNDANT_FOREIGN','Synthetic foreign facility','hospital')").bind(foreign).execute(p).await.unwrap();
    for (id, facility, code) in [
        (local_category, f, "S25_LOCAL_CATEGORY"),
        (foreign_category, foreign, "S25_FOREIGN_CATEGORY"),
    ] {
        sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name)VALUES($1,$2,$3,'Synthetic imported category')").bind(id).bind(facility).bind(code).execute(p).await.unwrap();
    }
    for (id, facility, category, code) in [
        (local_item, f, foreign_category, "S25_LOCAL_BAD_CATEGORY"),
        (
            Uuid::new_v4(),
            foreign,
            local_category,
            "S25_FOREIGN_BAD_CATEGORY",
        ),
    ] {
        sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,is_active)VALUES($1,$2,$3,$4,'Synthetic imported item','supply','piece',true)").bind(id).bind(facility).bind(category).bind(code).execute(p).await.unwrap();
    }
    through030().run(p).await.unwrap();
    hms_db::migrate::run(p).await.unwrap();
    let item = hms_db::inventory::get_item(p, f, local_item)
        .await
        .unwrap()
        .unwrap();
    assert!(item.category_name.is_none());
    let rows = hms_db::inventory::list_items(
        p,
        f,
        None,
        25,
        hms_db::inventory::InventoryItemFilters {
            search: Some("S25_LOCAL_BAD_CATEGORY".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].category_name.is_none());
    error(
        categories::command(
            p,
            governed::actor(p, f).await,
            InventoryCategoryReviewedInput::Retire {
                client_request_id: Uuid::new_v4(),
                category_id: local_category,
                expected_version: 1,
            },
        )
        .await
        .unwrap_err(),
        categories::InventoryCategoryError::ItemReference,
    );
}
#[tokio::test]
async fn category25_local_category_rename_waits_for_explicit_search_rebuild() {
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let mut c = create(p, f, "S25_FRESHNESS", None).await.category;
    let actor = governed::actor(p, f).await;
    c = categories::command(
        p,
        actor.clone(),
        correct(
            &c,
            "qvoldlocalcategory",
            InventoryCategoryParentChange::Retain,
        ),
    )
    .await
    .unwrap()
    .category;
    let item = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit)VALUES($1,$2,$3,'S25_LOCAL_FRESH_ITEM','Synthetic freshness item','supply','piece')").bind(item).bind(f).bind(c.id).execute(p).await.unwrap();
    hms_db::search::rebuild_search_index_for_facility(p, f)
        .await
        .unwrap();
    assert!(inventory_matches(p, f, "qvoldlocalcategory")
        .await
        .iter()
        .any(|v| v.id == item));
    categories::command(
        p,
        actor,
        correct(
            &c,
            "qvnewlocalcategory",
            InventoryCategoryParentChange::Retain,
        ),
    )
    .await
    .unwrap();
    assert!(inventory_matches(p, f, "qvoldlocalcategory")
        .await
        .iter()
        .any(|v| v.id == item));
    assert!(!inventory_matches(p, f, "qvnewlocalcategory")
        .await
        .iter()
        .any(|v| v.id == item));
    hms_db::search::rebuild_search_index_for_facility(p, f)
        .await
        .unwrap();
    assert!(!inventory_matches(p, f, "qvoldlocalcategory")
        .await
        .iter()
        .any(|v| v.id == item));
    assert!(inventory_matches(p, f, "qvnewlocalcategory")
        .await
        .iter()
        .any(|v| v.id == item));
}
#[tokio::test]
async fn category25_actual_query_plans_cover_directory_literal_search_history_and_reference_probes()
{
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let canonical = Uuid::from_u128(hms_db::provision::DEFAULT_INVENTORY_CATEGORY_MED_ID);
    let c = create(p, f, "S25_PLAN_SUBJECT", None).await.category;
    sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name,parent_id)SELECT gen_random_uuid(),$1,'S25_PLAN_'||lpad(n::text,4,'0'),'Synthetic query plan category',$2 FROM generate_series(1,1000)n").bind(f).bind(canonical).execute(p).await.unwrap();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit)SELECT gen_random_uuid(),$1,$2,'S25_PLAN_ITEM_'||lpad(n::text,4,'0'),'Synthetic query plan item','supply','piece' FROM generate_series(1,1000)n").bind(f).bind(canonical).execute(p).await.unwrap();
    let actor = governed::actor(p, f).await;
    for _ in 0..30 {
        categories::command(
            p,
            actor.clone(),
            correct(&c, &c.name, InventoryCategoryParentChange::Retain),
        )
        .await
        .unwrap();
    }
    for table in [
        "inventory_categories",
        "inventory_items",
        "inventory_category_commands",
    ] {
        sqlx::query(&format!("ANALYZE {table}"))
            .execute(p)
            .await
            .unwrap();
    }
    let directory:serde_json::Value=sqlx::query_scalar("EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)SELECT c.id,c.code,c.name,p.code FROM inventory_categories c LEFT JOIN inventory_categories p ON p.id=c.parent_id AND p.facility_id=c.facility_id WHERE c.facility_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT 25").bind(f).fetch_one(p).await.unwrap();
    assert_eq!(directory[0]["Plan"]["Actual Rows"], 25);
    assert!(directory
        .to_string()
        .contains("inventory_category_administration_page_idx"));
    for pattern in ["%S25\\_PLAN\\_0999%", "%25%"] {
        let plan:serde_json::Value=sqlx::query_scalar("EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)SELECT c.id FROM inventory_categories c WHERE c.facility_id=$1 AND(c.code||' '||c.name) ILIKE $2 ESCAPE '\\' ORDER BY c.created_at DESC,c.id DESC LIMIT 25").bind(f).bind(pattern).fetch_one(p).await.unwrap();
        assert!(plan[0]["Plan"]["Actual Rows"].as_u64().unwrap() <= 25);
        println!("CATEGORY25 search plan pattern_chars={} root={} actual_rows={} execution_ms={} (two-character search has no asserted index guarantee)",pattern.chars().count(),plan[0]["Plan"]["Node Type"],plan[0]["Plan"]["Actual Rows"],plan[0]["Execution Time"]);
    }
    let history:serde_json::Value=sqlx::query_scalar("EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)SELECT id,action,recorded_at FROM inventory_category_commands WHERE facility_id=$1 AND category_id=$2 ORDER BY recorded_at DESC,id DESC LIMIT 25").bind(f).bind(c.id).fetch_one(p).await.unwrap();
    assert_eq!(history[0]["Plan"]["Actual Rows"], 25);
    for(sql,index)in[("EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)SELECT EXISTS(SELECT 1 FROM inventory_items WHERE category_id=$1)","inventory_category_item_reference_idx"),("EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)SELECT EXISTS(SELECT 1 FROM inventory_categories WHERE parent_id=$1)","inventory_category_child_reference_idx")]{let plan:serde_json::Value=sqlx::query_scalar(sql).bind(c.id).fetch_one(p).await.unwrap();assert!(plan.to_string().contains(index),"selective empty reference probe uses its leading UUID index");}
    println!("CATEGORY25 directory25 indexed plan execution_ms={} history25 execution_ms={} over1000categories+1000items+31subjectreceipts; fixture plans are not productionp99 acceptance",directory[0]["Execution Time"],history[0]["Execution Time"]);
}
#[tokio::test]
async fn category25_original_receipt_and_uuid_replay_are_bound_to_exact_current_actor() {
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let original = create(p, f, "S25_ACTOR_BOUND", None).await;
    let mut other = governed::actor(p, f).await;
    let user = Uuid::new_v4();
    // A second real ordinary local account/session, with independent current grants.
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash,password_change_required,is_active)SELECT $1,facility_id,$2,'Synthetic second category actor',password_hash,false,true FROM users WHERE id=$3").bind(user).bind(format!("synthetic-category-{}@example.invalid",user)).bind(other.user_id).execute(p).await.unwrap();
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code)VALUES($1,'inventory.manage'),($1,'patient.demographics.view')").bind(user).execute(p).await.unwrap();
    sqlx::query("INSERT INTO user_features(user_id,feature_key)VALUES($1,'inventory')")
        .bind(user)
        .execute(p)
        .await
        .unwrap();
    sqlx::query("INSERT INTO user_patient_visibility(user_id,visibility)VALUES($1,'demographics')")
        .bind(user)
        .execute(p)
        .await
        .unwrap();
    let (sv, pv): (i64, i64) =
        sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
            .bind(user)
            .fetch_one(p)
            .await
            .unwrap();
    let now: chrono::DateTime<chrono::Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(p)
        .await
        .unwrap();
    let session = Uuid::new_v4();
    hms_db::auth::insert_refresh_session(
        p,
        &hms_db::auth::NewRefreshSession {
            token_hash: session.to_string(),
            session_id: session,
            session_family_id: session,
            rotated_from_session_id: None,
            user_id: user,
            facility_id: f,
            session_version: sv,
            permission_version_at_issue: pv,
            csrf_token_hash: "synthetic-category-second-session".into(),
            expires_at: now + chrono::Duration::hours(1),
            session_started_at: now,
            idle_expires_at: now + chrono::Duration::hours(1),
            absolute_expires_at: now + chrono::Duration::hours(1),
            device_label: None,
        },
    )
    .await
    .unwrap();
    let verified: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT password_verified_at FROM refresh_sessions WHERE session_id=$1")
            .bind(session)
            .fetch_one(p)
            .await
            .unwrap();
    other.user_id = user;
    other.authorization.session_id = session;
    other.authorization.session_version = sv;
    other.authorization.permission_version = pv;
    other.authorization.original_password_verified_at = Some(verified);
    other.authorization.valid_until = verified + chrono::Duration::minutes(15);
    error(
        categories::receipt(p, other.clone(), original.client_request_id)
            .await
            .unwrap_err(),
        categories::InventoryCategoryError::NotFound,
    );
    error(
        categories::command(p, other, original.reviewed_input.clone())
            .await
            .unwrap_err(),
        categories::InventoryCategoryError::RequestConflict,
    );
    let(count,audits):(i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM inventory_category_commands WHERE category_id=$1),(SELECT count(*) FROM audit_events WHERE resource_type='inventory_category' AND resource_id=$1)").bind(original.category.id).fetch_one(p).await.unwrap();
    assert_eq!((count, audits), (1, 1));
    let own = categories::receipt(p, governed::actor(p, f).await, original.client_request_id)
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(own).unwrap(),
        serde_json::to_value(original).unwrap()
    );
}

#[tokio::test]
async fn category25_inactive_current_child_still_blocks_parent_lifecycle() {
    let db = TestDb::hospital().await.unwrap();
    let p = db.pool();
    let f = db.facility_id();
    let parent = create(p, f, "S25_INACTIVE_CHILD_PARENT", None)
        .await
        .category;
    let child = create(p, f, "S25_INACTIVE_CHILD", Some(&parent))
        .await
        .category;
    let retired = categories::command(
        p,
        governed::actor(p, f).await,
        InventoryCategoryReviewedInput::Retire {
            client_request_id: Uuid::new_v4(),
            category_id: child.id,
            expected_version: child.version,
        },
    )
    .await
    .unwrap();
    assert!(!retired.category.is_active);
    error(
        categories::command(
            p,
            governed::actor(p, f).await,
            InventoryCategoryReviewedInput::Retire {
                client_request_id: Uuid::new_v4(),
                category_id: parent.id,
                expected_version: parent.version,
            },
        )
        .await
        .unwrap_err(),
        categories::InventoryCategoryError::ChildReference,
    );
}
