//! Synthetic fixtures use the same placement and closure evidence as production.
use super::TestDb;
use crate::ward::{self, admission_moves as moves};
use chrono::{Duration, Utc};
use hms_domain::{deployment::DeploymentProfile, ward::*, ward_moves::*};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub async fn clear_discharge_blockers(db: &TestDb, discharge: Uuid) -> anyhow::Result<()> {
    for kind in [
        DischargeBlockerKind::DischargeSummary,
        DischargeBlockerKind::NursingRelease,
        DischargeBlockerKind::PharmacyClearance,
        DischargeBlockerKind::BillingClearance,
    ] {
        ward::override_discharge_blocker(
            db.pool(),
            db.facility_id(),
            discharge,
            kind,
            "Synthetic explicit fixture clearance".into(),
            db.owner_user_id(),
            Utc::now(),
        )
        .await?;
    }
    Ok(())
}
pub async fn prepare_discharge(db: &TestDb, admission: Uuid) -> anyhow::Result<Uuid> {
    let source = ward::get_admission_case(db.pool(), db.facility_id(), admission)
        .await?
        .ok_or_else(|| anyhow::anyhow!("synthetic admission missing"))?;
    if source.status == AdmissionStatus::ReadyForActivation {
        ward::activate_admission_case(db.pool(), db.facility_id(), admission, db.owner_user_id())
            .await?
            .ok_or_else(|| anyhow::anyhow!("synthetic activation missing"))?;
    }
    let context = ward::get_admission_context(db.pool(), db.facility_id(), admission)
        .await?
        .ok_or_else(|| anyhow::anyhow!("synthetic admission context missing"))?;
    let discharge = ward::request_discharge(
        db.pool(),
        Uuid::new_v4(),
        db.facility_id(),
        &context,
        None,
        None,
        db.owner_user_id(),
    )
    .await?;
    clear_discharge_blockers(db, discharge.id).await?;
    Ok(discharge.id)
}
pub async fn close_admission(db: &TestDb, admission: Uuid) -> anyhow::Result<()> {
    let discharge = prepare_discharge(db, admission).await?;
    ward::complete_discharge(db.pool(), db.facility_id(), discharge)
        .await?
        .ok_or_else(|| anyhow::anyhow!("synthetic discharge missing"))?;
    Ok(())
}
/// A borrowed transaction lets race tests retain the canonical parent row lock
/// until the real competing request has reached it. All deferred guards remain on.
pub async fn complete_prepared_discharge_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    discharge: Uuid,
) -> anyhow::Result<()> {
    let source: (Uuid, Option<Uuid>) = sqlx::query_as("SELECT d.admission_case_id,c.bed_id FROM discharge_cases d JOIN admission_cases c ON c.facility_id=d.facility_id AND c.id=d.admission_case_id WHERE d.facility_id=$1 AND d.id=$2 AND d.status='requested' AND c.status='discharge_pending' FOR UPDATE OF d,c").bind(facility).bind(discharge).fetch_one(&mut **tx).await?;
    let at = sqlx::query_scalar::<_, chrono::DateTime<Utc>>("SELECT clock_timestamp()")
        .fetch_one(&mut **tx)
        .await?;
    sqlx::query("UPDATE discharge_cases SET status='completed',discharged_at=$3,updated_at=$3 WHERE facility_id=$1 AND id=$2").bind(facility).bind(discharge).bind(at).execute(&mut **tx).await?;
    sqlx::query("UPDATE admission_cases SET status='discharged',discharged_at=$3,updated_at=$3,placement_revision=placement_revision+1 WHERE facility_id=$1 AND id=$2").bind(facility).bind(source.0).bind(at).execute(&mut **tx).await?;
    if let Some(bed) = source.1 {
        sqlx::query("UPDATE beds SET status='cleaning',cleaning_due_at=$3+make_interval(mins=>COALESCE(w.bed_cleaning_minutes_override,60)),updated_at=$3 FROM wards w WHERE beds.facility_id=$1 AND beds.id=$2 AND w.id=beds.ward_id AND w.facility_id=beds.facility_id").bind(facility).bind(bed).bind(at).execute(&mut **tx).await?;
    }
    ward::admission_moves::close_discharge_tx(tx, facility, source.0, discharge, at).await?;
    ward::admission_advisories::retire_pending(
        tx,
        facility,
        source.0,
        None,
        hms_domain::admission_advisories::AdmissionAdvisorySystemReason::AdmissionDischarged,
    )
    .await?;
    Ok(())
}
/// Use a separate real synthetic mover so fixture grants never invalidate the
/// owner/nurse session whose visibility or queued request the test is examining.
pub async fn move_admission(
    db: &TestDb,
    admission: Uuid,
    destination_bed: Uuid,
) -> anyhow::Result<AdmissionMoveReceipt> {
    let context = ward::get_admission_context(db.pool(), db.facility_id(), admission)
        .await?
        .ok_or_else(|| anyhow::anyhow!("synthetic admission missing"))?;
    if ward::get_admission_case(db.pool(), db.facility_id(), admission)
        .await?
        .ok_or_else(|| anyhow::anyhow!("synthetic admission missing"))?
        .status
        == AdmissionStatus::ReadyForActivation
    {
        ward::activate_admission_case(db.pool(), db.facility_id(), admission, db.owner_user_id())
            .await?
            .ok_or_else(|| anyhow::anyhow!("synthetic activation missing"))?;
    }
    let user = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,$2,$3,'Synthetic fixture mover',password_hash FROM users WHERE id=$4").bind(user).bind(db.facility_id()).bind(format!("fixture-mover-{user}@hms.local")).bind(db.owner_user_id()).execute(db.pool()).await?;
    for permission in [
        "admission.manage",
        "patient.demographics.view",
        "ward_board.view_all",
        "nursing.task.manage",
    ] {
        sqlx::query("INSERT INTO user_permissions(user_id,permission_code) VALUES($1,$2)")
            .bind(user)
            .bind(permission)
            .execute(db.pool())
            .await?;
    }
    for feature in ["patients", "admissions", "nursing"] {
        sqlx::query("INSERT INTO user_features(user_id,feature_key) VALUES($1,$2)")
            .bind(user)
            .bind(feature)
            .execute(db.pool())
            .await?;
    }
    sqlx::query("INSERT INTO user_patient_visibility(user_id,visibility) VALUES($1,'demographics'),($1,'full_clinical')").bind(user).execute(db.pool()).await?;
    sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient')").bind(db.facility_id()).bind(user).bind(context.patient_id).execute(db.pool()).await?;
    let (sv, pv): (i64, i64) =
        sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
            .bind(user)
            .fetch_one(db.pool())
            .await?;
    let now = Utc::now();
    let session = Uuid::new_v4();
    crate::auth::insert_refresh_session(
        db.pool(),
        &crate::auth::NewRefreshSession {
            token_hash: Uuid::new_v4().to_string(),
            session_id: session,
            session_family_id: session,
            rotated_from_session_id: None,
            user_id: user,
            facility_id: db.facility_id(),
            session_version: sv,
            permission_version_at_issue: pv,
            csrf_token_hash: "synthetic-hash".into(),
            expires_at: now + Duration::hours(1),
            session_started_at: now,
            idle_expires_at: now + Duration::hours(1),
            absolute_expires_at: now + Duration::hours(1),
            device_label: None,
        },
    )
    .await?;
    let actor = moves::AdmissionMoveActor {
        facility_id: db.facility_id(),
        user_id: user,
        request_id: None,
        authorization: crate::clinical::prescription_courses::PrescriptionAuthorization {
            session_id: session,
            session_version: sv,
            permission_version: pv,
            active_profile: DeploymentProfile::Hospital,
            valid_until: now + Duration::minutes(10),
            resolved_network_policy_version: Some(
                crate::network::get_policy(db.pool(), db.facility_id())
                    .await?
                    .version,
            ),
        },
    };
    let current = moves::context(db.pool(), actor.clone(), context.patient_id, admission).await?;
    let options = moves::destinations(
        db.pool(),
        actor.clone(),
        context.patient_id,
        admission,
        None,
        None,
        None,
        101,
    )
    .await?;
    let destination = options
        .into_iter()
        .find(|v| v.0.labels.bed_id == destination_bed)
        .ok_or_else(|| anyhow::anyhow!("explicit synthetic destination missing"))?
        .0;
    moves::move_admission(
        db.pool(),
        actor,
        context.patient_id,
        admission,
        AdmissionMoveRequest {
            client_request_id: Uuid::new_v4(),
            expected_placement_token: current.placement_token,
            destination_bed_id: destination_bed,
            expected_destination_token: destination.candidate_token,
            expected_task_membership_token: current
                .task_membership_token
                .ok_or_else(|| anyhow::anyhow!("synthetic task membership unavailable"))?,
            task_policy: AdmissionMoveTaskPolicy::RouteAllClearAssignees,
            reason: "Synthetic reviewed fixture movement".into(),
        },
    )
    .await
}
