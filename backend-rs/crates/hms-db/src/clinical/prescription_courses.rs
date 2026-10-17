//! Reviewed documentation and new prescription courses. Source locks precede
//! copied work; clinical receipts remain separate from PHI-free audit metadata.
use super::*;
use hms_domain::clinical::{
    NewPrescriptionCourseReceipt, NewPrescriptionCourseRequest, PrescriptionCourseProvenance,
    PrescriptionCourseRelation, PrescriptionDetail, PrescriptionDocumentationReceipt,
    UpdatePrescriptionDocumentationRequest,
};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Clone, Default)]
pub struct PrescriptionDocumentation {
    pub instructions: String,
    pub reason: String,
}
impl PrescriptionDocumentation {
    pub fn normalized(self) -> anyhow::Result<Self> {
        let value = Self {
            instructions: self.instructions.trim().to_owned(),
            reason: self.reason.trim().to_owned(),
        };
        if value.instructions.chars().count() > 4000 || value.reason.chars().count() > 2000 {
            return Err(PrescriptionCourseError::InvalidDocumentation.into());
        }
        Ok(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PrescriptionCourseError {
    NotFound,
    InvalidDocumentation,
    InvalidRequest,
    InvalidActor,
    SourceChanged,
    DocumentationLocked,
    InvalidSourceStatus,
    SuccessorExists,
    RequestConflict,
    StockChanged,
    InvalidContext,
    MixedRegimen,
    AuthorizationExpired,
}
impl PrescriptionCourseError {
    pub fn message(self) -> &'static str {
        match self {
    Self::NotFound=>"The prescription was not found.",
    Self::InvalidDocumentation=>"Use at most 4000 characters for instructions and 2000 for the prescribing reason.",
    Self::InvalidRequest=>"Review every required prescription field and retain a valid request reference.",
    Self::InvalidActor=>"The prescriber and active facility could not be verified.",
    Self::SourceChanged=>"The prescription changed. Reload its current details before reviewing this action.",
    Self::DocumentationLocked=>"This prescription's documentation is locked. Review a replacement course to change its instructions or reason.",
    Self::InvalidSourceStatus=>"Renewal requires a stopped or completed source; replacement requires an active or held source.",
    Self::SuccessorExists=>"This prescription already has a successor. Review that course before creating another.",
    Self::RequestConflict=>"This request reference was used for another prescription action.",
    Self::StockChanged=>"The linked stock or its unit changed. Reload and explicitly review the stock basis.",
    Self::MixedRegimen=>"Changing between as-needed and scheduled treatment requires a separate clinical review; linked new courses currently preserve the treatment kind.",
    Self::InvalidContext=>"The selected care context does not belong to this patient and facility.",
    Self::AuthorizationExpired=>"The authorization for this prescription action expired. Reload current access before continuing.",
}
    }
}
impl std::fmt::Display for PrescriptionCourseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}
impl std::error::Error for PrescriptionCourseError {}

#[derive(Clone)]
pub struct PrescriptionAuthorization {
    pub session_id: Uuid,
    pub session_version: i64,
    pub permission_version: i64,
    pub active_profile: hms_domain::deployment::DeploymentProfile,
    pub valid_until: DateTime<Utc>,
    pub resolved_network_policy_version: Option<i64>,
}
impl std::fmt::Debug for PrescriptionAuthorization {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PrescriptionAuthorization")
            .finish_non_exhaustive()
    }
}
#[derive(Clone)]
pub struct PrescriptionActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: Option<String>,
    pub authorization: Option<PrescriptionAuthorization>,
}
#[derive(FromRow)]
struct DetailRow {
    scheduled_stock_policy: Option<sqlx::types::Json<hms_domain::clinical::ScheduledStockPolicy>>,
    #[sqlx(flatten)]
    prescription: PrescriptionRow,
    instructions: String,
    reason: String,
    updated_at: DateTime<Utc>,
    created_by_user_id: Option<Uuid>,
    stock_unit: Option<String>,
    stock_active: Option<bool>,
    stock_updated_at: Option<DateTime<Utc>>,
    prn_safety_group_id: Option<Uuid>,
    has_generated_course: bool,
    provenance: Option<sqlx::types::Json<PrescriptionCourseProvenance>>,
    successor_prescription_id: Option<Uuid>,
}
const DETAIL_SELECT: &str = r#"SELECT p.id,p.patient_id,p.encounter_id,p.visit_id,p.discharge_case_id,p.medication_name,p.dose,p.route,p.frequency,
 p.inventory_item_id,p.start_date,p.duration_days,p.first_dose_at,p.prn_policy,p.status,p.prescribed_at,
 p.scheduled_stock_policy,p.instructions,p.reason,p.updated_at,p.created_by_user_id,p.prn_safety_group_id,
 i.unit AS stock_unit,i.is_active AS stock_active,i.updated_at AS stock_updated_at,
 EXISTS(SELECT 1 FROM medication_courses c WHERE c.facility_id=p.facility_id AND c.prescription_id=p.id) AS has_generated_course,
 (SELECT jsonb_build_object('source_prescription_id',v.source_prescription_id,'relation',v.relation,'change_reason',v.change_reason,
 'recorded_at',v.recorded_at,'recorded_by_user_id',v.recorded_by_user_id)
 FROM prescription_course_provenance v WHERE v.facility_id=p.facility_id AND v.prescription_id=p.id) AS provenance,
 (SELECT v.prescription_id FROM prescription_course_provenance v WHERE v.facility_id=p.facility_id AND v.source_prescription_id=p.id) AS successor_prescription_id
 FROM prescriptions p LEFT JOIN inventory_items i ON i.facility_id=p.facility_id AND i.id=p.inventory_item_id
 WHERE p.facility_id=$1 AND p.id=$2"#;
fn hash(value: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(value.as_ref()).to_vec()
}
fn token(value: &impl Serialize) -> anyhow::Result<String> {
    Ok(hash(serde_json::to_vec(value)?)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}
fn detail(row: DetailRow) -> anyhow::Result<PrescriptionDetail> {
    let prescription = prescription_from_row(row.prescription)?;
    let evidence = json!([
        &prescription,
        &row.scheduled_stock_policy,
        &row.instructions,
        &row.reason,
        row.updated_at,
        row.created_by_user_id,
        &row.stock_unit,
        row.stock_active,
        row.stock_updated_at,
        row.has_generated_course,
        row.prn_safety_group_id
    ]);
    Ok(PrescriptionDetail {
        scheduled_stock_policy: row.scheduled_stock_policy.map(|p| p.0),
        snapshot_token: token(&evidence)?,
        prescription,
        instructions: row.instructions,
        reason: row.reason,
        updated_at: row.updated_at,
        prescribed_by_user_id: row.created_by_user_id,
        stock_unit: row.stock_unit,
        has_generated_course: row.has_generated_course,
        provenance: row.provenance.map(|v| v.0),
        successor_prescription_id: row.successor_prescription_id,
    })
}
pub async fn get_detail(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PrescriptionDetail>> {
    sqlx::query_as::<_, DetailRow>(DETAIL_SELECT)
        .bind(facility)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(detail)
        .transpose()
}
async fn protected_read<'a>(
    pool: &'a PgPool,
    actor: PrescriptionActor,
    id: Uuid,
) -> anyhow::Result<Option<(Transaction<'a, Postgres>, PrescriptionActor)>> {
    let mut tx = pool.begin().await?;
    let patient: Option<Uuid> = sqlx::query_scalar(
        "SELECT patient_id FROM prescriptions WHERE facility_id=$1 AND id=$2 FOR SHARE",
    )
    .bind(actor.facility_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(patient) = patient else {
        return Ok(None);
    };
    let expected = actor
        .authorization
        .as_ref()
        .and_then(|proof| proof.resolved_network_policy_version);
    let mut proof = super::medication_access::MedicationActor {
        identity: actor,
        can_view_all_wards: false,
        resolved_network_policy_version: expected,
    };
    super::medication_access::verify(
        &mut tx,
        &mut proof,
        &[
            hms_domain::deployment::FeatureKey::Patients,
            hms_domain::deployment::FeatureKey::Encounters,
        ],
    )
    .await?;
    // Preserve prescribing's facility-scoped outpatient/history policy: the API
    // requires Full/View and demographics, without an extra care relationship,
    // current ward or alive/registered restriction on historical detail.
    super::medication_access::local_patient(&mut tx, &proof, patient).await?;
    Ok(Some((tx, proof.identity)))
}
pub async fn get_detail_authorized(
    pool: &PgPool,
    actor: PrescriptionActor,
    id: Uuid,
) -> anyhow::Result<Option<PrescriptionDetail>> {
    let Some((mut tx, actor)) = protected_read(pool, actor, id).await? else {
        return Ok(None);
    };
    let result = detail_tx(&mut tx, actor.facility_id, id).await?;
    check_authorization(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(Some(result))
}
async fn protected_receipt<T: serde::de::DeserializeOwned>(
    pool: &PgPool,
    actor: PrescriptionActor,
    source: Uuid,
    key: Uuid,
    kind: &'static str,
) -> anyhow::Result<Option<T>> {
    let Some((mut tx, actor)) = protected_read(pool, actor, source).await? else {
        return Ok(None);
    };
    let saved: Option<JsonValue> = sqlx::query_scalar("SELECT receipt FROM prescription_commands WHERE facility_id=$1 AND source_prescription_id=$2 AND actor_user_id=$3 AND request_key_hash=$4 AND command_type=$5")
        .bind(actor.facility_id).bind(source).bind(actor.user_id).bind(hash(key.as_bytes())).bind(kind)
        .fetch_optional(&mut *tx).await?;
    let result = saved
        .map(|mut value| {
            value["replayed"] = JsonValue::Bool(true);
            serde_json::from_value(value)
        })
        .transpose()?;
    check_authorization(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn get_documentation_receipt_authorized(
    pool: &PgPool,
    actor: PrescriptionActor,
    source: Uuid,
    key: Uuid,
) -> anyhow::Result<Option<PrescriptionDocumentationReceipt>> {
    protected_receipt(pool, actor, source, key, "documentation").await
}
pub async fn get_new_course_receipt_authorized(
    pool: &PgPool,
    actor: PrescriptionActor,
    source: Uuid,
    key: Uuid,
) -> anyhow::Result<Option<NewPrescriptionCourseReceipt>> {
    protected_receipt(pool, actor, source, key, "new_course").await
}
pub(crate) async fn detail_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<PrescriptionDetail> {
    detail(
        sqlx::query_as::<_, DetailRow>(DETAIL_SELECT)
            .bind(facility)
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or(PrescriptionCourseError::NotFound)?,
    )
}

/// Bounded batch projection for an already locked set of reviewed prescription sources.
pub(crate) async fn details_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    ids: &[Uuid],
) -> anyhow::Result<Vec<PrescriptionDetail>> {
    let sql = DETAIL_SELECT.replace("p.id=$2", "p.id=ANY($2)");
    sqlx::query_as::<_, DetailRow>(&sql)
        .bind(facility)
        .bind(ids)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(detail)
        .collect()
}
pub(crate) async fn verify_actor(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut PrescriptionActor,
) -> anyhow::Result<()> {
    verify_identity_actor(tx, actor).await?;
    if actor.authorization.is_none() {
        // Trusted repository/import compatibility only. HTTP commands use the
        // mandatory authorized wrappers; protected sibling actors are nonoptional.
        return Ok(());
    }
    let expected = actor
        .authorization
        .as_ref()
        .and_then(|proof| proof.resolved_network_policy_version)
        .ok_or(crate::network::NetworkPublicationError::MissingProof)?;
    crate::network::require_publication_tx(tx, actor.facility_id, expected).await
}

async fn verify_prescribing_actor(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut PrescriptionActor,
) -> anyhow::Result<()> {
    verify_actor(tx, actor).await?;
    if let Some(proof) = actor.authorization.as_ref() {
        super::medication_access::require_current_features_tx(
            tx,
            actor.facility_id,
            proof.active_profile,
            &[
                hms_domain::deployment::FeatureKey::Patients,
                hms_domain::deployment::FeatureKey::Encounters,
            ],
        )
        .await?;
    }
    check_authorization(tx, actor).await
}

/// Identity-only composition seam for MedicationActor (which retains its own
/// mandatory publication proof) and explicit trusted fixture/import creation.
pub(crate) async fn verify_identity_actor(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut PrescriptionActor,
) -> anyhow::Result<()> {
    let profile: Option<String> = hms_observability::observe_db_query(
        "clinical.prescription.proof.facility",
        sqlx::query_scalar(
            "SELECT deployment_profile FROM facilities WHERE id=$1 AND is_active FOR SHARE",
        )
        .bind(actor.facility_id)
        .fetch_optional(&mut **tx),
    )
    .await?;
    let user:Option<(i64,i64)>=hms_observability::observe_db_query("clinical.prescription.proof.user", sqlx::query_as("SELECT session_version,permission_version FROM users WHERE facility_id=$1 AND id=$2 AND is_active AND NOT password_change_required FOR SHARE").bind(actor.facility_id).bind(actor.user_id).fetch_optional(&mut **tx)).await?;
    if user.is_none() || profile.is_none() {
        return Err(PrescriptionCourseError::InvalidActor.into());
    }
    if let Some(proof) = actor.authorization.as_mut() {
        if user != Some((proof.session_version, proof.permission_version))
            || profile != Some(codec::encode(proof.active_profile)?)
        {
            return Err(PrescriptionCourseError::InvalidActor.into());
        }
        let session:Option<DateTime<Utc>>=hms_observability::observe_db_query("clinical.prescription.proof.session", sqlx::query_scalar("SELECT LEAST(expires_at,idle_expires_at,absolute_expires_at) FROM refresh_sessions WHERE facility_id=$1 AND user_id=$2 AND session_id=$3 AND session_version=$4 AND permission_version_at_issue=$5 AND revoked_at IS NULL AND LEAST(expires_at,idle_expires_at,absolute_expires_at)>clock_timestamp() FOR SHARE")
            .bind(actor.facility_id).bind(actor.user_id).bind(proof.session_id).bind(proof.session_version).bind(proof.permission_version).fetch_optional(&mut **tx)).await?;
        proof.valid_until = proof
            .valid_until
            .min(session.ok_or(PrescriptionCourseError::InvalidActor)?);
    }
    check_authorization(tx, actor).await
}
pub(crate) async fn check_authorization(
    tx: &mut Transaction<'_, Postgres>,
    actor: &PrescriptionActor,
) -> anyhow::Result<()> {
    if let Some(proof) = actor.authorization.as_ref() {
        let valid: bool = hms_observability::observe_db_query(
            "clinical.prescription.proof.deadline",
            sqlx::query_scalar("SELECT clock_timestamp()<$1")
                .bind(proof.valid_until)
                .fetch_one(&mut **tx),
        )
        .await?;
        if !valid {
            return Err(PrescriptionCourseError::AuthorizationExpired.into());
        }
    }
    Ok(())
}

fn validate_command(key: Uuid, snapshot: &str) -> anyhow::Result<()> {
    if key.is_nil() || snapshot.len() != 64 || !snapshot.bytes().all(|v| v.is_ascii_hexdigit()) {
        return Err(PrescriptionCourseError::InvalidRequest.into());
    }
    Ok(())
}
#[derive(FromRow)]
struct CommandRow {
    source_prescription_id: Uuid,
    actor_user_id: Uuid,
    command_type: String,
    payload_digest: Vec<u8>,
    receipt: JsonValue,
}
async fn replay<T: DeserializeOwned>(
    tx: &mut Transaction<'_, Postgres>,
    actor: &PrescriptionActor,
    source: Uuid,
    key: Uuid,
    kind: &str,
    payload: &impl Serialize,
) -> anyhow::Result<Option<T>> {
    let saved=sqlx::query_as::<_,CommandRow>("SELECT source_prescription_id,actor_user_id,command_type,payload_digest,receipt FROM prescription_commands WHERE facility_id=$1 AND request_key_hash=$2")
        .bind(actor.facility_id).bind(hash(key.as_bytes())).fetch_optional(&mut **tx).await?;
    let Some(saved) = saved else {
        return Ok(None);
    };
    if saved.source_prescription_id != source
        || saved.actor_user_id != actor.user_id
        || saved.command_type != kind
        || saved.payload_digest != hash(serde_json::to_vec(payload)?)
    {
        return Err(PrescriptionCourseError::RequestConflict.into());
    }
    Ok(Some(serde_json::from_value(saved.receipt)?))
}
async fn save_command(
    tx: &mut Transaction<'_, Postgres>,
    actor: &PrescriptionActor,
    source: Uuid,
    key: Uuid,
    kind: &str,
    payload: &impl Serialize,
    receipt: &impl Serialize,
) -> anyhow::Result<()> {
    let inserted=sqlx::query("INSERT INTO prescription_commands(facility_id,request_key_hash,source_prescription_id,actor_user_id,command_type,payload_digest,receipt) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING")
        .bind(actor.facility_id).bind(hash(key.as_bytes())).bind(source).bind(actor.user_id).bind(kind).bind(hash(serde_json::to_vec(payload)?)).bind(serde_json::to_value(receipt)?)
        .execute(&mut **tx).await?;
    if inserted.rows_affected() != 1 {
        return Err(PrescriptionCourseError::RequestConflict.into());
    }
    Ok(())
}
async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    actor: &PrescriptionActor,
    resource: Uuid,
    event: &str,
    metadata: JsonValue,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'prescription',$6,$7)")
        .bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(event).bind(resource).bind(metadata).execute(&mut **tx).await?;
    Ok(())
}
pub async fn create_with_documentation(
    pool: &PgPool,
    prescription: NewPrescription,
    policy: Option<PrnPolicyRequest>,
    documentation: PrescriptionDocumentation,
    request_id: Option<String>,
    authorization: Option<PrescriptionAuthorization>,
) -> anyhow::Result<PrescriptionDetail> {
    create_with_stock_policy(
        pool,
        prescription,
        policy,
        None,
        documentation,
        request_id,
        authorization,
    )
    .await
}
pub async fn create_with_stock_policy(
    pool: &PgPool,
    mut prescription: NewPrescription,
    policy: Option<PrnPolicyRequest>,
    scheduled_policy: Option<hms_domain::clinical::ScheduledStockPolicyRequest>,
    documentation: PrescriptionDocumentation,
    request_id: Option<String>,
    authorization: Option<PrescriptionAuthorization>,
) -> anyhow::Result<PrescriptionDetail> {
    let mut actor = PrescriptionActor {
        facility_id: prescription.facility_id,
        user_id: prescription.actor_user_id,
        request_id,
        authorization,
    };
    let id = prescription.id;
    let mut tx = pool.begin().await?;
    if actor.authorization.is_some() {
        verify_prescribing_actor(&mut tx, &mut actor).await?;
    } else {
        // Existing internal import/fixture API. Protected HTTP creation always
        // supplies authorization; no request payload can select this branch.
        verify_identity_actor(&mut tx, &mut actor).await?;
    }
    validate_create_care_context(&mut tx, &mut prescription).await?;
    insert_prescription_in_transaction(
        &mut tx,
        prescription,
        policy,
        documentation,
        None,
        scheduled_policy,
    )
    .await?;
    let result = detail_tx(&mut tx, actor.facility_id, id).await?;
    audit(&mut tx, &actor, id, "prescription.created", json!({})).await?;
    check_authorization(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
fn require_http_proof(actor: &PrescriptionActor) -> anyhow::Result<()> {
    if actor
        .authorization
        .as_ref()
        .and_then(|proof| proof.resolved_network_policy_version)
        .is_none()
    {
        return Err(crate::network::NetworkPublicationError::MissingProof.into());
    }
    Ok(())
}
pub async fn update_documentation_authorized(
    pool: &PgPool,
    actor: PrescriptionActor,
    source: Uuid,
    input: UpdatePrescriptionDocumentationRequest,
) -> anyhow::Result<PrescriptionDocumentationReceipt> {
    require_http_proof(&actor)?;
    update_documentation(pool, actor, source, input).await
}
pub async fn update_documentation(
    pool: &PgPool,
    mut actor: PrescriptionActor,
    source: Uuid,
    mut input: UpdatePrescriptionDocumentationRequest,
) -> anyhow::Result<PrescriptionDocumentationReceipt> {
    validate_command(input.client_request_id, &input.expected_snapshot_token)?;
    let docs = PrescriptionDocumentation {
        instructions: input.instructions,
        reason: input.reason,
    }
    .normalized()?;
    input.instructions = docs.instructions;
    input.reason = docs.reason;
    let mut tx = pool.begin().await?;
    lock_prescription(&mut tx, actor.facility_id, source)
        .await?
        .ok_or(PrescriptionCourseError::NotFound)?;
    verify_prescribing_actor(&mut tx, &mut actor).await?;
    if let Some(mut result) = replay::<PrescriptionDocumentationReceipt>(
        &mut tx,
        &actor,
        source,
        input.client_request_id,
        "documentation",
        &input,
    )
    .await?
    {
        result.replayed = true;
        check_authorization(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(result);
    }
    let current = detail_tx(&mut tx, actor.facility_id, source).await?;
    if current.snapshot_token != input.expected_snapshot_token {
        return Err(PrescriptionCourseError::SourceChanged.into());
    }
    if current.has_generated_course
        || current
            .prescription
            .frequency
            .trim()
            .eq_ignore_ascii_case("prn")
        || current.prescription.prn_policy.is_some()
        || matches!(
            current.prescription.status,
            PrescriptionStatus::Stopped | PrescriptionStatus::Completed
        )
    {
        return Err(PrescriptionCourseError::DocumentationLocked.into());
    }
    sqlx::query("UPDATE prescriptions SET instructions=$3,reason=$4,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2")
        .bind(actor.facility_id).bind(source).bind(&input.instructions).bind(&input.reason).execute(&mut *tx).await?;
    let result = PrescriptionDocumentationReceipt {
        client_request_id: input.client_request_id,
        prescription: detail_tx(&mut tx, actor.facility_id, source).await?,
        replayed: false,
    };
    save_command(
        &mut tx,
        &actor,
        source,
        input.client_request_id,
        "documentation",
        &input,
        &result,
    )
    .await?;
    audit(
        &mut tx,
        &actor,
        source,
        "prescription.documentation.updated",
        json!({}),
    )
    .await?;
    check_authorization(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}

pub async fn get_new_course_receipt(
    pool: &PgPool,
    actor: &PrescriptionActor,
    source: Uuid,
    key: Uuid,
) -> anyhow::Result<Option<NewPrescriptionCourseReceipt>> {
    let saved:Option<JsonValue>=sqlx::query_scalar("SELECT receipt FROM prescription_commands WHERE facility_id=$1 AND source_prescription_id=$2 AND actor_user_id=$3 AND request_key_hash=$4 AND command_type='new_course'")
        .bind(actor.facility_id).bind(source).bind(actor.user_id).bind(hash(key.as_bytes())).fetch_optional(pool).await?;
    saved
        .map(|v| {
            let mut receipt: NewPrescriptionCourseReceipt = serde_json::from_value(v)?;
            receipt.replayed = true;
            Ok(receipt)
        })
        .transpose()
}

/// The caller already owns the prescription lock. No writer may take a source
/// lock while holding this group lock: source -> safety group -> copied work.
pub(crate) async fn lock_prn_safety_group(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    source: Uuid,
) -> anyhow::Result<Option<Uuid>> {
    Ok(sqlx::query_scalar("SELECT g.id FROM prescription_prn_safety_groups g JOIN prescriptions p ON p.facility_id=g.facility_id AND p.patient_id=g.patient_id AND p.prn_safety_group_id=g.id WHERE p.facility_id=$1 AND p.id=$2 FOR UPDATE OF g")
        .bind(facility).bind(source).fetch_optional(&mut **tx).await?)
}

pub(crate) async fn validate_care_context_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    patient: Uuid,
    encounter: Option<Uuid>,
    visit: Option<Uuid>,
) -> anyhow::Result<Option<Uuid>> {
    let inherited_visit = if let Some(encounter) = encounter {
        let context:Option<Option<Uuid>>=sqlx::query_scalar("SELECT visit_id FROM encounters WHERE facility_id=$1 AND patient_id=$2 AND id=$3 AND status='in_progress' FOR SHARE")
            .bind(facility).bind(patient).bind(encounter).fetch_optional(&mut **tx).await?;
        context.ok_or(PrescriptionCourseError::InvalidContext)?
    } else {
        None
    };
    if visit
        .zip(inherited_visit)
        .is_some_and(|(selected, actual)| selected != actual)
    {
        return Err(PrescriptionCourseError::InvalidContext.into());
    }
    let visit = visit.or(inherited_visit);
    if let Some(visit) = visit {
        let valid:Option<Uuid>=sqlx::query_scalar("SELECT id FROM visits WHERE facility_id=$1 AND patient_id=$2 AND id=$3 AND status IN ('waiting','called','in_triage','in_consultation') FOR SHARE")
            .bind(facility).bind(patient).bind(visit).fetch_optional(&mut **tx).await?;
        if valid.is_none() {
            return Err(PrescriptionCourseError::InvalidContext.into());
        }
    }
    Ok(visit)
}

async fn validate_create_care_context(
    tx: &mut Transaction<'_, Postgres>,
    prescription: &mut NewPrescription,
) -> anyhow::Result<()> {
    if let Some(id) = prescription.discharge_case_id {
        let discharge:Option<(Uuid,Option<Uuid>,Option<Uuid>)>=sqlx::query_as("SELECT admission_case_id,encounter_id,visit_id FROM discharge_cases WHERE facility_id=$1 AND id=$2 AND patient_id=$3 AND status='requested' FOR SHARE")
            .bind(prescription.facility_id).bind(id).bind(prescription.patient_id).fetch_optional(&mut **tx).await?;
        let discharge = discharge.ok_or(PrescriptionCourseError::InvalidContext)?;
        // Match discharge writers' case -> admission order. Legacy null case
        // context must not conceal the owning admission's closed care context.
        let admission:Option<(Option<Uuid>,Option<Uuid>)>=sqlx::query_as("SELECT encounter_id,visit_id FROM admission_cases WHERE facility_id=$1 AND id=$2 AND patient_id=$3 AND status IN ('admitted','discharge_pending') FOR SHARE")
            .bind(prescription.facility_id).bind(discharge.0).bind(prescription.patient_id).fetch_optional(&mut **tx).await?;
        let admission = admission.ok_or(super::stock_basis::StockBasisError::AdmissionInactive)?;
        for (selected, inherited) in [
            (&mut prescription.encounter_id, discharge.1.or(admission.0)),
            (&mut prescription.visit_id, discharge.2.or(admission.1)),
        ] {
            if selected.zip(inherited).is_some_and(|(a, b)| a != b) {
                return Err(PrescriptionCourseError::InvalidContext.into());
            }
            *selected = selected.or(inherited);
        }
    }
    prescription.visit_id = validate_care_context_tx(
        tx,
        prescription.facility_id,
        prescription.patient_id,
        prescription.encounter_id,
        prescription.visit_id,
    )
    .await?;
    Ok(())
}

pub async fn create_new_course_authorized(
    pool: &PgPool,
    actor: PrescriptionActor,
    source: Uuid,
    input: NewPrescriptionCourseRequest,
) -> anyhow::Result<NewPrescriptionCourseReceipt> {
    require_http_proof(&actor)?;
    create_new_course(pool, actor, source, input).await
}
pub async fn create_new_course(
    pool: &PgPool,
    mut actor: PrescriptionActor,
    source: Uuid,
    input: NewPrescriptionCourseRequest,
) -> anyhow::Result<NewPrescriptionCourseReceipt> {
    let input = input
        .normalized()
        .map_err(|_| PrescriptionCourseError::InvalidRequest)?;
    let mut tx = pool.begin().await?;
    let summary = lock_prescription(&mut tx, actor.facility_id, source)
        .await?
        .ok_or(PrescriptionCourseError::NotFound)?;
    verify_prescribing_actor(&mut tx, &mut actor).await?;
    if let Some(mut result) = replay::<NewPrescriptionCourseReceipt>(
        &mut tx,
        &actor,
        source,
        input.client_request_id,
        "new_course",
        &input,
    )
    .await?
    {
        result.replayed = true;
        check_authorization(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(result);
    }
    let safety_group = lock_prn_safety_group(&mut tx, actor.facility_id, source).await?;
    let mut items = summary
        .inventory_item_id
        .into_iter()
        .chain(input.inventory_item_id)
        .collect::<Vec<_>>();
    items.sort();
    items.dedup();
    // Stable item order avoids A->B/B->A replacement deadlocks. Source and new
    // stock basis stay stable through token comparison and successor creation.
    let _locked: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM inventory_items WHERE facility_id=$1 AND id=ANY($2) ORDER BY id FOR SHARE",
    )
    .bind(actor.facility_id)
    .bind(items)
    .fetch_all(&mut *tx)
    .await?;
    let current = detail_tx(&mut tx, actor.facility_id, source).await?;
    let successor:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM prescription_course_provenance WHERE facility_id=$1 AND source_prescription_id=$2)")
        .bind(actor.facility_id).bind(source).fetch_one(&mut *tx).await?;
    if successor {
        return Err(PrescriptionCourseError::SuccessorExists.into());
    }
    if input.expected_snapshot_token != current.snapshot_token {
        return Err(PrescriptionCourseError::SourceChanged.into());
    }
    let before = current.prescription.status;
    let allowed = matches!(
        (input.relation, before),
        (
            PrescriptionCourseRelation::Renewal,
            PrescriptionStatus::Stopped | PrescriptionStatus::Completed
        ) | (
            PrescriptionCourseRelation::Replacement,
            PrescriptionStatus::Active | PrescriptionStatus::OnHold
        )
    );
    if !allowed {
        return Err(PrescriptionCourseError::InvalidSourceStatus.into());
    }
    if current
        .prescription
        .frequency
        .trim()
        .eq_ignore_ascii_case("prn")
        != input.frequency.eq_ignore_ascii_case("prn")
    {
        return Err(PrescriptionCourseError::MixedRegimen.into());
    }
    if input.frequency.eq_ignore_ascii_case("prn") && safety_group.is_none() {
        return Err(PrescriptionCourseError::StockChanged.into());
    }
    if let Some(item) = input.inventory_item_id {
        let unit:Option<String>=sqlx::query_scalar("SELECT unit FROM inventory_items WHERE facility_id=$1 AND id=$2 AND is_active AND item_type IN ('medication','controlled_substance') AND (NOT $3 OR (NOT controlled AND item_type='medication'))")
            .bind(actor.facility_id).bind(item).bind(input.prn_policy.is_some()).fetch_optional(&mut *tx).await?;
        if unit.is_none() || unit != input.expected_stock_unit {
            return Err(PrescriptionCourseError::StockChanged.into());
        }
    }
    let visit = validate_care_context_tx(
        &mut tx,
        actor.facility_id,
        current.prescription.patient_id,
        input.encounter_id,
        input.visit_id,
    )
    .await?;
    check_authorization(&mut tx, &actor).await?;
    let after = if input.relation == PrescriptionCourseRelation::Replacement {
        update_prescription_in_transaction(
            &mut tx,
            actor.facility_id,
            source,
            Some(current.prescription.patient_id),
            UpdatePrescriptionRequest {
                medication_name: None,
                dose: None,
                route: None,
                frequency: None,
                inventory_item_id: None,
                start_date: None,
                duration_days: None,
                first_dose_at: None,
                status: Some(PrescriptionStatus::Stopped),
            },
        )
        .await?
        .ok_or(PrescriptionCourseError::NotFound)?;
        PrescriptionStatus::Stopped
    } else {
        before
    };
    let id = Uuid::new_v4();
    insert_prescription_in_transaction(
        &mut tx,
        NewPrescription {
            id,
            facility_id: actor.facility_id,
            patient_id: current.prescription.patient_id,
            encounter_id: input.encounter_id,
            visit_id: visit,
            discharge_case_id: None,
            medication_name: input.medication_name.clone(),
            dose: input.dose.clone(),
            route: input.route.clone(),
            frequency: input.frequency.clone(),
            inventory_item_id: input.inventory_item_id,
            start_date: Some(input.start_date),
            duration_days: input.duration_days,
            first_dose_at: input.first_dose_at,
            actor_user_id: actor.user_id,
        },
        input.prn_policy.clone(),
        PrescriptionDocumentation {
            instructions: input.instructions.clone(),
            reason: input.reason.clone(),
        },
        safety_group,
        input.scheduled_stock_policy.clone(),
    )
    .await?;
    let relation = codec::encode(input.relation)?;
    let recorded_at:DateTime<Utc>=sqlx::query_scalar("INSERT INTO prescription_course_provenance(prescription_id,facility_id,source_prescription_id,relation,change_reason,recorded_by_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING recorded_at")
        .bind(id).bind(actor.facility_id).bind(source).bind(&relation).bind(&input.change_reason).bind(actor.user_id).fetch_one(&mut *tx).await?;
    let result = NewPrescriptionCourseReceipt {
        client_request_id: input.client_request_id,
        source_prescription_id: source,
        source_status_before: before,
        source_status_after: after,
        relation: input.relation,
        prescription: detail_tx(&mut tx, actor.facility_id, id).await?,
        recorded_at,
        replayed: false,
    };
    save_command(
        &mut tx,
        &actor,
        source,
        input.client_request_id,
        "new_course",
        &input,
        &result,
    )
    .await?;
    audit(&mut tx,&actor,id,"prescription.course.created",json!({"source_prescription_id":source,"relation":relation,"source_status_before":before,"source_status_after":after})).await?;
    check_authorization(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}

pub async fn get_documentation_receipt(
    pool: &PgPool,
    actor: &PrescriptionActor,
    source: Uuid,
    key: Uuid,
) -> anyhow::Result<Option<PrescriptionDocumentationReceipt>> {
    let saved:Option<JsonValue>=sqlx::query_scalar("SELECT receipt FROM prescription_commands WHERE facility_id=$1 AND source_prescription_id=$2 AND actor_user_id=$3 AND request_key_hash=$4 AND command_type='documentation'")
        .bind(actor.facility_id).bind(source).bind(actor.user_id).bind(hash(key.as_bytes())).fetch_optional(pool).await?;
    saved
        .map(|v| {
            let mut receipt: PrescriptionDocumentationReceipt = serde_json::from_value(v)?;
            receipt.replayed = true;
            Ok(receipt)
        })
        .transpose()
}
