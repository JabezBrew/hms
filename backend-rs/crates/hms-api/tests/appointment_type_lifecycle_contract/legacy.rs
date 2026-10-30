use super::*;
#[tokio::test]
async fn honest_pre029_blank_metadata_and_large_positive_duration_remain_exactly_readable() {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610180029)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let baseline = hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    hms_db::provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    let mut ids = Vec::new();
    for (code, name) in [("", ""), (" ", "  ")] {
        let id = Uuid::new_v4();
        let saved = hms_db::care::create_appointment_type(
            &pool,
            hms_db::care::NewAppointmentType {
                id,
                facility_id: baseline.facility_id,
                code: code.into(),
                name: name.into(),
                default_duration_minutes: 2000,
                created_by_user_id: Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
            },
        )
        .await
        .unwrap();
        assert_eq!(saved.code, code);
        assert_eq!(saved.name, name);
        ids.push((id, code, name));
    }
    hms_db::migrate::run(&pool).await.unwrap();
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.auto_migrate = false;
    let app = app_with_config(config, database).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    for (id, code, name) in ids {
        let (s, b) = request(
            &app,
            &token,
            Method::GET,
            &format!("/api/v2/scheduling/services/{id}/administration"),
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(b["data"]["code"], code);
        assert_eq!(b["data"]["name"], name);
        assert_eq!(b["data"]["default_duration_minutes"], 2000);
        assert_eq!(b["data"]["version"], 1);
        let(s,b)=request(&app,&token,Method::POST,&format!("/api/v2/scheduling/services/{id}/metadata"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic explicit metadata correction","default_duration_minutes":30}))).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(b["data"]["service"]["code"], code);
        assert_eq!(
            b["data"]["service"]["name"],
            "Synthetic explicit metadata correction"
        );
    }
    println!("type23 honest028 repository rows blank/whitespace code/name +positive2000minute defaults retained;029 protected actualGET200 exact strings and explicitmetadata correction preserveimmutablecode");
}
