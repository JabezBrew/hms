use super::*;
#[derive(Clone, Debug, FromRow)]
pub(super) struct CourseRow {
    pub summary: sqlx::types::Json<TreatmentCourseListItem>,
    pub source_snapshot: sqlx::types::Json<Value>,
    pub course_snapshot: sqlx::types::Json<Value>,
    pub local_stop: Option<sqlx::types::Json<TreatmentCourseStopEvidence>>,
    pub stock_item_name: Option<String>,
    pub stock_item_code: Option<String>,
    pub stock_item_current_unit: Option<String>,
    pub stock_actionable: Option<bool>,
}

pub(super) const COURSE_SELECT: &str = r#"
SELECT jsonb_build_object(
'id',c.id,'patient_id',c.patient_id,'admission_case_id',c.admission_case_id,'prescription_id',c.prescription_id,
'kind',CASE WHEN lower(trim(c.frequency))='prn' THEN 'prn' WHEN lower(trim(c.frequency)) IN ('once','stat') THEN 'once' WHEN c.interval_minutes>0 THEN 'scheduled' ELSE 'unrecognized' END,
'status',CASE WHEN local_stop.id IS NOT NULL THEN 'stopped' ELSE c.status END,'source_status',p.status,
'medication_name',c.medication_name,'dose',c.dose,'route',c.route,'frequency',c.frequency,'inventory_item_id',c.inventory_item_id,
'first_dose_at',c.first_dose_at,'generation_window_start',c.generation_window_start,'generation_window_end',c.generation_window_end,
'scheduled_through',c.scheduled_through,'created_at',c.created_at,'has_local_stop',local_stop.id IS NOT NULL,
'has_reviewed_stock_policy',c.prescription_scheduled_stock_policy IS NOT NULL OR c.prescription_prn_policy IS NOT NULL) AS summary,
jsonb_build_object('id',p.id,'patient_id',p.patient_id,'status',p.status,'medication_name',p.medication_name,'dose',p.dose,'route',p.route,'frequency',p.frequency,
'inventory_item_id',p.inventory_item_id,'start_date',p.start_date,'duration_days',p.duration_days,'first_dose_at',p.first_dose_at,
'prn_policy',p.prn_policy,'scheduled_stock_policy',p.scheduled_stock_policy,'prn_safety_group_id',p.prn_safety_group_id,
'encounter_id',p.encounter_id,'visit_id',p.visit_id,'discharge_case_id',p.discharge_case_id,'instructions',p.instructions,'reason',p.reason,'updated_at',p.updated_at) AS source_snapshot,
jsonb_build_object('id',c.id,'facility_id',c.facility_id,'patient_id',c.patient_id,'admission_case_id',c.admission_case_id,'prescription_id',c.prescription_id,
'medication_name',c.medication_name,'dose',c.dose,'route',c.route,'frequency',c.frequency,'inventory_item_id',c.inventory_item_id,
'first_dose_at',c.first_dose_at,'interval_minutes',c.interval_minutes,'generation_window_start',c.generation_window_start,'generation_window_end',c.generation_window_end,
'prescription_start_date',c.prescription_start_date,'prescription_duration_days',c.prescription_duration_days,'prescription_first_dose_at',c.prescription_first_dose_at,
'prescription_prn_policy',c.prescription_prn_policy,'prescription_scheduled_stock_policy',c.prescription_scheduled_stock_policy,
'status',c.status,'scheduled_through',c.scheduled_through,'updated_at',c.updated_at,'local_stop_id',local_stop.id) AS course_snapshot,
local_stop.evidence AS local_stop,stock.name AS stock_item_name,stock.code AS stock_item_code,stock.unit AS stock_item_current_unit,
(stock.is_active AND NOT stock.controlled AND stock.item_type='medication') AS stock_actionable
FROM medication_courses c
JOIN prescriptions p ON p.id=c.prescription_id AND p.facility_id=c.facility_id AND p.patient_id=c.patient_id
JOIN admission_cases a ON a.id=c.admission_case_id AND a.facility_id=c.facility_id AND a.patient_id=c.patient_id
JOIN patients patient ON patient.id=c.patient_id AND patient.facility_id=c.facility_id
LEFT JOIN medication_course_stops local_stop ON local_stop.facility_id=c.facility_id AND local_stop.medication_course_id=c.id
LEFT JOIN inventory_items stock ON stock.id=c.inventory_item_id AND stock.facility_id=c.facility_id
"#;

pub(super) fn source_matches(row: &CourseRow) -> bool {
    let c = &row.course_snapshot.0;
    let p = &row.source_snapshot.0;
    [
        "medication_name",
        "dose",
        "route",
        "frequency",
        "inventory_item_id",
    ]
    .iter()
    .all(|field| c[*field] == p[*field])
        && [
            ("prescription_start_date", "start_date"),
            ("prescription_duration_days", "duration_days"),
            ("prescription_first_dose_at", "first_dose_at"),
            ("prescription_prn_policy", "prn_policy"),
            (
                "prescription_scheduled_stock_policy",
                "scheduled_stock_policy",
            ),
        ]
        .iter()
        .all(|(captured, current)| c[*captured] == p[*current])
}
pub(super) fn scheduled_policy(
    row: &CourseRow,
) -> anyhow::Result<Option<hms_domain::clinical::ScheduledStockPolicy>> {
    let policy = &row.course_snapshot["prescription_scheduled_stock_policy"];
    if policy.is_null() {
        return Ok(None);
    }
    serde_json::from_value(policy.clone())
        .map(Some)
        .map_err(|_| TreatmentCourseError::ReviewRequired.into())
}
pub(super) fn prn_policy(
    row: &CourseRow,
) -> anyhow::Result<Option<hms_domain::clinical::PrnPolicy>> {
    let policy = &row.course_snapshot["prescription_prn_policy"];
    if policy.is_null() {
        return Ok(None);
    }
    serde_json::from_value(policy.clone())
        .map(Some)
        .map_err(|_| TreatmentCourseError::ReviewRequired.into())
}
pub(super) async fn source_lock(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    scope: Scope,
    write: bool,
) -> anyhow::Result<Uuid> {
    let sql = if write {
        "SELECT p.id FROM medication_courses c JOIN prescriptions p ON p.id=c.prescription_id AND p.facility_id=c.facility_id AND p.patient_id=c.patient_id WHERE c.facility_id=$1 AND c.id=$2 AND c.patient_id=$3 AND c.admission_case_id=$4 FOR UPDATE OF p"
    } else {
        "SELECT p.id FROM medication_courses c JOIN prescriptions p ON p.id=c.prescription_id AND p.facility_id=c.facility_id AND p.patient_id=c.patient_id WHERE c.facility_id=$1 AND c.id=$2 AND c.patient_id=$3 AND c.admission_case_id=$4 FOR SHARE OF p"
    };
    hms_observability::observe_db_query(
        "treatment_courses.source",
        sqlx::query_scalar(sql)
            .bind(actor.identity.facility_id)
            .bind(scope.course)
            .bind(scope.patient)
            .bind(scope.admission)
            .fetch_optional(&mut **tx),
    )
    .await?
    .ok_or_else(|| TreatmentCourseError::NotFound.into())
}
pub(super) async fn course(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    scope: Scope,
    write: bool,
) -> anyhow::Result<CourseRow> {
    let sql=format!("{COURSE_SELECT} WHERE c.facility_id=$1 AND c.id=$2 AND c.patient_id=$3 AND c.admission_case_id=$4 {}",if write {"FOR UPDATE OF c"} else {"FOR SHARE OF c"});
    hms_observability::observe_db_query(
        "treatment_courses.detail",
        sqlx::query_as(&sql)
            .bind(actor.identity.facility_id)
            .bind(scope.course)
            .bind(scope.patient)
            .bind(scope.admission)
            .fetch_optional(&mut **tx),
    )
    .await?
    .ok_or_else(|| TreatmentCourseError::NotFound.into())
}
