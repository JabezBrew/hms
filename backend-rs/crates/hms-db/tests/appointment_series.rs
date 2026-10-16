use chrono::{Duration, Utc};
use hms_db::{appointment_series::*, care::*, test_support::TestDb};
use hms_domain::{appointment_series::*, care::AppointmentStatus};
use uuid::Uuid;

struct Fixture {
    db: TestDb,
    patient: Uuid,
    clinic: Uuid,
    service: Uuid,
    sessions: Vec<Uuid>,
    starts: Vec<chrono::DateTime<Utc>>,
}
impl Fixture {
    async fn new(count: usize) -> Self {
        let db = TestDb::hospital().await.unwrap();
        let patient = db
            .scenario("series-safe")
            .registered_patient()
            .await
            .unwrap()
            .id;
        let clinic = create_clinic(
            db.pool(),
            NewClinic {
                id: Uuid::new_v4(),
                facility_id: db.facility_id(),
                code: "SYN-SERIES".into(),
                name: "Synthetic series clinic".into(),
                actor_user_id: db.owner_user_id(),
            },
        )
        .await
        .unwrap()
        .id;
        let service = create_appointment_type(
            db.pool(),
            NewAppointmentType {
                id: Uuid::new_v4(),
                facility_id: db.facility_id(),
                code: "SYN-REVIEW".into(),
                name: "Synthetic review".into(),
                default_duration_minutes: 20,
                created_by_user_id: db.owner_user_id(),
            },
        )
        .await
        .unwrap()
        .id;
        let mut sessions = vec![];
        let mut starts = vec![];
        for day in 1..=count {
            let start = Utc::now()
                .date_naive()
                .and_hms_opt(9, 0, 0)
                .unwrap()
                .and_utc()
                + Duration::days(day as i64);
            sessions.push(
                create_clinic_session(
                    db.pool(),
                    NewClinicSession {
                        id: Uuid::new_v4(),
                        facility_id: db.facility_id(),
                        clinic_id: Some(clinic),
                        service_code: None,
                        practitioner_user_id: Some(db.owner_user_id()),
                        owner_type: ClinicSessionOwnerType::Practitioner,
                        owner_id: Some(db.owner_user_id()),
                        name: "Synthetic review session".into(),
                        mode: ClinicSessionMode::FixedSlot,
                        starts_at: start,
                        ends_at: start + Duration::hours(1),
                        slot_minutes: Some(20),
                        capacity: 1,
                        allow_overbooking: false,
                        overbook_limit: 0,
                        created_by_user_id: db.owner_user_id(),
                    },
                )
                .await
                .unwrap()
                .id,
            );
            starts.push(start);
        }
        Self {
            db,
            patient,
            clinic,
            service,
            sessions,
            starts,
        }
    }
    fn actor(&self) -> SeriesActor {
        SeriesActor {
            facility_id: self.db.facility_id(),
            user_id: self.db.owner_user_id(),
            request_id: Some("synthetic-series-test".into()),
        }
    }
    fn data(&self) -> CreateAppointmentSeriesRequest {
        CreateAppointmentSeriesRequest {
            client_request_id: Uuid::new_v4(),
            patient_id: self.patient,
            clinic_id: self.clinic,
            service_id: self.service,
            occurrences: self
                .sessions
                .iter()
                .zip(&self.starts)
                .map(|(id, start)| AppointmentSeriesOccurrence {
                    session_id: *id,
                    starts_at: *start,
                    ends_at: *start + Duration::minutes(20),
                    overbook_reason: None,
                })
                .collect(),
        }
    }
    async fn counts(&self) -> (i64, i64, i64) {
        sqlx::query_as("SELECT (SELECT count(*) FROM appointment_series WHERE patient_id=$1),(SELECT count(*) FROM appointments WHERE patient_id=$1),(SELECT count(*) FROM audit_events WHERE event_type='appointment.series_created')").bind(self.patient).fetch_one(self.db.pool()).await.unwrap()
    }
    async fn prebook(&self, index: usize) {
        create_booked_appointment(
            self.db.pool(),
            NewBookedAppointment {
                id: Uuid::new_v4(),
                facility_id: self.db.facility_id(),
                patient_id: self.patient,
                clinic_id: Some(self.clinic),
                clinic_session_id: Some(self.sessions[index]),
                appointment_type_id: Some(self.service),
                practitioner_user_id: Some(self.db.owner_user_id()),
                starts_at: self.starts[index],
                ends_at: self.starts[index] + Duration::minutes(20),
                overbook_reason: None,
                series_id: None,
                created_by_user_id: self.db.owner_user_id(),
            },
        )
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn exact_request_concurrency_is_one_atomic_series_and_replay_preserves_membership() {
    let f = Fixture::new(2).await;
    let data = f.data();
    let (left, right) = tokio::join!(
        create_series(f.db.pool(), f.actor(), data.clone()),
        create_series(f.db.pool(), f.actor(), data.clone())
    );
    let left = left.unwrap();
    let right = right.unwrap();
    assert_eq!(left.id, right.id);
    assert_eq!(left.snapshot_token, right.snapshot_token);
    assert_eq!(f.counts().await, (1, 2, 1));
    assert!(left
        .appointments
        .iter()
        .all(|a| a.practitioner_user_id == Some(f.db.owner_user_id())));
    let mut changed = data.clone();
    changed.occurrences[0].overbook_reason = Some("Different instructions".into());
    assert_eq!(
        create_series(f.db.pool(), f.actor(), changed)
            .await
            .unwrap_err()
            .downcast_ref::<SeriesError>(),
        Some(&SeriesError::RequestConflict)
    );
    assert_eq!(
        series_by_request(f.db.pool(), &f.actor(), data.client_request_id)
            .await
            .unwrap(),
        Some(left.id)
    );
    let mut other = f.actor();
    other.user_id = Uuid::new_v4();
    assert_eq!(
        series_by_request(f.db.pool(), &other, data.client_request_id)
            .await
            .unwrap(),
        None
    );
    assert!(get_series(f.db.pool(), Uuid::new_v4(), left.id)
        .await
        .unwrap()
        .is_none());
    let page = list_series(f.db.pool(), f.db.facility_id(), f.patient, None, 1)
        .await
        .unwrap();
    assert_eq!(page.len(), 1);
    assert_eq!(page[0].scheduled_count, 2);
    assert!(
        list_series(f.db.pool(), f.db.facility_id(), Uuid::new_v4(), None, 100)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn maximum_series_persists_fifty_real_slots_and_rejects_a_larger_batch_before_writes() {
    let f = Fixture::new(50).await;
    let data = f.data();
    let mut oversized = data.clone();
    oversized.occurrences.push(data.occurrences[0].clone());
    assert_eq!(
        create_series(f.db.pool(), f.actor(), oversized)
            .await
            .unwrap_err()
            .downcast_ref::<SeriesError>(),
        Some(&SeriesError::Invalid)
    );
    assert_eq!(f.counts().await, (0, 0, 0));
    let saved = create_series(f.db.pool(), f.actor(), data).await.unwrap();
    assert_eq!(saved.occurrence_count, 50);
    assert_eq!(saved.appointments.len(), 50);
    assert_eq!(f.counts().await, (1, 50, 1));
}
#[tokio::test]
async fn later_capacity_conflict_or_competing_series_never_leaves_a_partial_series() {
    let f = Fixture::new(2).await;
    f.prebook(1).await;
    assert!(create_series(f.db.pool(), f.actor(), f.data())
        .await
        .is_err());
    assert_eq!(f.counts().await, (0, 1, 0));
    sqlx::query("DELETE FROM appointments WHERE patient_id=$1")
        .bind(f.patient)
        .execute(f.db.pool())
        .await
        .unwrap();
    let left = f.data();
    let mut right = f.data();
    right.occurrences.reverse();
    let (a, b) = tokio::join!(
        create_series(f.db.pool(), f.actor(), left),
        create_series(f.db.pool(), f.actor(), right)
    );
    assert_ne!(a.is_ok(), b.is_ok());
    assert_eq!(f.counts().await, (1, 2, 1));
}
#[tokio::test]
async fn bounds_real_grid_active_references_and_service_constraints_are_rechecked() {
    let f = Fixture::new(2).await;
    let mut data = f.data();
    data.occurrences[0].starts_at += Duration::minutes(1);
    data.occurrences[0].ends_at += Duration::minutes(1);
    assert!(create_series(f.db.pool(), f.actor(), data).await.is_err());
    let mut data = f.data();
    data.occurrences[1] = data.occurrences[0].clone();
    assert!(create_series(f.db.pool(), f.actor(), data).await.is_err());
    let mut data = f.data();
    data.occurrences[1].starts_at += Duration::days(181);
    data.occurrences[1].ends_at += Duration::days(181);
    assert!(create_series(f.db.pool(), f.actor(), data).await.is_err());
    let mut data = f.data();
    data.service_id = Uuid::new_v4();
    assert!(create_series(f.db.pool(), f.actor(), data).await.is_err());
    sqlx::query("UPDATE clinics SET is_active=false WHERE id=$1")
        .bind(f.clinic)
        .execute(f.db.pool())
        .await
        .unwrap();
    assert!(create_series(f.db.pool(), f.actor(), f.data())
        .await
        .is_err());
    sqlx::query("UPDATE clinics SET is_active=true WHERE id=$1")
        .bind(f.clinic)
        .execute(f.db.pool())
        .await
        .unwrap();
    let other = create_appointment_type(
        f.db.pool(),
        NewAppointmentType {
            id: Uuid::new_v4(),
            facility_id: f.db.facility_id(),
            code: "SYN-OTHER".into(),
            name: "Synthetic other".into(),
            default_duration_minutes: 20,
            created_by_user_id: f.db.owner_user_id(),
        },
    )
    .await
    .unwrap();
    constrain_appointment_type_to_session(f.db.pool(), f.db.facility_id(), f.sessions[1], other.id)
        .await
        .unwrap();
    assert!(create_series(f.db.pool(), f.actor(), f.data())
        .await
        .is_err());
    assert_eq!(f.counts().await, (0, 0, 0));
}
#[tokio::test]
async fn cancel_future_uses_reviewed_snapshot_and_fixed_replay_cutoff_preserving_arrived_and_past()
{
    let f = Fixture::new(3).await;
    let data = f.data();
    let series = create_series(f.db.pool(), f.actor(), data.clone())
        .await
        .unwrap();
    let first = series
        .appointments
        .iter()
        .find(|a| a.starts_at == f.starts[0])
        .unwrap()
        .id;
    let second = series
        .appointments
        .iter()
        .find(|a| a.starts_at == f.starts[1])
        .unwrap()
        .id;
    sqlx::query("UPDATE appointments SET status='checked_in' WHERE id=$1")
        .bind(first)
        .execute(f.db.pool())
        .await
        .unwrap();
    sqlx::query("UPDATE appointments SET starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' WHERE id=$1").bind(second).execute(f.db.pool()).await.unwrap();
    let mut command = CancelFutureAppointmentsRequest {
        client_request_id: Uuid::new_v4(),
        expected_snapshot_token: series.snapshot_token.clone(),
        reason: "Synthetic cancellation".into(),
    };
    assert_eq!(
        cancel_future(f.db.pool(), f.actor(), series.id, command.clone())
            .await
            .unwrap_err()
            .downcast_ref::<SeriesError>(),
        Some(&SeriesError::SnapshotChanged)
    );
    command.expected_snapshot_token = get_series(f.db.pool(), f.db.facility_id(), series.id)
        .await
        .unwrap()
        .unwrap()
        .snapshot_token;
    let (a, b) = tokio::join!(
        cancel_future(f.db.pool(), f.actor(), series.id, command.clone()),
        cancel_future(f.db.pool(), f.actor(), series.id, command.clone())
    );
    let a = a.unwrap().unwrap();
    let b = b.unwrap().unwrap();
    assert_eq!(a.cancelled_count, 1);
    assert_eq!(a.cutoff_at, b.cutoff_at);
    assert_eq!(a.cancelled_appointment_ids, b.cancelled_appointment_ids);
    assert_eq!(a.retained_appointment_ids.len(), 2);
    assert_eq!(
        a.series
            .appointments
            .iter()
            .find(|m| m.id == first)
            .unwrap()
            .status,
        AppointmentStatus::CheckedIn
    );
    assert_eq!(
        a.series
            .appointments
            .iter()
            .find(|m| m.id == second)
            .unwrap()
            .status,
        AppointmentStatus::Scheduled
    );
    let replay = create_series(f.db.pool(), f.actor(), data).await.unwrap();
    assert_eq!(replay.id, series.id);
    assert_eq!(replay.snapshot_token, a.series.snapshot_token);
    let counts:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM appointment_history WHERE event_type='cancelled'),(SELECT count(*) FROM audit_events WHERE event_type='appointment.series_future_cancelled')").fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(counts, (1, 1));
    command.reason = "Different cancellation".into();
    assert_eq!(
        cancel_future(f.db.pool(), f.actor(), series.id, command)
            .await
            .unwrap_err()
            .downcast_ref::<SeriesError>(),
        Some(&SeriesError::RequestConflict)
    );
}
#[tokio::test]
async fn create_and_cancellation_audit_failure_roll_back_all_members_history_and_receipts() {
    let f = Fixture::new(2).await;
    sqlx::query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_series_failure CHECK(event_type NOT IN ('appointment.series_created','appointment.series_future_cancelled'))").execute(f.db.pool()).await.unwrap();
    assert!(create_series(f.db.pool(), f.actor(), f.data())
        .await
        .is_err());
    assert_eq!(f.counts().await, (0, 0, 0));
    sqlx::query("ALTER TABLE audit_events DROP CONSTRAINT synthetic_series_failure")
        .execute(f.db.pool())
        .await
        .unwrap();
    let saved = create_series(f.db.pool(), f.actor(), f.data())
        .await
        .unwrap();
    sqlx::query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_series_failure CHECK(event_type<>'appointment.series_future_cancelled')").execute(f.db.pool()).await.unwrap();
    assert!(cancel_future(
        f.db.pool(),
        f.actor(),
        saved.id,
        CancelFutureAppointmentsRequest {
            client_request_id: Uuid::new_v4(),
            expected_snapshot_token: saved.snapshot_token.clone(),
            reason: "Synthetic reason".into()
        }
    )
    .await
    .is_err());
    let after = get_series(f.db.pool(), f.db.facility_id(), saved.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(after.snapshot_token, saved.snapshot_token);
    let counts:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM appointment_history),(SELECT count(*) FROM appointment_series_cancellations)").fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(counts, (0, 0));
}
async fn wait_advisory(db: &TestDb, number: i64) {
    tokio::time::timeout(std::time::Duration::from_secs(5),async {loop{let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=$1::bigint::oid)").bind(number).fetch_one(db.pool()).await.unwrap();if waiting{break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.unwrap();
}
#[tokio::test]
async fn session_and_practitioner_exceptions_serialize_with_atomic_series_booking() {
    for practitioner in [false, true] {
        let f = Fixture::new(2).await;
        sqlx::raw_sql("CREATE FUNCTION pause_exception_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(88123); RETURN NEW; END $$; CREATE TRIGGER pause_exception_insert BEFORE INSERT ON appointment_blocked_times FOR EACH ROW EXECUTE FUNCTION pause_exception_insert();").execute(f.db.pool()).await.unwrap();
        let mut gate = f.db.pool().begin().await.unwrap();
        sqlx::query("SELECT pg_advisory_xact_lock(88123)")
            .execute(&mut *gate)
            .await
            .unwrap();
        let pool = f.db.pool().clone();
        let facility = f.db.facility_id();
        let user = f.db.owner_user_id();
        let start = f.starts[0];
        let session = f.sessions[0];
        let exception = tokio::spawn(async move {
            hms_db::scheduling::create_exception(
                &pool,
                hms_db::scheduling::NewSchedulingException {
                    id: Uuid::new_v4(),
                    facility_id: facility,
                    session_id: (!practitioner).then_some(session),
                    practitioner_user_id: practitioner.then_some(user),
                    starts_at: start,
                    ends_at: start + Duration::minutes(20),
                    reason: "Synthetic exception".into(),
                    created_by_user_id: user,
                },
            )
            .await
        });
        wait_advisory(&f.db, 88123).await;
        let pool = f.db.pool().clone();
        let actor = f.actor();
        let data = f.data();
        let mut booking = tokio::spawn(async move { create_series(&pool, actor, data).await });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(100), &mut booking)
                .await
                .is_err()
        );
        gate.commit().await.unwrap();
        exception.await.unwrap().unwrap();
        assert!(booking.await.unwrap().is_err());
        assert_eq!(f.counts().await, (0, 0, 0));
    }
}
#[tokio::test]
async fn rescheduling_waits_for_session_cancellation_without_reverse_lock_deadlock() {
    let f = Fixture::new(2).await;
    let saved = create_series(f.db.pool(), f.actor(), f.data())
        .await
        .unwrap();
    let appointment = saved
        .appointments
        .iter()
        .find(|a| a.clinic_session_id == f.sessions[0])
        .unwrap()
        .id;
    sqlx::raw_sql("CREATE FUNCTION pause_session_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT NEW.is_active THEN PERFORM pg_advisory_xact_lock(89123); END IF; RETURN NEW; END $$; CREATE TRIGGER pause_session_cancel AFTER UPDATE ON clinic_sessions FOR EACH ROW EXECUTE FUNCTION pause_session_cancel();").execute(f.db.pool()).await.unwrap();
    let mut gate = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(89123)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let facility = f.db.facility_id();
    let user = f.db.owner_user_id();
    let session = f.sessions[0];
    let cancel = tokio::spawn(async move {
        hms_db::scheduling::cancel_bookable_session(
            &pool,
            facility,
            session,
            user,
            "Synthetic cancellation",
        )
        .await
    });
    wait_advisory(&f.db, 89123).await;
    let pool = f.db.pool().clone();
    let start = f.starts[0] + Duration::minutes(20);
    let mut update = tokio::spawn(async move {
        update_appointment(
            &pool,
            AppointmentUpdate {
                id: appointment,
                facility_id: facility,
                starts_at: Some(start),
                ends_at: Some(start + Duration::minutes(20)),
                actor_user_id: user,
            },
        )
        .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut update)
            .await
            .is_err()
    );
    gate.commit().await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        cancel.await.unwrap().unwrap();
        let result = update.await.unwrap();
        assert!(result.is_err() || result.unwrap().is_none());
    })
    .await
    .unwrap();
    assert_eq!(
        get_appointment(f.db.pool(), facility, appointment)
            .await
            .unwrap()
            .unwrap()
            .status,
        AppointmentStatus::Cancelled
    );
}

#[tokio::test]
async fn arrival_after_concurrent_future_cancellation_cannot_revive_a_member_or_create_a_visit() {
    let f = Fixture::new(2).await;
    let saved = create_series(f.db.pool(), f.actor(), f.data())
        .await
        .unwrap();
    sqlx::raw_sql("CREATE FUNCTION pause_series_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='appointment.series_future_cancelled' THEN PERFORM pg_advisory_xact_lock(90123); END IF; RETURN NEW; END $$; CREATE TRIGGER pause_series_cancel BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION pause_series_cancel();").execute(f.db.pool()).await.unwrap();
    let mut gate = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(90123)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let actor = f.actor();
    let id = saved.id;
    let command = CancelFutureAppointmentsRequest {
        client_request_id: Uuid::new_v4(),
        expected_snapshot_token: saved.snapshot_token,
        reason: "Synthetic cancellation".into(),
    };
    let cancel = tokio::spawn(async move { cancel_future(&pool, actor, id, command).await });
    wait_advisory(&f.db, 90123).await;
    let pool = f.db.pool().clone();
    let facility = f.db.facility_id();
    let patient = f.patient;
    let clinic = f.clinic;
    let actor = f.db.owner_user_id();
    let appointment = saved.appointments[0].id;
    let mut arrival = tokio::spawn(async move {
        check_in_visit(
            &pool,
            NewVisit {
                id: Uuid::new_v4(),
                facility_id: facility,
                patient_id: patient,
                appointment_id: Some(appointment),
                clinic_id: Some(clinic),
                created_by_user_id: actor,
            },
        )
        .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut arrival)
            .await
            .is_err()
    );
    gate.commit().await.unwrap();
    assert_eq!(cancel.await.unwrap().unwrap().unwrap().cancelled_count, 2);
    assert!(arrival.await.unwrap().is_err());
    let visits: i64 = sqlx::query_scalar("SELECT count(*) FROM visits WHERE appointment_id=$1")
        .bind(appointment)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(visits, 0);
    assert_eq!(
        get_appointment(f.db.pool(), facility, appointment)
            .await
            .unwrap()
            .unwrap()
            .status,
        AppointmentStatus::Cancelled
    );
}
