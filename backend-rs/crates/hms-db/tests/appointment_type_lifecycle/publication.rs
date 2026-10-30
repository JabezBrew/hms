use super::*;

pub(super) async fn new_type(pool: &hms_db::PgPool, facility: Uuid, actor: Uuid) -> Uuid {
    let id = Uuid::new_v4();
    hms_db::scheduling::create_bookable_service(
        pool,
        hms_db::scheduling::NewBookableService {
            id,
            facility_id: facility,
            code: format!("SYNTH{}", id.simple()),
            name: "Synthetic reference control".into(),
            default_duration_minutes: 30,
            created_by_user_id: actor,
        },
    )
    .await
    .unwrap();
    id
}

#[tokio::test]
async fn allowed_link_reparent_requires_current_active_type_and_preserves_old_tuple() {
    let (_db, pool, baseline, actor) = fixture().await;
    let facility = baseline.facility_id;
    let mut facts = Vec::new();
    for is_template in [false, true] {
        let retired = new_type(&pool, facility, actor).await;
        let active = new_type(&pool, facility, actor).await;
        let (a, b) = if is_template {
            let mut first = template(facility, actor, None, vec![retired, active]);
            first.starts_on = Utc::now().date_naive() - Duration::days(10);
            first.ends_on = Some(Utc::now().date_naive() - Duration::days(1));
            let mut second = first.clone();
            second.id = Uuid::new_v4();
            second.allowed_service_ids = vec![];
            let a = hms_db::scheduling::create_bookable_session_template(&pool, first)
                .await
                .unwrap()
                .id;
            let b = hms_db::scheduling::create_bookable_session_template(&pool, second)
                .await
                .unwrap()
                .id;
            (a, b)
        } else {
            let a = hms_db::scheduling::create_bookable_session(
                &pool,
                session(facility, actor, None, vec![retired, active], 60),
            )
            .await
            .unwrap()
            .id;
            let b = hms_db::scheduling::create_bookable_session(
                &pool,
                session(facility, actor, None, vec![], 61),
            )
            .await
            .unwrap()
            .id;
            (a, b)
        };
        sqlx::query("UPDATE appointment_types SET is_active=false,version=version+1,updated_at=clock_timestamp() WHERE id=$1").bind(retired).execute(&pool).await.unwrap();
        let (table, column) = if is_template {
            (
                "clinic_session_template_appointment_types",
                "clinic_session_template_id",
            )
        } else {
            ("clinic_session_appointment_types", "clinic_session_id")
        };
        let sql=format!("UPDATE {table} SET {column}=$1 WHERE facility_id=$2 AND {column}=$3 AND appointment_type_id=$4");
        let refused = sqlx::query(&sql)
            .bind(b)
            .bind(facility)
            .bind(a)
            .bind(retired)
            .execute(&pool)
            .await
            .is_err();
        let preserved:bool=sqlx::query_scalar(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE facility_id=$1 AND {column}=$2 AND appointment_type_id=$3)"))
            .bind(facility).bind(a).bind(retired).fetch_one(&pool).await.unwrap();
        let positive = sqlx::query(&sql)
            .bind(b)
            .bind(facility)
            .bind(a)
            .bind(active)
            .execute(&pool)
            .await
            .is_ok();
        facts.push((refused, preserved, positive));
    }
    println!(
        "type23 actual allowed-link reparent refused/originaltuple/activepositive facts={facts:?}"
    );
    assert_eq!(facts, vec![(true, true, true); 2]);
}
