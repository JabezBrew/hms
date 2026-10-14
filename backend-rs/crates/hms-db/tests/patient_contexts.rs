use chrono::{DateTime, Utc};
use hms_db::care::{NewCareTeamAssignment, NewEncounter, NewVisit};
use hms_db::patients::{PatientContextCursor, PatientContextFilters};
use hms_db::test_support::TestDb;
use hms_domain::care::{CareTeamRole, EncounterStatus, EncounterType, VisitStatus};
use hms_domain::patients::{PatientContextKind, PatientContextListItem, PatientRecord};
use uuid::Uuid;

#[tokio::test]
async fn current_owned_and_care_team_encounters_derive_assignments_without_persisting_grants() {
    let fixture = ContextFixture::new().await;
    let patient = fixture.patient("context-owned").await;
    assert!(fixture.for_patient(patient.id).await.is_empty());
    let other_encounter = fixture
        .encounter(patient.id, fixture.db.owner_user_id(), None)
        .await;
    assert!(fixture.for_patient(patient.id).await.is_empty());
    let owned = fixture.encounter(patient.id, fixture.actor_id, None).await;
    let assigned = fixture.for_patient(patient.id).await;
    assert_eq!(assigned.len(), 1);
    assert!(matches!(
        &assigned[0].context_kind,
        PatientContextKind::Assigned
    ));
    let membership = fixture.assign(other_encounter, fixture.actor_id).await;
    assert_eq!(fixture.for_patient(patient.id).await.len(), 1);
    hms_db::care::update_encounter_status(
        fixture.pool(),
        fixture.facility_id(),
        owned,
        EncounterStatus::Completed,
    )
    .await
    .expect("owned encounter completes")
    .expect("encounter exists");
    assert_eq!(
        fixture.for_patient(patient.id).await.len(),
        1,
        "active care-team membership remains a source"
    );
    sqlx::query("UPDATE encounter_care_team_assignments SET is_active = FALSE WHERE id = $1")
        .bind(membership)
        .execute(fixture.pool())
        .await
        .expect("synthetic membership is deactivated");
    assert!(fixture.for_patient(patient.id).await.is_empty());
    let persisted = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM patient_contexts WHERE facility_id = $1 AND user_id = $2 AND patient_id = $3",
    ).bind(fixture.facility_id()).bind(fixture.actor_id).bind(patient.id).fetch_one(fixture.pool())
        .await.expect("persisted context count loads");
    assert_eq!(
        persisted, 0,
        "reading current care relationships never creates a lasting assignment grant"
    );
}

#[tokio::test]
async fn context_patient_deduplication_preserves_explicit_facts_and_stable_bounded_cursors() {
    let fixture = ContextFixture::new().await;
    let mut patients = Vec::new();
    let mut encounters = Vec::new();
    for slug in ["context-tie-a", "context-tie-b", "context-tie-c"] {
        let patient = fixture.patient(slug).await;
        encounters.push(fixture.encounter(patient.id, fixture.actor_id, None).await);
        patients.push(patient);
    }
    fixture.assign(encounters[0], fixture.actor_id).await;
    for (patient_id, kind) in [
        (patients[0].id, PatientContextKind::Assigned),
        (patients[0].id, PatientContextKind::Recent),
        (patients[1].id, PatientContextKind::Recent),
    ] {
        hms_db::patients::upsert_patient_context(
            fixture.pool(),
            fixture.facility_id(),
            fixture.actor_id,
            patient_id,
            kind,
            None,
        )
        .await
        .expect("explicit context fact is recorded");
    }
    let timestamp: DateTime<Utc> = "2026-06-04T12:00:00Z"
        .parse()
        .expect("synthetic timestamp is valid");
    sqlx::query(
        "UPDATE encounters SET started_at = $1 WHERE facility_id = $2 AND created_by_user_id = $3",
    )
    .bind(timestamp)
    .bind(fixture.facility_id())
    .bind(fixture.actor_id)
    .execute(fixture.pool())
    .await
    .expect("equal source timestamps prepare");
    sqlx::query("UPDATE encounter_care_team_assignments SET created_at = $1 WHERE user_id = $2")
        .bind(timestamp)
        .bind(fixture.actor_id)
        .execute(fixture.pool())
        .await
        .expect("equal team timestamp prepares");
    sqlx::query(
        "UPDATE patient_contexts SET updated_at = $1 WHERE facility_id = $2 AND user_id = $3",
    )
    .bind(timestamp)
    .bind(fixture.facility_id())
    .bind(fixture.actor_id)
    .execute(fixture.pool())
    .await
    .expect("equal persisted context timestamps prepare");

    let mut expected: Vec<_> = patients.iter().map(|patient| patient.id).collect();
    expected.sort_unstable_by(|left, right| right.cmp(left));
    let mut observed = Vec::new();
    let mut cursor = None;
    for expected_id in expected {
        let (page, query_count) =
            hms_observability::with_request_query_counter(hms_db::patients::list_context_patients(
                fixture.pool(),
                fixture.facility_id(),
                fixture.actor_id,
                cursor,
                1,
                PatientContextFilters::default(),
            ))
            .await;
        let page = page.expect("context cursor page loads");
        assert_eq!(
            query_count, 1,
            "each page uses one scoped query and no separate total/count hydration"
        );
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].id, expected_id);
        assert_eq!(page[0].updated_at, timestamp);
        assert!(matches!(
            &page[0].context_kind,
            PatientContextKind::Assigned
        ));
        observed.push(page[0].id);
        cursor = Some(PatientContextCursor {
            updated_at: page[0].updated_at,
            patient_id: page[0].id,
        });
    }
    assert!(hms_db::patients::list_context_patients(
        fixture.pool(),
        fixture.facility_id(),
        fixture.actor_id,
        cursor,
        1,
        PatientContextFilters::default()
    )
    .await
    .expect("last page loads")
    .is_empty());
    observed.sort_unstable();
    observed.dedup();
    assert_eq!(observed.len(), 3);
    let filtered = hms_db::patients::list_context_patients(
        fixture.pool(),
        fixture.facility_id(),
        fixture.actor_id,
        None,
        2,
        PatientContextFilters {
            patient_id: Some(patients[0].id),
            search: Some(format!(
                "{} {}",
                patients[0].first_name, patients[0].last_name
            )),
        },
    )
    .await
    .expect("patient/search filters combine after deduplication");
    assert_eq!(filtered.len(), 1);
    for encounter in encounters {
        hms_db::care::update_encounter_status(
            fixture.pool(),
            fixture.facility_id(),
            encounter,
            EncounterStatus::Completed,
        )
        .await
        .expect("active encounter completes");
    }
    let retained = fixture.rows().await;
    assert_eq!(retained.len(), 2);
    assert!(matches!(
        &retained
            .iter()
            .find(|row| row.id == patients[0].id)
            .expect("explicit assignment survives")
            .context_kind,
        PatientContextKind::Assigned
    ));
    assert!(matches!(
        &retained
            .iter()
            .find(|row| row.id == patients[1].id)
            .expect("recent context survives")
            .context_kind,
        PatientContextKind::Recent
    ));
    sqlx::query("UPDATE users SET is_active = FALSE WHERE id = $1")
        .bind(fixture.actor_id)
        .execute(fixture.pool())
        .await
        .expect("synthetic caller is deactivated");
    assert!(fixture.rows().await.is_empty());
}

#[tokio::test]
async fn context_relationships_expire_on_closed_visits_and_reject_cross_patient_or_facility_links()
{
    let fixture = ContextFixture::new().await;
    let patient = fixture.patient("context-linked").await;
    for status in [
        VisitStatus::CheckedOut,
        VisitStatus::NoShow,
        VisitStatus::Cancelled,
    ] {
        let visit = fixture.visit(patient.id).await;
        fixture
            .encounter(patient.id, fixture.actor_id, Some(visit))
            .await;
        assert_eq!(fixture.for_patient(patient.id).await.len(), 1);
        hms_db::care::update_visit_status(fixture.pool(), fixture.facility_id(), visit, status)
            .await
            .expect("linked visit closes")
            .expect("visit exists");
        assert!(
            fixture.for_patient(patient.id).await.is_empty(),
            "an unfinished encounter cannot retain an expired visit assignment"
        );
    }
    let other_patient = fixture.patient("context-other").await;
    let other_visit = fixture.visit(other_patient.id).await;
    let mismatched = fixture
        .encounter(patient.id, fixture.actor_id, Some(other_visit))
        .await;
    fixture.assign(mismatched, fixture.actor_id).await;
    assert!(
        fixture.for_patient(patient.id).await.is_empty(),
        "both owner/team sources validate linked visit patient"
    );
    let unlinked = fixture.patient("context-unlinked").await;
    fixture.encounter(unlinked.id, fixture.actor_id, None).await;
    assert_eq!(fixture.for_patient(unlinked.id).await.len(), 1);
    assert!(hms_db::patients::list_context_patients(
        fixture.pool(),
        Uuid::new_v4(),
        fixture.actor_id,
        None,
        10,
        PatientContextFilters::default()
    )
    .await
    .expect("foreign facility query is empty")
    .is_empty());
    assert!(hms_db::patients::list_context_patients(
        fixture.pool(),
        fixture.facility_id(),
        fixture.db.owner_user_id(),
        None,
        10,
        PatientContextFilters {
            patient_id: Some(unlinked.id),
            search: None
        },
    )
    .await
    .expect("unrelated actor query succeeds")
    .is_empty());
    let foreign_facility = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities (id, code, name, deployment_profile) VALUES ($1, 'SYNTHETIC-CONTEXT', 'Synthetic context facility', 'hospital')")
        .bind(foreign_facility).execute(fixture.pool()).await.expect("synthetic second facility creates");
    let foreign_visit = fixture.visit(other_patient.id).await;
    sqlx::query("UPDATE visits SET facility_id = $1 WHERE id = $2")
        .bind(foreign_facility)
        .bind(foreign_visit)
        .execute(fixture.pool())
        .await
        .expect("synthetic cross-facility visit link prepares");
    fixture
        .encounter(other_patient.id, fixture.actor_id, Some(foreign_visit))
        .await;
    assert!(fixture.for_patient(other_patient.id).await.is_empty());
}

struct ContextFixture {
    db: TestDb,
    actor_id: Uuid,
}

impl ContextFixture {
    async fn new() -> Self {
        let db = TestDb::hospital()
            .await
            .expect("isolated context database provisions");
        let actor_id = Uuid::new_v4();
        sqlx::query("INSERT INTO users (id, facility_id, email, display_name, password_hash) VALUES ($1, $2, $3, 'Synthetic context clinician', 'test-only-unused-hash')")
            .bind(actor_id).bind(db.facility_id()).bind(format!("{actor_id}@synthetic.invalid")).execute(db.pool())
            .await.expect("synthetic scoped clinician creates");
        Self { db, actor_id }
    }
    fn pool(&self) -> &hms_db::PgPool {
        self.db.pool()
    }
    fn facility_id(&self) -> Uuid {
        self.db.facility_id()
    }
    async fn patient(&self, slug: &str) -> PatientRecord {
        self.db
            .scenario(slug)
            .registered_patient()
            .await
            .expect("synthetic patient registers without a context side effect")
    }
    async fn encounter(&self, patient_id: Uuid, owner_id: Uuid, visit_id: Option<Uuid>) -> Uuid {
        hms_db::care::create_encounter(
            self.pool(),
            NewEncounter {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                visit_id,
                encounter_type: EncounterType::Outpatient,
                created_by_user_id: owner_id,
            },
        )
        .await
        .expect("synthetic encounter starts through the production interface")
        .id
    }
    async fn assign(&self, encounter_id: Uuid, user_id: Uuid) -> Uuid {
        hms_db::care::create_care_team_assignment(
            self.pool(),
            NewCareTeamAssignment {
                id: Uuid::new_v4(),
                encounter_id,
                user_id,
                role: CareTeamRole::Nurse,
                created_by_user_id: self.db.owner_user_id(),
            },
        )
        .await
        .expect("synthetic care-team assignment creates")
        .id
    }
    async fn visit(&self, patient_id: Uuid) -> Uuid {
        hms_db::care::check_in_visit(
            self.pool(),
            NewVisit {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                appointment_id: None,
                clinic_id: None,
                created_by_user_id: self.db.owner_user_id(),
            },
        )
        .await
        .expect("synthetic patient checks in")
        .id
    }
    async fn rows(&self) -> Vec<PatientContextListItem> {
        hms_db::patients::list_context_patients(
            self.pool(),
            self.facility_id(),
            self.actor_id,
            None,
            25,
            PatientContextFilters::default(),
        )
        .await
        .expect("current context list loads")
    }
    async fn for_patient(&self, patient_id: Uuid) -> Vec<PatientContextListItem> {
        hms_db::patients::list_context_patients(
            self.pool(),
            self.facility_id(),
            self.actor_id,
            None,
            25,
            PatientContextFilters {
                patient_id: Some(patient_id),
                search: None,
            },
        )
        .await
        .expect("current context patient filter loads")
    }
}
