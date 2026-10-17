//! Exact care-context gates and first-terminal encounter evidence.
//! Generic care keeps its demographic workflow purpose; consultation's richer
//! relationship and data-class proof belongs to its separate caller.
use super::*;
use crate::clinical::{medication_access, prescription_courses};
use hms_domain::deployment::{FeatureKey, PermissionCode};
use hms_observability::observe_db_query;
use sqlx::Transaction;

type Tx<'a> = Transaction<'a, Postgres>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CareLifecycleError {
    NotFound,
    Unavailable,
    ContextChanged,
    IdentityBound,
    WorkflowRequired,
    TerminalConflict,
    VisitUnavailable,
    Busy,
}
impl std::fmt::Display for CareLifecycleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::NotFound => "care_context_not_found",
            Self::Unavailable => "care_authorization_expired",
            Self::ContextChanged => "care_context_changed",
            Self::IdentityBound => "encounter_identity_bound",
            Self::WorkflowRequired => "encounter_admission_workflow_required",
            Self::TerminalConflict => "encounter_terminal_conflict",
            Self::VisitUnavailable => "visit_not_available_for_consultation",
            Self::Busy => "care_context_busy",
        })
    }
}
impl std::error::Error for CareLifecycleError {}

#[derive(Clone)]
pub struct CareActor {
    pub identity: prescription_courses::PrescriptionActor,
    pub permission: PermissionCode,
    pub feature: FeatureKey,
}

pub(crate) fn purpose(
    actor: &CareActor,
    permission: PermissionCode,
    feature: FeatureKey,
) -> anyhow::Result<()> {
    if actor.permission != permission || actor.feature != feature {
        return Err(CareLifecycleError::Unavailable.into());
    }
    Ok(())
}

pub(crate) async fn authority_tx(tx: &mut Tx<'_>, actor: &mut CareActor) -> anyhow::Result<()> {
    if actor.identity.authorization.is_none() {
        return Err(CareLifecycleError::Unavailable.into());
    }
    prescription_courses::verify_actor(tx, &mut actor.identity)
        .await
        .map_err(authority_error)?;
    let proof = actor
        .identity
        .authorization
        .as_mut()
        .ok_or(CareLifecycleError::Unavailable)?;
    medication_access::require_current_features_tx(
        tx,
        actor.identity.facility_id,
        proof.active_profile,
        &[actor.feature],
    )
    .await
    .map_err(authority_error)?;
    let required = [actor.permission, PermissionCode::PatientDemographicsView]
        .into_iter()
        .map(codec::encode)
        .collect::<anyhow::Result<Vec<_>>>()?;
    let feature = codec::encode(actor.feature)?;
    let (allowed, boundary): (bool, Option<DateTime<Utc>>) = observe_db_query(
        "care.lifecycle.authority",
        sqlx::query_as(r#"
        WITH point AS MATERIALIZED (SELECT clock_timestamp() AS at), effective AS (
          SELECT permission_code FROM user_permissions WHERE user_id=$2
          UNION SELECT p.permission_code FROM permission_assignments p CROSS JOIN point n
            WHERE p.facility_id=$1 AND p.grantee_user_id=$2 AND p.scope_type='facility'
              AND p.scope_id IS NULL AND p.status='active' AND p.starts_at<=n.at
              AND (p.ends_at IS NULL OR p.ends_at>n.at)
          UNION SELECT d.permission_code FROM delegations d CROSS JOIN point n
            WHERE d.facility_id=$1 AND d.delegate_user_id=$2 AND d.status='active'
              AND d.starts_at<=n.at AND (d.ends_at IS NULL OR d.ends_at>n.at)
        )
        SELECT NOT EXISTS (SELECT 1 FROM unnest($3::text[]) r(code)
          WHERE NOT EXISTS (SELECT 1 FROM effective e WHERE e.permission_code=r.code))
          AND EXISTS (SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='demographics')
          AND EXISTS (SELECT 1 FROM user_features WHERE user_id=$2 AND feature_key=$4),
          (SELECT min(boundary) FROM user_authority_boundaries b
            CROSS JOIN LATERAL (VALUES(b.starts_at),(b.ends_at)) boundaries(boundary)
            CROSS JOIN point n WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
        "#).bind(actor.identity.facility_id).bind(actor.identity.user_id)
            .bind(required).bind(feature).fetch_one(&mut **tx),
    ).await?;
    if !allowed {
        return Err(CareLifecycleError::Unavailable.into());
    }
    if let Some(boundary) = boundary {
        proof.valid_until = proof.valid_until.min(boundary);
    }
    deadline_tx(tx, actor).await
}

fn authority_error(error: anyhow::Error) -> anyhow::Error {
    if error.is::<prescription_courses::PrescriptionCourseError>()
        || error.is::<medication_access::MedicationAccessError>()
    {
        CareLifecycleError::Unavailable.into()
    } else {
        error
    }
}

pub(crate) async fn deadline_tx(tx: &mut Tx<'_>, actor: &CareActor) -> anyhow::Result<()> {
    prescription_courses::check_authorization(tx, &actor.identity)
        .await
        .map_err(authority_error)
}

pub(crate) async fn local_patient_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    patient: Uuid,
) -> anyhow::Result<()> {
    let found: Option<Uuid> = observe_db_query(
        "care.lifecycle.patient",
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE")
            .bind(facility)
            .bind(patient)
            .fetch_optional(&mut **tx),
    )
    .await?;
    found.ok_or(CareLifecycleError::NotFound)?;
    Ok(())
}

#[derive(Clone, Debug)]
pub struct VisitContext {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub appointment_id: Option<Uuid>,
    pub clinic_id: Option<Uuid>,
    pub status: VisitStatus,
    pub checked_in_at: DateTime<Utc>,
    pub consultation_started_at: Option<DateTime<Utc>>,
}
#[derive(FromRow)]
struct VisitContextRow {
    id: Uuid,
    patient_id: Uuid,
    appointment_id: Option<Uuid>,
    clinic_id: Option<Uuid>,
    status: String,
    checked_in_at: DateTime<Utc>,
    consultation_started_at: Option<DateTime<Utc>>,
}

fn lock_error(error: sqlx::Error) -> anyhow::Error {
    if error
        .as_database_error()
        .and_then(|e| e.code())
        .is_some_and(|c| c == "55P03")
    {
        CareLifecycleError::Busy.into()
    } else {
        error.into()
    }
}

pub async fn lock_visit_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    patient: Uuid,
    visit: Uuid,
    nowait: bool,
) -> anyhow::Result<VisitContext> {
    let suffix = if nowait {
        " FOR UPDATE NOWAIT"
    } else {
        " FOR UPDATE"
    };
    let row: VisitContextRow = observe_db_query("care.lifecycle.visit_gate", sqlx::query_as(&format!(
        "SELECT id,patient_id,appointment_id,clinic_id,status,checked_in_at,consultation_started_at FROM visits WHERE facility_id=$1 AND patient_id=$2 AND id=$3{suffix}",
    )).bind(facility).bind(patient).bind(visit).fetch_optional(&mut **tx)).await.map_err(lock_error)?.ok_or(CareLifecycleError::NotFound)?;
    Ok(VisitContext {
        id: row.id,
        patient_id: row.patient_id,
        appointment_id: row.appointment_id,
        clinic_id: row.clinic_id,
        status: codec::decode(&row.status)?,
        checked_in_at: row.checked_in_at,
        consultation_started_at: row.consultation_started_at,
    })
}

/// The caller already holds the exact visit gate and its own retained authority.
/// No appointment, intake, checkout or patient-record transition is implied.
pub async fn promote_visit_to_consultation_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    patient: Uuid,
    visit: Uuid,
    expected: VisitStatus,
    now: DateTime<Utc>,
) -> anyhow::Result<()> {
    if !matches!(
        expected,
        VisitStatus::Waiting
            | VisitStatus::Called
            | VisitStatus::InTriage
            | VisitStatus::Triaged
            | VisitStatus::InConsultation
            | VisitStatus::OnHold
    ) {
        return Err(CareLifecycleError::VisitUnavailable.into());
    }
    let changed = observe_db_query("care.lifecycle.visit_start", sqlx::query(
        "UPDATE visits SET status='in_consultation',consultation_started_at=COALESCE(consultation_started_at,$5),updated_at=$5 WHERE facility_id=$1 AND patient_id=$2 AND id=$3 AND status=$4",
    ).bind(facility).bind(patient).bind(visit).bind(codec::encode(expected)?).bind(now).execute(&mut **tx)).await?.rows_affected();
    if changed != 1 {
        return Err(CareLifecycleError::VisitUnavailable.into());
    }
    Ok(())
}

#[derive(Clone, Debug, FromRow)]
pub struct EncounterContext {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub encounter_type: String,
    pub status: String,
}

async fn encounter_source_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<EncounterContext> {
    observe_db_query("care.lifecycle.encounter_source", sqlx::query_as(
        "SELECT id,patient_id,visit_id,encounter_type,status FROM encounters WHERE facility_id=$1 AND id=$2",
    ).bind(facility).bind(id).fetch_optional(&mut **tx)).await?.ok_or_else(|| CareLifecycleError::NotFound.into())
}

/// Lock source and proposed visits in deterministic order before the encounter.
/// A concurrent publisher can change the preloaded tuple before a wait: reread it
/// after the gate and refuse that changed source without taking reverse locks.
pub async fn lock_encounter_context_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    patient: Uuid,
    id: Uuid,
    proposed_visit: Option<Uuid>,
    nowait: bool,
) -> anyhow::Result<EncounterContext> {
    let before = encounter_source_tx(tx, facility, id).await?;
    if before.patient_id != patient {
        return Err(CareLifecycleError::ContextChanged.into());
    }
    let mut visits: Vec<_> = before.visit_id.into_iter().chain(proposed_visit).collect();
    visits.sort_unstable();
    visits.dedup();
    for visit in visits {
        lock_visit_tx(tx, facility, patient, visit, nowait).await?;
    }
    let suffix = if nowait {
        " FOR UPDATE NOWAIT"
    } else {
        " FOR UPDATE"
    };
    let current: EncounterContext = observe_db_query("care.lifecycle.encounter_gate", sqlx::query_as(&format!(
        "SELECT id,patient_id,visit_id,encounter_type,status FROM encounters WHERE facility_id=$1 AND id=$2 AND patient_id=$3{suffix}",
    )).bind(facility).bind(id).bind(patient).fetch_optional(&mut **tx)).await.map_err(lock_error)?.ok_or(CareLifecycleError::NotFound)?;
    if current.visit_id != before.visit_id {
        return Err(CareLifecycleError::ContextChanged.into());
    }
    Ok(current)
}

pub async fn lock_admission_context_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    patient: Uuid,
    encounter: Option<Uuid>,
    visit: Option<Uuid>,
) -> anyhow::Result<(Option<Uuid>, Option<Uuid>)> {
    if let Some(encounter) = encounter {
        let current =
            lock_encounter_context_tx(tx, facility, patient, encounter, visit, false).await?;
        if visit.is_some() && visit != current.visit_id {
            return Err(CareLifecycleError::ContextChanged.into());
        }
        // This is the fresh gated tuple, not an earlier service projection.
        Ok((Some(current.id), current.visit_id))
    } else {
        if let Some(visit) = visit {
            lock_visit_tx(tx, facility, patient, visit, false).await?;
        }
        Ok((None, visit))
    }
}

async fn encounter_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<EncounterListItem> {
    let row = observe_db_query("care.lifecycle.encounter_result", sqlx::query_as::<_, EncounterRow>(
        "SELECT e.id,e.patient_id,p.patient_code,p.first_name || ' ' || p.last_name AS patient_display_name,e.visit_id,e.encounter_type,e.status,e.started_at,e.ended_at FROM encounters e JOIN patients p ON p.facility_id=e.facility_id AND p.id=e.patient_id WHERE e.facility_id=$1 AND e.id=$2",
    ).bind(facility).bind(id).fetch_one(&mut **tx)).await?;
    encounter_from_row(row)
}

async fn binding_tx(tx: &mut Tx<'_>, facility: Uuid, id: Uuid) -> anyhow::Result<bool> {
    Ok(observe_db_query("care.lifecycle.encounter_binding", sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM admission_cases WHERE facility_id=$1 AND encounter_id=$2) OR EXISTS(SELECT 1 FROM referral_consultation_starts WHERE facility_id=$1 AND encounter_id=$2)",
    ).bind(facility).bind(id).fetch_one(&mut **tx)).await?)
}

pub(crate) async fn update_encounter(
    pool: &PgPool,
    mut actor: Option<CareActor>,
    input: EncounterUpdate,
) -> anyhow::Result<Option<EncounterListItem>> {
    let mut tx = pool.begin().await?;
    if let Some(actor) = actor.as_mut() {
        authority_tx(&mut tx, actor).await?;
    }
    let before = match encounter_source_tx(&mut tx, input.facility_id, input.id).await {
        Ok(row) => row,
        Err(error)
            if error.downcast_ref::<CareLifecycleError>()
                == Some(&CareLifecycleError::NotFound) =>
        {
            return Ok(None)
        }
        Err(error) => return Err(error),
    };
    local_patient_tx(&mut tx, input.facility_id, before.patient_id).await?;
    let current = lock_encounter_context_tx(
        &mut tx,
        input.facility_id,
        before.patient_id,
        input.id,
        input.visit_id,
        false,
    )
    .await?;
    if let Some(actor) = actor.as_ref() {
        deadline_tx(&mut tx, actor).await?;
    }
    let visit = input.visit_id.or(current.visit_id);
    let kind = input
        .encounter_type
        .map(codec::encode)
        .transpose()?
        .unwrap_or(current.encounter_type.clone());
    let changed = current.visit_id != visit || current.encounter_type != kind;
    if changed && binding_tx(&mut tx, input.facility_id, input.id).await? {
        return Err(CareLifecycleError::IdentityBound.into());
    }
    if changed && current.status != "in_progress" {
        return Err(CareLifecycleError::TerminalConflict.into());
    }
    if changed {
        observe_db_query("care.lifecycle.encounter_update", sqlx::query(
            "UPDATE encounters SET visit_id=$3,encounter_type=$4,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2",
        ).bind(input.facility_id).bind(input.id).bind(visit).bind(kind).execute(&mut *tx)).await?;
    }
    let result = encounter_tx(&mut tx, input.facility_id, input.id).await?;
    if let Some(actor) = actor.as_ref() {
        deadline_tx(&mut tx, actor).await?;
    }
    tx.commit().await?;
    Ok(Some(result))
}

pub(crate) async fn terminal_encounter(
    pool: &PgPool,
    mut actor: Option<CareActor>,
    facility: Uuid,
    id: Uuid,
    status: EncounterStatus,
) -> anyhow::Result<Option<EncounterListItem>> {
    if status == EncounterStatus::InProgress {
        return Err(CareLifecycleError::TerminalConflict.into());
    }
    let mut tx = pool.begin().await?;
    if let Some(actor) = actor.as_mut() {
        authority_tx(&mut tx, actor).await?;
    }
    let before = match encounter_source_tx(&mut tx, facility, id).await {
        Ok(row) => row,
        Err(error)
            if error.downcast_ref::<CareLifecycleError>()
                == Some(&CareLifecycleError::NotFound) =>
        {
            return Ok(None)
        }
        Err(error) => return Err(error),
    };
    local_patient_tx(&mut tx, facility, before.patient_id).await?;
    let current =
        lock_encounter_context_tx(&mut tx, facility, before.patient_id, id, None, false).await?;
    if let Some(actor) = actor.as_ref() {
        deadline_tx(&mut tx, actor).await?;
    }
    let requested = codec::encode(status)?;
    // Historical `finished` is an existing Completed spelling. Its exact
    // stored outcome and timestamp survive replay; do not normalize evidence
    // by writing a different status string.
    let current_status: EncounterStatus = codec::decode(&current.status)?;
    if current_status != EncounterStatus::InProgress && current_status != status {
        return Err(CareLifecycleError::TerminalConflict.into());
    }
    if current_status == EncounterStatus::InProgress {
        let active: bool = observe_db_query("care.lifecycle.active_admission", sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM admission_cases WHERE facility_id=$1 AND encounter_id=$2 AND status IN('ready_for_activation','admitted','discharge_pending'))",
        ).bind(facility).bind(id).fetch_one(&mut *tx)).await?;
        if active {
            return Err(CareLifecycleError::WorkflowRequired.into());
        }
        observe_db_query("care.lifecycle.encounter_terminal", sqlx::query(
            "UPDATE encounters SET status=$3,ended_at=COALESCE(ended_at,clock_timestamp()),updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2 AND status='in_progress'",
        ).bind(facility).bind(id).bind(requested).execute(&mut *tx)).await?;
    }
    let result = encounter_tx(&mut tx, facility, id).await?;
    if let Some(actor) = actor.as_ref() {
        deadline_tx(&mut tx, actor).await?;
    }
    tx.commit().await?;
    Ok(Some(result))
}

pub async fn update_encounter_authorized(
    pool: &PgPool,
    actor: CareActor,
    input: EncounterUpdate,
) -> anyhow::Result<Option<EncounterListItem>> {
    purpose(
        &actor,
        PermissionCode::EncounterManage,
        FeatureKey::Encounters,
    )?;
    if actor.identity.facility_id != input.facility_id
        || actor.identity.user_id != input.actor_user_id
    {
        return Err(CareLifecycleError::Unavailable.into());
    }
    update_encounter(pool, Some(actor), input).await
}

pub async fn terminal_encounter_authorized(
    pool: &PgPool,
    actor: CareActor,
    id: Uuid,
    status: EncounterStatus,
) -> anyhow::Result<Option<EncounterListItem>> {
    purpose(
        &actor,
        PermissionCode::EncounterManage,
        FeatureKey::Encounters,
    )?;
    let facility = actor.identity.facility_id;
    terminal_encounter(pool, Some(actor), facility, id, status).await
}

pub(crate) async fn create_encounter(
    pool: &PgPool,
    mut actor: Option<CareActor>,
    input: NewEncounter,
) -> anyhow::Result<EncounterListItem> {
    let mut tx = pool.begin().await?;
    if let Some(actor) = actor.as_mut() {
        authority_tx(&mut tx, actor).await?;
    }
    local_patient_tx(&mut tx, input.facility_id, input.patient_id).await?;
    let visit = if let Some(id) = input.visit_id {
        Some(lock_visit_tx(&mut tx, input.facility_id, input.patient_id, id, false).await?)
    } else {
        None
    };
    if let Some(actor) = actor.as_ref() {
        deadline_tx(&mut tx, actor).await?;
    }
    // This generic command has no intake or appointment-creation side effect.
    // Its exact supplied visit is the only queue row it can advance.
    if let Some(visit) = visit.as_ref() {
        if !matches!(
            visit.status,
            VisitStatus::Waiting
                | VisitStatus::Called
                | VisitStatus::InTriage
                | VisitStatus::Triaged
                | VisitStatus::InConsultation
                | VisitStatus::OnHold
        ) {
            return Err(CareLifecycleError::VisitUnavailable.into());
        }
    }
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await?;
    observe_db_query("care.lifecycle.encounter_create", sqlx::query(
        "INSERT INTO encounters(id,facility_id,patient_id,visit_id,encounter_type,status,created_by_user_id,started_at) VALUES($1,$2,$3,$4,$5,'in_progress',$6,$7)",
    ).bind(input.id).bind(input.facility_id).bind(input.patient_id).bind(input.visit_id)
        .bind(codec::encode(input.encounter_type)?).bind(input.created_by_user_id).bind(now)
        .execute(&mut *tx)).await?;
    if let Some(visit) = visit {
        promote_visit_to_consultation_tx(
            &mut tx,
            input.facility_id,
            input.patient_id,
            visit.id,
            visit.status,
            now,
        )
        .await?;
    }
    let result = encounter_tx(&mut tx, input.facility_id, input.id).await?;
    if let Some(actor) = actor.as_ref() {
        deadline_tx(&mut tx, actor).await?;
    }
    tx.commit().await?;
    Ok(result)
}

pub async fn create_encounter_authorized(
    pool: &PgPool,
    actor: CareActor,
    input: NewEncounter,
) -> anyhow::Result<EncounterListItem> {
    purpose(
        &actor,
        PermissionCode::EncounterManage,
        FeatureKey::Encounters,
    )?;
    if actor.identity.facility_id != input.facility_id
        || actor.identity.user_id != input.created_by_user_id
    {
        return Err(CareLifecycleError::Unavailable.into());
    }
    create_encounter(pool, Some(actor), input).await
}

pub async fn update_visit_status_authorized(
    pool: &PgPool,
    mut actor: CareActor,
    patient: Uuid,
    id: Uuid,
    status: VisitStatus,
) -> anyhow::Result<Option<VisitListItem>> {
    match status {
        VisitStatus::Called | VisitStatus::CheckedOut | VisitStatus::NoShow => purpose(
            &actor,
            PermissionCode::AppointmentManage,
            FeatureKey::Appointments,
        )?,
        VisitStatus::InConsultation | VisitStatus::OnHold | VisitStatus::ReadyCheckout => purpose(
            &actor,
            PermissionCode::EncounterManage,
            FeatureKey::Encounters,
        )?,
        _ => return Err(CareLifecycleError::Unavailable.into()),
    }
    let mut tx = pool.begin().await?;
    authority_tx(&mut tx, &mut actor).await?;
    let facility = actor.identity.facility_id;
    local_patient_tx(&mut tx, facility, patient).await?;
    let visit = lock_visit_tx(&mut tx, facility, patient, id, false).await?;
    deadline_tx(&mut tx, &actor).await?;
    if status == VisitStatus::InConsultation {
        let now = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(&mut *tx)
            .await?;
        promote_visit_to_consultation_tx(&mut tx, facility, patient, id, visit.status, now).await?;
    } else {
        super::update_visit_status_tx(&mut tx, facility, id, status).await?;
    }
    let result = super::visit_by_id_tx(&mut tx, facility, id).await?;
    deadline_tx(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
