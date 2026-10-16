//! Source-linked PRN requests. All writers serialize on the prescription first.
use super::WardCursor;
use crate::PgPool;
use chrono::{DateTime, Duration, Utc};
use hms_domain::clinical::{PrescriptionListItem, PrescriptionStatus, PrnPolicy};
use hms_domain::ward::{PrnDoseRequestResult, PrnOrderListItem};
use sqlx::{types::Json, FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PrnError {
    InvalidIndication,
    Unconfigured,
    NotActionable,
    StockChanged,
    PendingDose,
    Interval,
    DailyLimit,
    RequestConflict,
}
impl PrnError {
    pub fn message(self) -> &'static str {
        match self {
        Self::InvalidIndication => "Record why this dose is needed, using at most 500 characters.",
        Self::Unconfigured => "This as-needed order has no explicit prescribing limits. Ask the prescriber to replace it with a configured order.",
        Self::NotActionable => "The prescription, admission or medication course is no longer active. Reload and review the order.",
        Self::StockChanged => "The linked stock item or its unit has changed. Ask the prescriber to review this order.",
        Self::PendingDose => "A dose from this prescription is already awaiting supply or an outcome. Review that dose first.",
        Self::Interval => "The minimum interval since the last administered dose has not elapsed.",
        Self::DailyLimit => "The prescribed maximum number of doses in the preceding 24 hours has been reached.",
        Self::RequestConflict => "This request reference belongs to a different dose request. Reload before continuing.",
    }
    }
}
impl std::fmt::Display for PrnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}
impl std::error::Error for PrnError {}

#[derive(Clone, Debug)]
pub struct RequestPrnDose {
    pub facility_id: Uuid,
    pub prescription_id: Uuid,
    pub admission_case_id: Uuid,
    pub client_request_id: Uuid,
    pub indication: String,
    pub actor_user_id: Uuid,
    pub request_id: Option<String>,
}

fn time_window(source: &PrescriptionListItem) -> Option<(DateTime<Utc>, Option<DateTime<Utc>>)> {
    let date_start = source
        .start_date
        .map(|date| date.and_hms_opt(0, 0, 0).unwrap().and_utc());
    if source
        .first_dose_at
        .zip(date_start)
        .is_some_and(|(first, date)| first < date)
    {
        return None;
    }
    let start = source
        .first_dose_at
        .or_else(|| {
            source
                .start_date
                .map(|date| date.and_hms_opt(0, 0, 0).unwrap().and_utc())
        })
        .unwrap_or(source.prescribed_at);
    let end = match source.duration_days {
        Some(days) => Some(start.checked_add_signed(Duration::days(i64::from(days)))?),
        None => None,
    };
    Some((start, end))
}

/// Caller holds the source prescription lock. No transaction crosses external I/O.
pub(crate) async fn validate_prn_source(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    admission: Uuid,
    source: &PrescriptionListItem,
    _at: DateTime<Utc>,
) -> anyhow::Result<PrnPolicy> {
    let policy = source.prn_policy.clone().ok_or(PrnError::Unconfigured)?;
    if source.status != PrescriptionStatus::Active
        || !source.frequency.trim().eq_ignore_ascii_case("prn")
        || policy.as_request().normalized().is_err()
    {
        return Err(PrnError::NotActionable.into());
    }
    let admitted = sqlx::query_scalar::<_, Uuid>("SELECT patient_id FROM admission_cases WHERE facility_id=$1 AND id=$2 AND status IN ('admitted','discharge_pending') FOR SHARE")
        .bind(facility).bind(admission).fetch_optional(&mut **tx).await?;
    if admitted != Some(source.patient_id) {
        return Err(PrnError::NotActionable.into());
    }
    let unit = sqlx::query_scalar::<_, String>("SELECT unit FROM inventory_items WHERE facility_id=$1 AND id=$2 AND is_active AND NOT controlled AND item_type='medication' FOR SHARE")
        .bind(facility).bind(source.inventory_item_id).fetch_optional(&mut **tx).await?;
    if unit.as_deref() != Some(policy.stock_unit.as_str()) {
        return Err(PrnError::StockChanged.into());
    }
    let at: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut **tx)
        .await?;
    let Some((start, end)) = time_window(source) else {
        return Err(PrnError::NotActionable.into());
    };
    if at < start || end.is_some_and(|end| at >= end) {
        return Err(PrnError::NotActionable.into());
    }
    Ok(policy)
}

pub(crate) async fn enforce_prn_limits(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    safety_group: Uuid,
    policy: &PrnPolicy,
    at: DateTime<Utc>,
) -> anyhow::Result<()> {
    let (count,last): (i64,Option<DateTime<Utc>>) = sqlx::query_as("SELECT count(*),max(administered_at) FROM medication_administrations WHERE facility_id=$1 AND prn_safety_group_id=$2 AND status='administered' AND administered_at > $3")
        .bind(facility).bind(safety_group).bind(at-Duration::hours(24)).fetch_one(&mut **tx).await?;
    if last
        .is_some_and(|last| at < last + Duration::hours(i64::from(policy.minimum_interval_hours)))
    {
        return Err(PrnError::Interval.into());
    }
    if count >= i64::from(policy.maximum_doses_per_24_hours) {
        return Err(PrnError::DailyLimit.into());
    }
    Ok(())
}

pub async fn request_prn_dose(
    pool: &PgPool,
    command: RequestPrnDose,
) -> anyhow::Result<PrnDoseRequestResult> {
    let indication = command.indication.trim();
    if indication.is_empty() || indication.chars().count() > 500 {
        return Err(PrnError::InvalidIndication.into());
    }
    let mut tx = pool.begin().await?;
    let source =
        crate::clinical::lock_prescription(&mut tx, command.facility_id, command.prescription_id)
            .await?
            .ok_or(PrnError::NotActionable)?;
    let safety_group = crate::clinical::prescription_courses::lock_prn_safety_group(
        &mut tx,
        command.facility_id,
        source.id,
    )
    .await?
    .ok_or(PrnError::Unconfigured)?;
    // Exact replay returns the original record even if it has since been supplied,
    // recorded or stopped. It never creates a new reservation or rewrites evidence.
    let replay: Option<(Uuid,Uuid,Uuid,Uuid,Uuid,String)> = sqlx::query_as("SELECT id,prescription_id,admission_case_id,pharmacy_fulfillment_id,prn_requested_by_user_id,prn_indication FROM medication_administrations WHERE facility_id=$1 AND prn_request_id=$2")
        .bind(command.facility_id).bind(command.client_request_id).fetch_optional(&mut *tx).await?;
    if let Some((id, prescription, admission, fulfillment, actor, reason)) = replay {
        if prescription != source.id
            || admission != command.admission_case_id
            || actor != command.actor_user_id
            || reason != indication
        {
            return Err(PrnError::RequestConflict.into());
        }
        tx.commit().await?;
        return Ok(PrnDoseRequestResult {
            prescription_id: source.id,
            admission_case_id: admission,
            medication_administration_id: id,
            pharmacy_fulfillment_id: fulfillment,
            client_request_id: command.client_request_id,
            created: false,
        });
    }
    let at: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await?;
    let policy = validate_prn_source(
        &mut tx,
        command.facility_id,
        command.admission_case_id,
        &source,
        at,
    )
    .await?;
    let at: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await?;
    enforce_prn_limits(&mut tx, command.facility_id, safety_group, &policy, at).await?;
    let pending: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM medication_administrations WHERE facility_id=$1 AND prn_safety_group_id=$2 AND status='scheduled')")
        .bind(command.facility_id).bind(safety_group).fetch_one(&mut *tx).await?;
    if pending {
        return Err(PrnError::PendingDose.into());
    }
    let (start, end) = time_window(&source).ok_or(PrnError::NotActionable)?;
    let course_id=sqlx::query_scalar::<_,Uuid>(r#"
        INSERT INTO medication_courses (id,facility_id,patient_id,admission_case_id,prescription_id,medication_name,dose,route,frequency,inventory_item_id,first_dose_at,generation_window_start,generation_window_end,status,created_by_user_id,prescription_start_date,prescription_duration_days,prescription_first_dose_at,prescription_prn_policy)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,'active',$13,$14,$15,$16,$17)
        ON CONFLICT(facility_id,prescription_id,admission_case_id) DO UPDATE SET id=medication_courses.id
        RETURNING id"#)
        .bind(Uuid::new_v4()).bind(command.facility_id).bind(source.patient_id).bind(command.admission_case_id).bind(source.id)
        .bind(&source.medication_name).bind(&source.dose).bind(&source.route).bind(&source.frequency).bind(source.inventory_item_id)
        .bind(start).bind(end.or_else(||start.checked_add_signed(Duration::days(31))).ok_or(PrnError::NotActionable)?).bind(command.actor_user_id)
        .bind(source.start_date).bind(source.duration_days).bind(source.first_dose_at).bind(Json(&policy)).fetch_one(&mut *tx).await?;
    let valid: bool=sqlx::query_scalar(r#"SELECT EXISTS(SELECT 1 FROM medication_courses c WHERE c.facility_id=$1 AND c.id=$2 AND c.status='active'
        AND c.medication_name=$3 AND c.dose=$4 AND c.route=$5 AND c.frequency=$6
        AND c.inventory_item_id IS NOT DISTINCT FROM $7 AND c.prescription_start_date IS NOT DISTINCT FROM $8
        AND c.prescription_duration_days IS NOT DISTINCT FROM $9 AND c.prescription_first_dose_at IS NOT DISTINCT FROM $10
        AND c.prescription_prn_policy=$11 AND c.first_dose_at <= $12)"#)
        .bind(command.facility_id).bind(course_id).bind(&source.medication_name).bind(&source.dose).bind(&source.route).bind(&source.frequency)
        .bind(source.inventory_item_id).bind(source.start_date).bind(source.duration_days).bind(source.first_dose_at).bind(Json(&policy)).bind(at).fetch_one(&mut *tx).await?;
    if !valid {
        return Err(PrnError::NotActionable.into());
    }
    let fulfillment_id=sqlx::query_scalar::<_,Uuid>(r#"
        INSERT INTO pharmacy_fulfillments(id,facility_id,patient_id,admission_case_id,prescription_id,medication_course_id,status,medication_name,dose,route,frequency,inventory_item_id,coverage_start,coverage_end,requested_dose_count,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12,$13,1,$14)
        ON CONFLICT(facility_id,medication_course_id) DO UPDATE
        SET requested_dose_count=pharmacy_fulfillments.dispensed_dose_count+1,
            status=CASE WHEN pharmacy_fulfillments.dispensed_dose_count>0 THEN 'partially_dispensed' ELSE 'pending' END,
            coverage_end=GREATEST(pharmacy_fulfillments.coverage_end,EXCLUDED.coverage_end),updated_at=now()
        RETURNING id"#)
        .bind(Uuid::new_v4()).bind(command.facility_id).bind(source.patient_id).bind(command.admission_case_id).bind(source.id).bind(course_id)
        .bind(&source.medication_name).bind(&source.dose).bind(&source.route).bind(&source.frequency).bind(source.inventory_item_id)
        .bind(at).bind(at+Duration::seconds(1)).bind(command.actor_user_id).fetch_one(&mut *tx).await?;
    let sequence:i64=sqlx::query_scalar("SELECT COALESCE(max(dose_sequence),0)::bigint+1 FROM medication_administrations WHERE facility_id=$1 AND medication_course_id=$2")
        .bind(command.facility_id).bind(course_id).fetch_one(&mut *tx).await?;
    let sequence = i32::try_from(sequence).map_err(|_| PrnError::NotActionable)?;
    let id = Uuid::new_v4();
    sqlx::query(r#"INSERT INTO medication_administrations(id,facility_id,patient_id,admission_case_id,prescription_id,medication_course_id,pharmacy_fulfillment_id,medication_name,dose,route,frequency,dose_sequence,scheduled_at,status,created_by_user_id,prn_request_id,prn_indication,prn_requested_by_user_id,prn_safety_group_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'scheduled',$14,$15,$16,$14,$17)"#)
        .bind(id).bind(command.facility_id).bind(source.patient_id).bind(command.admission_case_id).bind(source.id).bind(course_id).bind(fulfillment_id)
        .bind(&source.medication_name).bind(&source.dose).bind(&source.route).bind(&source.frequency).bind(sequence).bind(at).bind(command.actor_user_id).bind(command.client_request_id).bind(indication).bind(safety_group).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO pharmacy_fulfillment_mar_entries(fulfillment_id,medication_administration_id) VALUES($1,$2)")
        .bind(fulfillment_id).bind(id).execute(&mut *tx).await?;
    // The free-text indication stays in the clinical record, never audit metadata.
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,'medication.prn_requested','medication_administration',$5,'{}'::jsonb)")
        .bind(Uuid::new_v4()).bind(command.facility_id).bind(command.actor_user_id).bind(command.request_id).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(PrnDoseRequestResult {
        prescription_id: source.id,
        admission_case_id: command.admission_case_id,
        medication_administration_id: id,
        pharmacy_fulfillment_id: fulfillment_id,
        client_request_id: command.client_request_id,
        created: true,
    })
}

#[derive(FromRow)]
struct PrnRow {
    prn_safety_group_id: Option<Uuid>,
    prescription_id: Uuid,
    patient_id: Uuid,
    medication_name: String,
    dose: String,
    route: String,
    prescribed_at: DateTime<Utc>,
    prn_policy: Option<Json<PrnPolicy>>,
    status: String,
    pending_medication_administration_id: Option<Uuid>,
    pending_is_dispensed: Option<bool>,
    administered_in_last_24_hours: i64,
    last_administered_at: Option<DateTime<Utc>>,
    cap_release_at: Option<DateTime<Utc>>,
    stock_unit: Option<String>,
    stock_active: Option<bool>,
    stock_controlled: Option<bool>,
    start_date: Option<chrono::NaiveDate>,
    first_dose_at: Option<DateTime<Utc>>,
    duration_days: Option<i32>,
}

pub async fn list_prn_orders(
    pool: &PgPool,
    facility: Uuid,
    patient: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PrnOrderListItem>> {
    let at = Utc::now();
    let mut q = QueryBuilder::<Postgres>::new(
        r#"SELECT p.prn_safety_group_id,p.id AS prescription_id,p.patient_id,p.medication_name,p.dose,p.route,p.prescribed_at,p.prn_policy,p.status,p.start_date,p.first_dose_at,p.duration_days,
        i.unit AS stock_unit,i.is_active AS stock_active,i.controlled AS stock_controlled,
        pending.id AS pending_medication_administration_id,pending.is_dispensed AS pending_is_dispensed,
        actual.total AS administered_in_last_24_hours,actual.last_at AS last_administered_at,cap.cap_at AS cap_release_at
        FROM prescriptions p LEFT JOIN inventory_items i ON i.id=p.inventory_item_id AND i.facility_id=p.facility_id
        LEFT JOIN LATERAL(SELECT m.id,m.is_dispensed FROM medication_administrations m WHERE m.facility_id=p.facility_id AND m.prn_safety_group_id=p.prn_safety_group_id AND m.status='scheduled' ORDER BY m.scheduled_at,m.id LIMIT 1) pending ON TRUE
        LEFT JOIN LATERAL(SELECT count(*) AS total,max(administered_at) AS last_at FROM medication_administrations m WHERE m.facility_id=p.facility_id AND m.prn_safety_group_id=p.prn_safety_group_id AND m.status='administered' AND m.administered_at>clock_timestamp()-interval '24 hours') actual ON TRUE
        LEFT JOIN LATERAL(SELECT m.administered_at AS cap_at FROM medication_administrations m WHERE m.facility_id=p.facility_id AND m.prn_safety_group_id=p.prn_safety_group_id AND m.status='administered' AND m.administered_at>clock_timestamp()-interval '24 hours' ORDER BY m.administered_at DESC OFFSET COALESCE(GREATEST(0,(p.prn_policy->>'maximum_doses_per_24_hours')::integer-1),0) LIMIT 1) cap ON TRUE
        WHERE p.facility_id="#,
    );
    q.push_bind(facility)
        .push(" AND p.patient_id=")
        .push_bind(patient)
        .push(" AND lower(trim(p.frequency))='prn' AND p.status IN ('active','on_hold')");
    if let Some(c) = cursor {
        q.push(" AND (p.prescribed_at,p.id)<(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY p.prescribed_at DESC,p.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = q.build_query_as::<PrnRow>().fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let policy = r.prn_policy.map(|p| p.0);
            let mut next = None;
            let reason = match policy.as_ref() {
                None => Some("unconfigured"),
                Some(_) if r.prn_safety_group_id.is_none() => Some("unconfigured"),
                Some(p)
                    if r.stock_unit.as_deref() != Some(p.stock_unit.as_str())
                        || r.stock_active != Some(true)
                        || r.stock_controlled != Some(false) =>
                {
                    Some("stock_changed")
                }
                Some(_) if r.status != "active" => Some("prescription_on_hold"),
                Some(_) if r.pending_medication_administration_id.is_some() => Some("pending_dose"),
                Some(p) => {
                    let start = r
                        .first_dose_at
                        .or_else(|| {
                            r.start_date
                                .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc())
                        })
                        .unwrap_or(r.prescribed_at);
                    let end = r
                        .duration_days
                        .and_then(|d| start.checked_add_signed(Duration::days(i64::from(d))));
                    if at < start {
                        next = Some(start);
                        Some("not_started")
                    } else if end.is_some_and(|end| at >= end) {
                        Some("course_ended")
                    } else {
                        let interval = r
                            .last_administered_at
                            .map(|v| v + Duration::hours(i64::from(p.minimum_interval_hours)));
                        let cap = if r.administered_in_last_24_hours
                            >= i64::from(p.maximum_doses_per_24_hours)
                        {
                            r.cap_release_at.map(|v| v + Duration::hours(24))
                        } else {
                            None
                        };
                        next = interval.into_iter().chain(cap).max().filter(|v| *v > at);
                        if next.is_some() {
                            Some("dose_limit")
                        } else {
                            None
                        }
                    }
                }
            };
            PrnOrderListItem {
                prescription_id: r.prescription_id,
                patient_id: r.patient_id,
                medication_name: r.medication_name,
                dose: r.dose,
                route: r.route,
                prescribed_at: r.prescribed_at,
                prn_policy: policy,
                pending_medication_administration_id: r.pending_medication_administration_id,
                pending_is_dispensed: r.pending_is_dispensed,
                administered_in_last_24_hours: r.administered_in_last_24_hours,
                last_administered_at: r.last_administered_at,
                next_eligible_at: next,
                unavailable_reason: reason.map(str::to_owned),
            }
        })
        .collect())
}
