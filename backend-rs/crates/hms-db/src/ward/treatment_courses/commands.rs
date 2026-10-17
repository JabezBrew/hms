use super::*;
use super::{policy, read, requests, rows, schedule};
use crate::clinical::{prescription_courses, stock_basis};

fn validate_tokens(key: Uuid, source: &str, course: &str, context: &str) -> anyhow::Result<()> {
    if key.is_nil()
        || ![source, course, context]
            .iter()
            .all(|token| token_valid(token))
    {
        return Err(TreatmentCourseError::InvalidInput.into());
    }
    Ok(())
}
fn validate_snapshots(
    row: &rows::CourseRow,
    context: &policy::ContextRow,
    source_token: &str,
    course_token: &str,
    context_token: &str,
) -> anyhow::Result<()> {
    if hash(&context.snapshot.0)? != context_token {
        return Err(TreatmentCourseError::ContextChanged.into());
    }
    if hash(&row.source_snapshot.0)? != source_token
        || hash(&row.course_snapshot.0)? != course_token
    {
        return Err(TreatmentCourseError::SnapshotChanged.into());
    }
    Ok(())
}
async fn open<'a>(
    pool: &'a PgPool,
    actor: &mut TreatmentActor,
    scope: Scope,
    key: Uuid,
) -> anyhow::Result<(Tx<'a>, policy::ContextRow, policy::Authority, Uuid)> {
    let mut tx = pool.begin().await?;
    requests::reserve(&mut tx, actor, key).await?;
    let prescription = rows::source_lock(&mut tx, actor, scope, true).await?;
    let authority = policy::identity(&mut tx, actor).await?;
    prescription_courses::lock_prn_safety_group(&mut tx, actor.identity.facility_id, prescription)
        .await?;
    let context = policy::context(&mut tx, actor, scope.patient, scope.admission).await?;
    policy::relationship(&mut tx, actor, &context).await?;
    Ok((tx, context, authority, prescription))
}
async fn original(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    scope: Scope,
    key: Uuid,
    fingerprint: &str,
) -> anyhow::Result<Option<TreatmentCourseReceipt>> {
    let Some(saved) = requests::load(tx, actor, key).await? else {
        return Ok(None);
    };
    if !requests::scoped(&saved, scope) || saved.fingerprint != fingerprint {
        return Err(TreatmentCourseError::RequestConflict.into());
    }
    Ok(Some(requests::replay(saved.receipt.0)))
}
async fn metadata(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    scope: Scope,
    prescription: Uuid,
    key: Uuid,
) -> anyhow::Result<TreatmentCourseReceiptMetadata> {
    let name: String = hms_observability::observe_db_query(
        "treatment_courses.actor.display",
        sqlx::query_scalar("SELECT display_name FROM users WHERE facility_id=$1 AND id=$2")
            .bind(actor.identity.facility_id)
            .bind(actor.identity.user_id)
            .fetch_one(&mut **tx),
    )
    .await?;
    Ok(TreatmentCourseReceiptMetadata {
        client_request_id: key,
        replayed: false,
        patient_id: scope.patient,
        admission_case_id: scope.admission,
        prescription_id: prescription,
        course_id: scope.course,
        recorded_by_user_id: actor.identity.user_id,
        recorded_by_display_name: name,
        recorded_at: policy::now(tx).await?,
    })
}
const PENDING: &str=" AND m.status IN ('scheduled','held') AND (m.status='scheduled' OR m.prescription_held) AND m.administered_at IS NULL AND m.outcome_recorded_at IS NULL AND m.local_course_stop_id IS NULL";
fn pending_query(
    actor: &TreatmentActor,
    scope: Scope,
    prescription: Uuid,
    select: &'static str,
) -> QueryBuilder<'static, Postgres> {
    let mut q = QueryBuilder::new(select);
    q.push(" FROM medication_administrations m WHERE m.facility_id=")
        .push_bind(actor.identity.facility_id)
        .push(" AND m.medication_course_id=")
        .push_bind(scope.course)
        .push(" AND m.patient_id=")
        .push_bind(scope.patient)
        .push(" AND m.admission_case_id=")
        .push_bind(scope.admission)
        .push(" AND m.prescription_id=")
        .push_bind(prescription)
        .push(PENDING);
    q
}
/// Bounded memory, stable source-parent serialization; no unbounded ID array.
async fn pending_fingerprint(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    scope: Scope,
    prescription: Uuid,
) -> anyhow::Result<(i64, String)> {
    let mut last = None;
    let mut count = 0i64;
    let mut digest = Sha256::new();
    loop {
        let mut q = pending_query(actor, scope, prescription, "SELECT m.id");
        if let Some(last) = last {
            q.push(" AND m.id>").push_bind(last);
        }
        q.push(" ORDER BY m.id LIMIT 512");
        let ids: Vec<Uuid> = hms_observability::observe_db_query(
            "treatment_courses.stop.membership.hash",
            q.build_query_scalar().fetch_all(&mut **tx),
        )
        .await?;
        if ids.is_empty() {
            break;
        }
        for id in &ids {
            digest.update(id.as_bytes());
        }
        count = count
            .checked_add(ids.len() as i64)
            .ok_or(TreatmentCourseError::ReviewRequired)?;
        last = ids.last().copied();
        if ids.len() < 512 {
            break;
        }
    }
    Ok((count, format!("{:x}", digest.finalize())))
}
async fn membership(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    scope: Scope,
    prescription: Uuid,
    request: Uuid,
    ids: Option<&[Uuid]>,
) -> anyhow::Result<u64> {
    let mut q=QueryBuilder::<Postgres>::new("INSERT INTO treatment_course_request_doses(request_id,facility_id,patient_id,admission_case_id,prescription_id,medication_course_id,medication_administration_id,original_membership) SELECT ");
    q.push_bind(request).push(",m.facility_id,m.patient_id,m.admission_case_id,m.prescription_id,m.medication_course_id,m.id,jsonb_build_object('medication_administration_id',m.id,'scheduled_at',m.scheduled_at,'dose_sequence',m.dose_sequence,'pharmacy_fulfillment_id',m.pharmacy_fulfillment_id,'status_at_command',m.status,'was_dispensed',m.is_dispensed,'scheduled_stock_policy',m.scheduled_stock_policy) FROM medication_administrations m WHERE m.facility_id=").push_bind(actor.identity.facility_id)
        .push(" AND m.medication_course_id=").push_bind(scope.course).push(" AND m.patient_id=").push_bind(scope.patient)
        .push(" AND m.admission_case_id=").push_bind(scope.admission).push(" AND m.prescription_id=").push_bind(prescription);
    if let Some(ids) = ids {
        q.push(" AND m.id=ANY(").push_bind(ids.to_vec()).push(")");
    } else {
        q.push(PENDING);
    }
    Ok(hms_observability::observe_db_query(
        "treatment_courses.request.membership",
        q.build().execute(&mut **tx),
    )
    .await?
    .rows_affected())
}

pub async fn stop_treatment_course(
    pool: &PgPool,
    mut actor: TreatmentActor,
    patient: Uuid,
    admission: Uuid,
    course: Uuid,
    mut input: StopTreatmentCourseRequest,
) -> anyhow::Result<TreatmentCourseReceipt> {
    validate_tokens(
        input.client_request_id,
        &input.expected_source_token,
        &input.expected_course_token,
        &input.expected_context_token,
    )?;
    input.reason = input.reason.trim().to_owned();
    if input.reason.is_empty() || input.reason.len() > 2000 {
        return Err(TreatmentCourseError::InvalidInput.into());
    }
    let scope = Scope {
        patient,
        admission,
        course,
    };
    let fingerprint = hash(
        &json!({"operation":"stopped","patient":patient,"admission":admission,"course":course,"input":input}),
    )?;
    let (mut tx, context, authority, prescription) =
        open(pool, &mut actor, scope, input.client_request_id).await?;
    if let Some(receipt) = original(
        &mut tx,
        &actor,
        scope,
        input.client_request_id,
        &fingerprint,
    )
    .await?
    {
        access::deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(receipt);
    }
    if !authority.manage {
        return Err(TreatmentCourseError::PermissionDenied.into());
    }
    let row = rows::course(&mut tx, &actor, scope, true).await?;
    validate_snapshots(
        &row,
        &context,
        &input.expected_source_token,
        &input.expected_course_token,
        &input.expected_context_token,
    )?;
    if !policy::active(&context) {
        return Err(TreatmentCourseError::ContextChanged.into());
    }
    if read::stop_reason(&row, &context, authority).is_some() {
        return Err(TreatmentCourseError::Terminal.into());
    }
    read::counts(&mut tx, &actor, scope, &row).await?;
    let (retired, member_hash) = pending_fingerprint(&mut tx, &actor, scope, prescription).await?;
    let cancelled=hms_observability::observe_db_query("treatment_courses.stop.fulfillments",sqlx::query("UPDATE pharmacy_fulfillments SET status='cancelled',updated_at=clock_timestamp() WHERE facility_id=$1 AND medication_course_id=$2 AND patient_id=$3 AND admission_case_id=$4 AND prescription_id=$5 AND status IN ('pending','partially_dispensed')")
        .bind(actor.identity.facility_id).bind(course).bind(patient).bind(admission).bind(prescription).execute(&mut *tx)).await?.rows_affected();
    let metadata = metadata(
        &mut tx,
        &actor,
        scope,
        prescription,
        input.client_request_id,
    )
    .await?;
    let stop = TreatmentCourseStopEvidence {
        id: Uuid::new_v4(),
        reason: input.reason.clone(),
        recorded_by_user_id: metadata.recorded_by_user_id,
        recorded_by_display_name: metadata.recorded_by_display_name.clone(),
        recorded_at: metadata.recorded_at,
        ward_id: context.current_ward_id,
        ward_name: context.current_ward_name.clone(),
        source_status_at_stop: row.summary.source_status,
        retired_pending_dose_count: retired,
        cancelled_fulfillment_count: i64::try_from(cancelled)
            .map_err(|_| TreatmentCourseError::ReviewRequired)?,
        retired_dose_membership_token: member_hash,
    };
    hms_observability::observe_db_query("treatment_courses.stop.save",sqlx::query("INSERT INTO medication_course_stops(id,facility_id,medication_course_id,patient_id,admission_case_id,prescription_id,reason,recorded_by_user_id,recorded_by_display_name,recorded_at,ward_id,ward_name,source_snapshot,course_snapshot,context_snapshot,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)")
        .bind(stop.id).bind(actor.identity.facility_id).bind(course).bind(patient).bind(admission).bind(prescription).bind(&stop.reason).bind(stop.recorded_by_user_id).bind(&stop.recorded_by_display_name).bind(stop.recorded_at).bind(stop.ward_id).bind(&stop.ward_name).bind(&row.source_snapshot).bind(&row.course_snapshot).bind(&context.snapshot).bind(sqlx::types::Json(&stop)).execute(&mut *tx)).await?;
    let request = Uuid::new_v4();
    let receipt = TreatmentCourseReceipt::Stopped {
        metadata,
        reviewed_input: input.clone(),
        result: stop.clone(),
    };
    requests::save(
        &mut tx,
        &actor,
        scope,
        prescription,
        request,
        &fingerprint,
        serde_json::to_value(&input)?,
        &receipt,
    )
    .await?;
    if membership(&mut tx, &actor, scope, prescription, request, None).await? != retired as u64 {
        return Err(TreatmentCourseError::SnapshotChanged.into());
    }
    let mut update=QueryBuilder::<Postgres>::new("UPDATE medication_administrations m SET status='held',prescription_held=false,local_course_stop_id=");
    update
        .push_bind(stop.id)
        .push(",updated_at=clock_timestamp() WHERE m.facility_id=")
        .push_bind(actor.identity.facility_id)
        .push(" AND m.medication_course_id=")
        .push_bind(course)
        .push(" AND m.patient_id=")
        .push_bind(patient)
        .push(" AND m.admission_case_id=")
        .push_bind(admission)
        .push(" AND m.prescription_id=")
        .push_bind(prescription)
        .push(PENDING);
    if hms_observability::observe_db_query(
        "treatment_courses.stop.doses",
        update.build().execute(&mut *tx),
    )
    .await?
    .rows_affected()
        != retired as u64
    {
        return Err(TreatmentCourseError::SnapshotChanged.into());
    }
    hms_observability::observe_db_query("treatment_courses.stop.course",sqlx::query("UPDATE medication_courses SET status='stopped',updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(actor.identity.facility_id).bind(course).execute(&mut *tx)).await?;
    requests::audit(
        &mut tx,
        &actor,
        scope,
        request,
        "medication_course.stopped",
        retired,
    )
    .await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(receipt)
}

pub async fn create_treatment_supply_window(
    pool: &PgPool,
    mut actor: TreatmentActor,
    patient: Uuid,
    admission: Uuid,
    course: Uuid,
    mut input: CreateTreatmentSupplyWindowRequest,
) -> anyhow::Result<TreatmentCourseReceipt> {
    validate_tokens(
        input.client_request_id,
        &input.expected_source_token,
        &input.expected_course_token,
        &input.expected_context_token,
    )?;
    input.note = input
        .note
        .map(|n| n.trim().to_owned())
        .filter(|n| !n.is_empty());
    if input.note.as_ref().is_some_and(|n| n.len() > 1000) {
        return Err(TreatmentCourseError::InvalidInput.into());
    }
    let scope = Scope {
        patient,
        admission,
        course,
    };
    let fingerprint = hash(
        &json!({"operation":"supply_window_created","patient":patient,"admission":admission,"course":course,"input":input}),
    )?;
    let (mut tx, context, authority, prescription) =
        open(pool, &mut actor, scope, input.client_request_id).await?;
    if let Some(receipt) = original(
        &mut tx,
        &actor,
        scope,
        input.client_request_id,
        &fingerprint,
    )
    .await?
    {
        access::deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(receipt);
    }
    if !authority.manage {
        return Err(TreatmentCourseError::PermissionDenied.into());
    }
    let row = rows::course(&mut tx, &actor, scope, true).await?;
    validate_snapshots(
        &row,
        &context,
        &input.expected_source_token,
        &input.expected_course_token,
        &input.expected_context_token,
    )?;
    read::counts(&mut tx, &actor, scope, &row).await?;
    if !policy::active(&context) {
        return Err(TreatmentCourseError::ContextChanged.into());
    }
    if row.local_stop.is_some() || row.summary.status != TreatmentCourseStatus::Active {
        return Err(TreatmentCourseError::Terminal.into());
    }
    if row.summary.source_status != hms_domain::clinical::PrescriptionStatus::Active
        || !rows::source_matches(&row)
    {
        return Err(TreatmentCourseError::SourceChanged.into());
    }
    if row.summary.kind != TreatmentCourseKind::Scheduled {
        return Err(TreatmentCourseError::WindowUnsupported.into());
    }
    let policy = stock_basis::validate_policy(
        &mut tx,
        actor.identity.facility_id,
        row.summary.inventory_item_id,
        rows::scheduled_policy(&row)?,
    )
    .await?;
    let now = policy::now(&mut tx).await?;
    let boundary = row
        .summary
        .scheduled_through
        .ok_or(TreatmentCourseError::ReviewRequired)?;
    if boundary != input.expected_scheduled_through {
        return Err(TreatmentCourseError::SnapshotChanged.into());
    }
    if boundary < now {
        return Err(TreatmentCourseError::WindowElapsed.into());
    }
    let limits = schedule::constraints(&row, now)?.ok_or(TreatmentCourseError::WindowInvalid)?;
    if input.scheduled_before <= boundary || input.scheduled_before > limits.scheduled_before_max {
        return Err(TreatmentCourseError::WindowInvalid.into());
    }
    let times = schedule::dose_times(&row, input.scheduled_before)?;
    let overlap:bool=hms_observability::observe_db_query("treatment_courses.window.overlap",sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM medication_administrations WHERE facility_id=$1 AND medication_course_id=$2 AND scheduled_at >= $3) OR EXISTS(SELECT 1 FROM pharmacy_fulfillments WHERE facility_id=$1 AND medication_course_id=$2 AND source_kind='scheduled_window' AND coverage_end>$3)").bind(actor.identity.facility_id).bind(course).bind(boundary).fetch_one(&mut *tx)).await?;
    if overlap {
        return Err(TreatmentCourseError::ReviewRequired.into());
    }
    let fulfillment = Uuid::new_v4();
    let metadata = metadata(
        &mut tx,
        &actor,
        scope,
        prescription,
        input.client_request_id,
    )
    .await?;
    hms_observability::observe_db_query("treatment_courses.window.fulfillment",sqlx::query("INSERT INTO pharmacy_fulfillments(id,facility_id,patient_id,admission_case_id,prescription_id,medication_course_id,status,medication_name,dose,route,frequency,inventory_item_id,coverage_start,coverage_end,requested_dose_count,created_by_user_id,source_kind) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12,$13,$14,$15,'scheduled_window')")
        .bind(fulfillment).bind(actor.identity.facility_id).bind(patient).bind(admission).bind(prescription).bind(course).bind(&row.summary.medication_name).bind(&row.summary.dose).bind(&row.summary.route).bind(&row.summary.frequency).bind(row.summary.inventory_item_id).bind(boundary).bind(input.scheduled_before).bind(times.len() as i32).bind(actor.identity.user_id).execute(&mut *tx)).await?;
    let doses: Vec<TreatmentCreatedDose> = times
        .into_iter()
        .map(|(scheduled_at, dose_sequence)| TreatmentCreatedDose {
            id: Uuid::new_v4(),
            scheduled_at,
            dose_sequence,
            scheduled_stock_policy: policy.clone(),
        })
        .collect();
    let mut insert=QueryBuilder::<Postgres>::new("INSERT INTO medication_administrations(id,facility_id,patient_id,admission_case_id,prescription_id,medication_course_id,pharmacy_fulfillment_id,medication_name,dose,route,frequency,dose_sequence,scheduled_at,status,created_by_user_id,scheduled_stock_policy) ");
    insert.push_values(&doses, |mut b, dose| {
        b.push_bind(dose.id)
            .push_bind(actor.identity.facility_id)
            .push_bind(patient)
            .push_bind(admission)
            .push_bind(prescription)
            .push_bind(course)
            .push_bind(fulfillment)
            .push_bind(&row.summary.medication_name)
            .push_bind(&row.summary.dose)
            .push_bind(&row.summary.route)
            .push_bind(&row.summary.frequency)
            .push_bind(dose.dose_sequence)
            .push_bind(dose.scheduled_at)
            .push_bind("scheduled")
            .push_bind(actor.identity.user_id)
            .push_bind(sqlx::types::Json(&dose.scheduled_stock_policy));
    });
    hms_observability::observe_db_query(
        "treatment_courses.window.doses",
        insert.build().execute(&mut *tx),
    )
    .await?;
    let ids: Vec<Uuid> = doses.iter().map(|d| d.id).collect();
    hms_observability::observe_db_query("treatment_courses.window.canonical_membership",sqlx::query("INSERT INTO pharmacy_fulfillment_mar_entries(fulfillment_id,medication_administration_id) SELECT $1,unnest($2::uuid[])").bind(fulfillment).bind(&ids).execute(&mut *tx)).await?;
    let receipt = TreatmentCourseReceipt::SupplyWindowCreated {
        metadata,
        reviewed_input: input.clone(),
        result: TreatmentSupplyWindowEvidence {
            previous_scheduled_through: boundary,
            scheduled_through: input.scheduled_before,
            fulfillment_id: fulfillment,
            created_dose_count: doses.len() as i64,
            created_doses: doses,
            scheduled_stock_policy: policy,
        },
    };
    let request = Uuid::new_v4();
    requests::save(
        &mut tx,
        &actor,
        scope,
        prescription,
        request,
        &fingerprint,
        serde_json::to_value(&input)?,
        &receipt,
    )
    .await?;
    if membership(&mut tx, &actor, scope, prescription, request, Some(&ids)).await?
        != ids.len() as u64
    {
        return Err(TreatmentCourseError::SnapshotChanged.into());
    }
    hms_observability::observe_db_query("treatment_courses.window.boundary",sqlx::query("UPDATE medication_courses SET scheduled_through=$3,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(actor.identity.facility_id).bind(course).bind(input.scheduled_before).execute(&mut *tx)).await?;
    requests::audit(
        &mut tx,
        &actor,
        scope,
        request,
        "medication_course.supply_window_created",
        ids.len() as i64,
    )
    .await?;
    // A final audit or child wait must not publish a new window after its
    // reviewed start has elapsed. Exact saved replay returns before this path.
    if policy::now(&mut tx).await? > boundary {
        return Err(TreatmentCourseError::WindowElapsed.into());
    }
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(receipt)
}
