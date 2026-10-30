use super::*;
use hms_db::scheduling::GenerateSessionFilters;

async fn wait_for_generation(pool: &hms_db::PgPool) -> bool {
    for _ in 0..200 {
        let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%INSERT INTO clinic_sessions%')").fetch_one(pool).await.unwrap();
        if waiting {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    false
}
#[tokio::test]
async fn generation_retains_full_allowed_membership_against_insert_delete_and_reparent() {
    let (_db, pool, baseline, actor) = fixture().await;
    let facility = baseline.facility_id;
    let mut facts = Vec::new();
    for (index, kind) in ["insert", "delete", "reparent"].into_iter().enumerate() {
        let typ = publication::new_type(&pool, facility, actor).await;
        let day = Utc::now().date_naive() + Duration::days(2);
        let mut source = template(
            facility,
            actor,
            None,
            if kind == "insert" { vec![] } else { vec![typ] },
        );
        source.starts_on = day;
        source.ends_on = Some(day);
        let original = hms_db::scheduling::create_bookable_session_template(&pool, source.clone())
            .await
            .unwrap();
        source.id = Uuid::new_v4();
        source.allowed_service_ids = vec![];
        let other = hms_db::scheduling::create_bookable_session_template(&pool, source)
            .await
            .unwrap();
        let lock = 18002910 + index as i64;
        sqlx::raw_sql(&format!("CREATE FUNCTION pause_type23_generation()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.source_template_id='{}'::uuid THEN PERFORM pg_advisory_xact_lock({lock});END IF;RETURN NEW;END$$;CREATE TRIGGER pause_type23_generation BEFORE INSERT ON clinic_sessions FOR EACH ROW EXECUTE FUNCTION pause_type23_generation();",original.id)).execute(&pool).await.unwrap();
        let mut gate = pool.acquire().await.unwrap();
        sqlx::query("SELECT pg_advisory_lock($1)")
            .bind(lock)
            .execute(&mut *gate)
            .await
            .unwrap();
        let p = pool.clone();
        let original_id = original.id;
        let pending = tokio::spawn(async move {
            hms_db::scheduling::generate_bookable_sessions(
                &p,
                facility,
                day,
                day,
                GenerateSessionFilters {
                    template_id: Some(original_id),
                    clinic_id: None,
                },
                actor,
            )
            .await
        });
        let observed = wait_for_generation(&pool).await;
        let result=match kind {
            "insert"=>tokio::time::timeout(std::time::Duration::from_secs(1),sqlx::query("INSERT INTO clinic_session_template_appointment_types(facility_id,clinic_session_template_id,appointment_type_id)VALUES($1,$2,$3)").bind(facility).bind(original.id).bind(typ).execute(&pool)).await,
            "delete"=>tokio::time::timeout(std::time::Duration::from_secs(1),sqlx::query("DELETE FROM clinic_session_template_appointment_types WHERE facility_id=$1 AND clinic_session_template_id=$2 AND appointment_type_id=$3").bind(facility).bind(original.id).bind(typ).execute(&pool)).await,
            _=>tokio::time::timeout(std::time::Duration::from_secs(1),sqlx::query("UPDATE clinic_session_template_appointment_types SET clinic_session_template_id=$1 WHERE facility_id=$2 AND clinic_session_template_id=$3 AND appointment_type_id=$4").bind(other.id).bind(facility).bind(original.id).bind(typ).execute(&pool)).await,
        };
        let nowait_refused = result.as_ref().is_ok_and(|r| {
            r.as_ref().is_err_and(|e| {
                e.as_database_error()
                    .is_some_and(|e| e.code().as_deref() == Some("55P03"))
            })
        });
        sqlx::query("SELECT pg_advisory_unlock($1)")
            .bind(lock)
            .execute(&mut *gate)
            .await
            .unwrap();
        let generated = pending.await.unwrap().unwrap();
        assert_eq!(generated.generated_count, 1);
        let expected:Vec<Uuid>=sqlx::query_scalar("SELECT appointment_type_id FROM clinic_session_template_appointment_types WHERE facility_id=$1 AND clinic_session_template_id=$2 ORDER BY appointment_type_id").bind(facility).bind(original.id).fetch_all(&pool).await.unwrap();
        let actual:Vec<Uuid>=sqlx::query_scalar("SELECT appointment_type_id FROM clinic_session_appointment_types WHERE facility_id=$1 AND clinic_session_id=$2 ORDER BY appointment_type_id").bind(facility).bind(generated.sessions[0].id).fetch_all(&pool).await.unwrap();
        let positive = hms_db::scheduling::create_bookable_session_template(
            &pool,
            template(facility, actor, None, vec![typ]),
        )
        .await
        .is_ok();
        facts.push((observed, nowait_refused, actual == expected, positive));
        sqlx::raw_sql("DROP TRIGGER pause_type23_generation ON clinic_sessions;DROP FUNCTION pause_type23_generation();").execute(&pool).await.unwrap();
    }
    println!("type23 actual retained generation observed/childNOWAIT/exactcopy/independentpositive facts={facts:?}");
    assert_eq!(facts, vec![(true, true, true, true); 3]);
}

#[tokio::test]
async fn membership_first_refuses_generation_then_explicit_edits_and_parent_cascades_work() {
    let (_db, pool, baseline, actor) = fixture().await;
    let facility = baseline.facility_id;
    let mut facts = Vec::new();
    for kind in ["insert", "delete", "reparent"] {
        let typ = publication::new_type(&pool, facility, actor).await;
        let day = Utc::now().date_naive() + Duration::days(3);
        let mut source = template(
            facility,
            actor,
            None,
            if kind == "insert" { vec![] } else { vec![typ] },
        );
        source.starts_on = day;
        source.ends_on = Some(day);
        let original = hms_db::scheduling::create_bookable_session_template(&pool, source.clone())
            .await
            .unwrap();
        source.id = Uuid::new_v4();
        source.allowed_service_ids = vec![];
        let other = hms_db::scheduling::create_bookable_session_template(&pool, source)
            .await
            .unwrap();
        let mut edit = pool.begin().await.unwrap();
        match kind {
            "insert" => {
                sqlx::query("INSERT INTO clinic_session_template_appointment_types(facility_id,clinic_session_template_id,appointment_type_id)VALUES($1,$2,$3)").bind(facility).bind(original.id).bind(typ).execute(&mut *edit).await.unwrap();
            }
            "delete" => {
                sqlx::query("DELETE FROM clinic_session_template_appointment_types WHERE facility_id=$1 AND clinic_session_template_id=$2 AND appointment_type_id=$3").bind(facility).bind(original.id).bind(typ).execute(&mut *edit).await.unwrap();
            }
            _ => {
                sqlx::query("UPDATE clinic_session_template_appointment_types SET clinic_session_template_id=$1 WHERE facility_id=$2 AND clinic_session_template_id=$3 AND appointment_type_id=$4").bind(other.id).bind(facility).bind(original.id).bind(typ).execute(&mut *edit).await.unwrap();
            }
        }
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            hms_db::scheduling::generate_bookable_sessions(
                &pool,
                facility,
                day,
                day,
                GenerateSessionFilters {
                    template_id: Some(original.id),
                    clinic_id: None,
                },
                actor,
            ),
        )
        .await;
        let nowait = result.as_ref().is_ok_and(|r| {
            r.as_ref().is_err_and(|e| {
                e.downcast_ref::<sqlx::Error>()
                    .and_then(sqlx::Error::as_database_error)
                    .is_some_and(|e| e.code().as_deref() == Some("55P03"))
            })
        });
        let none: bool = sqlx::query_scalar(
            "SELECT NOT EXISTS(SELECT 1 FROM clinic_sessions WHERE source_template_id=$1)",
        )
        .bind(original.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        edit.commit().await.unwrap();
        let generated = hms_db::scheduling::generate_bookable_sessions(
            &pool,
            facility,
            day,
            day,
            GenerateSessionFilters {
                template_id: Some(original.id),
                clinic_id: None,
            },
            actor,
        )
        .await
        .unwrap();
        assert_eq!(generated.generated_count, 1);
        let id = generated.sessions[0].id;
        let expected:Vec<Uuid>=sqlx::query_scalar("SELECT appointment_type_id FROM clinic_session_template_appointment_types WHERE clinic_session_template_id=$1 ORDER BY appointment_type_id").bind(original.id).fetch_all(&pool).await.unwrap();
        let actual:Vec<Uuid>=sqlx::query_scalar("SELECT appointment_type_id FROM clinic_session_appointment_types WHERE clinic_session_id=$1 ORDER BY appointment_type_id").bind(id).fetch_all(&pool).await.unwrap();
        let template_cascade = sqlx::query("DELETE FROM clinic_session_templates WHERE id=$1")
            .bind(original.id)
            .execute(&pool)
            .await
            .is_ok();
        let session_cascade = sqlx::query("DELETE FROM clinic_sessions WHERE id=$1")
            .bind(id)
            .execute(&pool)
            .await
            .is_ok();
        let clean:bool=sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM clinic_session_template_appointment_types WHERE clinic_session_template_id=$1) AND NOT EXISTS(SELECT 1 FROM clinic_session_appointment_types WHERE clinic_session_id=$2)").bind(original.id).bind(id).fetch_one(&pool).await.unwrap();
        facts.push((
            nowait,
            none,
            expected == actual,
            template_cascade,
            session_cascade && clean,
        ));
    }
    println!("type23 membership-first generationNOWAIT/noPartial/exactretry/templatecascade/sessioncascade facts={facts:?}");
    assert_eq!(facts, vec![(true, true, true, true, true); 3]);
}
