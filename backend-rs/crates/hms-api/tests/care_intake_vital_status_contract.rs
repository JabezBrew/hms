//! Canonical normal-intake vital status precedes a restricted-record override.
mod support;
use support::*;

fn must<T, E>(value: Result<T, E>, stage: &'static str) -> T {
    value.unwrap_or_else(|_| panic!("{stage}"))
}

async fn bounded(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = must(
        to_bytes(response.into_body(), 2 * 1024 * 1024).await,
        "bounded synthetic intake response reads",
    );
    (
        status,
        must(serde_json::from_slice(&bytes), "intake envelope decodes"),
    )
}

#[tokio::test]
async fn normal_outpatient_intake_rejects_deceased_even_with_authorized_restricted_record_override()
{
    let app = app().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let user = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    for permission in [
        PermissionCode::PatientUpdate,
        PermissionCode::AppointmentManage,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(&app, user, permission).await;
    }
    for feature in [FeatureKey::Patients, FeatureKey::Appointments] {
        grant_test_feature(&app, user, feature).await;
    }
    grant_test_patient_visibility(&app, user, PatientDataVisibility::Demographics).await;
    let actor = Actor::login(&app, "owner@hms.local").await;
    let clinic = Uuid::new_v4();
    must(sqlx::query("INSERT INTO clinics(id,facility_id,code,name,is_active) VALUES($1,$2,$3,'Synthetic vital-status clinic',true)").bind(clinic).bind(facility).bind(format!("SYN-VITAL-{}",clinic.simple())).execute(&pool).await,"exact active synthetic clinic inserts");
    let mut outcomes = Vec::new();
    let mut facts = Vec::new();
    let mut deceased_denials = Vec::new();
    let private_note = "Synthetic private restricted-record explanation";
    for (restricted, deceased) in [(false, false), (true, false), (false, true), (true, true)] {
        let patient = Uuid::new_v4();
        must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status,record_status,vital_status) VALUES($1,$2,$3,'Synthetic','Vital status','2000-01-01','other','active','registered','presumed_alive')").bind(patient).bind(facility).bind(format!("SYN-VITAL-{}",patient.simple())).execute(&pool).await,"isolated registered synthetic patient inserts");
        // Establish the independent record/vital axes through the real status
        // publisher, rather than manufacturing an impossible imported state.
        let state = bounded(
            api_patch_json(
                app.clone(),
                &actor,
                format!("/api/v2/patients/{patient}"),
                json!({
                    "record_status":if restricted {"restricted"} else {"registered"},
                    "vital_status":if deceased {"deceased"} else {"presumed_alive"},
                    "status_reason_code":"synthetic_status_review"
                }),
            )
            .await,
        )
        .await;
        assert!(
            state.0 == StatusCode::OK,
            "actual patient state publisher establishes the synthetic control"
        );
        let mut input = json!({
            "patient_id":patient,
            "clinic_id":clinic,
            "idempotency_key":Uuid::new_v4().to_string()
        });
        if restricted {
            input["restricted_record_override"] = json!({
                "reason_code":"synthetic_authorized_override",
                "reason_note":private_note
            });
        }
        let out = bounded(
            api_post_json(
                app.clone(),
                &actor,
                "/api/v2/care-areas/outpatient/intake",
                input,
            )
            .await,
        )
        .await;
        outcomes.push(out.0.as_u16());
        deceased_denials.push(
            out.0 == StatusCode::CONFLICT
                && out.1["error"]["code"] == "patient_deceased_intake_blocked",
        );
        let saved:(i64,i64,i64,bool)=must(sqlx::query_as("SELECT (SELECT count(*) FROM visits WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM care_area_intake_idempotency_keys WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND resource_id=$2 AND event_type='patient.identity.record_override'),COALESCE((SELECT bool_and(metadata->>'reason_code'='synthetic_authorized_override' AND metadata->>'reason_note_present'='true' AND NOT(metadata ? 'reason_note') AND position($3 in metadata::text)=0) FROM audit_events WHERE facility_id=$1 AND resource_id=$2 AND event_type='patient.identity.record_override'),true)").bind(facility).bind(patient).bind(private_note).fetch_one(&pool).await,"committed intake and private-audit aggregate facts load");
        facts.push(saved);
    }
    // Static statuses/counts only: no response body, patient identity or note.
    eprintln!("vital_intake_statuses={outcomes:?} committed_visit_key_override_privacy={facts:?} deceased_denials={deceased_denials:?}");
    assert!(
        outcomes[..2] == [200, 200]
            && facts[0] == (1, 1, 0, true)
            && facts[1] == (1, 1, 1, true)
            && deceased_denials[2..].iter().all(|value| *value)
            && facts[2..].iter().all(|value| *value == (0, 0, 0, true)),
        "registered and authorized restricted living controls create one context; deceased status always blocks before a visit, intake key or override audit can commit"
    );
}
