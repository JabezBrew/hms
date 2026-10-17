use chrono::{Duration, Utc};
use hms_db::{test_support::TestDb, ward::*};
use hms_domain::{
    deployment::DeploymentProfile,
    fluid::*,
    ward::{WardBoardMonitoringFilter, WardBoardSort},
};
use uuid::Uuid;
struct F {
    db: TestDb,
    patient: Uuid,
    admission: Uuid,
    ward: Uuid,
    proof: FluidActor,
}
async fn actor(db: &TestDb, user: Uuid) -> FluidActor {
    let versions: (i64, i64) =
        sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
            .bind(user)
            .fetch_one(db.pool())
            .await
            .unwrap();
    let session = Uuid::new_v4();
    let now = Utc::now();
    hms_db::auth::insert_refresh_session(
        db.pool(),
        &hms_db::auth::NewRefreshSession {
            token_hash: Uuid::new_v4().to_string(),
            session_id: session,
            session_family_id: session,
            rotated_from_session_id: None,
            user_id: user,
            facility_id: db.facility_id(),
            session_version: versions.0,
            permission_version_at_issue: versions.1,
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
    FluidActor {
        resolved_network_policy_version: Some(
            hms_db::network::get_policy(db.pool(), db.facility_id())
                .await
                .unwrap()
                .version,
        ),
        facility_id: db.facility_id(),
        user_id: user,
        request_id: None,
        session_id: session,
        session_version: versions.0,
        permission_version: versions.1,
        active_profile: DeploymentProfile::Hospital,
        valid_until: now + Duration::minutes(15),
        can_view_all_wards: true,
    }
}
impl F {
    async fn new() -> Self {
        let db = TestDb::hospital().await.unwrap();
        let care = db
            .scenario("fluid-revision")
            .admission_case_with_available_bed()
            .await
            .unwrap();
        activate_admission_case(
            db.pool(),
            db.facility_id(),
            care.admission.id,
            db.owner_user_id(),
        )
        .await
        .unwrap();
        let proof = actor(&db, db.owner_user_id()).await;
        Self {
            proof,
            db,
            patient: care.patient.id,
            admission: care.admission.id,
            ward: care.ward.id,
        }
    }
    fn actor(&self) -> FluidActor {
        self.proof.clone()
    }
    fn values(&self, intake: i32, output: i32) -> FluidObservationValues {
        FluidObservationValues {
            recorded_at: Utc::now() - Duration::minutes(1),
            intake_ml: intake,
            output_ml: output,
            metadata: FluidMetadata {
                intake_category: (intake > 0).then_some(FluidIntakeCategory::Oral),
                output_category: (output > 0).then_some(FluidOutputCategory::Urine),
                notes: Some("Synthetic clinical detail".into()),
                ..Default::default()
            },
        }
    }
    async fn create(&self, v: FluidObservationValues) -> FluidWriteResult {
        create_fluid_observation(
            self.db.pool(),
            self.actor(),
            self.patient,
            CreateFluidObservationRequest {
                client_request_id: Uuid::new_v4(),
                admission_case_id: self.admission,
                patient_id: Some(self.patient),
                values: v,
            },
        )
        .await
        .unwrap()
    }
    async fn source(&self, id: Uuid) -> FluidObservation {
        get_fluid_observation(self.db.pool(), self.db.facility_id(), id)
            .await
            .unwrap()
            .unwrap()
    }
    fn scope(&self) -> FluidBalanceFilters {
        FluidBalanceFilters {
            patient_id: Some(self.patient),
            admission_case_id: Some(self.admission),
            ..Default::default()
        }
    }
    async fn summary(&self) -> FluidEffectiveSummary {
        fluid_effective_summary(self.db.pool(), self.db.facility_id(), self.scope())
            .await
            .unwrap()
    }
    async fn rules(&self, expected: i64) -> FluidRuleSettings {
        update_fluid_rules(
            self.db.pool(),
            self.actor(),
            UpdateFluidRuleSettingsRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: expected,
                reason: "Synthetic policy review".into(),
                values: FluidRuleValues {
                    enable_intake_alerts: true,
                    enable_output_alerts: true,
                    enable_balance_alerts: true,
                    ..Default::default()
                },
            },
        )
        .await
        .unwrap()
    }
}
#[tokio::test]
async fn paired_evidence_correction_void_replay_and_cross_day_totals_are_atomic() {
    let f = F::new().await;
    let mut old = f.values(500, 200);
    old.recorded_at = (Utc::now() - Duration::days(2))
        .date_naive()
        .and_hms_opt(23, 59, 59)
        .unwrap()
        .and_utc();
    let made = f.create(old.clone()).await;
    let source = f.source(made.entry_id).await;
    let mut new = old.clone();
    new.recorded_at += Duration::seconds(1);
    new.intake_ml = 700;
    new.metadata.notes = Some("Synthetic correction".into());
    let input = CorrectFluidObservationRequest {
        client_request_id: Uuid::new_v4(),
        reason: "Synthetic measured-volume correction".into(),
        replacement: new.clone(),
    };
    let corrected =
        correct_fluid_observation(f.db.pool(), f.actor(), source.clone(), input.clone())
            .await
            .unwrap();
    assert_eq!(f.source(made.entry_id).await.values, old);
    assert_eq!(f.source(corrected.entry_id).await.values, new);
    assert!(!f.source(made.entry_id).await.current);
    let s = f.summary().await;
    assert_eq!(
        (s.entry_count, s.total_intake_ml, s.total_output_ml),
        (1, 700, 200)
    );
    assert_eq!(s.intake_breakdown[0].category, "oral");
    let legacy = fluid_balance_summary(f.db.pool(), f.db.facility_id(), f.scope())
        .await
        .unwrap();
    assert_eq!(
        (
            legacy.entry_count,
            legacy.total_intake_ml,
            legacy.total_output_ml
        ),
        (1, 700, 200)
    );
    let daily:Vec<(chrono::NaiveDate,i64,i64,i64)>=sqlx::query_as("SELECT date,entry_count,intake_ml,output_ml FROM fluid_effective_daily_totals WHERE admission_case_id=$1 ORDER BY date").bind(f.admission).fetch_all(f.db.pool()).await.unwrap();
    assert_eq!(daily.len(), 2);
    assert_eq!((daily[0].1, daily[0].2, daily[0].3), (0, 0, 0));
    assert_eq!((daily[1].1, daily[1].2, daily[1].3), (1, 700, 200));
    let voided = void_fluid_observation(
        f.db.pool(),
        f.actor(),
        f.source(corrected.entry_id).await,
        VoidFluidObservationRequest {
            client_request_id: Uuid::new_v4(),
            reason: "Synthetic duplicate evidence".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(voided.revision, 3);
    assert_eq!(f.summary().await.entry_count, 0);
    let visible =
        list_fluid_observations(f.db.pool(), f.db.facility_id(), f.scope(), true, None, 25)
            .await
            .unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].id, corrected.entry_id);
    assert!(!visible[0].current);
    assert_eq!(visible[0].closed_by_action, Some(FluidWriteKind::Voided));
    assert!(
        list_fluid_observations(f.db.pool(), f.db.facility_id(), f.scope(), false, None, 25)
            .await
            .unwrap()
            .is_empty()
    );
    let replay = correct_fluid_observation(f.db.pool(), f.actor(), source, input)
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.entry_id, corrected.entry_id);
    assert!(!f.source(replay.entry_id).await.current);
    let history = fluid_observation_history(
        f.db.pool(),
        f.db.facility_id(),
        made.root_entry_id,
        None,
        101,
    )
    .await
    .unwrap();
    assert_eq!(history.len(), 2);
    assert!(history.iter().all(|r| !r.current));
    assert_eq!(history[0].closed_by_action, Some(FluidWriteKind::Voided));
    let audit: Vec<serde_json::Value> =
        sqlx::query_scalar("SELECT metadata FROM audit_events WHERE resource_id=$1")
            .bind(made.root_entry_id)
            .fetch_all(f.db.pool())
            .await
            .unwrap();
    assert_eq!(audit.len(), 3);
    assert!(audit.iter().all(|v| !v.to_string().contains("Synthetic")));
}
#[tokio::test]
async fn concurrent_terminal_changes_have_one_winner_and_conflicting_keys_cannot_rewrite() {
    let f = F::new().await;
    let made = f.create(f.values(300, 100)).await;
    let a = f.source(made.entry_id).await;
    let b = a.clone();
    let key = Uuid::new_v4();
    let input = VoidFluidObservationRequest {
        client_request_id: key,
        reason: "Synthetic first change".into(),
    };
    let (left, right) = tokio::join!(
        void_fluid_observation(f.db.pool(), f.actor(), a, input.clone()),
        correct_fluid_observation(
            f.db.pool(),
            f.actor(),
            b,
            CorrectFluidObservationRequest {
                client_request_id: Uuid::new_v4(),
                reason: "Synthetic competing change".into(),
                replacement: f.values(400, 100)
            }
        )
    );
    assert_ne!(left.is_ok(), right.is_ok());
    let actions: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fluid_observation_actions WHERE root_entry_id=$1")
            .bind(made.root_entry_id)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(actions, 1);
    if left.is_ok() {
        let conflict = void_fluid_observation(
            f.db.pool(),
            f.actor(),
            f.source(made.entry_id).await,
            VoidFluidObservationRequest {
                client_request_id: key,
                reason: "A different reason".into(),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(conflict.downcast_ref(), Some(&FluidError::RequestConflict));
    }
}
#[tokio::test]
async fn audit_failure_rolls_back_evidence_projection_and_idempotency_reservation() {
    let f = F::new().await;
    let made = f.create(f.values(300, 100)).await;
    let source = f.source(made.entry_id).await;
    let key = Uuid::new_v4();
    sqlx::raw_sql("CREATE FUNCTION fail_fluid_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='fluid.observation.voided' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_fluid_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_fluid_audit();").execute(f.db.pool()).await.unwrap();
    let p = VoidFluidObservationRequest {
        client_request_id: key,
        reason: "Synthetic void review".into(),
    };
    assert!(
        void_fluid_observation(f.db.pool(), f.actor(), source.clone(), p.clone())
            .await
            .is_err()
    );
    assert!(f.source(made.entry_id).await.current);
    assert_eq!(f.summary().await.entry_count, 1);
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fluid_write_commands WHERE client_request_id=$1")
            .bind(key)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(n, 0);
    sqlx::query("DROP TRIGGER fail_fluid_audit ON audit_events")
        .execute(f.db.pool())
        .await
        .unwrap();
    void_fluid_observation(f.db.pool(), f.actor(), source, p)
        .await
        .unwrap();
}
#[tokio::test]
async fn facility_rules_no_data_strict_boundaries_version_replay_and_rollover_are_truthful() {
    let f = F::new().await;
    let today = Utc::now().date_naive();
    let a = fluid_assessment(
        f.db.pool(),
        f.db.facility_id(),
        f.patient,
        f.admission,
        today,
    )
    .await
    .unwrap();
    assert_eq!(a.status, FluidAssessmentStatus::Unconfigured);
    assert!(a.conditions.is_empty());
    f.rules(0).await;
    let a = fluid_assessment(
        f.db.pool(),
        f.db.facility_id(),
        f.patient,
        f.admission,
        today,
    )
    .await
    .unwrap();
    assert_eq!(a.status, FluidAssessmentStatus::NoData);
    assert!(a.conditions.is_empty());
    let mut v = f.values(1500, 2000);
    v.recorded_at = today.and_hms_opt(0, 0, 0).unwrap().and_utc();
    f.create(v).await;
    let a = fluid_assessment(
        f.db.pool(),
        f.db.facility_id(),
        f.patient,
        f.admission,
        today,
    )
    .await
    .unwrap();
    assert_eq!(a.status, FluidAssessmentStatus::Assessed);
    assert!(a.conditions.is_empty());
    let yesterday = fluid_assessment(
        f.db.pool(),
        f.db.facility_id(),
        f.patient,
        f.admission,
        today.pred_opt().unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(yesterday.status, FluidAssessmentStatus::NoData);
    assert!(!yesterday.partial_day);
    let p = UpdateFluidRuleSettingsRequest {
        client_request_id: Uuid::new_v4(),
        expected_version: 1,
        reason: "Synthetic updated policy".into(),
        values: FluidRuleValues {
            enable_intake_alerts: true,
            min_daily_intake_target: 1600,
            ..Default::default()
        },
    };
    let saved = update_fluid_rules(f.db.pool(), f.actor(), p.clone())
        .await
        .unwrap();
    f.rules(2).await;
    let replay = update_fluid_rules(f.db.pool(), f.actor(), p.clone())
        .await
        .unwrap();
    assert_eq!(replay.version, saved.version);
    assert_eq!(replay.values, saved.values);
    let mut conflict = p;
    conflict.client_request_id = Uuid::new_v4();
    assert_eq!(
        update_fluid_rules(f.db.pool(), f.actor(), conflict)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&FluidError::RuleConflict)
    );
    let other = get_fluid_rules(f.db.pool(), Uuid::new_v4()).await.unwrap();
    assert!(!other.configured);
}
#[tokio::test]
async fn board_filters_use_effective_fluid_counts_before_limit_and_no_data_never_alarms() {
    let f = F::new().await;
    f.rules(0).await;
    let mut v = f.values(100, 1000);
    v.recorded_at = Utc::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();
    let made = f.create(v).await;
    // The matching admission must survive filtering before a one-row page,
    // even when more than a hundred unrelated admissions sort ahead of it.
    sqlx::query("WITH added AS (INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status) SELECT gen_random_uuid(),$1,'SYNTHETIC-FLUID-'||n,'Synthetic','Fixture','2000-01-01','female','active' FROM generate_series(1,120) n RETURNING id) INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status,admitted_at) SELECT gen_random_uuid(),$1,id,$2,'admitted',now()-interval '1 year' FROM added").bind(f.db.facility_id()).bind(f.ward).execute(f.db.pool()).await.unwrap();
    for filter in [
        WardBoardMonitoringFilter::Critical,
        WardBoardMonitoringFilter::Alerts,
        WardBoardMonitoringFilter::NeedsAttention,
    ] {
        let rows = list_ward_board(
            f.db.pool(),
            f.db.facility_id(),
            Some(f.ward),
            None,
            None,
            Some(filter),
            WardBoardSort::Attention,
            None,
            1,
        )
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].admission_id, f.admission);
        assert_eq!(rows[0].fluid_condition_count, 2);
        assert_eq!(rows[0].fluid_critical_count, 1);
        assert_eq!(rows[0].active_alert_count, 0);
    }
    void_fluid_observation(
        f.db.pool(),
        f.actor(),
        f.source(made.entry_id).await,
        VoidFluidObservationRequest {
            client_request_id: Uuid::new_v4(),
            reason: "Synthetic invalid evidence".into(),
        },
    )
    .await
    .unwrap();
    let rows = list_ward_board(
        f.db.pool(),
        f.db.facility_id(),
        Some(f.ward),
        Some(f.patient),
        None,
        Some(WardBoardMonitoringFilter::Critical),
        WardBoardSort::Attention,
        None,
        1,
    )
    .await
    .unwrap();
    assert!(rows.is_empty());
    let status: String = sqlx::query_scalar(
        "SELECT assessment_status FROM fluid_admission_monitoring WHERE admission_case_id=$1",
    )
    .bind(f.admission)
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(status, "no_data");
}

#[tokio::test]
async fn migration_backfills_populated_legacy_pairs_and_preserves_import_cleanup_compatibility() {
    let f = F::new().await;
    let id = Uuid::new_v4();
    let when = Utc::now() - Duration::days(3);
    sqlx::query("INSERT INTO fluid_balance_entries(id,facility_id,patient_id,admission_case_id,recorded_at,intake_ml,output_ml) VALUES($1,$2,$3,$4,$5,100,30)").bind(id).bind(f.db.facility_id()).bind(f.patient).bind(f.admission).bind(when).execute(f.db.pool()).await.unwrap();
    // Exercise old synthetic/import update and delete paths with the real triggers.
    sqlx::query("UPDATE fluid_balance_entries SET intake_ml=200 WHERE id=$1")
        .bind(id)
        .execute(f.db.pool())
        .await
        .unwrap();
    assert_eq!(f.summary().await.total_intake_ml, 200);
    sqlx::query("DELETE FROM fluid_balance_entries WHERE id=$1")
        .bind(id)
        .execute(f.db.pool())
        .await
        .unwrap();
    assert_eq!(f.summary().await.entry_count, 0);
    sqlx::raw_sql("DROP VIEW fluid_admission_monitoring; DROP TRIGGER fluid_entry_projection_insert_update ON fluid_balance_entries; DROP TRIGGER fluid_entry_projection_delete ON fluid_balance_entries; DROP FUNCTION fluid_entry_projection_compatibility(); DROP TRIGGER fluid_root_daily_projection ON fluid_observation_roots; DROP FUNCTION fluid_root_project_daily(); DROP TABLE fluid_observation_actions,fluid_write_commands,fluid_effective_daily_totals,fluid_rule_versions,fluid_rule_settings CASCADE; DROP TABLE fluid_observation_roots CASCADE; ALTER TABLE fluid_balance_entries DROP COLUMN root_entry_id,DROP COLUMN revision,DROP COLUMN metadata;").execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO fluid_balance_entries(id,facility_id,patient_id,admission_case_id,recorded_at,intake_ml,output_ml) VALUES($1,$2,$3,$4,$5,20000,7000)").bind(id).bind(f.db.facility_id()).bind(f.patient).bind(f.admission).bind(when).execute(f.db.pool()).await.unwrap();
    // Old schemas permitted mismatched patient/admission foreign keys. Preserve
    // that evidence, but never publish it through a different patient's scope.
    let forged = Uuid::new_v4();
    let other: Uuid =
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND id<>$2 LIMIT 1")
            .bind(f.db.facility_id())
            .bind(f.patient)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    sqlx::query("INSERT INTO fluid_balance_entries(id,facility_id,patient_id,admission_case_id,recorded_at,intake_ml,output_ml) VALUES($1,$2,$3,$4,$5,9999,0)").bind(forged).bind(f.db.facility_id()).bind(other).bind(f.admission).bind(when).execute(f.db.pool()).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/202610160011_fluid_observation_revisions.sql"
    ))
    .execute(f.db.pool())
    .await
    .unwrap();
    let activity: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT r.updated_at FROM fluid_observation_roots r WHERE r.id=$1")
            .bind(id)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    let original_created: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT created_at FROM fluid_balance_entries WHERE id=$1")
            .bind(id)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(activity, original_created);
    assert!(
        get_fluid_observation(f.db.pool(), f.db.facility_id(), forged)
            .await
            .unwrap()
            .is_none()
    );
    let preserved: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fluid_balance_entries WHERE id=$1")
            .bind(forged)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(preserved, 1);
    let source = f.source(id).await;
    assert_eq!(
        (source.values.intake_ml, source.values.output_ml),
        (20000, 7000)
    );
    assert!(source.values.metadata.intake_category.is_none());
    let mut values = source.values.clone();
    values.metadata.notes = Some("Synthetic metadata-only correction".into());
    correct_fluid_observation(
        f.db.pool(),
        f.actor(),
        source,
        CorrectFluidObservationRequest {
            client_request_id: Uuid::new_v4(),
            reason: "Preserve legacy measured volumes".into(),
            replacement: values,
        },
    )
    .await
    .unwrap();
    assert_eq!(f.summary().await.total_intake_ml, 20000);
    let current =
        list_fluid_observations(f.db.pool(), f.db.facility_id(), f.scope(), false, None, 1)
            .await
            .unwrap()
            .remove(0);
    sqlx::query("DELETE FROM fluid_balance_entries WHERE id=$1")
        .bind(current.id)
        .execute(f.db.pool())
        .await
        .unwrap();
    assert_eq!(f.summary().await.entry_count, 0);
}

#[tokio::test]
async fn legacy_create_audit_failure_cannot_leave_an_unaudited_entry_or_daily_counter() {
    let f = F::new().await;
    let id = Uuid::new_v4();
    sqlx::raw_sql("CREATE FUNCTION reject_fluid_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='fluid.observation.created' THEN RAISE EXCEPTION 'synthetic create audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_fluid_create_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_fluid_create_audit();").execute(f.db.pool()).await.unwrap();
    assert!(create_fluid_balance_for_actor(
        f.db.pool(),
        f.actor(),
        NewFluidBalanceEntry {
            id,
            facility_id: f.db.facility_id(),
            patient_id: f.patient,
            admission_case_id: f.admission,
            recorded_at: Utc::now(),
            intake_ml: 100,
            output_ml: 30,
            recorded_by_user_id: f.db.owner_user_id()
        }
    )
    .await
    .is_err());
    assert_eq!(f.summary().await.entry_count, 0);
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM fluid_balance_entries WHERE id=$1")
        .bind(id)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(n, 0);
}

async fn assigned_actor(f: &F) -> (FluidActor, Uuid) {
    let user = Uuid::new_v4();
    let staff = Uuid::new_v4();
    let practitioner = Uuid::new_v4();
    let assignment = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,$2,$3,'Synthetic assigned nurse',password_hash FROM users WHERE id=$4").bind(user).bind(f.db.facility_id()).bind(format!("fluid-{user}@hms.local")).bind(f.db.owner_user_id()).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES($1,$2,$3,$4,'Synthetic ward','Nurse',CURRENT_DATE)").bind(staff).bind(f.db.facility_id()).bind(user).bind(format!("H-{user}")).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO practitioner_profiles(id,facility_id,staff_id,license_number,specialization,qualification) VALUES($1,$2,$3,$4,'Nursing','Synthetic qualification')").bind(practitioner).bind(f.db.facility_id()).bind(staff).bind(format!("L-{user}")).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO ward_staff_assignments(id,facility_id,ward_id,practitioner_profile_id,role_code,role_name,role_category) VALUES($1,$2,$3,$4,'staff_nurse','Nurse','nursing')").bind(assignment).bind(f.db.facility_id()).bind(f.ward).bind(practitioner).execute(f.db.pool()).await.unwrap();
    let mut proof = actor(&f.db, user).await;
    proof.can_view_all_wards = false;
    (proof, assignment)
}
async fn wait_block(pool: &hms_db::PgPool, pid: i32) {
    tokio::time::timeout(std::time::Duration::from_secs(4),async{loop{let n:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))").bind(pid).fetch_one(pool).await.unwrap();if n>0{break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("protected fluid operation reached held source");
}
#[tokio::test]
async fn fluid_current_ward_scope_is_before_pages_and_complete_scalar_and_rich_aggregates() {
    let f = F::new().await;
    f.create(f.values(100, 20)).await;
    f.create(f.values(200, 30)).await;
    let other_ward = Uuid::new_v4();
    let other_admission = Uuid::new_v4();
    sqlx::query("INSERT INTO wards(id,facility_id,code,name,status) VALUES($1,$2,$3,'Synthetic other ward','active')").bind(other_ward).bind(f.db.facility_id()).bind(format!("FL-{}",Uuid::new_v4())).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'discharged')").bind(other_admission).bind(f.db.facility_id()).bind(f.patient).bind(other_ward).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO fluid_balance_entries(id,facility_id,patient_id,admission_case_id,recorded_at,intake_ml,output_ml) SELECT gen_random_uuid(),$1,$2,$3,clock_timestamp()-interval '1 second',900,0 FROM generate_series(1,125)").bind(f.db.facility_id()).bind(f.patient).bind(other_admission).execute(f.db.pool()).await.unwrap();
    let (proof, _) = assigned_actor(&f).await;
    let scope = FluidBalanceFilters {
        patient_id: Some(f.patient),
        descending: true,
        ..Default::default()
    };
    let page = list_fluid_observations_for_actor(
        f.db.pool(),
        proof.clone(),
        scope.clone(),
        false,
        None,
        1,
    )
    .await
    .unwrap();
    assert_eq!(page.len(), 1);
    assert_eq!(page[0].admission_case_id, f.admission);
    let second = list_fluid_observations_for_actor(
        f.db.pool(),
        proof.clone(),
        scope.clone(),
        false,
        Some(WardCursor {
            occurred_at: page[0].values.recorded_at,
            id: page[0].id,
        }),
        1,
    )
    .await
    .unwrap();
    assert_eq!(second.len(), 1);
    assert_ne!(second[0].id, page[0].id);
    let (one, cost) =
        hms_observability::with_request_query_counter(list_fluid_observations_for_actor(
            f.db.pool(),
            proof.clone(),
            scope.clone(),
            false,
            None,
            1,
        ))
        .await;
    let (many, larger_cost) =
        hms_observability::with_request_query_counter(list_fluid_observations_for_actor(
            f.db.pool(),
            proof.clone(),
            scope.clone(),
            false,
            None,
            101,
        ))
        .await;
    assert_eq!(one.unwrap().len(), 1);
    assert_eq!(many.unwrap().len(), 2);
    // Retaining the version-zero policy adds one unchanged sentinel INSERT
    // and one SHARE read to each page, including the 101-row request. The exact
    // budget must remain independent of page size and excluded ward history.
    assert_eq!((cost, larger_cost), (11, 11));
    let list = list_fluid_balance_for_actor(f.db.pool(), proof.clone(), scope.clone(), None, 101)
        .await
        .unwrap();
    assert_eq!(list.len(), 2);
    let rich = fluid_effective_summary_for_actor(f.db.pool(), proof.clone(), scope.clone())
        .await
        .unwrap();
    assert_eq!(
        (rich.entry_count, rich.total_intake_ml, rich.total_output_ml),
        (2, 300, 50)
    );
    let scalar = fluid_scalar_summary_for_actor(f.db.pool(), proof.clone(), scope.clone())
        .await
        .unwrap();
    assert_eq!((scalar.entry_count, scalar.net_ml), (2, 250));
    let trends =
        fluid_scalar_trends_for_actor(f.db.pool(), proof.clone(), scope.clone(), None, 101)
            .await
            .unwrap();
    assert_eq!(trends.iter().map(|r| r.entry_count).sum::<i64>(), 2);
    let denied = FluidBalanceFilters {
        patient_id: Some(f.patient),
        admission_case_id: Some(other_admission),
        ..Default::default()
    };
    assert!(
        fluid_scalar_summary_for_actor(f.db.pool(), proof.clone(), denied)
            .await
            .unwrap_err()
            .is::<nursing_access::NursingError>()
    );
    // Current admission ward is authoritative for old unsnapshotted observations.
    let destination = create_bed(
        f.db.pool(),
        NewBed {
            id: Uuid::new_v4(),
            facility_id: f.db.facility_id(),
            ward_id: other_ward,
            section_id: None,
            bed_code: "SYNTHETIC-DESTINATION".into(),
            actor_user_id: f.db.owner_user_id(),
        },
    )
    .await
    .unwrap();
    hms_db::test_support::ward_lifecycle::move_admission(&f.db, f.admission, destination.id)
        .await
        .unwrap();
    assert_eq!(
        fluid_scalar_summary_for_actor(f.db.pool(), proof, scope)
            .await
            .unwrap()
            .entry_count,
        0
    );
}
#[tokio::test]
async fn fluid_read_wait_rechecks_revocation_and_change_wait_rechecks_deadline() {
    let f = F::new().await;
    let made = f.create(f.values(100, 20)).await;
    let mut held = f.db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM fluid_observation_roots WHERE id=$1 FOR UPDATE")
        .bind(made.root_entry_id)
        .execute(&mut *held)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let proof = f.actor();
    let task =
        tokio::spawn(
            async move { get_fluid_observation_for_actor(&pool, proof, made.entry_id).await },
        );
    wait_block(f.db.pool(), pid).await;
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
        .bind(f.proof.session_id)
        .execute(f.db.pool())
        .await
        .unwrap();
    held.commit().await.unwrap();
    assert_eq!(
        task.await.unwrap().unwrap_err().downcast_ref(),
        Some(&nursing_access::NursingError::AuthorizationExpired)
    );
    let source = f.source(made.entry_id).await;
    let mut proof = actor(&f.db, f.db.owner_user_id()).await;
    proof.valid_until = Utc::now() + Duration::seconds(4);
    let expires = proof.valid_until;
    let mut held = f.db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM fluid_observation_roots WHERE id=$1 FOR UPDATE")
        .bind(made.root_entry_id)
        .execute(&mut *held)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let key = Uuid::new_v4();
    let task = tokio::spawn(async move {
        void_fluid_observation(
            &pool,
            proof,
            source,
            VoidFluidObservationRequest {
                client_request_id: key,
                reason: "Synthetic review".into(),
            },
        )
        .await
    });
    wait_block(f.db.pool(), pid).await;
    let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(expires).fetch_one(f.db.pool()).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 50)).await;
    held.commit().await.unwrap();
    assert_eq!(
        task.await.unwrap().unwrap_err().downcast_ref(),
        Some(&nursing_access::NursingError::AuthorizationExpired)
    );
    assert!(f.source(made.entry_id).await.current);
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fluid_write_commands WHERE client_request_id=$1")
            .bind(key)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(count, 0);
}
#[tokio::test]
async fn fluid_new_entry_wait_rejects_closed_admission_but_exact_saved_replay_survives_closure() {
    let f = F::new().await;
    let input = CreateFluidObservationRequest {
        patient_id: Some(f.patient),
        client_request_id: Uuid::new_v4(),
        admission_case_id: f.admission,
        values: f.values(100, 20),
    };
    let saved = create_fluid_observation(f.db.pool(), f.actor(), f.patient, input.clone())
        .await
        .unwrap();
    let discharge = hms_db::test_support::ward_lifecycle::prepare_discharge(&f.db, f.admission)
        .await
        .unwrap();
    let mut held = f.db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    hms_db::test_support::ward_lifecycle::complete_prepared_discharge_tx(
        &mut held,
        f.db.facility_id(),
        discharge,
    )
    .await
    .unwrap();
    let pool = f.db.pool().clone();
    let proof = f.actor();
    let patient = f.patient;
    let mut next = input.clone();
    next.client_request_id = Uuid::new_v4();
    let task =
        tokio::spawn(async move { create_fluid_observation(&pool, proof, patient, next).await });
    wait_block(f.db.pool(), pid).await;
    held.commit().await.unwrap();
    assert_eq!(
        task.await.unwrap().unwrap_err().downcast_ref(),
        Some(&nursing_access::NursingError::InvalidContext)
    );
    let replay = create_fluid_observation(f.db.pool(), f.actor(), f.patient, input)
        .await
        .unwrap();
    assert_eq!(replay.entry_id, saved.entry_id);
    assert!(replay.replayed);
    let context = fluid_context_for_actor(f.db.pool(), f.actor(), f.patient, f.admission)
        .await
        .unwrap();
    assert!(!context.can_record_observation);
    let source = f.source(saved.entry_id).await;
    void_fluid_observation(
        f.db.pool(),
        f.actor(),
        source,
        VoidFluidObservationRequest {
            client_request_id: Uuid::new_v4(),
            reason: "Historical correction remains authorized".into(),
        },
    )
    .await
    .unwrap();
}
#[tokio::test]
async fn fluid_rules_have_separate_admin_feature_proof_and_expiring_lock_wait_cannot_publish() {
    let f = F::new().await;
    sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'nursing',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(f.db.facility_id()).execute(f.db.pool()).await.unwrap();
    f.rules(0).await;
    assert!(
        get_fluid_rules_for_actor(f.db.pool(), f.actor(), true)
            .await
            .unwrap()
            .configured
    );
    assert_eq!(
        fluid_scalar_summary_for_actor(f.db.pool(), f.actor(), f.scope())
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&nursing_access::NursingError::FeatureDisabled)
    );
    let mut held = f.db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT facility_id FROM fluid_rule_settings WHERE facility_id=$1 FOR UPDATE")
        .bind(f.db.facility_id())
        .execute(&mut *held)
        .await
        .unwrap();
    let mut proof = f.actor();
    proof.valid_until = Utc::now() + Duration::seconds(4);
    let expires = proof.valid_until;
    let pool = f.db.pool().clone();
    let key = Uuid::new_v4();
    let task = tokio::spawn(async move {
        update_fluid_rules(
            &pool,
            proof,
            UpdateFluidRuleSettingsRequest {
                client_request_id: key,
                expected_version: 1,
                reason: "Synthetic expiry review".into(),
                values: FluidRuleValues::default(),
            },
        )
        .await
    });
    wait_block(f.db.pool(), pid).await;
    let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(expires).fetch_one(f.db.pool()).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 50)).await;
    held.commit().await.unwrap();
    assert_eq!(
        task.await.unwrap().unwrap_err().downcast_ref(),
        Some(&FluidError::AuthorizationExpired)
    );
    assert_eq!(
        get_fluid_rules(f.db.pool(), f.db.facility_id())
            .await
            .unwrap()
            .version,
        1
    );
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fluid_write_commands WHERE client_request_id=$1")
            .bind(key)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn fluid_context_never_offers_new_entry_for_an_inactive_ward() {
    let f = F::new().await;
    assert!(
        fluid_context_for_actor(f.db.pool(), f.actor(), f.patient, f.admission)
            .await
            .unwrap()
            .can_record_observation
    );
    sqlx::query("UPDATE wards SET status='inactive' WHERE id=$1")
        .bind(f.ward)
        .execute(f.db.pool())
        .await
        .unwrap();
    let context = fluid_context_for_actor(f.db.pool(), f.actor(), f.patient, f.admission)
        .await
        .unwrap();
    assert_eq!(context.status, hms_domain::ward::AdmissionStatus::Admitted);
    assert!(!context.can_record_observation);
    let result = create_fluid_observation(
        f.db.pool(),
        f.actor(),
        f.patient,
        CreateFluidObservationRequest {
            patient_id: Some(f.patient),
            client_request_id: Uuid::new_v4(),
            admission_case_id: f.admission,
            values: f.values(100, 0),
        },
    )
    .await;
    assert_eq!(
        result.unwrap_err().downcast_ref(),
        Some(&nursing_access::NursingError::InvalidContext)
    );
    assert_eq!(f.summary().await.entry_count, 0);
}
