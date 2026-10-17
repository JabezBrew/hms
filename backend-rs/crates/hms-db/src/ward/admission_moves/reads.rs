use super::super::task_routing::{self, OpenTaskRoute};
use super::*;
use sqlx::types::Json;

pub(super) fn membership(
    actor: &AdmissionMoveActor,
    r: &Root,
    rows: &[OpenTaskRoute],
) -> anyhow::Result<String> {
    if rows
        .iter()
        .any(|v| v.patient_id != r.patient_id || v.service_ward_id != r.ward_id)
    {
        return Err(MoveError::SourceChanged.into());
    }
    token(&serde_json::json!([
        actor.facility_id,
        r.id,
        r.patient_id,
        r.placement_revision,
        rows
    ]))
}
pub(super) async fn begin(
    pool: &PgPool,
    actor: &mut AdmissionMoveActor,
    patient: Uuid,
    case: Uuid,
) -> anyhow::Result<(Tx<'static>, access::Scope, Root)> {
    if patient.is_nil() || case.is_nil() {
        return Err(MoveError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    let scope = access::authority(&mut tx, actor).await?;
    access::patient(&mut tx, actor, patient).await?;
    let r = root(&mut tx, actor, patient, case, Some(false)).await?;
    access::ward(&scope, r.ward_id)?;
    Ok((tx, scope, r))
}
pub async fn context(
    pool: &PgPool,
    mut actor: AdmissionMoveActor,
    patient: Uuid,
    case: Uuid,
) -> anyhow::Result<AdmissionPlacementContext> {
    let (mut tx, scope, r) = begin(pool, &mut actor, patient, case).await?;
    let(count,assigned):(i64,i64)=observe_db_query("ward.moves.tasks.count",sqlx::query_as("SELECT count(*),count(assigned_to_user_id) FROM nursing_tasks WHERE facility_id=$1 AND admission_case_id=$2 AND status='open'").bind(actor.facility_id).bind(case).fetch_one(&mut *tx)).await?;
    access::task_scope(&mut tx, &actor, &r).await?;
    let task_token = if count <= 500 {
        let rows = task_routing::read_open_routes_tx(&mut tx, actor.facility_id, case)
            .await
            .map_err(route_error)?;
        if rows.len() as i64 != count {
            return Err(MoveError::TasksChanged.into());
        }
        Some(membership(&actor, &r, &rows)?)
    } else {
        None
    };
    let current = placement::current(&mut tx, &actor, &r).await?;
    let reason = if !r.active() {
        Some(AdmissionMoveUnavailableReason::SourceInactive)
    } else if !r.consistent()
        || current
            .as_ref()
            .is_none_or(|p| p.placement_revision != r.placement_revision)
    {
        Some(AdmissionMoveUnavailableReason::SourceInconsistent)
    } else if count > 500 {
        Some(AdmissionMoveUnavailableReason::TooManyOpenTasks)
    } else if count > 0 && !scope.can_route_tasks {
        Some(AdmissionMoveUnavailableReason::NursingAuthorityRequired)
    } else {
        None
    };
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(AdmissionPlacementContext {
        patient_id: patient,
        admission_case_id: case,
        encounter_id: r.encounter_id,
        visit_id: r.visit_id,
        admitted_at: if r.active() || r.status == "discharged" {
            r.admitted_at
        } else {
            None
        },
        status: codec::decode(&r.status)?,
        placement_revision: r.placement_revision,
        placement_token: r.source_token()?,
        ward_id: r.ward_id,
        ward_name: r.ward_name,
        bed_id: r.bed_id,
        bed_code: r.bed_code,
        current_placement: current,
        placement_history_partial: r.placement_history_partial,
        placement_known_from: r.placement_known_from,
        open_task_count: count,
        assigned_open_task_count: assigned,
        max_open_tasks: 500,
        task_membership_token: task_token,
        source_cleaning_minutes: r.cleaning_minutes,
        can_move: reason.is_none(),
        unavailable_reason: reason,
    })
}
pub async fn destinations(
    pool: &PgPool,
    mut actor: AdmissionMoveActor,
    patient: Uuid,
    case: Uuid,
    ward: Option<Uuid>,
    search: Option<String>,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> anyhow::Result<Vec<(AdmissionMoveDestination, DateTime<Utc>)>> {
    if !(1..=101).contains(&limit)
        || search.as_ref().is_some_and(|s| s.chars().count() > 80)
        || ward.is_some_and(|id| id.is_nil())
    {
        return Err(MoveError::InvalidInput.into());
    }
    let (mut tx, scope, r) = begin(pool, &mut actor, patient, case).await?;
    if let Some(id) = ward {
        access::ward(&scope, id)?;
    }
    let mut q = sqlx::QueryBuilder::new(placement::CANDIDATE_SELECT);
    q.push_bind(actor.facility_id).push(" AND b.status='available' AND w.status='active' AND (b.section_id IS NULL OR s.status='active') AND NOT EXISTS(SELECT 1 FROM admission_cases a WHERE a.facility_id=b.facility_id AND a.bed_id=b.id AND a.status IN('ready_for_activation','admitted','discharge_pending'))");
    if let Some(ids) = &scope.wards {
        q.push(" AND b.ward_id=ANY(").push_bind(ids).push(")");
    }
    if let Some(id) = ward {
        q.push(" AND b.ward_id=").push_bind(id);
    }
    if let Some(s) = search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let escaped = s
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        q.push(" AND (b.bed_code||' '||w.name||' '||COALESCE(s.name,'')) ILIKE ")
            .push_bind(format!("%{escaped}%"))
            .push(" ESCAPE '\\'");
    }
    if let Some((at, id)) = cursor {
        q.push(" AND (b.created_at,b.id)>(")
            .push_bind(at)
            .push(",")
            .push_bind(id)
            .push(")");
    }
    q.push(" ORDER BY b.created_at,b.id LIMIT ")
        .push_bind(limit);
    let rows = observe_db_query(
        "ward.moves.destination.list",
        q.build_query_as::<placement::Candidate>()
            .fetch_all(&mut *tx),
    )
    .await?;
    let result = rows
        .into_iter()
        .map(|v| {
            Ok((
                AdmissionMoveDestination {
                    labels: v.labels(),
                    candidate_token: v.token(&actor, &r)?,
                },
                v.created_at,
            ))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
#[derive(FromRow)]
struct HistoryRow {
    id: Uuid,
    patient_id: Uuid,
    admission_case_id: Uuid,
    placement_revision: i64,
    moved_at: DateTime<Utc>,
    actor_user_id: Uuid,
    actor_display_name: String,
    source: Json<AdmissionPlacementLabels>,
    destination: Json<AdmissionPlacementLabels>,
    routed_task_count: i32,
    cleared_assignee_count: i32,
}
impl HistoryRow {
    fn project(self) -> AdmissionMoveHistoryItem {
        AdmissionMoveHistoryItem {
            id: self.id,
            patient_id: self.patient_id,
            admission_case_id: self.admission_case_id,
            placement_revision: self.placement_revision,
            moved_at: self.moved_at,
            recorded_by_user_id: self.actor_user_id,
            recorded_by_display_name: self.actor_display_name,
            source: self.source.0,
            destination: self.destination.0,
            routed_task_count: self.routed_task_count.into(),
            cleared_assignee_count: self.cleared_assignee_count.into(),
        }
    }
}
pub async fn history(
    pool: &PgPool,
    mut actor: AdmissionMoveActor,
    patient: Uuid,
    case: Uuid,
    before: Option<i64>,
    limit: i64,
) -> anyhow::Result<Vec<AdmissionMoveHistoryItem>> {
    if !(1..=101).contains(&limit) || before.is_some_and(|v| v <= 0) {
        return Err(MoveError::InvalidInput.into());
    }
    let (mut tx, _, _) = begin(pool, &mut actor, patient, case).await?;
    let rows:Vec<HistoryRow>=observe_db_query("ward.moves.history",sqlx::query_as("SELECT id,patient_id,admission_case_id,placement_revision,moved_at,actor_user_id,actor_display_name,detail->'source' AS source,detail->'destination' AS destination,routed_task_count,cleared_assignee_count FROM admission_moves WHERE facility_id=$1 AND admission_case_id=$2 AND patient_id=$3 AND ($4::bigint IS NULL OR placement_revision<$4) ORDER BY placement_revision DESC LIMIT $5").bind(actor.facility_id).bind(case).bind(patient).bind(before).bind(limit).fetch_all(&mut *tx)).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(rows.into_iter().map(HistoryRow::project).collect())
}
pub(super) async fn exact_tx(
    tx: &mut Tx<'_>,
    actor: &AdmissionMoveActor,
    patient: Uuid,
    case: Uuid,
    id: Uuid,
) -> anyhow::Result<AdmissionMoveDetail> {
    let row:Option<(Json<AdmissionMoveDetail>,)>=observe_db_query("ward.moves.exact",sqlx::query_as("SELECT detail FROM admission_moves WHERE facility_id=$1 AND admission_case_id=$2 AND patient_id=$3 AND id=$4").bind(actor.facility_id).bind(case).bind(patient).bind(id).fetch_optional(&mut **tx)).await?;
    let value = row.ok_or(MoveError::NotFound)?.0 .0;
    if value.history.id != id
        || value.history.patient_id != patient
        || value.history.admission_case_id != case
    {
        return Err(MoveError::NotFound.into());
    }
    Ok(value)
}
pub async fn detail(
    pool: &PgPool,
    mut actor: AdmissionMoveActor,
    patient: Uuid,
    case: Uuid,
    id: Uuid,
) -> anyhow::Result<AdmissionMoveDetail> {
    let (mut tx, _, _) = begin(pool, &mut actor, patient, case).await?;
    let result = exact_tx(&mut tx, &actor, patient, case, id).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
#[derive(FromRow)]
pub(super) struct Saved {
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub actor_user_id: Uuid,
    pub payload_digest: Vec<u8>,
    pub result_id: Option<Uuid>,
    pub recorded_at: DateTime<Utc>,
    pub receipt: Option<Json<AdmissionMoveReceipt>>,
}
pub(super) async fn saved(
    tx: &mut Tx<'_>,
    actor: &AdmissionMoveActor,
    key: Uuid,
) -> anyhow::Result<Option<Saved>> {
    observe_db_query("ward.moves.receipt",sqlx::query_as("SELECT patient_id,admission_case_id,actor_user_id,payload_digest,result_id,recorded_at,receipt FROM admission_move_commands WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(hash(key.as_bytes())).fetch_optional(&mut **tx)).await.map_err(Into::into)
}
pub(super) async fn checked(
    tx: &mut Tx<'_>,
    actor: &AdmissionMoveActor,
    patient: Uuid,
    case: Uuid,
    key: Uuid,
    saved: Saved,
) -> anyhow::Result<AdmissionMoveReceipt> {
    if saved.patient_id != patient
        || saved.admission_case_id != case
        || saved.actor_user_id != actor.user_id
    {
        return Err(MoveError::NotFound.into());
    }
    let mut result = saved.receipt.ok_or(MoveError::RequestConflict)?.0;
    if result.client_request_id != key
        || result.reviewed_input.client_request_id != key
        || result.replayed
        || result.recorded_at != saved.recorded_at
        || saved.result_id != Some(result.movement.history.id)
        || result.movement.history.recorded_by_user_id != actor.user_id
        || hash(serde_json::to_vec(&result.reviewed_input)?) != saved.payload_digest
    {
        return Err(MoveError::RequestConflict.into());
    }
    let immutable = exact_tx(tx, actor, patient, case, result.movement.history.id).await?;
    if result.movement != immutable || result.recorded_at != immutable.history.moved_at {
        return Err(MoveError::RequestConflict.into());
    }
    result.replayed = true;
    Ok(result)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: AdmissionMoveActor,
    patient: Uuid,
    case: Uuid,
    key: Uuid,
) -> anyhow::Result<AdmissionMoveReceipt> {
    if key.is_nil() {
        return Err(MoveError::InvalidInput.into());
    }
    let (mut tx, _, _) = begin(pool, &mut actor, patient, case).await?;
    let saved = saved(&mut tx, &actor, key)
        .await?
        .ok_or(MoveError::NotFound)?;
    let result = checked(&mut tx, &actor, patient, case, key, saved).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
