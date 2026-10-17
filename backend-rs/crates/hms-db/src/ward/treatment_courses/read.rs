use super::*;
use super::{policy, rows, schedule};

pub(super) async fn open<'a>(
    pool: &'a PgPool,
    actor: &mut TreatmentActor,
    scope: Scope,
) -> anyhow::Result<(
    Tx<'a>,
    policy::ContextRow,
    policy::Authority,
    rows::CourseRow,
)> {
    let mut tx = pool.begin().await?;
    rows::source_lock(&mut tx, actor, scope, false).await?;
    let authority = policy::identity(&mut tx, actor).await?;
    let context = policy::context(&mut tx, actor, scope.patient, scope.admission).await?;
    policy::relationship(&mut tx, actor, &context).await?;
    let row = rows::course(&mut tx, actor, scope, false).await?;
    Ok((tx, context, authority, row))
}
pub async fn treatment_courses_context(
    pool: &PgPool,
    mut actor: TreatmentActor,
    patient: Uuid,
    admission: Uuid,
) -> anyhow::Result<TreatmentCoursesContext> {
    let mut tx = pool.begin().await?;
    let context = policy::context(&mut tx, &actor, patient, admission).await?;
    let authority = policy::identity(&mut tx, &mut actor).await?;
    policy::relationship(&mut tx, &actor, &context).await?;
    let count:i64=hms_observability::observe_db_query("treatment_courses.context.count",sqlx::query_scalar("SELECT count(*) FROM medication_courses c JOIN prescriptions p ON p.id=c.prescription_id AND p.facility_id=c.facility_id AND p.patient_id=c.patient_id WHERE c.facility_id=$1 AND c.patient_id=$2 AND c.admission_case_id=$3").bind(actor.identity.facility_id).bind(patient).bind(admission).fetch_one(&mut *tx)).await?;
    let reason = if !authority.manage {
        Some(TreatmentUnavailableReason::PermissionDenied)
    } else if !policy::active(&context) {
        Some(TreatmentUnavailableReason::AdmissionInactive)
    } else {
        None
    };
    let result = TreatmentCoursesContext {
        patient_id: patient,
        admission_case_id: admission,
        admission_status: codec::decode(&context.admission_status)?,
        current_ward_id: context.current_ward_id,
        current_ward_name: context.current_ward_name.clone(),
        context_token: hash(&context.snapshot.0)?,
        can_view: true,
        can_manage_courses: reason.is_none(),
        management_unavailable_reason: reason,
        generated_course_count: count,
        coverage: TreatmentCoverage::GeneratedCoursesOnly,
    };
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn list_treatment_courses(
    pool: &PgPool,
    mut actor: TreatmentActor,
    patient: Uuid,
    admission: Uuid,
    query: TreatmentCourseListQuery,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<TreatmentCourseListItem>> {
    let mut tx = pool.begin().await?;
    let context = policy::context(&mut tx, &actor, patient, admission).await?;
    policy::identity(&mut tx, &mut actor).await?;
    policy::relationship(&mut tx, &actor, &context).await?;
    // Only lean headers are materialized for a page, never source documentation.
    let mut q = QueryBuilder::<Postgres>::new(
        r#"SELECT jsonb_build_object('id',c.id,'patient_id',c.patient_id,'admission_case_id',c.admission_case_id,'prescription_id',c.prescription_id,
'kind',CASE WHEN lower(trim(c.frequency))='prn' THEN 'prn' WHEN lower(trim(c.frequency)) IN ('once','stat') THEN 'once' WHEN c.interval_minutes>0 THEN 'scheduled' ELSE 'unrecognized' END,
'status',CASE WHEN s.id IS NOT NULL THEN 'stopped' ELSE c.status END,'source_status',p.status,'medication_name',c.medication_name,'dose',c.dose,'route',c.route,'frequency',c.frequency,'inventory_item_id',c.inventory_item_id,'first_dose_at',c.first_dose_at,'generation_window_start',c.generation_window_start,'generation_window_end',c.generation_window_end,'scheduled_through',c.scheduled_through,'created_at',c.created_at,'has_local_stop',s.id IS NOT NULL,'has_reviewed_stock_policy',c.prescription_scheduled_stock_policy IS NOT NULL OR c.prescription_prn_policy IS NOT NULL)
FROM medication_courses c JOIN prescriptions p ON p.id=c.prescription_id AND p.facility_id=c.facility_id AND p.patient_id=c.patient_id
LEFT JOIN medication_course_stops s ON s.facility_id=c.facility_id AND s.medication_course_id=c.id WHERE c.facility_id="#,
    );
    q.push_bind(actor.identity.facility_id)
        .push(" AND c.patient_id=")
        .push_bind(patient)
        .push(" AND c.admission_case_id=")
        .push_bind(admission);
    if let Some(status) = query.status {
        q.push(" AND (CASE WHEN s.id IS NOT NULL THEN 'stopped' ELSE c.status END)=")
            .push_bind(codec::encode(status)?);
    }
    if let Some(status) = query.source_status {
        q.push(" AND p.status=").push_bind(codec::encode(status)?);
    }
    if let Some(kind) = query.kind {
        q.push(" AND (CASE WHEN lower(trim(c.frequency))='prn' THEN 'prn' WHEN lower(trim(c.frequency)) IN ('once','stat') THEN 'once' WHEN c.interval_minutes>0 THEN 'scheduled' ELSE 'unrecognized' END)=").push_bind(codec::encode(kind)?);
    }
    if let Some(c) = cursor {
        q.push(" AND (c.created_at,c.id)<(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY c.created_at DESC,c.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows: Vec<sqlx::types::Json<TreatmentCourseListItem>> =
        hms_observability::observe_db_query(
            "treatment_courses.list",
            q.build_query_scalar().fetch_all(&mut *tx),
        )
        .await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

#[derive(FromRow)]
struct CountsRow {
    counts: sqlx::types::Json<TreatmentCourseCounts>,
    physical_total: String,
    physical_unit: Option<String>,
    physical_units: i64,
}
pub(super) async fn counts(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    scope: Scope,
    row: &rows::CourseRow,
) -> anyhow::Result<TreatmentCourseCounts> {
    // The exact authorized parent is already locked. This course-ID-only probe
    // returns no child data; imported foreign-scope evidence must make a complete
    // review fail rather than silently disappear from the shaped aggregates.
    let invalid:bool=hms_observability::observe_db_query("treatment_courses.evidence.scope",sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM medication_administrations m WHERE m.medication_course_id=$2 AND (m.facility_id IS DISTINCT FROM $1 OR m.patient_id IS DISTINCT FROM $3 OR m.admission_case_id IS DISTINCT FROM $4 OR m.prescription_id IS DISTINCT FROM $5)) OR EXISTS(SELECT 1 FROM pharmacy_fulfillments f WHERE f.medication_course_id=$2 AND (f.facility_id IS DISTINCT FROM $1 OR f.patient_id IS DISTINCT FROM $3 OR f.admission_case_id IS DISTINCT FROM $4 OR f.prescription_id IS DISTINCT FROM $5))")
        .bind(actor.identity.facility_id).bind(scope.course).bind(scope.patient).bind(scope.admission).bind(row.summary.prescription_id).fetch_one(&mut **tx)).await?;
    if invalid {
        return Err(TreatmentCourseError::ReviewRequired.into());
    }
    let saved:CountsRow=hms_observability::observe_db_query("treatment_courses.counts",sqlx::query_as(r#"SELECT jsonb_build_object(
'generated_scheduled_doses',count(*) FILTER(WHERE lower(trim(COALESCE(frequency,'')))<>'prn'),
'requested_prn_doses',count(*) FILTER(WHERE prn_request_id IS NOT NULL),
'supplied_doses',count(*) FILTER(WHERE is_dispensed),'given_doses',count(*) FILTER(WHERE status='administered'),
'awaiting_supply_doses',count(*) FILTER(WHERE status='scheduled' AND NOT is_dispensed),'supplied_pending_doses',count(*) FILTER(WHERE status='scheduled' AND is_dispensed),
'missed_doses',count(*) FILTER(WHERE status='missed'),'refused_doses',count(*) FILTER(WHERE status='refused'),'held_doses',count(*) FILTER(WHERE status='held'),
'explicit_non_given_doses',count(*) FILTER(WHERE status IN ('missed','refused','held') AND outcome_recorded_at IS NOT NULL),
'unrecorded_held_doses',count(*) FILTER(WHERE status='held' AND outcome_recorded_at IS NULL),
'issued_stock_quantity',null,'issued_stock_unit',null,'issued_stock_unrecorded_doses',count(*) FILTER(WHERE is_dispensed AND (dispensed_stock_quantity IS NULL OR dispensed_stock_unit IS NULL)),
'stock_total_unavailable_reason',null,'days_of_supply',null) AS counts,
COALESCE(sum(dispensed_stock_quantity::numeric) FILTER(WHERE is_dispensed),0)::text AS physical_total,
min(dispensed_stock_unit) FILTER(WHERE is_dispensed) AS physical_unit,
count(DISTINCT dispensed_stock_unit) FILTER(WHERE is_dispensed) AS physical_units
FROM medication_administrations WHERE facility_id=$1 AND medication_course_id=$2 AND patient_id=$3 AND admission_case_id=$4 AND prescription_id=$5"#)
        .bind(actor.identity.facility_id).bind(scope.course).bind(scope.patient).bind(scope.admission).bind(row.summary.prescription_id).fetch_one(&mut **tx)).await?;
    let mut result = saved.counts.0;
    let policy_unit = rows::scheduled_policy(row)?
        .map(|p| p.stock_unit)
        .or(rows::prn_policy(row)?.map(|p| p.stock_unit));
    if result.issued_stock_unrecorded_doses > 0
        || result.supplied_doses == 0 && policy_unit.is_none()
    {
        result.stock_total_unavailable_reason =
            Some(TreatmentStockTotalUnavailableReason::MissingEvidence);
    } else if saved.physical_units > 1 {
        result.stock_total_unavailable_reason =
            Some(TreatmentStockTotalUnavailableReason::MixedUnits);
    } else if let Ok(total) = saved.physical_total.parse::<i64>() {
        if (0..=9_007_199_254_740_991).contains(&total) {
            result.issued_stock_quantity = Some(total);
            result.issued_stock_unit = saved.physical_unit.or(policy_unit);
        } else {
            result.stock_total_unavailable_reason =
                Some(TreatmentStockTotalUnavailableReason::QuantityOverflow);
        }
    } else {
        result.stock_total_unavailable_reason =
            Some(TreatmentStockTotalUnavailableReason::QuantityOverflow);
    }
    Ok(result)
}
pub(super) fn stop_reason(
    row: &rows::CourseRow,
    context: &policy::ContextRow,
    authority: policy::Authority,
) -> Option<TreatmentUnavailableReason> {
    if !authority.manage {
        Some(TreatmentUnavailableReason::PermissionDenied)
    } else if !policy::active(context) {
        Some(TreatmentUnavailableReason::AdmissionInactive)
    } else if row.local_stop.is_some()
        || !matches!(
            row.summary.status,
            TreatmentCourseStatus::Active | TreatmentCourseStatus::OnHold
        )
    {
        Some(TreatmentUnavailableReason::CourseTerminal)
    } else {
        None
    }
}
pub(super) fn window_reason(
    row: &rows::CourseRow,
    context: &policy::ContextRow,
    authority: policy::Authority,
    now: DateTime<Utc>,
) -> anyhow::Result<Option<TreatmentUnavailableReason>> {
    if let Some(reason) = stop_reason(row, context, authority) {
        return Ok(Some(reason));
    }
    if row.summary.source_status != hms_domain::clinical::PrescriptionStatus::Active
        || row.summary.status != TreatmentCourseStatus::Active
    {
        return Ok(Some(TreatmentUnavailableReason::SourceNotActive));
    }
    if !rows::source_matches(row) {
        return Ok(Some(TreatmentUnavailableReason::SourceChanged));
    }
    if row.summary.kind != TreatmentCourseKind::Scheduled {
        return Ok(Some(TreatmentUnavailableReason::UnsupportedSchedule));
    }
    let Some(policy) = rows::scheduled_policy(row)? else {
        return Ok(Some(TreatmentUnavailableReason::StockPolicyReviewRequired));
    };
    if row.stock_actionable != Some(true) {
        return Ok(Some(TreatmentUnavailableReason::StockItemNotActionable));
    }
    if row.stock_item_current_unit.as_ref() != Some(&policy.stock_unit) {
        return Ok(Some(TreatmentUnavailableReason::StockUnitChanged));
    }
    let Some(end) = row.summary.scheduled_through else {
        return Ok(Some(
            TreatmentUnavailableReason::GenerationBoundaryUnavailable,
        ));
    };
    if end < now {
        return Ok(Some(TreatmentUnavailableReason::WindowElapsed));
    }
    if crate::pharmacy::reviewed_interval_minutes(&row.summary.frequency)
        .ok()
        .flatten()
        .map(i64::from)
        != row.course_snapshot["interval_minutes"].as_i64()
    {
        return Ok(Some(TreatmentUnavailableReason::UnsupportedSchedule));
    }
    if schedule::constraints(row, now)?.is_none() {
        return Ok(Some(TreatmentUnavailableReason::UnsupportedSchedule));
    }
    Ok(None)
}
pub async fn get_treatment_course(
    pool: &PgPool,
    mut actor: TreatmentActor,
    patient: Uuid,
    admission: Uuid,
    course: Uuid,
) -> anyhow::Result<TreatmentCourseDetail> {
    let scope = Scope {
        patient,
        admission,
        course,
    };
    let (mut tx, context, authority, row) = open(pool, &mut actor, scope).await?;
    let counts = counts(&mut tx, &actor, scope, &row).await?;
    let now = policy::now(&mut tx).await?;
    let stop = stop_reason(&row, &context, authority);
    let window = window_reason(&row, &context, authority, now)?;
    let constraints = if window.is_none() {
        schedule::constraints(&row, now)?
    } else {
        None
    };
    let result = TreatmentCourseDetail {
        summary: row.summary.0.clone(),
        source_token: hash(&row.source_snapshot.0)?,
        course_token: hash(&row.course_snapshot.0)?,
        context_token: hash(&context.snapshot.0)?,
        source_instructions: row.source_snapshot["instructions"]
            .as_str()
            .unwrap_or("")
            .to_owned(),
        source_reason: row.source_snapshot["reason"]
            .as_str()
            .unwrap_or("")
            .to_owned(),
        source_matches_course: rows::source_matches(&row),
        scheduled_stock_policy: rows::scheduled_policy(&row)?,
        prn_policy: rows::prn_policy(&row)?,
        stock_item_name: row.stock_item_name,
        stock_item_code: row.stock_item_code,
        stock_item_current_unit: row.stock_item_current_unit,
        counts,
        local_stop: row.local_stop.map(|r| r.0),
        can_stop_course: stop.is_none(),
        can_request_schedule_window: window.is_none(),
        stop_unavailable_reason: stop,
        window_unavailable_reason: window,
        supply_window_constraints: constraints,
    };
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
