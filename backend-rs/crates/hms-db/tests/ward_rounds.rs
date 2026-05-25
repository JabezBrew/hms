use chrono::Utc;
use hms_db::patients::NewPatient;
use hms_db::ward::{NewAdmission, NewBed, NewWard, NewWardSection};
use hms_db::ward_rounds::{NewWardRound, NewWardRoundAction, WardRoundUpdate};
use hms_domain::clinical::PrescriptionStatus;
use hms_domain::laboratory::LabPriority;
use hms_domain::patients::Sex;
use hms_domain::ward::NursingTaskType;
use hms_domain::ward_rounds::{
    WardRoundActionStatus, WardRoundActionType, WardRoundDischargeRequestPayload,
    WardRoundLabOrderPayload, WardRoundNoteSections, WardRoundNursingTaskPayload,
    WardRoundPrescriptionPayload, WardRoundStatus,
};

#[tokio::test]
async fn ward_round_commit_links_outputs_and_adds_safe_chronicle_parent_entry() {
    let db = hms_db::test_support::TestDb::hospital()
        .await
        .expect("test db provisions");
    let facility_id = db.facility_id();
    let owner_id = db.owner_user_id();
    let patient = hms_db::patients::create_patient(
        db.pool(),
        NewPatient {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_code: format!("WR-{}", uuid::Uuid::new_v4().simple()),
            first_name: "Ward".to_owned(),
            last_name: "Round".to_owned(),
            date_of_birth: chrono::NaiveDate::from_ymd_opt(1984, 1, 1)
                .expect("static test date is valid"),
            sex: Sex::Female,
        },
    )
    .await
    .expect("patient creates");
    let ward = hms_db::ward::create_ward(
        db.pool(),
        NewWard {
            id: uuid::Uuid::new_v4(),
            facility_id,
            code: format!("WRD-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]),
            name: "Ward Round Test".to_owned(),
        },
    )
    .await
    .expect("ward creates");
    let section = hms_db::ward::create_ward_section(
        db.pool(),
        NewWardSection {
            id: uuid::Uuid::new_v4(),
            facility_id,
            ward_id: ward.id,
            code: "WR".to_owned(),
            name: "Ward Round Section".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("section creates");
    let bed = hms_db::ward::create_bed(
        db.pool(),
        NewBed {
            id: uuid::Uuid::new_v4(),
            facility_id,
            ward_id: ward.id,
            section_id: Some(section.id),
            bed_code: "WR-1".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("bed creates");
    let admission = hms_db::ward::admit_patient(
        db.pool(),
        NewAdmission {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id: patient.id,
            ward_id: ward.id,
            bed_id: Some(bed.id),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("patient admits");
    let test_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM lab_tests WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(db.pool())
    .await
    .expect("lab test exists");

    let draft = hms_db::ward_rounds::create_ward_round(
        db.pool(),
        NewWardRound {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id: patient.id,
            admission_case_id: Some(admission.admission_id),
            note_sections: WardRoundNoteSections {
                interval_history: Some("Improving overnight.".to_owned()),
                examination: Some("Afebrile.".to_owned()),
                assessment: Some("Clinically stable.".to_owned()),
                plan: Some("Continue plan.".to_owned()),
                clinical_readiness_blockers: vec!["Await senior review".to_owned()],
            },
            rendered_note: Some("FULL PHI-SENSITIVE WARD ROUND NOTE".to_owned()),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("round create succeeds")
    .expect("active admission exists");
    assert_eq!(draft.status, WardRoundStatus::Draft);

    let stale_update = hms_db::ward_rounds::update_ward_round(
        db.pool(),
        facility_id,
        patient.id,
        draft.id,
        draft.version + 10,
        WardRoundUpdate {
            note_sections: None,
            rendered_note: Some("stale".to_owned()),
        },
    )
    .await
    .expect("stale update query succeeds");
    assert!(stale_update.is_none());

    add_action(
        db.pool(),
        facility_id,
        patient.id,
        draft.id,
        WardRoundActionType::Prescription,
        "Amoxicillin",
        WardRoundPrescriptionPayload {
            prescription_id: None,
            medication_name: Some("Amoxicillin".to_owned()),
            dose: Some("500 mg".to_owned()),
            frequency: Some("TDS".to_owned()),
            status: Some(PrescriptionStatus::Active),
        },
        owner_id,
    )
    .await;
    add_action(
        db.pool(),
        facility_id,
        patient.id,
        draft.id,
        WardRoundActionType::LabOrder,
        "FBC",
        WardRoundLabOrderPayload {
            test_ids: vec![test_id],
            panel_ids: vec![],
            priority: Some(LabPriority::Urgent),
        },
        owner_id,
    )
    .await;
    add_action(
        db.pool(),
        facility_id,
        patient.id,
        draft.id,
        WardRoundActionType::NursingTask,
        "Ambulate patient",
        WardRoundNursingTaskPayload {
            title: "Ambulate patient".to_owned(),
            instruction: "Assist patient to sit out of bed twice today.".to_owned(),
            due_at: Utc::now(),
            task_type: Some(NursingTaskType::WardRound),
            assigned_to_user_id: None,
        },
        owner_id,
    )
    .await;
    let current = hms_db::ward_rounds::get_current_ward_round(db.pool(), facility_id, patient.id)
        .await
        .expect("current query succeeds")
        .expect("current draft exists");
    add_action(
        db.pool(),
        facility_id,
        patient.id,
        draft.id,
        WardRoundActionType::DischargeRequest,
        "Discharge readiness",
        WardRoundDischargeRequestPayload { requested: true },
        owner_id,
    )
    .await;
    let latest = hms_db::ward_rounds::get_ward_round(db.pool(), facility_id, patient.id, draft.id)
        .await
        .expect("round reload succeeds")
        .expect("round exists");

    let stale_commit = hms_db::ward_rounds::commit_ward_round(
        db.pool(),
        facility_id,
        patient.id,
        draft.id,
        current.version,
        owner_id,
    )
    .await;
    assert!(stale_commit.is_err());

    let committed = hms_db::ward_rounds::commit_ward_round(
        db.pool(),
        facility_id,
        patient.id,
        draft.id,
        latest.version,
        owner_id,
    )
    .await
    .expect("commit succeeds")
    .expect("committed round exists");
    assert_eq!(committed.status, WardRoundStatus::Committed);
    assert!(committed.signed_at.is_some());
    assert_eq!(committed.artifacts.len(), 4);
    assert!(committed
        .actions
        .iter()
        .all(|action| action.status == WardRoundActionStatus::Committed));
    assert!(committed
        .actions
        .iter()
        .all(|action| action.committed_resource_id.is_some()));

    let nursing_instruction = sqlx::query_scalar::<_, Option<String>>(
        "SELECT instruction FROM nursing_tasks WHERE facility_id = $1 AND patient_id = $2",
    )
    .bind(facility_id)
    .bind(patient.id)
    .fetch_one(db.pool())
    .await
    .expect("nursing task exists");
    assert_eq!(
        nursing_instruction.as_deref(),
        Some("Assist patient to sit out of bed twice today.")
    );

    let timeline = hms_db::clinical::patient_chronicle_timeline(
        db.pool(),
        facility_id,
        patient.id,
        None,
        10,
        hms_db::clinical::ChronicleTimelineFilters {
            entry_type: Some("ward_round".to_owned()),
            search: None,
            encounter_id: None,
        },
    )
    .await
    .expect("timeline loads");
    let entry = timeline
        .iter()
        .find(|entry| entry.entry_id == committed.id)
        .expect("committed round appears in timeline");
    assert_eq!(entry.entry_type, "ward_round");
    assert!(entry.data.get("created_artifacts").is_some());
    assert!(entry.data.get("action_counts").is_some());
    assert!(entry.data.get("rendered_note").is_none());
}

async fn add_action<T: serde::Serialize>(
    pool: &hms_db::PgPool,
    facility_id: uuid::Uuid,
    patient_id: uuid::Uuid,
    ward_round_id: uuid::Uuid,
    action_type: WardRoundActionType,
    title: &str,
    payload: T,
    actor_user_id: uuid::Uuid,
) {
    hms_db::ward_rounds::create_ward_round_action(
        pool,
        NewWardRoundAction {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            ward_round_id,
            action_type,
            title: Some(title.to_owned()),
            instruction: None,
            payload: serde_json::to_value(payload).expect("payload serializes"),
            actor_user_id,
        },
    )
    .await
    .expect("action create query succeeds")
    .expect("round exists");
}
