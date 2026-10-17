//! Production Ward Round commands. Trusted legacy repository helpers are not HTTP write interfaces.
mod access;
mod artifacts;
mod validate;
use super::*;
use crate::clinical::prescription_courses::PrescriptionAuthorization;
use hms_domain::ward_rounds::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
type Tx<'a> = Transaction<'a, Postgres>;

#[derive(Clone)]
pub struct WardRoundActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: Option<String>,
    pub authorization: PrescriptionAuthorization,
    pub can_write: bool,
    pub can_prescribe: bool,
    pub can_order_labs: bool,
    pub can_create_nursing_task: bool,
    pub can_request_discharge: bool,
    pub can_view_all_wards: bool,
}
impl std::fmt::Debug for WardRoundActor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WardRoundActor").finish_non_exhaustive()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WardRoundError {
    NotFound,
    InvalidInput,
    PermissionDenied,
    PatientDenied,
    FeatureDisabled,
    AuthorityExpired,
    ContextChanged,
    SourceChanged,
    NotDraft,
    DraftExists,
    RequestConflict,
    CatalogChanged,
    PrescribingPanelRequired,
    PrescriptionClosed,
    DischargeReviewRequired,
    DraftReviewRequired,
}
impl std::fmt::Display for WardRoundError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}
impl std::error::Error for WardRoundError {}

#[derive(FromRow)]
struct GovernedAdmission {
    id: Uuid,
    patient_id: Uuid,
    ward_id: Uuid,
    status: String,
    encounter_id: Option<Uuid>,
    visit_id: Option<Uuid>,
    ward_status: String,
}
impl GovernedAdmission {
    fn active(&self) -> bool {
        matches!(self.status.as_str(), "admitted" | "discharge_pending")
            && self.ward_status == "active"
    }
    fn scope(&self) -> AdmissionScopeRow {
        AdmissionScopeRow {
            id: self.id,
            patient_id: self.patient_id,
            ward_id: self.ward_id,
            status: self.status.clone(),
        }
    }
}
async fn admission(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    patient: Uuid,
    id: Uuid,
    active: bool,
    exclusive: bool,
) -> anyhow::Result<GovernedAdmission> {
    let locks = if exclusive {
        "FOR UPDATE OF a FOR SHARE OF w"
    } else {
        "FOR SHARE OF a,w"
    };
    let row:Option<GovernedAdmission>=sqlx::query_as(&format!("SELECT a.id,a.patient_id,a.ward_id,a.status,a.encounter_id,a.visit_id,w.status AS ward_status FROM admission_cases a JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id WHERE a.facility_id=$1 AND a.patient_id=$2 AND a.id=$3 {locks}"))
        .bind(actor.facility_id).bind(patient).bind(id).fetch_optional(&mut **tx).await?;
    let row = row.ok_or(WardRoundError::ContextChanged)?;
    if active && !row.active() {
        return Err(WardRoundError::ContextChanged.into());
    }
    Ok(row)
}
async fn check_children(tx: &mut Tx<'_>, actor: &WardRoundActor, id: Uuid) -> anyhow::Result<()> {
    // Older imports/individual writers had no child count bound. Never aggregate
    // an arbitrarily large legacy snapshot or silently return a partial review.
    let invalid: bool = sqlx::query_scalar(
        r#"
        WITH parent AS(
            SELECT facility_id,patient_id,admission_case_id,status
            FROM ward_rounds WHERE facility_id=$1 AND id=$2
        ), actions AS(
            SELECT facility_id,patient_id,admission_case_id,status
            FROM ward_round_actions WHERE ward_round_id=$2 LIMIT 101
        ), links AS(
            SELECT facility_id,patient_id,admission_case_id
            FROM ward_round_artifact_links WHERE ward_round_id=$2 LIMIT 101
        )
        SELECT (SELECT count(*) FROM actions)>100
            OR (SELECT count(*) FROM links)>100
            OR EXISTS(SELECT 1 FROM actions c CROSS JOIN parent p
                WHERE (c.facility_id,c.patient_id,c.admission_case_id)
                    <>(p.facility_id,p.patient_id,p.admission_case_id)
                   OR (p.status='draft' AND c.status='committed'))
            OR EXISTS(SELECT 1 FROM links c CROSS JOIN parent p
                WHERE (c.facility_id,c.patient_id,c.admission_case_id)
                    <>(p.facility_id,p.patient_id,p.admission_case_id)
                   OR p.status='draft')
        "#,
    )
    .bind(actor.facility_id)
    .bind(id)
    .fetch_one(&mut **tx)
    .await?;
    if invalid {
        return Err(WardRoundError::DraftReviewRequired.into());
    }
    Ok(())
}
async fn detail_tx(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    patient: Uuid,
    id: Uuid,
) -> anyhow::Result<WardRoundDetail> {
    check_children(tx, actor, id).await?;
    let row=sqlx::query_as::<_,WardRoundDetailRow>(&format!("{WARD_ROUND_DETAIL_SELECT} WHERE ward_rounds.facility_id=$1 AND ward_rounds.patient_id=$2 AND ward_rounds.id=$3 {WARD_ROUND_DETAIL_GROUP_BY}"))
        .bind(actor.facility_id).bind(patient).bind(id).fetch_optional(&mut **tx).await?.ok_or(WardRoundError::NotFound)?;
    detail_from_row(row)
}
async fn lock_round(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    patient: Uuid,
    id: Uuid,
    write: bool,
) -> anyhow::Result<WardRoundScopeRow> {
    let sql = if write {
        "SELECT admission_case_id,status,version FROM ward_rounds WHERE facility_id=$1 AND patient_id=$2 AND id=$3 FOR UPDATE"
    } else {
        "SELECT admission_case_id,status,version FROM ward_rounds WHERE facility_id=$1 AND patient_id=$2 AND id=$3 FOR SHARE"
    };
    sqlx::query_as(sql)
        .bind(actor.facility_id)
        .bind(patient)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| WardRoundError::NotFound.into())
}
fn digest(value: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(value).to_vec()
}
async fn command_lock(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    key: Uuid,
) -> anyhow::Result<Vec<u8>> {
    if key.is_nil() {
        return Err(WardRoundError::InvalidInput.into());
    }
    let mut lock = actor.facility_id.as_bytes().to_vec();
    lock.extend(key.as_bytes());
    let lock = digest(lock);
    let number = i64::from_be_bytes(lock[..8].try_into().unwrap());
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(number)
        .execute(&mut **tx)
        .await?;
    Ok(digest(key.as_bytes()))
}
#[derive(FromRow)]
struct SavedCommand {
    actor_user_id: Uuid,
    patient_id: Uuid,
    ward_round_id: Uuid,
    command_type: String,
    payload_digest: Vec<u8>,
    receipt: Json<WardRoundCommandReceipt>,
}
async fn saved(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    hash: &[u8],
) -> anyhow::Result<Option<SavedCommand>> {
    sqlx::query_as("SELECT actor_user_id,patient_id,ward_round_id,command_type,payload_digest,receipt FROM ward_round_commands WHERE facility_id=$1 AND request_key_hash=$2")
        .bind(actor.facility_id).bind(hash).fetch_optional(&mut **tx).await.map_err(Into::into)
}
async fn replay(
    tx: &mut Tx<'_>,
    actor: &mut WardRoundActor,
    patient: Uuid,
    key: Uuid,
    kind: &str,
    input: &impl Serialize,
) -> anyhow::Result<Option<WardRoundCommandReceipt>> {
    let hash = command_lock(tx, actor, key).await?;
    if let Some(row) = saved(tx, actor, &hash).await? {
        if row.actor_user_id != actor.user_id
            || row.patient_id != patient
            || row.command_type != kind
            || row.payload_digest != digest(serde_json::to_vec(input)?)
        {
            return Err(WardRoundError::RequestConflict.into());
        }
        lock_round(tx, actor, patient, row.ward_round_id, false).await?;
        access::verify(tx, actor).await?;
        access::patient(tx, actor, patient).await?;
        let mut receipt = row.receipt.0;
        receipt.replayed = true;
        access::deadline(tx, actor).await?;
        return Ok(Some(receipt));
    }
    Ok(None)
}
async fn finish(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    patient: Uuid,
    input: &impl Serialize,
    result: &WardRoundCommandReceipt,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO ward_round_commands(facility_id,request_key_hash,actor_user_id,patient_id,ward_round_id,command_type,payload_digest,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(actor.facility_id).bind(digest(result.client_request_id.as_bytes())).bind(actor.user_id).bind(patient).bind(result.ward_round.id).bind(codec::encode(result.operation)?).bind(digest(serde_json::to_vec(input)?)).bind(Json(result)).execute(&mut **tx).await?;
    access::deadline(tx, actor).await
}
async fn refresh_rail(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    patient: Uuid,
    admission: Uuid,
    id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query("UPDATE ward_rounds SET review_rail=jsonb_build_object('active_medication_count',(SELECT count(*) FROM prescriptions WHERE facility_id=$1 AND patient_id=$2 AND status='active'),'open_lab_order_count',(SELECT count(*) FROM lab_orders WHERE facility_id=$1 AND patient_id=$2 AND status IN ('ordered','specimen_collected')),'open_nursing_task_count',(SELECT count(*) FROM nursing_tasks WHERE facility_id=$1 AND patient_id=$2 AND admission_case_id=$3 AND status='open'),'discharge_blocker_count',(SELECT count(*) FROM discharge_cases WHERE facility_id=$1 AND patient_id=$2 AND admission_case_id=$3 AND status='requested')) WHERE facility_id=$1 AND id=$4")
        .bind(actor.facility_id).bind(patient).bind(admission).bind(id).execute(&mut **tx).await?;
    Ok(())
}
async fn permissions(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    a: &GovernedAdmission,
    draft: bool,
) -> anyhow::Result<WardRoundPermissions> {
    let write = actor.can_write && a.active() && draft;
    let nursing = if write
        && actor.can_create_nursing_task
        && access::features(tx, actor, &[hms_domain::deployment::FeatureKey::Nursing])
            .await
            .is_ok()
    {
        if actor.can_view_all_wards {
            true
        } else {
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM ward_staff_assignments a JOIN practitioner_profiles pp ON pp.id=a.practitioner_profile_id AND pp.facility_id=a.facility_id JOIN staff_profiles s ON s.id=pp.staff_id AND s.facility_id=a.facility_id JOIN users u ON u.id=s.user_id AND u.facility_id=a.facility_id WHERE a.facility_id=$1 AND a.ward_id=$2 AND u.id=$3 AND a.is_active AND u.is_active)")
                .bind(actor.facility_id).bind(a.ward_id).bind(actor.user_id).fetch_one(&mut **tx).await?
        }
    } else {
        false
    };
    Ok(WardRoundPermissions {
        can_view: true,
        can_edit_draft: write,
        can_commit: write,
        can_add_prescription: write && actor.can_prescribe,
        can_order_labs: write
            && actor.can_order_labs
            && access::features(tx, actor, &[hms_domain::deployment::FeatureKey::Laboratory])
                .await
                .is_ok(),
        can_create_nursing_task: nursing,
        can_request_discharge: write
            && actor.can_request_discharge
            && access::features(tx, actor, &[hms_domain::deployment::FeatureKey::Admissions])
                .await
                .is_ok(),
        read_only: !write,
    })
}

pub async fn current(
    pool: &PgPool,
    mut actor: WardRoundActor,
    patient: Uuid,
    selected: Option<Uuid>,
) -> anyhow::Result<WardRoundWorkspace> {
    let mut tx = pool.begin().await?;
    // Resolve the opaque target first; the selected admission is validated again under lock below.
    let id = if let Some(id) = selected {
        id
    } else {
        sqlx::query_scalar("SELECT id FROM admission_cases WHERE facility_id=$1 AND patient_id=$2 AND status IN ('admitted','discharge_pending') ORDER BY admitted_at DESC,id DESC LIMIT 1")
            .bind(actor.facility_id).bind(patient).fetch_optional(&mut *tx).await?.ok_or(WardRoundError::NotFound)?
    };
    let round:Option<Uuid>=sqlx::query_scalar("SELECT id FROM ward_rounds WHERE facility_id=$1 AND patient_id=$2 AND admission_case_id=$3 AND status='draft' ORDER BY updated_at DESC,id DESC LIMIT 1")
        .bind(actor.facility_id).bind(patient).bind(id).fetch_optional(&mut *tx).await?;
    if let Some(id) = round {
        lock_round(&mut tx, &actor, patient, id, false).await?;
    }
    access::verify(&mut tx, &mut actor).await?;
    access::patient(&mut tx, &mut actor, patient).await?;
    let a = admission(&mut tx, &actor, patient, id, false, false).await?;
    // Re-read under the admission lock: a competing new draft cannot be mistaken for empty context.
    let row:Option<Uuid>=sqlx::query_scalar("SELECT id FROM ward_rounds WHERE facility_id=$1 AND patient_id=$2 AND admission_case_id=$3 AND status='draft' ORDER BY updated_at DESC,id DESC LIMIT 1")
        .bind(actor.facility_id).bind(patient).bind(id).fetch_optional(&mut *tx).await?;
    // If the first observed parent changed, fail closed rather than invert admission -> round lock order.
    if row != round {
        return Err(WardRoundError::SourceChanged.into());
    }
    let mut perms = permissions(&mut tx, &actor, &a, true).await?;
    let mut detail = if let Some(id) = row {
        Some(detail_tx(&mut tx, &actor, patient, id).await?)
    } else {
        None
    };
    if let Some(detail) = detail.as_mut() {
        detail.permissions = perms.clone();
    } else {
        perms.can_commit = false;
    }
    let result = WardRoundWorkspace {
        patient_id: patient,
        admission_case_id: id,
        admission_status: codec::decode(&a.status)?,
        ward_id: a.ward_id,
        permissions: perms,
        ward_round: detail,
    };
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn get(
    pool: &PgPool,
    mut actor: WardRoundActor,
    patient: Uuid,
    id: Uuid,
) -> anyhow::Result<WardRoundDetail> {
    let mut tx = pool.begin().await?;
    let row = lock_round(&mut tx, &actor, patient, id, false).await?;
    access::verify(&mut tx, &mut actor).await?;
    access::patient(&mut tx, &mut actor, patient).await?;
    let a = admission(
        &mut tx,
        &actor,
        patient,
        row.admission_case_id,
        false,
        false,
    )
    .await?;
    let mut result = detail_tx(&mut tx, &actor, patient, id).await?;
    result.permissions =
        permissions(&mut tx, &actor, &a, result.status == WardRoundStatus::Draft).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: WardRoundActor,
    patient: Uuid,
    key: Uuid,
) -> anyhow::Result<WardRoundCommandReceipt> {
    let mut tx = pool.begin().await?;
    let row = saved(&mut tx, &actor, &digest(key.as_bytes()))
        .await?
        .ok_or(WardRoundError::NotFound)?;
    if row.actor_user_id != actor.user_id || row.patient_id != patient {
        return Err(WardRoundError::NotFound.into());
    }
    lock_round(&mut tx, &actor, patient, row.ward_round_id, false).await?;
    access::verify(&mut tx, &mut actor).await?;
    access::patient(&mut tx, &mut actor, patient).await?;
    let mut value = row.receipt.0;
    value.replayed = true;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(value)
}

pub async fn save(
    pool: &PgPool,
    mut actor: WardRoundActor,
    patient: Uuid,
    input: SaveWardRoundDraftRequest,
) -> anyhow::Result<WardRoundCommandReceipt> {
    let input = validate::normalize(input)?;
    let mut tx = pool.begin().await?;
    if let Some(result) = replay(
        &mut tx,
        &mut actor,
        patient,
        input.client_request_id,
        "saved_draft",
        &input,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(result);
    }
    if let Some(id) = input.ward_round_id {
        let row = lock_round(&mut tx, &actor, patient, id, true).await?;
        if row.status != "draft" {
            return Err(WardRoundError::NotDraft.into());
        }
        if row.version != input.expected_version || row.admission_case_id != input.admission_case_id
        {
            return Err(WardRoundError::SourceChanged.into());
        }
    }
    artifacts::lock_prescriptions(&mut tx, &actor, patient, &input.actions).await?;
    access::prelock_targets(&mut tx, &actor, &input.actions).await?;
    access::verify(&mut tx, &mut actor).await?;
    access::patient(&mut tx, &mut actor, patient).await?;
    if let Some(id) = input.ward_round_id {
        check_children(&mut tx, &actor, id).await?;
    }
    let a = admission(
        &mut tx,
        &actor,
        patient,
        input.admission_case_id,
        true,
        false,
    )
    .await?;
    access::actions(&mut tx, &mut actor, patient, &a.scope(), &input.actions).await?;
    let prepared = artifacts::prepare(&mut tx, &actor, &input.actions).await?;
    let id = input.ward_round_id.unwrap_or_else(Uuid::new_v4);
    let version = if input.ward_round_id.is_none() {
        let saved:Option<Uuid>=sqlx::query_scalar("INSERT INTO ward_rounds(id,facility_id,patient_id,admission_case_id,status,note_sections,rendered_note,created_by_user_id) VALUES($1,$2,$3,$4,'draft',$5,$6,$7) ON CONFLICT(facility_id,admission_case_id) WHERE status='draft' DO NOTHING RETURNING id")
            .bind(id).bind(actor.facility_id).bind(patient).bind(a.id).bind(Json(&input.note_sections)).bind(&input.rendered_note).bind(actor.user_id).fetch_optional(&mut *tx).await?;
        if saved.is_none() {
            return Err(WardRoundError::DraftExists.into());
        }
        1
    } else {
        let version = input
            .expected_version
            .checked_add(1)
            .ok_or(WardRoundError::InvalidInput)?;
        sqlx::query("UPDATE ward_rounds SET note_sections=$3,rendered_note=$4,version=$5,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2 AND status='draft'")
            .bind(actor.facility_id).bind(id).bind(Json(&input.note_sections)).bind(&input.rendered_note).bind(version).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM ward_round_actions WHERE facility_id=$1 AND ward_round_id=$2 AND status='draft'").bind(actor.facility_id).bind(id).execute(&mut *tx).await?;
        version
    };
    for (position, action) in input.actions.iter().enumerate() {
        let (kind, mut title, instruction, payload) = validate::action_row(action)?;
        if let Some(target) = prepared.targets[position]
            .iter()
            .find(|t| t.resource_type == WardRoundTargetType::Prescription)
        {
            title = Some(target.display_name.clone());
        }
        sqlx::query("INSERT INTO ward_round_actions(id,facility_id,ward_round_id,patient_id,admission_case_id,action_type,status,title,instruction,payload,created_by_user_id,draft_position,reviewed_targets) VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12)")
            .bind(Uuid::new_v4()).bind(actor.facility_id).bind(id).bind(patient).bind(a.id).bind(codec::encode(kind)?).bind(title).bind(instruction).bind(Json(payload)).bind(actor.user_id).bind(position as i32).bind(Json(&prepared.targets[position])).execute(&mut *tx).await?;
    }
    refresh_rail(&mut tx, &actor, patient, a.id, id).await?;
    access::audit(&mut tx, &actor, id, "ward_round.draft.saved", version).await?;
    let result = WardRoundCommandReceipt {
        client_request_id: input.client_request_id,
        operation: WardRoundCommandOperation::SavedDraft,
        replayed: false,
        ward_round: detail_tx(&mut tx, &actor, patient, id).await?,
        created_artifacts: Vec::new(),
    };
    finish(&mut tx, &actor, patient, &input, &result).await?;
    tx.commit().await?;
    Ok(result)
}

pub async fn commit(
    pool: &PgPool,
    mut actor: WardRoundActor,
    patient: Uuid,
    id: Uuid,
    input: CommitWardRoundRequest,
) -> anyhow::Result<WardRoundCommandReceipt> {
    if input.client_request_id.is_nil() || input.expected_version < 1 {
        return Err(WardRoundError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    if let Some(result) = replay(
        &mut tx,
        &mut actor,
        patient,
        input.client_request_id,
        "committed",
        &(id, &input),
    )
    .await?
    {
        tx.commit().await?;
        return Ok(result);
    }
    let row = lock_round(&mut tx, &actor, patient, id, true).await?;
    if row.status != "draft" {
        return Err(WardRoundError::NotDraft.into());
    }
    if row.version != input.expected_version {
        return Err(WardRoundError::SourceChanged.into());
    }
    check_children(&mut tx, &actor, id).await?;
    let rows=sqlx::query_as::<_,CommitActionRow>("SELECT id,action_type,title,instruction,payload,reviewed_targets FROM ward_round_actions WHERE facility_id=$1 AND ward_round_id=$2 AND patient_id=$3 AND admission_case_id=$4 AND status='draft' ORDER BY draft_position ASC NULLS LAST,created_at,id LIMIT 101 FOR UPDATE")
        .bind(actor.facility_id).bind(id).bind(patient).bind(row.admission_case_id).fetch_all(&mut *tx).await?;
    if rows.len() > 100 {
        return Err(WardRoundError::InvalidInput.into());
    }
    let actions = rows
        .iter()
        .map(validate::stored)
        .collect::<anyhow::Result<Vec<_>>>()?;
    let reviewed = detail_tx(&mut tx, &actor, patient, id).await?;
    let normalized = validate::normalize(SaveWardRoundDraftRequest {
        client_request_id: input.client_request_id,
        ward_round_id: Some(id),
        expected_version: input.expected_version,
        admission_case_id: row.admission_case_id,
        note_sections: reviewed.note_sections.clone(),
        rendered_note: reviewed.rendered_note.clone(),
        actions,
    })?;
    if normalized.actions.is_empty()
        && normalized.rendered_note.as_deref().unwrap_or("").is_empty()
        && [
            &normalized.note_sections.interval_history,
            &normalized.note_sections.examination,
            &normalized.note_sections.assessment,
            &normalized.note_sections.plan,
        ]
        .iter()
        .all(|v| v.as_deref().unwrap_or("").is_empty())
    {
        return Err(WardRoundError::InvalidInput.into());
    }
    artifacts::lock_prescriptions(&mut tx, &actor, patient, &normalized.actions).await?;
    access::prelock_targets(&mut tx, &actor, &normalized.actions).await?;
    access::verify(&mut tx, &mut actor).await?;
    artifacts::lock_groups(&mut tx, &actor, patient, &normalized.actions).await?;
    let discharge = artifacts::discharge_source(
        &mut tx,
        &actor,
        patient,
        row.admission_case_id,
        &normalized.actions,
    )
    .await?;
    access::patient(&mut tx, &mut actor, patient).await?;
    let mut a = admission(
        &mut tx,
        &actor,
        patient,
        row.admission_case_id,
        true,
        discharge.is_some(),
    )
    .await?;
    access::actions(
        &mut tx,
        &mut actor,
        patient,
        &a.scope(),
        &normalized.actions,
    )
    .await?;
    let prepared = artifacts::prepare(&mut tx, &actor, &normalized.actions).await?;
    for (position, row) in rows.iter().enumerate() {
        if row
            .reviewed_targets
            .as_ref()
            .map(|value| value.0.as_slice())
            .unwrap_or(&[])
            != prepared.targets[position].as_slice()
        {
            return Err(WardRoundError::SourceChanged.into());
        }
    }
    if normalized.actions.iter().any(|v| {
        matches!(
            v,
            WardRoundDraftActionInput::Prescription(WardRoundPrescriptionCommand::Start(_))
                | WardRoundDraftActionInput::LabOrder(_)
        )
    }) {
        a.visit_id = crate::clinical::prescription_courses::validate_care_context_tx(
            &mut tx,
            actor.facility_id,
            patient,
            a.encounter_id,
            a.visit_id,
        )
        .await?;
    }
    for (row, action) in rows.iter().zip(&normalized.actions) {
        let artifact = artifacts::commit(
            &mut tx, &actor, patient, &a, row.id, action, discharge, &prepared,
        )
        .await?;
        link_artifact(&mut tx, actor.facility_id, id, patient, a.id, &artifact).await?;
        sqlx::query("UPDATE ward_round_actions SET status='committed',committed_resource_type=$3,committed_resource_id=$4,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2")
            .bind(actor.facility_id).bind(row.id).bind(&artifact.resource_type).bind(artifact.resource_id).execute(&mut *tx).await?;
    }
    let version = input
        .expected_version
        .checked_add(1)
        .ok_or(WardRoundError::InvalidInput)?;
    sqlx::query("UPDATE ward_rounds SET status='committed',version=$3,signed_by_user_id=$4,signed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2 AND status='draft'")
        .bind(actor.facility_id).bind(id).bind(version).bind(actor.user_id).execute(&mut *tx).await?;
    refresh_rail(&mut tx, &actor, patient, a.id, id).await?;
    access::audit(&mut tx, &actor, id, "ward_round.committed", version).await?;
    let detail = detail_tx(&mut tx, &actor, patient, id).await?;
    let result = WardRoundCommandReceipt {
        client_request_id: input.client_request_id,
        operation: WardRoundCommandOperation::Committed,
        replayed: false,
        created_artifacts: detail.artifacts.clone(),
        ward_round: detail,
    };
    finish(&mut tx, &actor, patient, &(id, &input), &result).await?;
    tx.commit().await?;
    Ok(result)
}
