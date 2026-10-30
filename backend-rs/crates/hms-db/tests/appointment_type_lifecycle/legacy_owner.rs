use super::*;
use std::borrow::Cow;

#[tokio::test]
async fn pre029_missing_service_owner_cannot_publish_new_care_but_old_care_can_close() {
    let db = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(db.database_url()).await.unwrap();
    let old = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610180029)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    old.run(&pool).await.unwrap();
    let baseline = BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    provision_baseline(&pool, &baseline).await.unwrap();
    let facility = baseline.facility_id;
    let actor: Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE facility_id=$1 AND email='owner@hms.local'")
            .bind(facility)
            .fetch_one(&pool)
            .await
            .unwrap();
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let legacy = Uuid::new_v4();
    let old_appointment = Uuid::new_v4();
    let start = Utc::now() + Duration::days(3);
    sqlx::query("INSERT INTO clinic_sessions(id,facility_id,owner_type,owner_id,name,mode,starts_at,ends_at,capacity,created_by_user_id)VALUES($1,$2,'service',NULL,'Synthetic legacy missing owner','capacity_block',$3,$4,4,$5)")
        .bind(legacy).bind(facility).bind(start).bind(start+Duration::hours(2)).bind(actor).execute(&pool).await.unwrap();
    let insert="INSERT INTO appointments(id,facility_id,patient_id,clinic_session_id,appointment_type_id,starts_at,ends_at,status,created_by_user_id)VALUES($1,$2,$3,$4,NULL,$5,$6,'scheduled',$7)";
    sqlx::query(insert)
        .bind(old_appointment)
        .bind(facility)
        .bind(patient)
        .bind(legacy)
        .bind(start)
        .bind(start + Duration::minutes(30))
        .bind(actor)
        .execute(&pool)
        .await
        .unwrap();
    hms_db::migrate::MIGRATOR.run(&pool).await.unwrap();
    let unsafe_new = sqlx::query(insert)
        .bind(Uuid::new_v4())
        .bind(facility)
        .bind(patient)
        .bind(legacy)
        .bind(start + Duration::minutes(30))
        .bind(start + Duration::minutes(60))
        .bind(actor)
        .execute(&pool)
        .await
        .is_ok();
    let closed = hms_db::care::cancel_appointment(
        &pool,
        facility,
        old_appointment,
        actor,
        "Synthetic unchanged care closure".into(),
    )
    .await
    .unwrap()
    .unwrap();
    let old_closed = closed.status == hms_domain::care::AppointmentStatus::Cancelled
        && closed.clinic_session_id == Some(legacy)
        && closed.appointment_type_id.is_none();
    let valid = hms_db::scheduling::create_bookable_session(
        &pool,
        session(facility, actor, None, vec![], 10),
    )
    .await
    .unwrap();
    let positive = sqlx::query(insert)
        .bind(Uuid::new_v4())
        .bind(facility)
        .bind(patient)
        .bind(valid.id)
        .bind(valid.starts_at)
        .bind(valid.starts_at + Duration::minutes(30))
        .bind(actor)
        .execute(&pool)
        .await
        .is_ok();
    println!("type23 honest pre029 missing-owner newaccepted/oldcanonicalclosed/independentvalid facts={unsafe_new}/{old_closed}/{positive}");
    assert_eq!((unsafe_new, old_closed, positive), (false, true, true));
}

#[tokio::test]
async fn pre029_foreign_scope_memberships_cannot_disappear_into_unrestricted_new_sources() {
    let db = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(db.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610180029)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let baseline = BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    provision_baseline(&pool, &baseline).await.unwrap();
    let f = baseline.facility_id;
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'SYNTH23OLDCHILD','Synthetic foreign child scope','hospital')").bind(foreign).execute(&pool).await.unwrap();
    let actor: Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE facility_id=$1 AND email='owner@hms.local'")
            .bind(f)
            .fetch_one(&pool)
            .await
            .unwrap();
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(f)
        .fetch_one(&pool)
        .await
        .unwrap();
    let day = Utc::now().date_naive() + Duration::days(8);
    let at = day.and_hms_opt(8, 0, 0).unwrap().and_utc();
    let mut fixtures = Vec::new();
    for kind in ["foreign", "local", "empty"] {
        let typ = Uuid::new_v4();
        sqlx::query("INSERT INTO appointment_types(id,facility_id,code,name,default_duration_minutes)VALUES($1,$2,$3,'Synthetic exact child type',30)").bind(typ).bind(f).bind(format!("SYNTH23CHILD{kind}")).execute(&pool).await.unwrap();
        let t = Uuid::new_v4();
        let session = Uuid::new_v4();
        let old_booking = Uuid::new_v4();
        sqlx::query("INSERT INTO clinic_session_templates(id,facility_id,owner_type,owner_id,name,mode,weekdays,starts_on,ends_on,start_time,end_time,capacity)VALUES($1,$2,'facility',$2,'Synthetic historical exact source','capacity_block',ARRAY[1,2,3,4,5,6,7]::smallint[],$3,$3,'08:00','12:00',10)").bind(t).bind(f).bind(day).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO clinic_sessions(id,facility_id,owner_type,owner_id,name,mode,starts_at,ends_at,capacity)VALUES($1,$2,'facility',$2,'Synthetic historical exact source','capacity_block',$3,$4,10)").bind(session).bind(f).bind(at).bind(at+Duration::hours(4)).execute(&pool).await.unwrap();
        if kind != "empty" {
            let child_f = if kind == "foreign" { foreign } else { f };
            sqlx::query("INSERT INTO clinic_session_template_appointment_types(facility_id,clinic_session_template_id,appointment_type_id)VALUES($1,$2,$3)").bind(child_f).bind(t).bind(typ).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO clinic_session_appointment_types(facility_id,clinic_session_id,appointment_type_id)VALUES($1,$2,$3)").bind(child_f).bind(session).bind(typ).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO appointments(id,facility_id,patient_id,clinic_session_id,appointment_type_id,starts_at,ends_at,status,created_by_user_id)VALUES($1,$2,$3,$4,$5,$6,$7,'scheduled',$8)").bind(old_booking).bind(f).bind(patient).bind(session).bind(if kind=="local" {Some(typ)}else{None}).bind(at).bind(at+Duration::minutes(30)).bind(actor).execute(&pool).await.unwrap();
        fixtures.push((kind, t, session, old_booking, typ));
    }
    hms_db::migrate::run(&pool).await.unwrap();
    let mut facts = Vec::new();
    for (kind, t, session, old_booking, typ) in fixtures {
        let future: bool = sqlx::query_scalar(
            "SELECT appointment_type_has_future_generator($1,$2,clock_timestamp())",
        )
        .bind(f)
        .bind(typ)
        .fetch_one(&pool)
        .await
        .unwrap();
        let generated = hms_db::scheduling::generate_bookable_sessions(
            &pool,
            f,
            day,
            day,
            hms_db::scheduling::GenerateSessionFilters {
                template_id: Some(t),
                clinic_id: None,
            },
            actor,
        )
        .await;
        let generated_ok = generated.as_ref().is_ok_and(|r| r.generated_count == 1);
        let new_id = Uuid::new_v4();
        let booked = hms_db::care::create_booked_appointment(
            &pool,
            NewBookedAppointment {
                id: new_id,
                facility_id: f,
                patient_id: patient,
                clinic_id: None,
                clinic_session_id: Some(session),
                appointment_type_id: if kind == "local" { Some(typ) } else { None },
                practitioner_user_id: None,
                starts_at: at + Duration::hours(1),
                ends_at: at + Duration::hours(2),
                overbook_reason: None,
                series_id: None,
                created_by_user_id: actor,
            },
        )
        .await
        .is_ok();
        let generated_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM clinic_sessions WHERE source_template_id=$1")
                .bind(t)
                .fetch_one(&pool)
                .await
                .unwrap();
        let new_count: i64 = sqlx::query_scalar("SELECT count(*) FROM appointments WHERE id=$1")
            .bind(new_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let raw_new = sqlx::query("INSERT INTO appointments(id,facility_id,patient_id,clinic_session_id,appointment_type_id,starts_at,ends_at,status,created_by_user_id)VALUES($1,$2,$3,$4,$5,$6,$7,'scheduled',$8)")
            .bind(Uuid::new_v4()).bind(f).bind(patient).bind(session).bind(if kind=="local" {Some(typ)}else{None}).bind(at+Duration::hours(3)).bind(at+Duration::hours(3)+Duration::minutes(15)).bind(actor).execute(&pool).await.is_ok();
        let rescheduled = hms_db::care::update_appointment(
            &pool,
            hms_db::care::AppointmentUpdate {
                id: old_booking,
                facility_id: f,
                starts_at: Some(at + Duration::hours(2)),
                ends_at: Some(at + Duration::hours(2) + Duration::minutes(30)),
                actor_user_id: actor,
            },
        )
        .await
        .unwrap()
        .is_some();
        let retired = sqlx::query("UPDATE appointment_types SET is_active=false,version=version+1,updated_at=clock_timestamp() WHERE id=$1").bind(typ).execute(&pool).await.is_ok();
        let closed = hms_db::care::cancel_appointment(
            &pool,
            f,
            old_booking,
            actor,
            "Synthetic historical closure".into(),
        )
        .await
        .unwrap()
        .is_some_and(|a| {
            a.status == hms_domain::care::AppointmentStatus::Cancelled
                && a.clinic_session_id == Some(session)
        });
        let exact:i64=sqlx::query_scalar("SELECT (SELECT count(*) FROM clinic_session_appointment_types WHERE clinic_session_id=$1)+(SELECT count(*) FROM clinic_session_template_appointment_types WHERE clinic_session_template_id=$2)").bind(session).bind(t).fetch_one(&pool).await.unwrap();
        facts.push((
            kind,
            generated_ok,
            booked,
            generated_count,
            new_count,
            closed,
            exact,
            future,
            raw_new,
            rescheduled,
            retired,
        ));
    }
    println!("type23 honest028 malformed child facility newgeneration/book/persist/oldclosure/exactmembership/future/rawnew/oldreschedule/retire facts={facts:?}");
    assert_eq!(
        facts,
        vec![
            ("foreign", false, false, 0, 0, true, 2, true, false, true, false),
            ("local", true, true, 1, 1, true, 2, true, true, true, false),
            ("empty", true, true, 1, 1, true, 0, false, true, true, true)
        ]
    );
}
