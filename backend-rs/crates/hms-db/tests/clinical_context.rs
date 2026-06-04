use hms_db::clinical::{
    NewAllergy, NewClinicalNote, NewPrescription, NewProblem, NewProblemArtifactLink,
};
use hms_db::laboratory::NewLabOrder;
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::clinical::{AllergySeverity, ClinicalNoteType, ProblemArtifactKind};
use hms_domain::deployment::DeploymentProfile;
use hms_domain::laboratory::LabPriority;
use uuid::Uuid;

#[tokio::test]
async fn problem_links_and_context_slices_stay_same_patient_scoped() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");
    let owner_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");
    let patients = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 ORDER BY created_at, id LIMIT 2",
    )
    .bind(facility_id)
    .fetch_all(&pool)
    .await
    .expect("patients exist");
    let patient_id = patients[0];
    let other_patient_id = patients[1];

    let problem = hms_db::clinical::create_problem(
        &pool,
        NewProblem {
            id: Uuid::new_v4(),
            facility_id,
            patient_id,
            label: "Diabetes".to_owned(),
            onset_date: None,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("problem creates");
    let other_note = hms_db::clinical::create_note(
        &pool,
        NewClinicalNote {
            id: Uuid::new_v4(),
            facility_id,
            patient_id: other_patient_id,
            encounter_id: None,
            note_type: ClinicalNoteType::DoctorNote,
            title: "Other patient note".to_owned(),
            body: "Not the same patient".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("other note creates");

    let mismatch = hms_db::clinical::create_problem_artifact_link(
        &pool,
        NewProblemArtifactLink {
            id: Uuid::new_v4(),
            facility_id,
            patient_id,
            problem_id: problem.id,
            artifact_kind: ProblemArtifactKind::ClinicalNote,
            artifact_id: other_note.id,
            actor_user_id: owner_id,
            request_id: Some("same-patient-problem-link-test".to_owned()),
        },
    )
    .await
    .expect("mismatched link is handled");
    assert!(mismatch.is_none());

    hms_db::clinical::create_allergy(
        &pool,
        NewAllergy {
            id: Uuid::new_v4(),
            facility_id,
            patient_id,
            substance: "Penicillin".to_owned(),
            reaction: Some("Rash".to_owned()),
            severity: AllergySeverity::Moderate,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("allergy creates");
    hms_db::clinical::create_prescription(
        &pool,
        NewPrescription {
            id: Uuid::new_v4(),
            facility_id,
            patient_id,
            medication_name: "Metformin".to_owned(),
            dose: "500 mg".to_owned(),
            route: "oral".to_owned(),
            frequency: "bd".to_owned(),
            inventory_item_id: None,
            start_date: None,
            duration_days: None,
            first_dose_at: None,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("prescription creates");

    let pharmacy_context =
        hms_db::clinical::pharmacy_clinical_context(&pool, facility_id, patient_id)
            .await
            .expect("pharmacy context loads");
    assert_eq!(pharmacy_context.active_problems[0].id, problem.id);
    assert_eq!(pharmacy_context.active_allergies[0].substance, "Penicillin");
    assert_eq!(
        pharmacy_context.order_relevant_medications[0].medication_name,
        "Metformin"
    );

    let test_id = hms_db::laboratory::list_test_catalog(&pool, facility_id)
        .await
        .expect("lab catalog loads")[0]
        .id;
    let order = hms_db::laboratory::create_order(
        &pool,
        NewLabOrder {
            id: Uuid::new_v4(),
            facility_id,
            patient_id,
            test_ids: vec![test_id],
            panel_ids: vec![],
            priority: LabPriority::Routine,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("lab order creates");

    let lab_link = hms_db::clinical::create_problem_artifact_link(
        &pool,
        NewProblemArtifactLink {
            id: Uuid::new_v4(),
            facility_id,
            patient_id,
            problem_id: problem.id,
            artifact_kind: ProblemArtifactKind::LabOrder,
            artifact_id: order.id,
            actor_user_id: owner_id,
            request_id: Some("lab-problem-link-test".to_owned()),
        },
    )
    .await
    .expect("lab problem link creates")
    .expect("lab problem link is same patient");
    assert_eq!(lab_link.problem_id, problem.id);

    let lab_context = hms_db::clinical::laboratory_clinical_context(&pool, facility_id, order.id)
        .await
        .expect("lab context loads")
        .expect("lab context exists");
    assert_eq!(lab_context.patient_id, patient_id);
    assert_eq!(lab_context.linked_problems.len(), 1);
    assert_eq!(lab_context.linked_problems[0].id, problem.id);
}
