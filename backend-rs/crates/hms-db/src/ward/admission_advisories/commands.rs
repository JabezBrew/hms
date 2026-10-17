use super::*;
use sqlx::types::Json;

fn token_valid(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn normalize_reason(value: Option<String>, required: bool) -> anyhow::Result<Option<String>> {
    let value = value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty());
    if (required && value.is_none()) || value.as_ref().is_some_and(|v| v.chars().count() > 2000) {
        return Err(AdvisoryError::InvalidInput.into());
    }
    Ok(value)
}
#[derive(FromRow)]
struct Command {
    actor_user_id: Uuid,
    patient_id: Uuid,
    admission_case_id: Uuid,
    operation: String,
    payload_digest: Vec<u8>,
    receipt: Json<AdmissionAdvisoryReceipt>,
}
async fn begin(
    tx: &mut Tx<'_>,
    actor: &AdvisoryActor,
    patient: Uuid,
    case_id: Uuid,
    key: Uuid,
    operation: AdmissionAdvisoryOperation,
    input: &impl Serialize,
) -> anyhow::Result<Option<AdmissionAdvisoryReceipt>> {
    if key.is_nil() {
        return Err(AdvisoryError::InvalidInput.into());
    }
    let mut scope = actor.facility_id.as_bytes().to_vec();
    scope.extend(key.as_bytes());
    let hash = hash(scope);
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(i64::from_be_bytes(hash[..8].try_into().unwrap()))
        .execute(&mut **tx)
        .await?;
    let row:Option<Command>=sqlx::query_as("SELECT actor_user_id,patient_id,admission_case_id,operation,payload_digest,receipt FROM admission_advisory_commands WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(super::hash(key.as_bytes())).fetch_optional(&mut **tx).await?;
    if let Some(row) = row {
        if row.actor_user_id != actor.user_id
            || row.patient_id != patient
            || row.admission_case_id != case_id
            || row.operation != codec::encode(operation)?
            || row.payload_digest != super::hash(serde_json::to_vec(input)?)
        {
            return Err(AdvisoryError::RequestConflict.into());
        }
        let mut result = row.receipt.0;
        result.replayed = true;
        return Ok(Some(result));
    }
    Ok(None)
}
async fn proof(
    tx: &mut Tx<'_>,
    actor: &mut AdvisoryActor,
    patient: Uuid,
    c: &CaseRow,
) -> anyhow::Result<()> {
    access::verify(tx, actor).await?;
    access::patient(tx, actor, patient).await?;
    access::ward(tx, actor, c.ward_id).await
}
async fn finish(
    tx: &mut Tx<'_>,
    actor: &AdvisoryActor,
    c: &CaseRow,
    key: Uuid,
    operation: AdmissionAdvisoryOperation,
    id: Uuid,
    input: &impl Serialize,
) -> anyhow::Result<AdmissionAdvisoryReceipt> {
    let mut original = actor.clone();
    original.can_write = false;
    let advisory = detail_tx(tx, &original, c, id, false).await?;
    let recorded_at = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut **tx)
        .await?;
    let result = AdmissionAdvisoryReceipt {
        client_request_id: key,
        operation,
        replayed: false,
        advisory,
        recorded_at,
    };
    sqlx::query("INSERT INTO admission_advisory_commands(facility_id,request_key_hash,actor_user_id,patient_id,admission_case_id,advisory_id,operation,payload_digest,receipt,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)").bind(actor.facility_id).bind(hash(key.as_bytes())).bind(actor.user_id).bind(c.patient_id).bind(c.id).bind(id).bind(codec::encode(operation)?).bind(hash(serde_json::to_vec(input)?)).bind(Json(&result)).bind(recorded_at).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,$4,'admission_advisory',$5,jsonb_build_object('status',$6::text,'version',$7::bigint))")
        .bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(match operation {AdmissionAdvisoryOperation::Created=>"admission_advisory.created",AdmissionAdvisoryOperation::Decided=>"admission_advisory.decided"}).bind(id).bind(codec::encode(result.advisory.summary.status)?).bind(result.advisory.summary.version).execute(&mut **tx).await?;
    access::deadline(tx, actor).await?;
    Ok(result)
}
pub async fn create(
    pool: &PgPool,
    mut actor: AdvisoryActor,
    patient: Uuid,
    case_id: Uuid,
    mut input: CreateAdmissionAdvisoryRequest,
) -> anyhow::Result<AdmissionAdvisoryReceipt> {
    input.notes = input.notes.trim().to_owned();
    if !token_valid(&input.expected_context_token)
        || input.notes.is_empty()
        || input.notes.chars().count() > 4000
    {
        return Err(AdvisoryError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    let prior = begin(
        &mut tx,
        &actor,
        patient,
        case_id,
        input.client_request_id,
        AdmissionAdvisoryOperation::Created,
        &input,
    )
    .await?;
    let c = case(&mut tx, &actor, patient, case_id, prior.is_none()).await?;
    proof(&mut tx, &mut actor, patient, &c).await?;
    if let Some(result) = prior {
        access::deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(result);
    }
    if !actor.can_write {
        return Err(AdvisoryError::AuthorityExpired.into());
    }
    if !c.open() || c.token(actor.facility_id)? != input.expected_context_token {
        return Err(AdvisoryError::ContextChanged.into());
    }
    let phase = if c.status == "ready_for_activation" {
        AdmissionAdvisoryPhase::PreActivation
    } else {
        AdmissionAdvisoryPhase::PostActivation
    };
    let id = Uuid::new_v4();
    let inserted:Option<Uuid>=sqlx::query_scalar("INSERT INTO admission_advisories(id,facility_id,patient_id,admission_case_id,captured_ward_id,captured_ward_name,task_type,phase,notes,status,version,created_by_user_id,created_by_display_name) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',1,u.id,u.display_name FROM users u WHERE u.id=$10 AND u.facility_id=$2 ON CONFLICT(facility_id,admission_case_id,task_type) DO NOTHING RETURNING id")
        .bind(id).bind(actor.facility_id).bind(patient).bind(case_id).bind(c.ward_id).bind(&c.ward_name).bind(codec::encode(input.task_type)?).bind(codec::encode(phase)?).bind(&input.notes).bind(actor.user_id).fetch_optional(&mut *tx).await?;
    if inserted.is_none() {
        return Err(AdvisoryError::TypeExists.into());
    }
    let result = finish(
        &mut tx,
        &actor,
        &c,
        input.client_request_id,
        AdmissionAdvisoryOperation::Created,
        id,
        &input,
    )
    .await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn decide(
    pool: &PgPool,
    mut actor: AdvisoryActor,
    patient: Uuid,
    case_id: Uuid,
    id: Uuid,
    mut input: DecideAdmissionAdvisoryRequest,
) -> anyhow::Result<AdmissionAdvisoryReceipt> {
    input.reason = normalize_reason(
        input.reason,
        input.decision != AdmissionAdvisoryDecision::Completed,
    )?;
    if input.expected_version < 1 || !token_valid(&input.expected_context_token) {
        return Err(AdvisoryError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    let prior = begin(
        &mut tx,
        &actor,
        patient,
        case_id,
        input.client_request_id,
        AdmissionAdvisoryOperation::Decided,
        &(id, &input),
    )
    .await?;
    let c = case(&mut tx, &actor, patient, case_id, prior.is_none()).await?;
    proof(&mut tx, &mut actor, patient, &c).await?;
    if let Some(result) = prior {
        access::deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(result);
    }
    if !actor.can_write {
        return Err(AdvisoryError::AuthorityExpired.into());
    }
    if c.token(actor.facility_id)? != input.expected_context_token
        || (!c.open() && input.decision != AdmissionAdvisoryDecision::Cancelled)
    {
        return Err(AdvisoryError::ContextChanged.into());
    }
    let current = detail_tx(&mut tx, &actor, &c, id, true).await?;
    if current.summary.status != AdmissionAdvisoryStatus::Pending {
        return Err(AdvisoryError::Terminal.into());
    }
    if current.summary.version != input.expected_version {
        return Err(AdvisoryError::VersionChanged.into());
    }
    sqlx::query("UPDATE admission_advisories t SET status=$5,version=version+1,decision_source='manual',decision_reason=$6,decided_by_user_id=u.id,decided_by_display_name=u.display_name,decided_at=clock_timestamp(),decision_ward_id=$7,decision_ward_name=$8 FROM users u WHERE t.facility_id=$1 AND t.patient_id=$2 AND t.admission_case_id=$3 AND t.id=$4 AND u.facility_id=t.facility_id AND u.id=$9")
        .bind(actor.facility_id).bind(patient).bind(case_id).bind(id).bind(codec::encode(input.decision)?).bind(&input.reason).bind(c.ward_id).bind(&c.ward_name).bind(actor.user_id).execute(&mut *tx).await?;
    let result = finish(
        &mut tx,
        &actor,
        &c,
        input.client_request_id,
        AdmissionAdvisoryOperation::Decided,
        id,
        &(id, &input),
    )
    .await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: AdvisoryActor,
    patient: Uuid,
    case_id: Uuid,
    key: Uuid,
) -> anyhow::Result<AdmissionAdvisoryReceipt> {
    let mut tx = pool.begin().await?;
    let c = case(&mut tx, &actor, patient, case_id, false).await?;
    proof(&mut tx, &mut actor, patient, &c).await?;
    let row:Option<Command>=sqlx::query_as("SELECT actor_user_id,patient_id,admission_case_id,operation,payload_digest,receipt FROM admission_advisory_commands WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(hash(key.as_bytes())).fetch_optional(&mut *tx).await?;
    let row = row.ok_or(AdvisoryError::NotFound)?;
    if row.actor_user_id != actor.user_id
        || row.patient_id != patient
        || row.admission_case_id != case_id
    {
        return Err(AdvisoryError::NotFound.into());
    }
    let mut result = row.receipt.0;
    result.replayed = true;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
