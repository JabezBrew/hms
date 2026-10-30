use super::*;
use hms_db::provision::{provision_demo_seed, DemoSeedProfile};

async fn configured_general(
    active: bool,
) -> (
    hms_db::test_support::TestDatabase,
    hms_db::PgPool,
    BaselineProvisioning,
    Uuid,
) {
    let db = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(db.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let baseline = BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    let typ = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO deployment_profiles(code,label)VALUES('hospital','Synthetic hospital')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'HMS','Synthetic configured facility','hospital')").bind(baseline.facility_id).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO appointment_types(id,facility_id,code,name,default_duration_minutes,is_active)VALUES($1,$2,'general','Synthetic intentional default',43,$3)").bind(typ).bind(baseline.facility_id).bind(active).execute(&pool).await.unwrap();
    provision_baseline(&pool, &baseline).await.unwrap();
    (db, pool, baseline, typ)
}
#[tokio::test]
async fn active_custom_general_is_preserved_and_used_by_actual_demo_publication() {
    let (_db, pool, baseline, typ) = configured_general(true).await;
    let before: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(t) FROM appointment_types t WHERE id=$1")
            .bind(typ)
            .fetch_one(&pool)
            .await
            .unwrap();
    provision_demo_seed(&pool, &baseline, DemoSeedProfile::Smoke)
        .await
        .unwrap();
    let(appointments,wrong):(i64,i64)=sqlx::query_as("SELECT count(*),count(*)FILTER(WHERE a.appointment_type_id IS DISTINCT FROM $2)FROM appointments a JOIN patients p ON p.id=a.patient_id AND p.facility_id=a.facility_id WHERE a.facility_id=$1 AND p.patient_code ~ '^DEMO-[0-9]+$'").bind(baseline.facility_id).bind(typ).fetch_one(&pool).await.unwrap();
    let links:i64=sqlx::query_scalar("SELECT count(*) FROM clinic_session_appointment_types WHERE facility_id=$1 AND appointment_type_id=$2").bind(baseline.facility_id).bind(typ).fetch_one(&pool).await.unwrap();
    let after: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(t) FROM appointment_types t WHERE id=$1")
            .bind(typ)
            .fetch_one(&pool)
            .await
            .unwrap();
    println!("type23 actual custom-General smoke demo appointments={appointments}; wrong_type_links={wrong}; exact_allowed_links={links}");
    assert!(appointments > 0);
    assert_eq!(wrong, 0);
    assert!(links > 0);
    assert_eq!(after, before);
}
#[tokio::test]
async fn retired_custom_general_refuses_demo_and_rolls_back_prior_graph_deletes() {
    let (_db, pool, baseline, typ) = configured_general(false).await;
    let patient = Uuid::new_v4();
    sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status)VALUES($1,$2,'DEMO-4242','Synthetic','Retained','1990-01-01','female','active')").bind(patient).bind(baseline.facility_id).execute(&pool).await.unwrap();
    let before: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(p) FROM patients p WHERE id=$1")
            .bind(patient)
            .fetch_one(&pool)
            .await
            .unwrap();
    let outcome = provision_demo_seed(&pool, &baseline, DemoSeedProfile::Smoke)
        .await
        .unwrap_err();
    assert_eq!(outcome.to_string(), "demo_seed_general_service_unavailable");
    let after: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(p) FROM patients p WHERE id=$1")
            .bind(patient)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(after, before);
    let facts:(bool,i64,i64)=sqlx::query_as("SELECT (SELECT NOT is_active AND name='Synthetic intentional default' AND default_duration_minutes=43 FROM appointment_types WHERE id=$2),(SELECT count(*) FROM appointments WHERE facility_id=$1),(SELECT count(*) FROM clinic_session_appointment_types WHERE facility_id=$1)").bind(baseline.facility_id).bind(typ).fetch_one(&pool).await.unwrap();
    assert_eq!(facts, (true, 0, 0));
}
