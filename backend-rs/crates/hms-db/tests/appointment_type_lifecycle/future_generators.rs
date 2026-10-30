use super::*;
use chrono::{Datelike, TimeZone};

#[tokio::test]
async fn future_generator_predicate_matches_actual_utc_weekday_windows() {
    let (_db, pool, baseline, actor) = fixture().await;
    let facility = baseline.facility_id;
    let point = Utc
        .with_ymd_and_hms(2026, 10, 18, 10, 0, 0)
        .single()
        .unwrap();
    let today = point.date_naive();
    // (first day, last inclusive day, weekdays, window end hour, active, expected)
    let cases = [
        (0, Some(0), vec![7], 12, true, true), // Ongoing Sunday still has future capacity.
        (0, Some(0), vec![7], 10, true, false), // Exact end is closed.
        (0, None, vec![7], 10, true, true),    // Next Sunday is +6 from Monday base.
        (8, Some(8), vec![1], 12, true, true), // Future starts_on controls the bounded base.
        (1, Some(5), vec![6], 12, true, false), // Finite interval contains no matching weekday.
        (1, Some(6), vec![6], 12, true, true), // Last inclusive allowed day.
        (-8, Some(-1), vec![7], 12, true, false), // Historical template ended.
        (0, None, vec![7], 12, false, false),  // Inactive generators retain history.
        (0, None, vec![7, 7], 12, true, true), // Duplicate weekday imports do not widen the week.
    ];
    let mut observed = Vec::new();
    for (index, (start, last, weekdays, end_hour, active, expected)) in
        cases.into_iter().enumerate()
    {
        let typ = publication::new_type(&pool, facility, actor).await;
        let mut source = template(
            facility,
            actor,
            if index % 2 == 0 { Some(typ) } else { None },
            if index % 2 == 0 { vec![] } else { vec![typ] },
        );
        source.starts_on = today + Duration::days(start);
        source.ends_on = last.map(|v| today + Duration::days(v));
        source.weekdays = weekdays;
        source.end_time = NaiveTime::from_hms_opt(end_hour, 0, 0).unwrap();
        let saved = hms_db::scheduling::create_bookable_session_template(&pool, source.clone())
            .await
            .unwrap();
        if !active {
            sqlx::query("UPDATE clinic_session_templates SET is_active=false WHERE id=$1")
                .bind(saved.id)
                .execute(&pool)
                .await
                .unwrap();
        }
        let actual: bool =
            sqlx::query_scalar("SELECT appointment_type_has_future_generator($1,$2,$3)")
                .bind(facility)
                .bind(typ)
                .bind(point)
                .fetch_one(&pool)
                .await
                .unwrap();
        // Independent bounded calendar reference uses the canonical Rust UTC producer shape.
        let reference = active
            && (0..=21).any(|offset| {
                let day = today + Duration::days(offset);
                day >= source.starts_on
                    && source.ends_on.is_none_or(|end| day <= end)
                    && source
                        .weekdays
                        .contains(&(day.weekday().number_from_monday() as i16))
                    && day.and_time(source.end_time).and_utc() > point
            });
        assert_eq!(reference, expected);
        observed.push((actual, expected));
        let foreign: bool =
            sqlx::query_scalar("SELECT appointment_type_has_future_generator($1,$2,$3)")
                .bind(Uuid::new_v4())
                .bind(typ)
                .bind(point)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(!foreign);
    }
    // PostgreSQL's historical array_length(empty)=NULL CHECK permits an empty
    // imported weekday array. Keep it readable; it must create no occurrence.
    let typ = publication::new_type(&pool, facility, actor).await;
    sqlx::query("INSERT INTO clinic_session_templates(id,facility_id,owner_type,owner_id,name,mode,weekdays,starts_on,start_time,end_time,capacity)VALUES($1,$2,'service',$3,'Synthetic imported empty week','capacity_block',ARRAY[]::smallint[],$4,'08:00','12:00',1)")
        .bind(Uuid::new_v4()).bind(facility).bind(typ).bind(today).execute(&pool).await.unwrap();
    let empty: bool = sqlx::query_scalar("SELECT appointment_type_has_future_generator($1,$2,$3)")
        .bind(facility)
        .bind(typ)
        .bind(point)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!empty);
    println!("type23 actual UTC future-generator/independent calendar facts={observed:?}; empty_import_matches={empty}");
    assert!(observed.iter().all(|(actual, expected)| actual == expected));
}
