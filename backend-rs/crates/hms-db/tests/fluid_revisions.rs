use chrono::{Duration, Utc};
use hms_db::{test_support::TestDb, ward::*};
use hms_domain::{
    fluid::*,
    ward::{WardBoardMonitoringFilter, WardBoardSort},
};
use uuid::Uuid;
struct F {
    db: TestDb,
    patient: Uuid,
    admission: Uuid,
    ward: Uuid,
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
        Self {
            db,
            patient: care.patient.id,
            admission: care.admission.id,
            ward: care.ward.id,
        }
    }
    fn actor(&self) -> FluidActor {
        FluidActor {
            facility_id: self.db.facility_id(),
            user_id: self.db.owner_user_id(),
            request_id: None,
        }
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
    assert!(create_fluid_balance_entry(
        f.db.pool(),
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
