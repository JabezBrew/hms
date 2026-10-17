use super::*;
use super::{read, requests};

pub async fn list_treatment_course_doses(
    pool: &PgPool,
    mut actor: TreatmentActor,
    patient: Uuid,
    admission: Uuid,
    course: Uuid,
    query: TreatmentCourseDoseQuery,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<TreatmentCourseDose>> {
    let scope = Scope {
        patient,
        admission,
        course,
    };
    let (mut tx, _, _, parent) = read::open(pool, &mut actor, scope).await?;
    if query
        .scheduled_from
        .zip(query.scheduled_before)
        .is_some_and(|(from, before)| from >= before)
    {
        return Err(TreatmentCourseError::InvalidInput.into());
    }
    let request = if let Some(key) = query.request_id {
        Some(
            requests::load(&mut tx, &actor, key)
                .await?
                .filter(|saved| requests::scoped(saved, scope))
                .ok_or(TreatmentCourseError::NotFound)?
                .id,
        )
    } else {
        None
    };
    let mut q = QueryBuilder::<Postgres>::new(
        r#"SELECT jsonb_build_object('id',m.id,'scheduled_at',m.scheduled_at,'dose_sequence',m.dose_sequence,'status',m.status,'is_dispensed',m.is_dispensed,'prescription_held',m.prescription_held,'pharmacy_fulfillment_id',m.pharmacy_fulfillment_id,'prn_request_id',m.prn_request_id,'prn_indication',m.prn_indication,'dispensed_stock_quantity',m.dispensed_stock_quantity,'dispensed_stock_unit',m.dispensed_stock_unit,'dispensed_at',m.dispensed_at,'administered_at',m.administered_at,'reason_not_given',m.reason_not_given,'administration_notes',m.administration_notes,'outcome_recorded_at',m.outcome_recorded_at,'outcome_recorded_by_user_id',m.outcome_recorded_by_user_id,'outcome_recorded_by_display_name',u.display_name,'local_stop_id',m.local_course_stop_id,'original_request_membership',membership.original_membership)
FROM medication_administrations m LEFT JOIN users u ON u.id=m.outcome_recorded_by_user_id AND u.facility_id=m.facility_id
LEFT JOIN treatment_course_request_doses membership ON membership.medication_administration_id=m.id AND membership.facility_id=m.facility_id AND membership.patient_id=m.patient_id AND membership.admission_case_id=m.admission_case_id AND membership.prescription_id=m.prescription_id AND membership.medication_course_id=m.medication_course_id AND membership.request_id="#,
    );
    q.push_bind(request)
        .push(" WHERE m.facility_id=")
        .push_bind(actor.identity.facility_id)
        .push(" AND m.medication_course_id=")
        .push_bind(course)
        .push(" AND m.patient_id=")
        .push_bind(patient)
        .push(" AND m.admission_case_id=")
        .push_bind(admission)
        .push(" AND m.prescription_id=")
        .push_bind(parent.summary.prescription_id);
    if request.is_some() {
        q.push(" AND membership.request_id IS NOT NULL");
    }
    if let Some(status) = query.status {
        q.push(" AND m.status=").push_bind(codec::encode(status)?);
    }
    if let Some(supplied) = query.is_dispensed {
        q.push(" AND m.is_dispensed=").push_bind(supplied);
    }
    if let Some(from) = query.scheduled_from {
        q.push(" AND m.scheduled_at>=").push_bind(from);
    }
    if let Some(before) = query.scheduled_before {
        q.push(" AND m.scheduled_at<").push_bind(before);
    }
    if let Some(c) = cursor {
        q.push(" AND (m.scheduled_at,m.id)>(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY m.scheduled_at,m.id LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows: Vec<sqlx::types::Json<TreatmentCourseDose>> = hms_observability::observe_db_query(
        "treatment_courses.doses",
        q.build_query_scalar().fetch_all(&mut *tx),
    )
    .await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}
pub async fn list_treatment_course_supply(
    pool: &PgPool,
    mut actor: TreatmentActor,
    patient: Uuid,
    admission: Uuid,
    course: Uuid,
    query: TreatmentCourseSupplyQuery,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<TreatmentCourseSupplyWindow>> {
    let scope = Scope {
        patient,
        admission,
        course,
    };
    let (mut tx, _, _, parent) = read::open(pool, &mut actor, scope).await?;
    let mut q = QueryBuilder::<Postgres>::new(
        r#"SELECT jsonb_build_object('id',f.id,'kind',f.source_kind,'status',f.status,'coverage_start',f.coverage_start,'coverage_end',f.coverage_end,'requested_dose_count',f.requested_dose_count,'dispensed_dose_count',f.dispensed_dose_count,'remaining_scheduled_unsupplied_dose_count',(SELECT count(*) FROM medication_administrations m WHERE m.facility_id=f.facility_id AND m.patient_id=f.patient_id AND m.admission_case_id=f.admission_case_id AND m.prescription_id=f.prescription_id AND m.medication_course_id=f.medication_course_id AND m.pharmacy_fulfillment_id=f.id AND m.status='scheduled' AND NOT m.is_dispensed),'created_at',f.created_at,'dispensed_at',f.dispensed_at,'inventory_item_id',f.inventory_item_id,'dispensing_location_id',f.dispensing_location_id)
FROM pharmacy_fulfillments f WHERE f.facility_id="#,
    );
    q.push_bind(actor.identity.facility_id)
        .push(" AND f.medication_course_id=")
        .push_bind(course)
        .push(" AND f.patient_id=")
        .push_bind(patient)
        .push(" AND f.admission_case_id=")
        .push_bind(admission)
        .push(" AND f.prescription_id=")
        .push_bind(parent.summary.prescription_id);
    if let Some(status) = query.status {
        q.push(" AND f.status=").push_bind(codec::encode(status)?);
    }
    if let Some(kind) = query.kind {
        q.push(" AND f.source_kind=")
            .push_bind(codec::encode(kind)?);
    }
    if let Some(c) = cursor {
        q.push(" AND (f.created_at,f.id)<(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY f.created_at DESC,f.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows: Vec<sqlx::types::Json<TreatmentCourseSupplyWindow>> =
        hms_observability::observe_db_query(
            "treatment_courses.supply",
            q.build_query_scalar().fetch_all(&mut *tx),
        )
        .await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}
