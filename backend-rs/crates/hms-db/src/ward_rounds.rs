use anyhow::Context;
use chrono::{DateTime, Utc};
use hms_domain::clinical::PrescriptionStatus;
use hms_domain::laboratory::{LabOrderStatus, LabPriority};
use hms_domain::ward::{AdmissionStatus, NursingTaskStatus, NursingTaskType};
use hms_domain::ward_rounds::{
    WardRoundActionCounts, WardRoundActionItem, WardRoundActionStatus, WardRoundActionType,
    WardRoundArtifactSummary, WardRoundDetail, WardRoundDischargeRequestPayload,
    WardRoundLabOrderPayload, WardRoundNoteSections, WardRoundNursingTaskPayload,
    WardRoundPrescriptionPayload, WardRoundReviewRail, WardRoundStatus,
};
use hms_observability::observe_db_query;
use serde_json::Value as JsonValue;
use sqlx::types::Json;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct NewWardRound {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub admission_case_id: Option<Uuid>,
    pub note_sections: WardRoundNoteSections,
    pub rendered_note: Option<String>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct WardRoundUpdate {
    pub note_sections: Option<WardRoundNoteSections>,
    pub rendered_note: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewWardRoundAction {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub ward_round_id: Uuid,
    pub action_type: WardRoundActionType,
    pub title: Option<String>,
    pub instruction: Option<String>,
    pub payload: JsonValue,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug, Default)]
pub struct WardRoundActionUpdate {
    pub title: Option<String>,
    pub instruction: Option<String>,
    pub payload: Option<JsonValue>,
    pub status: Option<WardRoundActionStatus>,
}

#[derive(Clone, Debug, FromRow)]
struct AdmissionScopeRow {
    id: Uuid,
    patient_id: Uuid,
    ward_id: Uuid,
    status: String,
}

#[derive(Clone, Debug, FromRow)]
struct WardRoundScopeRow {
    admission_case_id: Uuid,
    status: String,
    version: i64,
}

#[derive(Clone, Debug, FromRow)]
struct WardRoundDetailRow {
    id: Uuid,
    patient_id: Uuid,
    admission_case_id: Uuid,
    status: String,
    version: i64,
    note_sections: Json<WardRoundNoteSections>,
    review_rail: Json<WardRoundReviewRail>,
    rendered_note: Option<String>,
    action_counts: Json<WardRoundActionCounts>,
    actions: Json<Vec<WardRoundActionItem>>,
    artifacts: Json<Vec<WardRoundArtifactSummary>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    signed_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct CommitActionRow {
    id: Uuid,
    action_type: String,
    title: Option<String>,
    instruction: Option<String>,
    payload: JsonValue,
}

#[derive(Clone, Debug)]
struct CreatedArtifact {
    action_id: Uuid,
    resource_type: String,
    resource_id: Uuid,
    title: String,
}

pub async fn get_current_ward_round(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
) -> anyhow::Result<Option<WardRoundDetail>> {
    let Some(admission) = active_admission_for_patient(pool, facility_id, patient_id).await? else {
        return Ok(None);
    };

    let row = observe_db_query(
        "ward_rounds.current.get",
        sqlx::query_as::<_, WardRoundDetailRow>(&format!(
            "{WARD_ROUND_DETAIL_SELECT}
             WHERE ward_rounds.facility_id = $1
               AND ward_rounds.patient_id = $2
               AND ward_rounds.admission_case_id = $3
             {WARD_ROUND_DETAIL_GROUP_BY}
             ORDER BY ward_rounds.status = 'draft' DESC,
                      ward_rounds.updated_at DESC,
                      ward_rounds.id DESC
             LIMIT 1"
        ))
        .bind(facility_id)
        .bind(patient_id)
        .bind(admission.id)
        .fetch_optional(pool),
    )
    .await?;
    row.map(detail_from_row).transpose()
}

pub async fn get_ward_round(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    ward_round_id: Uuid,
) -> anyhow::Result<Option<WardRoundDetail>> {
    let row = observe_db_query(
        "ward_rounds.detail.get",
        sqlx::query_as::<_, WardRoundDetailRow>(&format!(
            "{WARD_ROUND_DETAIL_SELECT}
             WHERE ward_rounds.facility_id = $1
               AND ward_rounds.patient_id = $2
               AND ward_rounds.id = $3
             {WARD_ROUND_DETAIL_GROUP_BY}"
        ))
        .bind(facility_id)
        .bind(patient_id)
        .bind(ward_round_id)
        .fetch_optional(pool),
    )
    .await?;
    row.map(detail_from_row).transpose()
}

pub async fn create_ward_round(
    pool: &PgPool,
    round: NewWardRound,
) -> anyhow::Result<Option<WardRoundDetail>> {
    let Some(admission) = scoped_active_admission(
        pool,
        round.facility_id,
        round.patient_id,
        round.admission_case_id,
    )
    .await?
    else {
        return Ok(None);
    };
    let review_rail = review_rail(pool, round.facility_id, round.patient_id, admission.id).await?;
    let inserted_id = observe_db_query(
        "ward_rounds.create",
        sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO ward_rounds (
                id,
                facility_id,
                patient_id,
                admission_case_id,
                status,
                note_sections,
                review_rail,
                rendered_note,
                created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (facility_id, admission_case_id) WHERE status = 'draft'
            DO UPDATE SET note_sections = EXCLUDED.note_sections,
                          rendered_note = EXCLUDED.rendered_note,
                          review_rail = EXCLUDED.review_rail,
                          version = ward_rounds.version + 1,
                          updated_at = now()
            RETURNING id
            "#,
        )
        .bind(round.id)
        .bind(round.facility_id)
        .bind(round.patient_id)
        .bind(admission.id)
        .bind(codec::encode(WardRoundStatus::Draft)?)
        .bind(Json(round.note_sections))
        .bind(Json(review_rail))
        .bind(round.rendered_note)
        .bind(round.actor_user_id)
        .fetch_one(pool),
    )
    .await?;

    get_ward_round(pool, round.facility_id, round.patient_id, inserted_id).await
}

pub async fn update_ward_round(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    ward_round_id: Uuid,
    expected_version: i64,
    update: WardRoundUpdate,
) -> anyhow::Result<Option<WardRoundDetail>> {
    let note_sections = update.note_sections.map(Json);
    let updated_id = observe_db_query(
        "ward_rounds.update",
        sqlx::query_scalar::<_, Uuid>(
            r#"
            UPDATE ward_rounds
            SET note_sections = COALESCE($5, note_sections),
                rendered_note = COALESCE($6, rendered_note),
                version = version + 1,
                updated_at = now()
            WHERE facility_id = $1
              AND patient_id = $2
              AND id = $3
              AND version = $4
              AND status = 'draft'
            RETURNING id
            "#,
        )
        .bind(facility_id)
        .bind(patient_id)
        .bind(ward_round_id)
        .bind(expected_version)
        .bind(note_sections)
        .bind(update.rendered_note)
        .fetch_optional(pool),
    )
    .await?;

    match updated_id {
        Some(id) => get_ward_round(pool, facility_id, patient_id, id).await,
        None => Ok(None),
    }
}

pub async fn create_ward_round_action(
    pool: &PgPool,
    action: NewWardRoundAction,
) -> anyhow::Result<Option<WardRoundDetail>> {
    let Some(scope) = round_scope(
        pool,
        action.facility_id,
        action.patient_id,
        action.ward_round_id,
    )
    .await?
    else {
        return Ok(None);
    };
    if codec::decode::<WardRoundStatus>(&scope.status)? != WardRoundStatus::Draft {
        return Ok(None);
    }

    observe_db_query(
        "ward_rounds.actions.create",
        sqlx::query(
            r#"
            INSERT INTO ward_round_actions (
                id,
                facility_id,
                ward_round_id,
                patient_id,
                admission_case_id,
                action_type,
                status,
                title,
                instruction,
                payload,
                created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            "#,
        )
        .bind(action.id)
        .bind(action.facility_id)
        .bind(action.ward_round_id)
        .bind(action.patient_id)
        .bind(scope.admission_case_id)
        .bind(codec::encode(action.action_type)?)
        .bind(codec::encode(WardRoundActionStatus::Draft)?)
        .bind(action.title)
        .bind(action.instruction)
        .bind(action.payload)
        .bind(action.actor_user_id)
        .execute(pool),
    )
    .await?;

    bump_round_version(pool, action.facility_id, action.ward_round_id).await?;
    get_ward_round(
        pool,
        action.facility_id,
        action.patient_id,
        action.ward_round_id,
    )
    .await
}

pub async fn update_ward_round_action(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    ward_round_id: Uuid,
    action_id: Uuid,
    update: WardRoundActionUpdate,
) -> anyhow::Result<Option<WardRoundDetail>> {
    let status = update.status.map(codec::encode).transpose()?;
    let updated = observe_db_query(
        "ward_rounds.actions.update",
        sqlx::query_scalar::<_, Uuid>(
            r#"
            UPDATE ward_round_actions
            SET title = COALESCE($5, title),
                instruction = COALESCE($6, instruction),
                payload = COALESCE($7, payload),
                status = COALESCE($8, status),
                updated_at = now()
            WHERE facility_id = $1
              AND patient_id = $2
              AND ward_round_id = $3
              AND id = $4
              AND status = 'draft'
            RETURNING id
            "#,
        )
        .bind(facility_id)
        .bind(patient_id)
        .bind(ward_round_id)
        .bind(action_id)
        .bind(update.title)
        .bind(update.instruction)
        .bind(update.payload)
        .bind(status)
        .fetch_optional(pool),
    )
    .await?;
    if updated.is_some() {
        bump_round_version(pool, facility_id, ward_round_id).await?;
    }
    match updated {
        Some(_) => get_ward_round(pool, facility_id, patient_id, ward_round_id).await,
        None => Ok(None),
    }
}

pub async fn delete_ward_round_action(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    ward_round_id: Uuid,
    action_id: Uuid,
) -> anyhow::Result<Option<WardRoundDetail>> {
    let deleted = observe_db_query(
        "ward_rounds.actions.delete",
        sqlx::query_scalar::<_, Uuid>(
            r#"
            DELETE FROM ward_round_actions
            WHERE facility_id = $1
              AND patient_id = $2
              AND ward_round_id = $3
              AND id = $4
              AND status = 'draft'
            RETURNING id
            "#,
        )
        .bind(facility_id)
        .bind(patient_id)
        .bind(ward_round_id)
        .bind(action_id)
        .fetch_optional(pool),
    )
    .await?;
    if deleted.is_some() {
        bump_round_version(pool, facility_id, ward_round_id).await?;
    }
    match deleted {
        Some(_) => get_ward_round(pool, facility_id, patient_id, ward_round_id).await,
        None => Ok(None),
    }
}

pub async fn commit_ward_round(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    ward_round_id: Uuid,
    expected_version: i64,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<WardRoundDetail>> {
    let mut transaction = pool.begin().await?;
    let Some(round) = sqlx::query_as::<_, WardRoundScopeRow>(
        r#"
        SELECT admission_case_id, status, version
        FROM ward_rounds
        WHERE facility_id = $1
          AND patient_id = $2
          AND id = $3
        FOR UPDATE
        "#,
    )
    .bind(facility_id)
    .bind(patient_id)
    .bind(ward_round_id)
    .fetch_optional(&mut *transaction)
    .await?
    else {
        return Ok(None);
    };

    if codec::decode::<WardRoundStatus>(&round.status)? != WardRoundStatus::Draft {
        anyhow::bail!("ward_round_not_draft");
    }
    if round.version != expected_version {
        anyhow::bail!("ward_round_stale_version");
    }

    let admission = admission_for_update(&mut transaction, facility_id, round.admission_case_id)
        .await?
        .context("ward_round_admission_not_found")?;
    if admission.patient_id != patient_id {
        anyhow::bail!("ward_round_wrong_patient");
    }
    let admission_status: AdmissionStatus = codec::decode(&admission.status)?;
    if !matches!(
        admission_status,
        AdmissionStatus::Admitted | AdmissionStatus::DischargePending
    ) {
        anyhow::bail!("ward_round_inactive_admission");
    }

    let actions = sqlx::query_as::<_, CommitActionRow>(
        r#"
        SELECT id, action_type, title, instruction, payload
        FROM ward_round_actions
        WHERE facility_id = $1
          AND ward_round_id = $2
          AND status = 'draft'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
        "#,
    )
    .bind(facility_id)
    .bind(ward_round_id)
    .fetch_all(&mut *transaction)
    .await?;

    let mut artifacts = Vec::new();
    for action in actions {
        let artifact = commit_action(
            &mut transaction,
            facility_id,
            patient_id,
            &admission,
            &action,
            actor_user_id,
        )
        .await
        .with_context(|| format!("ward_round_action_commit_failed:{}", action.id))?;
        link_artifact(
            &mut transaction,
            facility_id,
            ward_round_id,
            patient_id,
            admission.id,
            &artifact,
        )
        .await?;
        artifacts.push(artifact);
    }

    sqlx::query(
        r#"
        UPDATE ward_rounds
        SET status = $1,
            version = version + 1,
            signed_by_user_id = $2,
            signed_at = now(),
            updated_at = now()
        WHERE facility_id = $3
          AND id = $4
        "#,
    )
    .bind(codec::encode(WardRoundStatus::Committed)?)
    .bind(actor_user_id)
    .bind(facility_id)
    .bind(ward_round_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    get_ward_round(pool, facility_id, patient_id, ward_round_id).await
}

async fn active_admission_for_patient(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
) -> anyhow::Result<Option<AdmissionScopeRow>> {
    Ok(observe_db_query(
        "ward_rounds.active_admission.patient",
        sqlx::query_as::<_, AdmissionScopeRow>(
            r#"
            SELECT id, patient_id, ward_id, status
            FROM admission_cases
            WHERE facility_id = $1
              AND patient_id = $2
              AND status IN ('admitted', 'discharge_pending')
            ORDER BY admitted_at DESC, id DESC
            LIMIT 1
            "#,
        )
        .bind(facility_id)
        .bind(patient_id)
        .fetch_optional(pool),
    )
    .await?)
}

async fn scoped_active_admission(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    admission_case_id: Option<Uuid>,
) -> anyhow::Result<Option<AdmissionScopeRow>> {
    let Some(admission_case_id) = admission_case_id else {
        return active_admission_for_patient(pool, facility_id, patient_id).await;
    };
    Ok(sqlx::query_as::<_, AdmissionScopeRow>(
        r#"
        SELECT id, patient_id, ward_id, status
        FROM admission_cases
        WHERE facility_id = $1
          AND patient_id = $2
          AND id = $3
          AND status IN ('admitted', 'discharge_pending')
        "#,
    )
    .bind(facility_id)
    .bind(patient_id)
    .bind(admission_case_id)
    .fetch_optional(pool)
    .await?)
}

async fn round_scope(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    ward_round_id: Uuid,
) -> anyhow::Result<Option<WardRoundScopeRow>> {
    Ok(sqlx::query_as::<_, WardRoundScopeRow>(
        r#"
        SELECT admission_case_id, status, version
        FROM ward_rounds
        WHERE facility_id = $1
          AND patient_id = $2
          AND id = $3
        "#,
    )
    .bind(facility_id)
    .bind(patient_id)
    .bind(ward_round_id)
    .fetch_optional(pool)
    .await?)
}

async fn review_rail(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<WardRoundReviewRail> {
    let row = sqlx::query_as::<_, ReviewRailRow>(
        r#"
        SELECT
          (SELECT count(*)::bigint
           FROM prescriptions
           WHERE facility_id = $1
             AND patient_id = $2
             AND status = 'active') AS active_medication_count,
          (SELECT count(*)::bigint
           FROM lab_orders
           WHERE facility_id = $1
             AND patient_id = $2
             AND status IN ('ordered', 'specimen_collected')) AS open_lab_order_count,
          (SELECT count(*)::bigint
           FROM nursing_tasks
           WHERE facility_id = $1
             AND admission_case_id = $3
             AND status = 'open') AS open_nursing_task_count,
          (SELECT CASE WHEN EXISTS (
             SELECT 1
             FROM discharge_cases
             WHERE facility_id = $1
               AND admission_case_id = $3
               AND status = 'requested'
           ) THEN 1 ELSE 0 END)::bigint AS discharge_blocker_count
        "#,
    )
    .bind(facility_id)
    .bind(patient_id)
    .bind(admission_case_id)
    .fetch_one(pool)
    .await?;
    Ok(WardRoundReviewRail {
        active_medication_count: row.active_medication_count,
        open_lab_order_count: row.open_lab_order_count,
        open_nursing_task_count: row.open_nursing_task_count,
        discharge_blocker_count: row.discharge_blocker_count,
    })
}

#[derive(Clone, Debug, FromRow)]
struct ReviewRailRow {
    active_medication_count: i64,
    open_lab_order_count: i64,
    open_nursing_task_count: i64,
    discharge_blocker_count: i64,
}

async fn bump_round_version(
    pool: &PgPool,
    facility_id: Uuid,
    ward_round_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        UPDATE ward_rounds
        SET version = version + 1,
            updated_at = now()
        WHERE facility_id = $1
          AND id = $2
          AND status = 'draft'
        "#,
    )
    .bind(facility_id)
    .bind(ward_round_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn admission_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<Option<AdmissionScopeRow>> {
    Ok(sqlx::query_as::<_, AdmissionScopeRow>(
        r#"
        SELECT id, patient_id, ward_id, status
        FROM admission_cases
        WHERE facility_id = $1
          AND id = $2
        FOR UPDATE
        "#,
    )
    .bind(facility_id)
    .bind(admission_case_id)
    .fetch_optional(&mut **transaction)
    .await?)
}

async fn commit_action(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    patient_id: Uuid,
    admission: &AdmissionScopeRow,
    action: &CommitActionRow,
    actor_user_id: Uuid,
) -> anyhow::Result<CreatedArtifact> {
    let action_type: WardRoundActionType = codec::decode(&action.action_type)?;
    let artifact = match action_type {
        WardRoundActionType::Prescription => {
            commit_prescription_action(transaction, facility_id, patient_id, action, actor_user_id)
                .await?
        }
        WardRoundActionType::LabOrder => {
            commit_lab_order_action(transaction, facility_id, patient_id, action, actor_user_id)
                .await?
        }
        WardRoundActionType::NursingTask => {
            commit_nursing_task_action(
                transaction,
                facility_id,
                patient_id,
                admission,
                action,
                actor_user_id,
            )
            .await?
        }
        WardRoundActionType::DischargeRequest => {
            commit_discharge_request_action(
                transaction,
                facility_id,
                patient_id,
                admission,
                action,
                actor_user_id,
            )
            .await?
        }
    };

    sqlx::query(
        r#"
        UPDATE ward_round_actions
        SET status = $1,
            committed_resource_type = $2,
            committed_resource_id = $3,
            updated_at = now()
        WHERE facility_id = $4
          AND id = $5
        "#,
    )
    .bind(codec::encode(WardRoundActionStatus::Committed)?)
    .bind(&artifact.resource_type)
    .bind(artifact.resource_id)
    .bind(facility_id)
    .bind(action.id)
    .execute(&mut **transaction)
    .await?;

    Ok(artifact)
}

async fn commit_prescription_action(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    patient_id: Uuid,
    action: &CommitActionRow,
    actor_user_id: Uuid,
) -> anyhow::Result<CreatedArtifact> {
    let payload: WardRoundPrescriptionPayload = serde_json::from_value(action.payload.clone())?;
    let (resource_id, title) = if let Some(prescription_id) = payload.prescription_id {
        let row = sqlx::query_as::<_, PrescriptionArtifactRow>(
            r#"
            UPDATE prescriptions
            SET medication_name = COALESCE($4, medication_name),
                dose = COALESCE($5, dose),
                frequency = COALESCE($6, frequency),
                status = COALESCE($7, status),
                updated_at = now()
            WHERE facility_id = $1
              AND patient_id = $2
              AND id = $3
            RETURNING id, medication_name
            "#,
        )
        .bind(facility_id)
        .bind(patient_id)
        .bind(prescription_id)
        .bind(payload.medication_name)
        .bind(payload.dose)
        .bind(payload.frequency)
        .bind(payload.status.map(codec::encode).transpose()?)
        .fetch_optional(&mut **transaction)
        .await?
        .context("ward_round_prescription_not_found")?;
        (row.id, row.medication_name)
    } else {
        let medication_name = payload
            .medication_name
            .filter(|value| !value.trim().is_empty())
            .context("ward_round_prescription_medication_required")?;
        let dose = payload
            .dose
            .filter(|value| !value.trim().is_empty())
            .context("ward_round_prescription_dose_required")?;
        let frequency = payload
            .frequency
            .filter(|value| !value.trim().is_empty())
            .context("ward_round_prescription_frequency_required")?;
        let id = Uuid::new_v4();
        let row = sqlx::query_as::<_, PrescriptionArtifactRow>(
            r#"
            INSERT INTO prescriptions (
                id, facility_id, patient_id, medication_name, dose, frequency, status, created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, medication_name
            "#,
        )
        .bind(id)
        .bind(facility_id)
        .bind(patient_id)
        .bind(medication_name)
        .bind(dose)
        .bind(frequency)
        .bind(codec::encode(payload.status.unwrap_or(PrescriptionStatus::Active))?)
        .bind(actor_user_id)
        .fetch_one(&mut **transaction)
        .await?;
        (row.id, row.medication_name)
    };

    Ok(CreatedArtifact {
        action_id: action.id,
        resource_type: "prescription".to_owned(),
        resource_id,
        title,
    })
}

#[derive(Clone, Debug, FromRow)]
struct PrescriptionArtifactRow {
    id: Uuid,
    medication_name: String,
}

async fn commit_lab_order_action(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    patient_id: Uuid,
    action: &CommitActionRow,
    actor_user_id: Uuid,
) -> anyhow::Result<CreatedArtifact> {
    let payload: WardRoundLabOrderPayload = serde_json::from_value(action.payload.clone())?;
    let test_ids = resolve_lab_order_test_ids(
        transaction,
        facility_id,
        &payload.test_ids,
        &payload.panel_ids,
    )
    .await?;
    if test_ids.is_empty() {
        anyhow::bail!("ward_round_lab_order_tests_required");
    }

    let order_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO lab_orders (
            id, facility_id, patient_id, priority, status, ordered_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(order_id)
    .bind(facility_id)
    .bind(patient_id)
    .bind(codec::encode(
        payload.priority.unwrap_or(LabPriority::Routine),
    )?)
    .bind(codec::encode(LabOrderStatus::Ordered)?)
    .bind(actor_user_id)
    .execute(&mut **transaction)
    .await?;

    for test_id in test_ids {
        sqlx::query(
            r#"
            INSERT INTO lab_order_tests (order_id, test_id)
            VALUES ($1, $2)
            ON CONFLICT (order_id, test_id) DO NOTHING
            "#,
        )
        .bind(order_id)
        .bind(test_id)
        .execute(&mut **transaction)
        .await?;
    }

    Ok(CreatedArtifact {
        action_id: action.id,
        resource_type: "lab_order".to_owned(),
        resource_id: order_id,
        title: action
            .title
            .clone()
            .unwrap_or_else(|| "Laboratory order".to_owned()),
    })
}

async fn resolve_lab_order_test_ids(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    test_ids: &[Uuid],
    panel_ids: &[Uuid],
) -> anyhow::Result<Vec<Uuid>> {
    let rows = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT DISTINCT test_id
        FROM (
            SELECT lab_tests.id AS test_id
            FROM lab_tests
            WHERE lab_tests.facility_id = $1
              AND lab_tests.is_active = TRUE
              AND lab_tests.id = ANY($2)
            UNION
            SELECT lab_panel_tests.test_id
            FROM lab_panel_tests
            JOIN lab_panels
              ON lab_panels.id = lab_panel_tests.panel_id
             AND lab_panels.facility_id = $1
             AND lab_panels.is_active = TRUE
            JOIN lab_tests
              ON lab_tests.id = lab_panel_tests.test_id
             AND lab_tests.facility_id = $1
             AND lab_tests.is_active = TRUE
            WHERE lab_panel_tests.panel_id = ANY($3)
        ) tests
        ORDER BY test_id
        "#,
    )
    .bind(facility_id)
    .bind(test_ids)
    .bind(panel_ids)
    .fetch_all(&mut **transaction)
    .await?;
    Ok(rows)
}

async fn commit_nursing_task_action(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    patient_id: Uuid,
    admission: &AdmissionScopeRow,
    action: &CommitActionRow,
    actor_user_id: Uuid,
) -> anyhow::Result<CreatedArtifact> {
    let mut payload: WardRoundNursingTaskPayload = serde_json::from_value(action.payload.clone())?;
    if let Some(title) = action
        .title
        .as_ref()
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload.title = title.to_owned();
    }
    if let Some(instruction) = action
        .instruction
        .as_ref()
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload.instruction = instruction.to_owned();
    }
    let task_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO nursing_tasks (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            ward_id,
            task_type,
            title,
            instruction,
            status,
            due_at,
            assigned_to_user_id,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        "#,
    )
    .bind(task_id)
    .bind(facility_id)
    .bind(admission.id)
    .bind(patient_id)
    .bind(admission.ward_id)
    .bind(codec::encode(
        payload.task_type.unwrap_or(NursingTaskType::WardRound),
    )?)
    .bind(&payload.title)
    .bind(&payload.instruction)
    .bind(codec::encode(NursingTaskStatus::Open)?)
    .bind(payload.due_at)
    .bind(payload.assigned_to_user_id)
    .bind(actor_user_id)
    .execute(&mut **transaction)
    .await?;

    Ok(CreatedArtifact {
        action_id: action.id,
        resource_type: "nursing_task".to_owned(),
        resource_id: task_id,
        title: payload.title,
    })
}

async fn commit_discharge_request_action(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    patient_id: Uuid,
    admission: &AdmissionScopeRow,
    action: &CommitActionRow,
    actor_user_id: Uuid,
) -> anyhow::Result<CreatedArtifact> {
    let payload: WardRoundDischargeRequestPayload =
        serde_json::from_value(action.payload.clone()).unwrap_or_default();
    if !payload.requested {
        anyhow::bail!("ward_round_discharge_request_not_requested");
    }
    let discharge_id = Uuid::new_v4();
    let row = sqlx::query_as::<_, DischargeArtifactRow>(
        r#"
        INSERT INTO discharge_cases (
            id, facility_id, admission_case_id, patient_id, status, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, 'requested', $5)
        ON CONFLICT (admission_case_id) DO UPDATE
        SET status = EXCLUDED.status,
            updated_at = now()
        RETURNING id
        "#,
    )
    .bind(discharge_id)
    .bind(facility_id)
    .bind(admission.id)
    .bind(patient_id)
    .bind(actor_user_id)
    .fetch_one(&mut **transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE admission_cases
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2
          AND id = $3
        "#,
    )
    .bind(codec::encode(AdmissionStatus::DischargePending)?)
    .bind(facility_id)
    .bind(admission.id)
    .execute(&mut **transaction)
    .await?;

    Ok(CreatedArtifact {
        action_id: action.id,
        resource_type: "discharge_case".to_owned(),
        resource_id: row.id,
        title: action
            .title
            .clone()
            .unwrap_or_else(|| "Discharge requested".to_owned()),
    })
}

#[derive(Clone, Debug, FromRow)]
struct DischargeArtifactRow {
    id: Uuid,
}

async fn link_artifact(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    ward_round_id: Uuid,
    patient_id: Uuid,
    admission_case_id: Uuid,
    artifact: &CreatedArtifact,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO ward_round_artifact_links (
            id,
            facility_id,
            ward_round_id,
            action_id,
            patient_id,
            admission_case_id,
            resource_type,
            resource_id,
            title
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (ward_round_id, resource_type, resource_id)
        DO UPDATE SET title = EXCLUDED.title
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(facility_id)
    .bind(ward_round_id)
    .bind(artifact.action_id)
    .bind(patient_id)
    .bind(admission_case_id)
    .bind(&artifact.resource_type)
    .bind(artifact.resource_id)
    .bind(&artifact.title)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

const WARD_ROUND_DETAIL_SELECT: &str = r#"
            SELECT ward_rounds.id,
                   ward_rounds.patient_id,
                   ward_rounds.admission_case_id,
                   ward_rounds.status,
                   ward_rounds.version,
                   ward_rounds.note_sections AS note_sections,
                   ward_rounds.review_rail AS review_rail,
                   ward_rounds.rendered_note,
                   jsonb_build_object(
                     'draft', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.status = 'draft'),
                     'committed', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.status = 'committed'),
                     'cancelled', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.status = 'cancelled'),
                     'prescriptions', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'prescription'),
                     'lab_orders', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'lab_order'),
                     'nursing_tasks', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'nursing_task'),
                     'discharge_requests', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'discharge_request')
                   ) AS action_counts,
                   COALESCE(
                     jsonb_agg(
                       jsonb_build_object(
                         'id', ward_round_actions.id,
                         'ward_round_id', ward_round_actions.ward_round_id,
                         'action_type', ward_round_actions.action_type,
                         'status', ward_round_actions.status,
                         'title', ward_round_actions.title,
                         'instruction', ward_round_actions.instruction,
                         'payload', ward_round_actions.payload,
                         'committed_resource_type', ward_round_actions.committed_resource_type,
                         'committed_resource_id', ward_round_actions.committed_resource_id,
                         'created_at', ward_round_actions.created_at,
                         'updated_at', ward_round_actions.updated_at
                       )
                       ORDER BY ward_round_actions.created_at ASC, ward_round_actions.id ASC
                     ) FILTER (WHERE ward_round_actions.id IS NOT NULL),
                     '[]'::jsonb
                   ) AS actions,
                   COALESCE(
                     (
                       SELECT jsonb_agg(
                         jsonb_build_object(
                           'resource_type', links.resource_type,
                           'resource_id', links.resource_id,
                           'title', links.title
                         )
                         ORDER BY links.created_at ASC, links.id ASC
                       )
                       FROM ward_round_artifact_links links
                       WHERE links.ward_round_id = ward_rounds.id
                     ),
                     '[]'::jsonb
                   ) AS artifacts,
                   ward_rounds.created_at,
                   ward_rounds.updated_at,
                   ward_rounds.signed_at
            FROM ward_rounds
            LEFT JOIN ward_round_actions
              ON ward_round_actions.ward_round_id = ward_rounds.id
            "#;

const WARD_ROUND_DETAIL_GROUP_BY: &str = r#"
            GROUP BY ward_rounds.id,
                     ward_rounds.patient_id,
                     ward_rounds.admission_case_id,
                     ward_rounds.status,
                     ward_rounds.version,
                     ward_rounds.note_sections,
                     ward_rounds.review_rail,
                     ward_rounds.rendered_note,
                     ward_rounds.created_at,
                     ward_rounds.updated_at,
                     ward_rounds.signed_at
            "#;

fn detail_from_row(row: WardRoundDetailRow) -> anyhow::Result<WardRoundDetail> {
    Ok(WardRoundDetail {
        id: row.id,
        patient_id: row.patient_id,
        admission_case_id: row.admission_case_id,
        status: codec::decode(&row.status)?,
        version: row.version,
        note_sections: row.note_sections.0,
        review_rail: row.review_rail.0,
        rendered_note: row.rendered_note,
        action_counts: row.action_counts.0,
        permissions: hms_domain::ward_rounds::WardRoundPermissions {
            can_view: true,
            can_edit_draft: false,
            can_commit: false,
            can_add_prescription: false,
            can_order_labs: false,
            can_create_nursing_task: false,
            can_request_discharge: false,
            read_only: true,
        },
        actions: row.actions.0,
        artifacts: row.artifacts.0,
        created_at: row.created_at,
        updated_at: row.updated_at,
        signed_at: row.signed_at,
    })
}
