use chrono::{Duration, NaiveTime, Utc};
use hms_db::care::NewBookedAppointment;
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_db::scheduling::{NewBookableSession, NewBookableSessionTemplate};
use hms_domain::deployment::DeploymentProfile;
use hms_domain::scheduling::{BookableSessionMode, BookableUnitType};
use uuid::Uuid;

#[path = "appointment_type_lifecycle/future_generators.rs"]
mod future_generators;
#[path = "appointment_type_lifecycle/legacy_owner.rs"]
mod legacy_owner;
#[path = "appointment_type_lifecycle/membership_races.rs"]
mod membership_races;
#[path = "appointment_type_lifecycle/publication.rs"]
mod publication;
#[path = "appointment_type_lifecycle/query_plan.rs"]
mod query_plan;
#[path = "appointment_type_lifecycle/seeding.rs"]
mod seeding;

async fn fixture() -> (
    hms_db::test_support::TestDatabase,
    hms_db::PgPool,
    BaselineProvisioning,
    Uuid,
) {
    let db = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(db.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let baseline = BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    provision_baseline(&pool, &baseline).await.unwrap();
    let actor =
        sqlx::query_scalar("SELECT id FROM users WHERE facility_id=$1 AND email='owner@hms.local'")
            .bind(baseline.facility_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    (db, pool, baseline, actor)
}

fn session(
    facility: Uuid,
    actor: Uuid,
    owner: Option<Uuid>,
    allowed: Vec<Uuid>,
    offset: i64,
) -> NewBookableSession {
    let start = Utc::now() + Duration::days(3 + offset);
    NewBookableSession {
        id: Uuid::new_v4(),
        facility_id: facility,
        source_template_id: None,
        clinic_id: None,
        service_code: None,
        practitioner_user_id: None,
        owner_type: if owner.is_some() {
            BookableUnitType::Service
        } else {
            BookableUnitType::Facility
        },
        owner_id: owner.or(Some(facility)),
        name: "Synthetic type publication".into(),
        mode: BookableSessionMode::CapacityBlock,
        starts_at: start,
        ends_at: start + Duration::hours(2),
        slot_minutes: None,
        capacity: 10,
        allow_overbooking: false,
        overbook_limit: 0,
        created_by_user_id: actor,
        allowed_service_ids: allowed,
    }
}

fn template(
    facility: Uuid,
    actor: Uuid,
    owner: Option<Uuid>,
    allowed: Vec<Uuid>,
) -> NewBookableSessionTemplate {
    NewBookableSessionTemplate {
        id: Uuid::new_v4(),
        facility_id: facility,
        clinic_id: None,
        service_code: None,
        practitioner_user_id: None,
        owner_type: if owner.is_some() {
            BookableUnitType::Service
        } else {
            BookableUnitType::Facility
        },
        owner_id: owner.or(Some(facility)),
        name: "Synthetic template publication".into(),
        mode: BookableSessionMode::CapacityBlock,
        weekdays: vec![1, 2, 3, 4, 5, 6, 7],
        starts_on: Utc::now().date_naive(),
        ends_on: None,
        start_time: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
        end_time: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
        slot_minutes: None,
        capacity: 10,
        allow_overbooking: false,
        overbook_limit: 0,
        created_by_user_id: actor,
        allowed_service_ids: allowed,
    }
}

#[tokio::test]
async fn baseline_preserves_exact_retired_general_identity_and_metadata() {
    let db = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(db.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let baseline = BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    sqlx::query(
        "INSERT INTO deployment_profiles(code,label)VALUES('hospital','Synthetic hospital')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'HMS','Synthetic retained facility','hospital')")
        .bind(baseline.facility_id).execute(&pool).await.unwrap();
    let original = Uuid::new_v4();
    sqlx::query("INSERT INTO appointment_types(id,facility_id,code,name,default_duration_minutes,is_active)VALUES($1,$2,'general','Synthetic chosen general',47,false)")
        .bind(original).bind(baseline.facility_id).execute(&pool).await.unwrap();
    provision_baseline(&pool, &baseline).await.unwrap();
    let facts:(bool,bool,bool,bool)=sqlx::query_as("SELECT id=$2,name='Synthetic chosen general',default_duration_minutes=47,NOT is_active FROM appointment_types WHERE facility_id=$1 AND code='general'")
        .bind(baseline.facility_id).bind(original).fetch_one(&pool).await.unwrap();
    println!("type23 retained General actual identity/name/duration/retired facts={facts:?}");
    assert_eq!(facts, (true, true, true, true));
}

#[tokio::test]
async fn baseline_creates_missing_general_and_repeated_provision_preserves_it() {
    let (_db, pool, baseline, _) = fixture().await;
    let before: serde_json::Value = sqlx::query_scalar(
        "SELECT to_jsonb(t) FROM appointment_types t WHERE facility_id=$1 AND code='general'",
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    provision_baseline(&pool, &baseline).await.unwrap();
    let after: serde_json::Value = sqlx::query_scalar(
        "SELECT to_jsonb(t) FROM appointment_types t WHERE facility_id=$1 AND code='general'",
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(before, after);
    assert_eq!(after["is_active"], true);
}

#[tokio::test]
async fn new_reference_publishers_reject_inactive_and_foreign_types_with_local_controls() {
    let (_db, pool, baseline, actor) = fixture().await;
    let facility = baseline.facility_id;
    let local: Uuid = sqlx::query_scalar(
        "SELECT id FROM appointment_types WHERE facility_id=$1 AND is_active LIMIT 1",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    let inactive = Uuid::new_v4();
    let foreign = Uuid::new_v4();
    let foreign_facility = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'SYNTH23FOREIGN','Synthetic foreign facility','hospital')")
        .bind(foreign_facility).execute(&pool).await.unwrap();
    for (id, f, active, code) in [
        (inactive, facility, false, "SYNTH23INACTIVE"),
        (foreign, foreign_facility, true, "SYNTH23FOREIGN"),
    ] {
        sqlx::query("INSERT INTO appointment_types(id,facility_id,code,name,default_duration_minutes,is_active)VALUES($1,$2,$3,'Synthetic type',30,$4)")
            .bind(id).bind(f).bind(code).bind(active).execute(&pool).await.unwrap();
    }
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let mut facts = Vec::new();
    for (index, typ) in [local, inactive, foreign].into_iter().enumerate() {
        let source = hms_db::scheduling::create_bookable_session(
            &pool,
            session(facility, actor, None, vec![], index as i64),
        )
        .await
        .unwrap();
        let starts = Utc::now() + Duration::days(20 + index as i64);
        let booking = hms_db::care::create_booked_appointment(
            &pool,
            NewBookedAppointment {
                id: Uuid::new_v4(),
                facility_id: facility,
                patient_id: patient,
                clinic_id: None,
                clinic_session_id: None,
                appointment_type_id: Some(typ),
                practitioner_user_id: None,
                starts_at: starts,
                ends_at: starts + Duration::minutes(30),
                overbook_reason: None,
                series_id: None,
                created_by_user_id: actor,
            },
        )
        .await
        .is_ok();
        let constraint =
            hms_db::care::constrain_appointment_type_to_session(&pool, facility, source.id, typ)
                .await
                .is_ok();
        let session_owner = hms_db::scheduling::create_bookable_session(
            &pool,
            session(facility, actor, Some(typ), vec![], 30 + index as i64),
        )
        .await
        .is_ok();
        let template_owner = hms_db::scheduling::create_bookable_session_template(
            &pool,
            template(facility, actor, Some(typ), vec![]),
        )
        .await
        .is_ok();
        let session_allowed = hms_db::scheduling::create_bookable_session(
            &pool,
            session(facility, actor, None, vec![typ], 40 + index as i64),
        )
        .await
        .is_ok();
        let template_allowed = hms_db::scheduling::create_bookable_session_template(
            &pool,
            template(facility, actor, None, vec![typ]),
        )
        .await
        .is_ok();
        facts.push([
            booking,
            constraint,
            session_owner,
            template_owner,
            session_allowed,
            template_allowed,
        ]);
    }
    println!(
        "type23 actual repository new-reference local/inactive/foreign acceptance facts={facts:?}"
    );
    assert_eq!(facts, vec![[true; 6], [false; 6], [false; 6]]);
}
