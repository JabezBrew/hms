use chrono::{Duration, Utc};
use hms_db::{
    clinical::{
        note_records as notes, note_templates as templates,
        prescription_courses::PrescriptionAuthorization,
    },
    test_support::TestDb,
};
use hms_domain::{clinical::ClinicalNoteType, clinical_notes::*, deployment::DeploymentProfile};
use uuid::Uuid;
struct Fixture {
    db: TestDb,
    patient: Uuid,
    actor: notes::NoteActor,
}
impl Fixture {
    async fn new() -> Self {
        let db = TestDb::hospital().await.unwrap();
        let patient = db
            .scenario("synthetic-note-evidence")
            .registered_patient()
            .await
            .unwrap()
            .id;
        let actor = actor(&db, db.owner_user_id()).await;
        Self { db, patient, actor }
    }
    fn input(&self) -> RecordClinicalNoteRequest {
        RecordClinicalNoteRequest {
            client_request_id: Uuid::new_v4(),
            encounter_id: None,
            template_revision_id: None,
            note_type: ClinicalNoteType::DoctorNote,
            title: "  Synthetic reviewed note  ".into(),
            body: "  Synthetic exact content\n".into(),
        }
    }
    async fn save(&self) -> ClinicalNoteCommandReceipt {
        notes::record(
            self.db.pool(),
            self.actor.clone(),
            self.patient,
            self.input(),
        )
        .await
        .unwrap()
    }
    fn amendment(&self, version: i64) -> AmendClinicalNoteRequest {
        AmendClinicalNoteRequest {
            client_request_id: Uuid::new_v4(),
            expected_version: version,
            reason: "  Synthetic correction rationale  ".into(),
            body: "Synthetic amended content".into(),
        }
    }
    fn template(&self) -> RecordNoteTemplateRequest {
        RecordNoteTemplateRequest{client_request_id:Uuid::new_v4(),title:"Synthetic structured template".into(),note_type:ClinicalNoteType::DoctorNote,body_template:r#"{"description":"Synthetic preserved metadata","sections":[{"name":"","section":"Care Plan","required":true}]}"#.into(),is_active:true}
    }
}
async fn actor(db: &TestDb, user: Uuid) -> notes::NoteActor {
    let (sv, pv): (i64, i64) =
        sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
            .bind(user)
            .fetch_one(db.pool())
            .await
            .unwrap();
    let id = Uuid::new_v4();
    let now = Utc::now();
    hms_db::auth::insert_refresh_session(
        db.pool(),
        &hms_db::auth::NewRefreshSession {
            token_hash: id.to_string(),
            session_id: id,
            session_family_id: id,
            rotated_from_session_id: None,
            user_id: user,
            facility_id: db.facility_id(),
            session_version: sv,
            permission_version_at_issue: pv,
            csrf_token_hash: "synthetic-hash".into(),
            expires_at: now + Duration::hours(1),
            session_started_at: now,
            idle_expires_at: now + Duration::minutes(30),
            absolute_expires_at: now + Duration::hours(1),
            device_label: None,
        },
    )
    .await
    .unwrap();
    notes::NoteActor {
        facility_id: db.facility_id(),
        user_id: user,
        request_id: None,
        can_manage: true,
        override_ownership: false,
        authorization: PrescriptionAuthorization {
            resolved_network_policy_version: Some(
                hms_db::network::get_policy(db.pool(), db.facility_id())
                    .await
                    .unwrap()
                    .version,
            ),
            session_id: id,
            session_version: sv,
            permission_version: pv,
            active_profile: DeploymentProfile::Hospital,
            valid_until: now + Duration::minutes(15),
        },
    }
}
fn typed(e: &anyhow::Error, wanted: notes::NoteError) {
    assert_eq!(e.downcast_ref::<notes::NoteError>(), Some(&wanted));
}
#[tokio::test]
async fn exact_commands_preserve_original_context_body_reason_and_immutable_receipts() {
    let f = Fixture::new().await;
    let input = f.input();
    let saved = notes::record(f.db.pool(), f.actor.clone(), f.patient, input.clone())
        .await
        .unwrap();
    assert_eq!(saved.note.title, "Synthetic reviewed note");
    assert_eq!(saved.note.body, input.body);
    assert!(!saved.note.can_amend);
    assert_eq!(saved.note.author_user_id, Some(f.actor.user_id));
    let fresh = notes::get(f.db.pool(), f.actor.clone(), saved.note.id)
        .await
        .unwrap();
    assert!(fresh.can_amend);
    let amend = f.amendment(1);
    let updated = notes::amend(f.db.pool(), f.actor.clone(), saved.note.id, amend.clone())
        .await
        .unwrap();
    assert_eq!(updated.note.version, 2);
    assert_eq!(
        updated.reason.as_deref(),
        Some("Synthetic correction rationale")
    );
    assert_eq!(updated.note.title, saved.note.title);
    let replay = notes::record(f.db.pool(), f.actor.clone(), f.patient, input.clone())
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.note.body, saved.note.body);
    assert_eq!(replay.note.version, 1);
    let receipt = notes::receipt(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        amend.client_request_id,
    )
    .await
    .unwrap();
    assert_eq!(receipt.note.version, 2);
    assert_eq!(receipt.reason, updated.reason);
    let changed = RecordClinicalNoteRequest {
        body: "Different body".into(),
        ..input
    };
    typed(
        &notes::record(f.db.pool(), f.actor.clone(), f.patient, changed)
            .await
            .unwrap_err(),
        notes::NoteError::RequestConflict,
    );
    let history = notes::history(f.db.pool(), f.actor.clone(), saved.note.id, None, 10)
        .await
        .unwrap();
    assert_eq!(history.len(), 2);
    assert!(serde_json::to_value(&history).unwrap()[0]
        .get("body")
        .is_none());
    assert_eq!(history[0].edit_reason, updated.reason);
    let original = notes::get_version(f.db.pool(), f.actor.clone(), saved.note.id, history[1].id)
        .await
        .unwrap();
    assert_eq!(original.body, saved.note.body);
    assert!(
        sqlx::query("UPDATE clinical_note_versions SET body='rewrite' WHERE id=$1")
            .bind(history[1].id)
            .execute(f.db.pool())
            .await
            .is_err()
    );
    let audit: Vec<serde_json::Value> =
        sqlx::query_scalar("SELECT metadata FROM audit_events WHERE resource_id=$1")
            .bind(saved.note.id)
            .fetch_all(f.db.pool())
            .await
            .unwrap();
    assert_eq!(audit.len(), 2);
    assert!(audit
        .iter()
        .all(|v| v.get("body").is_none() && v.get("reason").is_none()));
}
#[tokio::test]
async fn concurrent_same_key_and_source_cas_have_single_evidence_winner() {
    let f = Fixture::new().await;
    let input = f.input();
    let (a, b) = tokio::join!(
        notes::record(f.db.pool(), f.actor.clone(), f.patient, input.clone()),
        notes::record(f.db.pool(), f.actor.clone(), f.patient, input)
    );
    let a = a.unwrap();
    let b = b.unwrap();
    assert_eq!(a.note.id, b.note.id);
    assert_ne!(a.replayed, b.replayed);
    let (a, b) = tokio::join!(
        notes::amend(f.db.pool(), f.actor.clone(), a.note.id, f.amendment(1)),
        notes::amend(f.db.pool(), f.actor.clone(), a.note.id, f.amendment(1))
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    typed(
        &a.err().or(b.err()).unwrap(),
        notes::NoteError::SourceChanged,
    );
}
#[tokio::test]
async fn pinned_templates_preserve_schema_and_require_author_or_explicit_override() {
    let f = Fixture::new().await;
    let template = templates::record(f.db.pool(), f.actor.clone(), f.template())
        .await
        .unwrap();
    let t = &template.template.template;
    let mut input = f.input();
    input.template_revision_id = Some(t.current_revision_id);
    input.body = r#"{"careplan":{"text":"Synthetic structured plan"},"_metadata":false}"#.into();
    let saved = notes::record(f.db.pool(), f.actor.clone(), f.patient, input.clone())
        .await
        .unwrap();
    let change = ChangeNoteTemplateRequest {
        client_request_id: Uuid::new_v4(),
        expected_version: 1,
        title: "Synthetic changed template".into(),
        note_type: ClinicalNoteType::DoctorNote,
        body_template: "New literal text".into(),
        is_active: false,
        change_summary: "Synthetic change".into(),
    };
    let changed = templates::change(f.db.pool(), f.actor.clone(), t.id, change)
        .await
        .unwrap();
    assert_eq!(changed.template.template.version, 2);
    let replay = notes::record(f.db.pool(), f.actor.clone(), f.patient, input.clone())
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(
        replay.note.template_revision.unwrap().body_template,
        template.template.body_template
    );
    input.client_request_id = Uuid::new_v4();
    typed(
        &notes::record(f.db.pool(), f.actor.clone(), f.patient, input)
            .await
            .unwrap_err(),
        notes::NoteError::TemplateUnavailable,
    );
    let mut amend = f.amendment(1);
    typed(
        &notes::amend(f.db.pool(), f.actor.clone(), saved.note.id, amend.clone())
            .await
            .unwrap_err(),
        notes::NoteError::InvalidInput,
    );
    amend.body = r#"{"careplan":"Synthetic corrected plan"}"#.into();
    notes::amend(f.db.pool(), f.actor.clone(), saved.note.id, amend)
        .await
        .unwrap();
    // Unknown imported authors are never inferred from the current viewer.
    let imported = hms_db::clinical::create_note(
        f.db.pool(),
        hms_db::clinical::NewClinicalNote {
            id: Uuid::new_v4(),
            facility_id: f.db.facility_id(),
            patient_id: f.patient,
            encounter_id: None,
            note_type: ClinicalNoteType::DoctorNote,
            title: "Synthetic imported".into(),
            body: "Synthetic legacy".into(),
            actor_user_id: f.actor.user_id,
        },
    )
    .await
    .unwrap();
    // A distinct valid local actor cannot amend another author's evidence.
    let other = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash,is_active,password_change_required) VALUES($1,$2,$3,'Synthetic eligible note reviewer','synthetic-not-used-for-signin',true,false)")
        .bind(other).bind(f.db.facility_id()).bind(format!("note-reviewer-{other}@example.invalid")).execute(f.db.pool()).await.unwrap();
    let mut other = actor(&f.db, other).await;
    typed(
        &notes::amend(f.db.pool(), other.clone(), imported.id, f.amendment(1))
            .await
            .unwrap_err(),
        notes::NoteError::AuthorRequired,
    );
    other.override_ownership = true;
    notes::amend(f.db.pool(), other, imported.id, f.amendment(1))
        .await
        .unwrap();
}
#[tokio::test]
async fn metadata_template_catalog_filters_before_pages_and_escapes_wildcards() {
    let f = Fixture::new().await;
    for i in 0..105 {
        let mut input = f.template();
        input.title = format!("Synthetic unrelated {i}");
        input.is_active = false;
        templates::record(f.db.pool(), f.actor.clone(), input)
            .await
            .unwrap();
    }
    let mut input = f.template();
    input.title = "Synthetic literal %_ filter".into();
    let exact = templates::record(f.db.pool(), f.actor.clone(), input)
        .await
        .unwrap();
    let q = GovernedNoteTemplateQuery {
        cursor: None,
        limit: Some(1),
        search: Some("%_".into()),
        activity: Some(TemplateActivity::Active),
        note_type: Some(ClinicalNoteType::DoctorNote),
    };
    let rows = templates::list(f.db.pool(), f.actor.clone(), q, None, 2)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, exact.template.template.id);
    assert!(serde_json::to_value(&rows).unwrap()[0]
        .get("body_template")
        .is_none());
    let q = GovernedNoteTemplateQuery {
        cursor: None,
        limit: Some(10),
        search: Some("Synthetic unrelated".into()),
        activity: Some(TemplateActivity::Inactive),
        note_type: None,
    };
    let first = templates::list(f.db.pool(), f.actor.clone(), q.clone(), None, 10)
        .await
        .unwrap();
    let last = first.last().unwrap();
    let second = templates::list(
        f.db.pool(),
        f.actor.clone(),
        q,
        Some((last.updated_at, last.id)),
        10,
    )
    .await
    .unwrap();
    assert_eq!(second.len(), 10);
    assert!(second.iter().all(|b| !first.iter().any(|a| a.id == b.id)));
}
#[tokio::test]
async fn note_history_pages_beyond_one_hundred_without_loading_bodies() {
    let f = Fixture::new().await;
    let saved = f.save().await;
    for version in 1..106 {
        notes::amend(
            f.db.pool(),
            f.actor.clone(),
            saved.note.id,
            f.amendment(version),
        )
        .await
        .unwrap();
    }
    let first = notes::history(f.db.pool(), f.actor.clone(), saved.note.id, None, 100)
        .await
        .unwrap();
    assert_eq!(first.len(), 100);
    let second = notes::history(
        f.db.pool(),
        f.actor.clone(),
        saved.note.id,
        Some(first.last().unwrap().version),
        100,
    )
    .await
    .unwrap();
    assert_eq!(second.len(), 6);
    assert_eq!(second.last().unwrap().version, 1);
}
#[tokio::test]
async fn root_lock_wait_rechecks_session_and_wallclock_for_reads_and_writes() {
    let f = Fixture::new().await;
    let saved = f.save().await;
    let mut lock = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT id FROM clinical_notes WHERE id=$1 FOR UPDATE")
        .bind(saved.note.id)
        .execute(&mut *lock)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let mut expiring = f.actor.clone();
    expiring.authorization.valid_until = Utc::now() + Duration::milliseconds(150);
    let id = saved.note.id;
    let pending = tokio::spawn(async move { notes::get(&pool, expiring, id).await });
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    lock.commit().await.unwrap();
    typed(
        &pending.await.unwrap().unwrap_err(),
        notes::NoteError::AuthorizationExpired,
    );
    let mut lock = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT id FROM clinical_notes WHERE id=$1 FOR UPDATE")
        .bind(id)
        .execute(&mut *lock)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let actor = f.actor.clone();
    let input = f.amendment(1);
    let pending = tokio::spawn(async move { notes::amend(&pool, actor, id, input).await });
    tokio::time::sleep(std::time::Duration::from_millis(75)).await;
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
        .bind(f.actor.authorization.session_id)
        .execute(f.db.pool())
        .await
        .unwrap();
    lock.commit().await.unwrap();
    typed(
        &pending.await.unwrap().unwrap_err(),
        notes::NoteError::AuthorizationExpired,
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM clinical_note_versions WHERE note_id=$1")
            .bind(id)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn template_changes_use_owner_cas_exact_replay_and_rollback_audit_failure() {
    let f = Fixture::new().await;
    for schema in [
        "[]",
        r#"{"sections":[{"section":"Plan"},{"name":"P-l a n"}]}"#,
        r#"{"sections":[{"section":"Plan","required":"yes"}]}"#,
    ] {
        let mut invalid = f.template();
        invalid.body_template = schema.into();
        typed(
            &templates::record(f.db.pool(), f.actor.clone(), invalid)
                .await
                .unwrap_err(),
            notes::NoteError::InvalidInput,
        );
    }
    let original = f.template();
    let saved = templates::record(f.db.pool(), f.actor.clone(), original.clone())
        .await
        .unwrap();
    let id = saved.template.template.id;
    let change = ChangeNoteTemplateRequest {
        client_request_id: Uuid::new_v4(),
        expected_version: 1,
        title: "Synthetic revised".into(),
        note_type: ClinicalNoteType::NursingNote,
        body_template: "Synthetic literal".into(),
        is_active: false,
        change_summary: "Synthetic change".into(),
    };
    let (a, b) = tokio::join!(
        templates::change(f.db.pool(), f.actor.clone(), id, change.clone()),
        templates::change(
            f.db.pool(),
            f.actor.clone(),
            id,
            ChangeNoteTemplateRequest {
                client_request_id: Uuid::new_v4(),
                ..change.clone()
            }
        )
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    typed(
        &a.err().or(b.err()).unwrap(),
        notes::NoteError::SourceChanged,
    );
    let replay = templates::record(f.db.pool(), f.actor.clone(), original)
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.template.template.version, 1);
    assert_eq!(replay.template.body_template, saved.template.body_template);
    assert!(
        sqlx::query("UPDATE clinical_note_template_revisions SET title='rewrite' WHERE id=$1")
            .bind(saved.template.template.current_revision_id)
            .execute(f.db.pool())
            .await
            .is_err()
    );
    assert!(sqlx::query(
        "UPDATE clinical_note_templates SET body_template='unsnapshotted rewrite' WHERE id=$1"
    )
    .bind(id)
    .execute(f.db.pool())
    .await
    .is_err());
    // Audit and evidence must commit as one unit, even when the final audit fails.
    sqlx::raw_sql("CREATE FUNCTION synthetic_note_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='clinical.note.recorded' THEN RAISE EXCEPTION 'synthetic_audit_unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_note_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_note_audit_failure();").execute(f.db.pool()).await.unwrap();
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM clinical_notes WHERE patient_id=$1")
        .bind(f.patient)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert!(
        notes::record(f.db.pool(), f.actor.clone(), f.patient, f.input())
            .await
            .is_err()
    );
    let after:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM clinical_notes WHERE patient_id=$1),(SELECT count(*) FROM clinical_note_commands WHERE patient_id=$1)").bind(f.patient).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(after, (before, 0));
}
#[tokio::test]
async fn waiting_create_cannot_attach_to_closed_care_but_historical_amendment_remains_available() {
    let f = Fixture::new().await;
    let encounter = Uuid::new_v4();
    sqlx::query("INSERT INTO encounters(id,facility_id,patient_id,encounter_type,status) VALUES($1,$2,$3,'outpatient','in_progress')").bind(encounter).bind(f.db.facility_id()).bind(f.patient).execute(f.db.pool()).await.unwrap();
    let mut command = f.input();
    command.encounter_id = Some(encounter);
    let saved = notes::record(f.db.pool(), f.actor.clone(), f.patient, command.clone())
        .await
        .unwrap();
    let mut lock = f.db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *lock)
        .await
        .unwrap();
    sqlx::query("UPDATE encounters SET status='finished' WHERE id=$1")
        .bind(encounter)
        .execute(&mut *lock)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let actor = f.actor.clone();
    let patient = f.patient;
    let mut blocked = command.clone();
    blocked.client_request_id = Uuid::new_v4();
    let pending = tokio::spawn(async move { notes::record(&pool, actor, patient, blocked).await });
    tokio::time::timeout(std::time::Duration::from_secs(2),async{loop{let waiting:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))").bind(pid).fetch_one(f.db.pool()).await.unwrap();if waiting>0{break;}assert!(!pending.is_finished());tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.unwrap();
    lock.commit().await.unwrap();
    typed(
        &pending.await.unwrap().unwrap_err(),
        notes::NoteError::ContextChanged,
    );
    assert!(
        notes::record(f.db.pool(), f.actor.clone(), f.patient, command)
            .await
            .unwrap()
            .replayed
    );
    notes::amend(f.db.pool(), f.actor.clone(), saved.note.id, f.amendment(1))
        .await
        .unwrap();
}
#[tokio::test]
async fn unknown_imported_author_has_no_inferred_ownership_and_feature_is_rechecked_after_wait() {
    let f = Fixture::new().await;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO clinical_notes(id,facility_id,patient_id,note_type,title,body,status,created_by_user_id) VALUES($1,$2,$3,'doctor_note','Synthetic unknown author','Synthetic legacy evidence','draft',NULL)").bind(id).bind(f.db.facility_id()).bind(f.patient).execute(f.db.pool()).await.unwrap();
    assert!(
        !notes::get(f.db.pool(), f.actor.clone(), id)
            .await
            .unwrap()
            .can_amend
    );
    typed(
        &notes::amend(f.db.pool(), f.actor.clone(), id, f.amendment(1))
            .await
            .unwrap_err(),
        notes::NoteError::AuthorRequired,
    );
    let mut admin = f.actor.clone();
    admin.override_ownership = true;
    notes::amend(f.db.pool(), admin, id, f.amendment(1))
        .await
        .unwrap();
    let mut lock = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT id FROM clinical_notes WHERE id=$1 FOR UPDATE")
        .bind(id)
        .execute(&mut *lock)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let actor = f.actor.clone();
    let pending = tokio::spawn(async move { notes::get(&pool, actor, id).await });
    tokio::time::sleep(std::time::Duration::from_millis(75)).await;
    sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'encounters',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(f.db.facility_id()).execute(f.db.pool()).await.unwrap();
    lock.commit().await.unwrap();
    typed(
        &pending.await.unwrap().unwrap_err(),
        notes::NoteError::AuthorizationExpired,
    );
}
#[tokio::test]
async fn populated_migration_preserves_legacy_body_schema_versions_and_unknown_ownership() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    for migration in hms_db::migrate::MIGRATOR
        .iter()
        .filter(|m| m.version < 202610160017)
    {
        sqlx::raw_sql(&migration.sql).execute(&pool).await.unwrap();
    }
    hms_db::provision::provision_baseline(
        &pool,
        &hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .unwrap();
    let facility = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .unwrap()
        .unwrap();
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let note = Uuid::new_v4();
    sqlx::query("INSERT INTO clinical_notes(id,facility_id,patient_id,note_type,title,body,status,version) VALUES($1,$2,$3,'doctor_note','Synthetic imported title','  Exact imported body\n','amended',2)").bind(note).bind(facility).bind(patient).execute(&pool).await.unwrap();
    for (version, body) in [
        (1, "Original immutable body"),
        (2, "  Exact imported body\n"),
    ] {
        sqlx::query("INSERT INTO clinical_note_versions(id,note_id,version,body) VALUES(gen_random_uuid(),$1,$2,$3)").bind(note).bind(version).bind(body).execute(&pool).await.unwrap();
    }
    let mut ids = Vec::new();
    for schema in [
        "Literal template",
        r#"[{"section":"Assessment"}]"#,
        r#"{"sections":[{"name":"Plan"}],"description":"Exact metadata"}"#,
    ] {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO clinical_note_templates(id,facility_id,title,note_type,body_template,is_active) VALUES($1,$2,'Synthetic import','doctor_note',$3,false)").bind(id).bind(facility).bind(schema).execute(&pool).await.unwrap();
        ids.push((id, schema));
    }
    sqlx::raw_sql(include_str!(
        "../../../migrations/202610160017_clinical_note_governance.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    for (id, schema) in ids {
        let row:(Option<Uuid>,String,String,bool,Option<Uuid>)=sqlx::query_as("SELECT t.owner_user_id,t.body_template,r.body_template,r.imported_legacy,r.created_by_user_id FROM clinical_note_templates t JOIN clinical_note_template_revisions r ON r.id=t.current_revision_id WHERE t.id=$1").bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(
            row,
            (None, schema.to_owned(), schema.to_owned(), true, None)
        );
    }
    let row: (String, Option<Uuid>, Option<Uuid>) = sqlx::query_as(
        "SELECT body,created_by_user_id,template_revision_id FROM clinical_notes WHERE id=$1",
    )
    .bind(note)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row, ("  Exact imported body\n".into(), None, None));
    let rows:Vec<(i64,String,Uuid,Option<String>)>=sqlx::query_as("SELECT version,body,facility_id,edit_reason FROM clinical_note_versions WHERE note_id=$1 ORDER BY version").bind(note).fetch_all(&pool).await.unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[0],
        (1, "Original immutable body".into(), facility, None)
    );
}

#[tokio::test]
async fn malformed_imported_schema_is_readable_and_retirable_without_reinterpreting_content() {
    let f = Fixture::new().await;
    let raw = r#"{"description":"Exact malformed legacy metadata","sections":[null]}"#;
    let imported = hms_db::clinical::create_note_template(
        f.db.pool(),
        hms_db::clinical::NewClinicalNoteTemplate {
            id: Uuid::new_v4(),
            facility_id: f.db.facility_id(),
            title: "Synthetic malformed import".into(),
            note_type: ClinicalNoteType::DoctorNote,
            body_template: raw.into(),
        },
    )
    .await
    .unwrap();
    let detail = templates::get(f.db.pool(), f.actor.clone(), imported.id)
        .await
        .unwrap();
    assert_eq!(detail.body_template, raw);
    assert_eq!(detail.template.owner_user_id, None);
    let mut note = f.input();
    note.template_revision_id = Some(detail.template.current_revision_id);
    typed(
        &notes::record(f.db.pool(), f.actor.clone(), f.patient, note)
            .await
            .unwrap_err(),
        notes::NoteError::InvalidInput,
    );
    let mut admin = f.actor.clone();
    admin.override_ownership = true;
    let command = ChangeNoteTemplateRequest {
        client_request_id: Uuid::new_v4(),
        expected_version: 1,
        title: detail.template.title,
        note_type: detail.template.note_type,
        body_template: raw.into(),
        is_active: false,
        change_summary: "Synthetic safe retirement".into(),
    };
    let saved = templates::change(f.db.pool(), admin.clone(), imported.id, command.clone())
        .await
        .unwrap();
    assert!(!saved.template.template.is_active);
    assert_eq!(saved.template.body_template, raw);
    assert_eq!(saved.template.template.owner_user_id, None);
    assert!(
        templates::change(f.db.pool(), admin, imported.id, command)
            .await
            .unwrap()
            .replayed
    );
}
