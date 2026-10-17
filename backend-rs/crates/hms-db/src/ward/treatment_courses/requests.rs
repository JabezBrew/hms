use super::*;
#[derive(FromRow)]
pub(super) struct SavedRequest {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub medication_course_id: Uuid,
    pub prescription_id: Uuid,
    pub fingerprint: String,
    pub receipt: sqlx::types::Json<TreatmentCourseReceipt>,
}
pub(super) async fn load(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    key: Uuid,
) -> anyhow::Result<Option<SavedRequest>> {
    Ok(hms_observability::observe_db_query("treatment_courses.request.get",sqlx::query_as("SELECT id,patient_id,admission_case_id,medication_course_id,prescription_id,fingerprint,receipt FROM treatment_course_requests WHERE facility_id=$1 AND actor_user_id=$2 AND request_hash=$3")
        .bind(actor.identity.facility_id).bind(actor.identity.user_id).bind(request_hash(actor,key)?).fetch_optional(&mut **tx)).await?)
}
pub(super) fn scoped(saved: &SavedRequest, scope: Scope) -> bool {
    saved.patient_id == scope.patient
        && saved.admission_case_id == scope.admission
        && saved.medication_course_id == scope.course
}
pub(super) fn replay(mut receipt: TreatmentCourseReceipt) -> TreatmentCourseReceipt {
    match &mut receipt {
        TreatmentCourseReceipt::Stopped { metadata, .. }
        | TreatmentCourseReceipt::SupplyWindowCreated { metadata, .. } => metadata.replayed = true,
    }
    receipt
}
pub async fn get_treatment_course_request(
    pool: &PgPool,
    mut actor: TreatmentActor,
    patient: Uuid,
    admission: Uuid,
    course: Uuid,
    key: Uuid,
) -> anyhow::Result<TreatmentCourseReceipt> {
    let scope = Scope {
        patient,
        admission,
        course,
    };
    let (mut tx, _, _, _) = super::read::open(pool, &mut actor, scope).await?;
    let saved = load(&mut tx, &actor, key)
        .await?
        .filter(|saved| scoped(saved, scope))
        .ok_or(TreatmentCourseError::NotFound)?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(replay(saved.receipt.0))
}
pub(super) async fn reserve(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    key: Uuid,
) -> anyhow::Result<()> {
    hms_observability::observe_db_query(
        "treatment_courses.request.lock",
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(request_hash(actor, key)?)
            .execute(&mut **tx),
    )
    .await?;
    Ok(())
}
pub(super) async fn save(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    scope: Scope,
    prescription: Uuid,
    id: Uuid,
    fingerprint: &str,
    input: Value,
    receipt: &TreatmentCourseReceipt,
) -> anyhow::Result<()> {
    let (metadata, operation) = match receipt {
        TreatmentCourseReceipt::Stopped { metadata, .. } => (metadata, "stopped"),
        TreatmentCourseReceipt::SupplyWindowCreated { metadata, .. } => {
            (metadata, "supply_window_created")
        }
    };
    hms_observability::observe_db_query("treatment_courses.request.save",sqlx::query("INSERT INTO treatment_course_requests(id,facility_id,actor_user_id,patient_id,admission_case_id,prescription_id,medication_course_id,request_hash,fingerprint,operation,reviewed_input,receipt,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
        .bind(id).bind(actor.identity.facility_id).bind(actor.identity.user_id).bind(scope.patient).bind(scope.admission).bind(prescription).bind(scope.course).bind(request_hash(actor,metadata.client_request_id)?).bind(fingerprint).bind(operation).bind(sqlx::types::Json(input)).bind(sqlx::types::Json(receipt)).bind(metadata.recorded_at).execute(&mut **tx)).await?;
    Ok(())
}
pub(super) async fn audit(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    scope: Scope,
    id: Uuid,
    event: &'static str,
    count: i64,
) -> anyhow::Result<()> {
    hms_observability::observe_db_query("treatment_courses.audit",sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'medication_course',$6,$7)")
        .bind(Uuid::new_v4()).bind(actor.identity.facility_id).bind(actor.identity.user_id).bind(&actor.identity.request_id).bind(event).bind(scope.course).bind(sqlx::types::Json(json!({"command_id":id,"dose_count":count}))).execute(&mut **tx)).await?;
    access::deadline(tx, actor).await
}
