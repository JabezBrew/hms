use chrono::{DateTime, Utc};
use hms_domain::ward::{
    AdmissionCaseListItem, AdmissionStatus, BedStatus, DischargeStatus, WardBoardItem,
    WardBoardMonitoringFilter, WardBoardSort,
};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

use super::{WardBoardCursor, WardCursor};

#[derive(Clone, Debug)]
pub struct AdmissionContext {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub bed_id: Option<Uuid>,
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
}

#[derive(Clone, Debug)]
pub struct NewAdmission {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub bed_id: Option<Uuid>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewAdmissionCase {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct WardBoardRow {
    placement_revision: i64,
    admission_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    ward_id: Uuid,
    ward_name: String,
    bed_id: Option<Uuid>,
    bed_code: Option<String>,
    admission_status: String,
    admitted_at: DateTime<Utc>,
    open_nursing_task_count: i64,
    overdue_nursing_task_count: i64,
    next_nursing_task_due_at: Option<DateTime<Utc>>,
    due_medication_count: i64,
    next_due_medication_at: Option<DateTime<Utc>>,
    active_alert_count: i64,
    critical_alert_count: i64,
    fluid_condition_count: i64,
    fluid_critical_count: i64,
    fluid_assessment_status: String,
    last_vitals_recorded_at: Option<DateTime<Utc>>,
    unverified_result_count: i64,
    critical_unverified_result_count: i64,
    pending_lab_order_count: i64,
    discharge_case_id: Option<Uuid>,
    discharge_status: Option<String>,
    open_discharge_blocker_count: i64,
    last_activity_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct AdmissionCaseRow {
    placement_revision: i64,
    id: Uuid,
    patient_id: Uuid,
    encounter_id: Option<Uuid>,
    visit_id: Option<Uuid>,
    patient_code: String,
    patient_display_name: String,
    ward_id: Uuid,
    ward_name: String,
    bed_id: Option<Uuid>,
    bed_code: Option<String>,
    status: String,
    created_at: DateTime<Utc>,
    admitted_at: Option<DateTime<Utc>>,
    discharged_at: Option<DateTime<Utc>>,
}

pub async fn list_ward_board(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    search: Option<String>,
    monitoring_filter: Option<WardBoardMonitoringFilter>,
    sort: WardBoardSort,
    cursor: Option<WardBoardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<WardBoardItem>> {
    let mut query = ward_board_list_query();
    query.push(" WHERE facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND status IN ('admitted', 'discharge_pending')");

    if let Some(ward_id) = ward_id {
        query.push(" AND ward_id = ");
        query.push_bind(ward_id);
    }

    if let Some(patient_id) = patient_id {
        query.push(" AND patient_id = ");
        query.push_bind(patient_id);
    }

    if let Some(pattern) = like_contains_pattern(search.as_deref()) {
        query.push(
            r#" AND (
                EXISTS (
                    SELECT 1
                    FROM patients
                    WHERE patients.id = admission_cases.patient_id
                      AND patients.facility_id = admission_cases.facility_id
                      AND lower(patients.patient_code || ' ' || patients.first_name || ' ' || patients.last_name) LIKE "#,
        );
        query.push_bind(pattern.to_lowercase());
        query.push(
            r#" ESCAPE '\')
                )
                OR EXISTS (
                    SELECT 1
                    FROM wards
                    WHERE wards.id = admission_cases.ward_id
                      AND wards.facility_id = admission_cases.facility_id
                      AND wards.name ILIKE "#,
        );
        query.push_bind(pattern.clone());
        query.push(
            r#" ESCAPE '\'
                )
                OR EXISTS (
                    SELECT 1
                    FROM beds
                    WHERE beds.id = admission_cases.bed_id
                      AND beds.facility_id = admission_cases.facility_id
                      AND beds.bed_code ILIKE "#,
        );
        query.push_bind(pattern);
        query.push(" ESCAPE '\\'))");
    }

    if let Some(monitoring_filter) = monitoring_filter {
        push_monitoring_filter(&mut query, monitoring_filter);
    }

    push_ward_board_cursor(&mut query, cursor);
    push_ward_board_order(&mut query, sort);
    query.push(" LIMIT ");
    query.push_bind(limit);
    query.push(ward_board_list_select());
    push_ward_board_order(&mut query, sort);

    let rows = observe_db_query(
        "ward.admission_cases.ward_board.list",
        query.build_query_as::<WardBoardRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(ward_board_from_row).collect()
}

pub async fn get_ward_board_admission(
    pool: &PgPool,
    facility_id: Uuid,
    admission_id: Uuid,
) -> anyhow::Result<Option<WardBoardItem>> {
    let mut query = ward_board_query();
    query.push(" WHERE admission_cases.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND admission_cases.status IN ('admitted', 'discharge_pending')");
    query.push(" AND admission_cases.id = ");
    query.push_bind(admission_id);
    let row = observe_db_query(
        "ward.admission_cases.ward_board.get_admission",
        query.build_query_as::<WardBoardRow>().fetch_optional(pool),
    )
    .await?;
    row.map(ward_board_from_row).transpose()
}

pub async fn get_admission_context(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<Option<AdmissionContext>> {
    Ok(observe_db_query(
        "ward.admission_cases.context.get",
        sqlx::query_as::<_, AdmissionContextRow>(
            r#"
        SELECT id,
               patient_id,
               ward_id,
               bed_id,
               encounter_id,
               visit_id
        FROM admission_cases
        WHERE facility_id = $1 AND id = $2
        "#,
        )
        .bind(facility_id)
        .bind(admission_case_id)
        .fetch_optional(pool),
    )
    .await?
    .map(|row| AdmissionContext {
        id: row.id,
        patient_id: row.patient_id,
        ward_id: row.ward_id,
        bed_id: row.bed_id,
        encounter_id: row.encounter_id,
        visit_id: row.visit_id,
    }))
}

pub async fn list_admission_cases(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<AdmissionCaseListItem>> {
    let mut query = admission_case_query();
    query.push(" WHERE admission_cases.facility_id = ");
    query.push_bind(facility_id);

    if let Some(cursor) = cursor {
        query.push(" AND (admission_cases.created_at, admission_cases.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY admission_cases.created_at ASC, admission_cases.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = observe_db_query(
        "ward.admission_cases.list",
        query.build_query_as::<AdmissionCaseRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(admission_case_from_row).collect()
}

pub async fn get_admission_case(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    optional_admission_case_by_id(pool, facility_id, admission_case_id).await
}

pub async fn create_admission_case(
    pool: &PgPool,
    admission: NewAdmissionCase,
) -> anyhow::Result<AdmissionCaseListItem> {
    let inserted = observe_db_query(
        "ward.admission_cases.create",
        sqlx::query_scalar::<_, Uuid>(
            r#"
        INSERT INTO admission_cases (
            id,
            facility_id,
            patient_id,
            ward_id,
            bed_id,
            encounter_id,
            visit_id,
            status,
            attending_user_id,
            created_by_user_id
        )
        SELECT $1, $2, $3, $4, NULL, $5, $6, $7, $8, $8
        WHERE EXISTS (
            SELECT 1
            FROM patients
            WHERE patients.facility_id = $2
              AND patients.id = $3
        )
          AND EXISTS (
            SELECT 1
            FROM wards
            WHERE wards.facility_id = $2
              AND wards.id = $4
              AND wards.status = 'active'
        )
        RETURNING id
        "#,
        )
        .bind(admission.id)
        .bind(admission.facility_id)
        .bind(admission.patient_id)
        .bind(admission.ward_id)
        .bind(admission.encounter_id)
        .bind(admission.visit_id)
        .bind(codec::encode(AdmissionStatus::ReadyForActivation)?)
        .bind(admission.actor_user_id)
        .fetch_optional(pool),
    )
    .await?
    .ok_or_else(|| anyhow::anyhow!("patient or ward not found for admission case"))?;

    admission_case_by_id(pool, admission.facility_id, inserted).await
}

pub async fn reserve_admission_bed(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
    requested_bed_id: Option<Uuid>,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    let mut transaction = pool.begin().await?;
    let case = observe_db_query(
        "ward.admission_cases.reserve.select_case",
        sqlx::query_as::<_, AdmissionContextStatusRow>(
            r#"
        SELECT id,
               patient_id,
               ward_id,
               bed_id,
               status
        FROM admission_cases
        WHERE facility_id = $1
          AND id = $2
        FOR UPDATE
        "#,
        )
        .bind(facility_id)
        .bind(admission_case_id)
        .fetch_optional(&mut *transaction),
    )
    .await?;

    let Some(case) = case else {
        return Ok(None);
    };
    if case.status != codec::encode(AdmissionStatus::ReadyForActivation)? {
        return Ok(None);
    }

    let bed_id = match requested_bed_id.or(case.bed_id) {
        Some(bed_id) => {
            let locked_bed = lock_available_bed(
                &mut transaction,
                facility_id,
                case.ward_id,
                Some(bed_id),
                Some(case.id),
            )
            .await?;
            if locked_bed.is_none() {
                return Ok(None);
            }
            Some(bed_id)
        }
        None => {
            lock_available_bed(
                &mut transaction,
                facility_id,
                case.ward_id,
                None,
                Some(case.id),
            )
            .await?
        }
    };

    let Some(bed_id) = bed_id else {
        return Ok(None);
    };

    if let Some(old_bed) = case.bed_id.filter(|id| *id != bed_id) {
        observe_db_query("ward.admission_cases.reserve.release_previous", sqlx::query(
            "UPDATE beds SET status='available',updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2 AND status='reserved'"
        ).bind(facility_id).bind(old_bed).execute(&mut *transaction)).await?;
    }

    observe_db_query(
        "ward.admission_cases.reserve.mark_bed_reserved",
        sqlx::query(
            r#"
        UPDATE beds
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2
          AND ward_id = $3
          AND id = $4
        "#,
        )
        .bind(codec::encode(BedStatus::Reserved)?)
        .bind(facility_id)
        .bind(case.ward_id)
        .bind(bed_id)
        .execute(&mut *transaction),
    )
    .await?;

    observe_db_query(
        "ward.admission_cases.reserve.assign_bed",
        sqlx::query(
            r#"
        UPDATE admission_cases
        SET bed_id = $1,
            placement_revision = placement_revision + CASE WHEN bed_id IS DISTINCT FROM $1 THEN 1 ELSE 0 END,
            attending_user_id = $2,
            updated_at = now()
        WHERE facility_id = $3
          AND id = $4
        "#,
        )
        .bind(bed_id)
        .bind(actor_user_id)
        .bind(facility_id)
        .bind(case.id)
        .execute(&mut *transaction),
    )
    .await?;

    transaction.commit().await?;
    optional_admission_case_by_id(pool, facility_id, case.id).await
}

pub async fn activate_admission_case(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    let mut transaction = pool.begin().await?;
    let case = observe_db_query(
        "ward.admission_cases.activate.select_case",
        sqlx::query_as::<_, AdmissionContextStatusRow>(
            r#"
        SELECT id,
               patient_id,
               ward_id,
               bed_id,
               status
        FROM admission_cases
        WHERE facility_id = $1
          AND id = $2
        FOR UPDATE
        "#,
        )
        .bind(facility_id)
        .bind(admission_case_id)
        .fetch_optional(&mut *transaction),
    )
    .await?;

    let Some(case) = case else {
        return Ok(None);
    };
    if case.status != codec::encode(AdmissionStatus::ReadyForActivation)? {
        return Ok(None);
    }

    let bed_id = lock_available_bed(
        &mut transaction,
        facility_id,
        case.ward_id,
        case.bed_id,
        Some(case.id),
    )
    .await?;

    let Some(bed_id) = bed_id else {
        return Ok(None);
    };

    let at: DateTime<Utc> = observe_db_query(
        "ward.admission_cases.activate.clock",
        sqlx::query_scalar("SELECT clock_timestamp()").fetch_one(&mut *transaction),
    )
    .await?;
    observe_db_query(
        "ward.admission_cases.activate.mark_bed_occupied",
        sqlx::query(
            r#"
        UPDATE beds
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2
          AND ward_id = $3
          AND id = $4
        "#,
        )
        .bind(codec::encode(BedStatus::Occupied)?)
        .bind(facility_id)
        .bind(case.ward_id)
        .bind(bed_id)
        .execute(&mut *transaction),
    )
    .await?;

    observe_db_query(
        "ward.admission_cases.activate.mark_admitted",
        sqlx::query(
            r#"
        UPDATE admission_cases
        SET bed_id = $1,
            status = $2,
            admitted_at = $6,
            placement_revision = placement_revision + 1,
            attending_user_id = $3,
            updated_at = $6
        WHERE facility_id = $4
          AND id = $5
        "#,
        )
        .bind(bed_id)
        .bind(codec::encode(AdmissionStatus::Admitted)?)
        .bind(actor_user_id)
        .bind(facility_id)
        .bind(case.id)
        .bind(at)
        .execute(&mut *transaction),
    )
    .await?;

    super::admission_moves::open_activation_tx(&mut transaction, facility_id, case.id, at).await?;
    transaction.commit().await?;
    optional_admission_case_by_id(pool, facility_id, case.id).await
}

pub async fn cancel_admission_case(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    cancel_admission_case_inner(pool, facility_id, admission_case_id, actor_user_id, None).await
}

pub async fn cancel_admission_case_authorized(
    pool: &PgPool,
    actor: super::admission_advisories::AdmissionClosureActor,
    admission_case_id: Uuid,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    cancel_admission_case_inner(
        pool,
        actor.facility_id,
        admission_case_id,
        actor.user_id,
        Some(actor),
    )
    .await
}

async fn cancel_admission_case_inner(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
    actor_user_id: Uuid,
    mut actor: Option<super::admission_advisories::AdmissionClosureActor>,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    let mut transaction = pool.begin().await?;
    let case = observe_db_query(
        "ward.admission_cases.cancel.select_case",
        sqlx::query_as::<_, AdmissionContextStatusRow>(
            r#"
        SELECT id,
               patient_id,
               ward_id,
               bed_id,
               status
        FROM admission_cases
        WHERE facility_id = $1
          AND id = $2
        FOR UPDATE
        "#,
        )
        .bind(facility_id)
        .bind(admission_case_id)
        .fetch_optional(&mut *transaction),
    )
    .await?;

    let Some(case) = case else {
        return Ok(None);
    };
    if let Some(actor) = actor.as_mut() {
        super::admission_advisories::verify_closure(&mut transaction, actor).await?;
    }
    if case.status != codec::encode(AdmissionStatus::ReadyForActivation)? {
        return Ok(None);
    }

    if let Some(bed_id) = case.bed_id {
        observe_db_query(
            "ward.admission_cases.cancel.release_reserved_bed",
            sqlx::query(
                r#"
            UPDATE beds
            SET status = $1,
                updated_at = now()
            WHERE facility_id = $2
              AND ward_id = $3
              AND id = $4
              AND status = $5
            "#,
            )
            .bind(codec::encode(BedStatus::Available)?)
            .bind(facility_id)
            .bind(case.ward_id)
            .bind(bed_id)
            .bind(codec::encode(BedStatus::Reserved)?)
            .execute(&mut *transaction),
        )
        .await?;
    }

    observe_db_query(
        "ward.admission_cases.cancel.mark_cancelled",
        sqlx::query(
            r#"
        UPDATE admission_cases
        SET status = $1,
            attending_user_id = $2,
            updated_at = now()
        WHERE facility_id = $3
          AND id = $4
        "#,
        )
        .bind(codec::encode(AdmissionStatus::Cancelled)?)
        .bind(actor_user_id)
        .bind(facility_id)
        .bind(case.id)
        .execute(&mut *transaction),
    )
    .await?;

    super::admission_advisories::retire_pending(
        &mut transaction,
        facility_id,
        case.id,
        actor.as_ref(),
        hms_domain::admission_advisories::AdmissionAdvisorySystemReason::AdmissionCaseCancelled,
    )
    .await?;
    if let Some(actor) = actor.as_ref() {
        super::admission_advisories::closure_deadline(&mut transaction, actor).await?;
    }
    transaction.commit().await?;
    optional_admission_case_by_id(pool, facility_id, case.id).await
}

#[derive(Clone, Copy, Debug)]
pub struct AdmissionPlacementRejected;
impl std::fmt::Display for AdmissionPlacementRejected {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("The requested admission placement is unavailable.")
    }
}
impl std::error::Error for AdmissionPlacementRejected {}
pub async fn admit_patient(
    pool: &PgPool,
    admission: NewAdmission,
) -> anyhow::Result<WardBoardItem> {
    admit_patient_inner(pool, admission, None).await
}
pub async fn admit_patient_authorized(
    pool: &PgPool,
    admission: NewAdmission,
    actor: super::admission_advisories::AdmissionClosureActor,
) -> anyhow::Result<WardBoardItem> {
    admit_patient_inner(pool, admission, Some(actor)).await
}
async fn admit_patient_inner(
    pool: &PgPool,
    admission: NewAdmission,
    mut actor: Option<super::admission_advisories::AdmissionClosureActor>,
) -> anyhow::Result<WardBoardItem> {
    let mut transaction = pool.begin().await?;
    if let Some(actor) = actor.as_mut() {
        if actor.facility_id != admission.facility_id || actor.user_id != admission.actor_user_id {
            return Err(AdmissionPlacementRejected.into());
        }
        super::admission_advisories::verify_closure(&mut transaction, actor).await?;
        let (allowed,boundary):(bool,Option<DateTime<Utc>>)=observe_db_query("ward.admission_cases.admit.authority",sqlx::query_as(r#"
        WITH point AS MATERIALIZED(SELECT clock_timestamp() at),effective AS(
          SELECT permission_code FROM user_permissions WHERE user_id=$2
          UNION SELECT p.permission_code FROM permission_assignments p CROSS JOIN point n WHERE p.facility_id=$1 AND p.grantee_user_id=$2 AND p.scope_type='facility' AND p.scope_id IS NULL AND p.status='active' AND p.starts_at<=n.at AND (p.ends_at IS NULL OR p.ends_at>n.at)
          UNION SELECT d.permission_code FROM delegations d CROSS JOIN point n WHERE d.facility_id=$1 AND d.delegate_user_id=$2 AND d.status='active' AND d.starts_at<=n.at AND (d.ends_at IS NULL OR d.ends_at>n.at))
        SELECT EXISTS(SELECT 1 FROM effective WHERE permission_code='admission.manage')
          AND EXISTS(SELECT 1 FROM effective WHERE permission_code='patient.demographics.view')
          AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='demographics')
          AND (SELECT count(*) FROM user_features WHERE user_id=$2 AND feature_key IN('patients','admissions'))=2,
          (SELECT min(boundary) FROM user_authority_boundaries b CROSS JOIN LATERAL(VALUES(b.starts_at),(b.ends_at)) v(boundary) CROSS JOIN point n WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
        "#).bind(admission.facility_id).bind(actor.user_id).fetch_one(&mut *transaction)).await?;
        if !allowed {
            return Err(super::admission_advisories::AdvisoryError::AuthorityExpired.into());
        }
        if let Some(boundary) = boundary {
            actor.authorization.valid_until = actor.authorization.valid_until.min(boundary);
        }
    }
    // Keep the existing intake visibility policy; moves use a separate historical purpose.
    let patient: Option<Uuid> = observe_db_query(
        "ward.admission_cases.admit.patient",
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE")
            .bind(admission.facility_id)
            .bind(admission.patient_id)
            .fetch_optional(&mut *transaction),
    )
    .await?;
    if patient.is_none() {
        return Err(AdmissionPlacementRejected.into());
    }
    let ward: Option<Uuid> = observe_db_query(
        "ward.admission_cases.admit.ward",
        sqlx::query_scalar(
            "SELECT id FROM wards WHERE facility_id=$1 AND id=$2 AND status='active' FOR SHARE",
        )
        .bind(admission.facility_id)
        .bind(admission.ward_id)
        .fetch_optional(&mut *transaction),
    )
    .await?;
    if ward.is_none() {
        return Err(AdmissionPlacementRejected.into());
    }
    // Lock a real eligible bed before inserting its owner (and before the owner index).
    let bed_id = lock_available_bed(
        &mut transaction,
        admission.facility_id,
        admission.ward_id,
        admission.bed_id,
        None,
    )
    .await?;
    if admission.bed_id.is_some() && bed_id.is_none() {
        return Err(AdmissionPlacementRejected.into());
    }
    let at: DateTime<Utc> = observe_db_query(
        "ward.admission_cases.admit.clock",
        sqlx::query_scalar("SELECT clock_timestamp()").fetch_one(&mut *transaction),
    )
    .await?;
    observe_db_query("ward.admission_cases.admit.insert_admission",sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,bed_id,status,attending_user_id,created_by_user_id,admitted_at,placement_revision) VALUES($1,$2,$3,$4,$5,'admitted',$6,$6,$7,$8)").bind(admission.id).bind(admission.facility_id).bind(admission.patient_id).bind(admission.ward_id).bind(bed_id).bind(admission.actor_user_id).bind(at).bind(if bed_id.is_some(){1_i64}else{0}).execute(&mut *transaction)).await?;
    if let Some(bed) = bed_id {
        observe_db_query("ward.admission_cases.admit.mark_bed_occupied",sqlx::query("UPDATE beds SET status='occupied',cleaning_due_at=NULL,updated_at=$3 WHERE facility_id=$1 AND id=$2").bind(admission.facility_id).bind(bed).bind(at).execute(&mut *transaction)).await?;
        super::admission_moves::open_activation_tx(
            &mut transaction,
            admission.facility_id,
            admission.id,
            at,
        )
        .await?;
    }
    if let Some(actor) = actor.as_ref() {
        super::admission_advisories::closure_deadline(&mut transaction, actor).await?;
    }
    transaction.commit().await?;
    ward_board_item_by_admission(pool, admission.facility_id, admission.id).await
}

fn ward_board_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT admission_cases.id AS admission_id,
               admission_cases.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               admission_cases.ward_id,
               wards.name AS ward_name,
               admission_cases.bed_id,
               beds.bed_code,
               admission_cases.status AS admission_status,
               admission_cases.admitted_at,
               admission_cases.placement_revision,
               COALESCE(task_counts.open_nursing_task_count, 0) AS open_nursing_task_count,
               COALESCE(task_counts.overdue_nursing_task_count, 0) AS overdue_nursing_task_count,
               task_counts.next_nursing_task_due_at,
               COALESCE(med_counts.due_medication_count, 0) AS due_medication_count,
               med_counts.next_due_medication_at,
               COALESCE(alert_counts.active_alert_count, 0) AS active_alert_count,
               COALESCE(alert_counts.critical_alert_count, 0) AS critical_alert_count,
               COALESCE(fluid_monitor.condition_count,0) AS fluid_condition_count,
               COALESCE(fluid_monitor.critical_count,0) AS fluid_critical_count,
               COALESCE(fluid_monitor.assessment_status,'no_data') AS fluid_assessment_status,
               vitals.last_vitals_recorded_at,
               COALESCE(result_counts.unverified_result_count, 0) AS unverified_result_count,
               COALESCE(result_counts.critical_unverified_result_count, 0) AS critical_unverified_result_count,
               COALESCE(lab_order_counts.pending_lab_order_count, 0) AS pending_lab_order_count,
               discharge_counts.discharge_case_id,
               discharge_counts.discharge_status,
               COALESCE(discharge_counts.open_discharge_blocker_count, 0) AS open_discharge_blocker_count,
               GREATEST(
                   admission_cases.updated_at,
                   COALESCE(fluid_monitor.last_activity_at,admission_cases.updated_at),
                   COALESCE(task_counts.last_task_activity_at, admission_cases.updated_at),
                   COALESCE(med_counts.last_medication_activity_at, admission_cases.updated_at),
                   COALESCE(alert_counts.last_alert_activity_at, admission_cases.updated_at),
                   COALESCE(vitals.last_vitals_recorded_at, admission_cases.updated_at),
                   COALESCE(result_counts.last_result_activity_at, admission_cases.updated_at),
                   COALESCE(lab_order_counts.last_lab_order_activity_at, admission_cases.updated_at),
                   COALESCE(discharge_counts.discharge_last_activity_at, admission_cases.updated_at)
               ) AS last_activity_at
        FROM admission_cases
        JOIN patients
          ON patients.id = admission_cases.patient_id
         AND patients.facility_id = admission_cases.facility_id
        JOIN wards
          ON wards.id = admission_cases.ward_id
         AND wards.facility_id = admission_cases.facility_id
        LEFT JOIN fluid_admission_monitoring fluid_monitor ON fluid_monitor.facility_id=admission_cases.facility_id AND fluid_monitor.admission_case_id=admission_cases.id
        LEFT JOIN beds
          ON beds.id = admission_cases.bed_id
         AND beds.facility_id = admission_cases.facility_id
        LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE status = 'open') AS open_nursing_task_count,
                   count(*) FILTER (WHERE status = 'open' AND due_at <= now()) AS overdue_nursing_task_count,
                   min(due_at) FILTER (WHERE status = 'open') AS next_nursing_task_due_at,
                   max(updated_at) FILTER (WHERE status = 'open') AS last_task_activity_at
            FROM nursing_tasks
            WHERE nursing_tasks.facility_id = admission_cases.facility_id
              AND nursing_tasks.admission_case_id = admission_cases.id
        ) task_counts ON true
        LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE status = 'scheduled' AND scheduled_at <= now()) AS due_medication_count,
                   min(scheduled_at) FILTER (WHERE status = 'scheduled' AND scheduled_at <= now()) AS next_due_medication_at,
                   max(updated_at) FILTER (WHERE status = 'scheduled') AS last_medication_activity_at
            FROM medication_administrations
            WHERE medication_administrations.facility_id = admission_cases.facility_id
              AND medication_administrations.admission_case_id = admission_cases.id
        ) med_counts ON true
        LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE nursing_alerts.status = 'open') AS active_alert_count,
                   count(*) FILTER (
                       WHERE nursing_alerts.status = 'open'
                         AND nursing_alerts.severity IN ('critical', 'high')
                   ) AS critical_alert_count,
                   max(updated_at) FILTER (WHERE nursing_alerts.status = 'open') AS last_alert_activity_at
            FROM nursing_alerts
            WHERE nursing_alerts.facility_id = admission_cases.facility_id
              AND nursing_alerts.admission_case_id = admission_cases.id
        ) alert_counts ON true
        LEFT JOIN LATERAL (
            SELECT max(recorded_at) AS last_vitals_recorded_at
            FROM patient_vitals
            WHERE patient_vitals.facility_id = admission_cases.facility_id
              AND patient_vitals.admission_case_id = admission_cases.id
        ) vitals ON true
        LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE lab_results.verified_at IS NULL) AS unverified_result_count,
                   count(*) FILTER (
                       WHERE lab_results.verified_at IS NULL
                         AND lab_results.is_critical = TRUE
                   ) AS critical_unverified_result_count,
                   max(lab_results.updated_at) FILTER (WHERE lab_results.verified_at IS NULL) AS last_result_activity_at
            FROM lab_results
            JOIN lab_orders
              ON lab_orders.id = lab_results.order_id
             AND lab_orders.facility_id = lab_results.facility_id
            WHERE lab_results.facility_id = admission_cases.facility_id
              AND lab_results.patient_id = admission_cases.patient_id
              AND lab_results.status <> 'verified'
              AND (
                  (
                      admission_cases.encounter_id IS NOT NULL
                      AND (
                          lab_orders.encounter_id = admission_cases.encounter_id
                          OR (
                              lab_orders.encounter_id IS NULL
                              AND admission_cases.visit_id IS NOT NULL
                              AND lab_orders.visit_id = admission_cases.visit_id
                          )
                      )
                  )
                  OR (
                      admission_cases.encounter_id IS NULL
                      AND admission_cases.visit_id IS NOT NULL
                      AND lab_orders.visit_id = admission_cases.visit_id
                  )
                  OR (
                      admission_cases.encounter_id IS NULL
                      AND admission_cases.visit_id IS NULL
                      AND lab_orders.ordered_at >= admission_cases.admitted_at
                  )
              )
        ) result_counts ON true
        LEFT JOIN LATERAL (
            SELECT count(*) AS pending_lab_order_count,
                   max(lab_orders.updated_at) AS last_lab_order_activity_at
            FROM lab_orders
            WHERE lab_orders.facility_id = admission_cases.facility_id
              AND lab_orders.patient_id = admission_cases.patient_id
              AND lab_orders.status IN ('ordered', 'specimen_collected')
              AND (
                  (
                      admission_cases.encounter_id IS NOT NULL
                      AND (
                          lab_orders.encounter_id = admission_cases.encounter_id
                          OR (
                              lab_orders.encounter_id IS NULL
                              AND admission_cases.visit_id IS NOT NULL
                              AND lab_orders.visit_id = admission_cases.visit_id
                          )
                      )
                  )
                  OR (
                      admission_cases.encounter_id IS NULL
                      AND admission_cases.visit_id IS NOT NULL
                      AND lab_orders.visit_id = admission_cases.visit_id
                  )
                  OR (
                      admission_cases.encounter_id IS NULL
                      AND admission_cases.visit_id IS NULL
                      AND lab_orders.ordered_at >= admission_cases.admitted_at
                  )
              )
        ) lab_order_counts ON true
        LEFT JOIN LATERAL (
            SELECT dc.id AS discharge_case_id,
                   dc.status AS discharge_status,
                   dc.updated_at AS discharge_last_activity_at,
                   (
                       CASE
                           WHEN NOT EXISTS (
                               SELECT 1
                               FROM clinical_notes
                               WHERE clinical_notes.facility_id = dc.facility_id
                                 AND clinical_notes.patient_id = dc.patient_id
                                 AND clinical_notes.note_type = 'doctor_note'
                                 AND lower(clinical_notes.title) = 'discharge summary'
                                 AND clinical_notes.status IN ('signed', 'amended')
                                 AND (
                                     (
                                         COALESCE(dc.encounter_id, admission_cases.encounter_id) IS NOT NULL
                                         AND clinical_notes.encounter_id = COALESCE(dc.encounter_id, admission_cases.encounter_id)
                                     )
                                     OR (
                                         COALESCE(dc.encounter_id, admission_cases.encounter_id) IS NULL
                                         AND COALESCE(dc.visit_id, admission_cases.visit_id) IS NOT NULL
                                         AND EXISTS (
                                             SELECT 1
                                             FROM encounters
                                             WHERE encounters.facility_id = dc.facility_id
                                               AND encounters.id = clinical_notes.encounter_id
                                               AND encounters.visit_id = COALESCE(dc.visit_id, admission_cases.visit_id)
                                         )
                                     )
                                 )
                           )
                           AND NOT EXISTS (
                               SELECT 1
                               FROM discharge_blocker_overrides
                               WHERE discharge_blocker_overrides.facility_id = dc.facility_id
                                 AND discharge_blocker_overrides.discharge_case_id = dc.id
                                 AND discharge_blocker_overrides.blocker_type = 'discharge_summary'
                           )
                           THEN 1 ELSE 0
                       END
                       + CASE
                           WHEN (
                               trim(COALESCE(dc.nursing_release_education, '')) = ''
                               OR trim(COALESCE(dc.nursing_release_instructions, '')) = ''
                           )
                           AND NOT EXISTS (
                               SELECT 1
                               FROM discharge_blocker_overrides
                               WHERE discharge_blocker_overrides.facility_id = dc.facility_id
                                 AND discharge_blocker_overrides.discharge_case_id = dc.id
                                 AND discharge_blocker_overrides.blocker_type = 'nursing_release'
                           )
                           THEN 1 ELSE 0
                       END
                       + CASE
                           WHEN EXISTS (
                               SELECT 1
                               FROM invoices
                               WHERE invoices.facility_id = dc.facility_id
                                 AND invoices.patient_id = dc.patient_id
                                 AND invoices.status <> 'void'
                                 AND GREATEST(invoices.gross_amount_minor - invoices.paid_amount_minor, 0) > 0
                                 AND (
                                     invoices.admission_case_id = dc.admission_case_id
                                     OR (
                                         invoices.admission_case_id IS NULL
                                         AND COALESCE(dc.encounter_id, admission_cases.encounter_id) IS NOT NULL
                                         AND invoices.encounter_id = COALESCE(dc.encounter_id, admission_cases.encounter_id)
                                     )
                                     OR (
                                         invoices.admission_case_id IS NULL
                                         AND COALESCE(dc.encounter_id, admission_cases.encounter_id) IS NULL
                                         AND COALESCE(dc.visit_id, admission_cases.visit_id) IS NOT NULL
                                         AND invoices.visit_id = COALESCE(dc.visit_id, admission_cases.visit_id)
                                     )
                                 )
                           )
                           AND NOT EXISTS (
                               SELECT 1
                               FROM discharge_blocker_overrides
                               WHERE discharge_blocker_overrides.facility_id = dc.facility_id
                                 AND discharge_blocker_overrides.discharge_case_id = dc.id
                                 AND discharge_blocker_overrides.blocker_type = 'billing_clearance'
                           )
                           THEN 1 ELSE 0
                       END
                       + CASE
                           WHEN dc.pharmacy_required
                           AND NOT EXISTS (
                               SELECT 1
                               FROM pharmacy_fulfillments
                               WHERE pharmacy_fulfillments.facility_id = dc.facility_id
                                 AND pharmacy_fulfillments.patient_id = dc.patient_id
                                 AND pharmacy_fulfillments.admission_case_id = dc.admission_case_id
                                 AND pharmacy_fulfillments.status = 'dispensed'
                           )
                           AND NOT EXISTS (
                               SELECT 1
                               FROM discharge_blocker_overrides
                               WHERE discharge_blocker_overrides.facility_id = dc.facility_id
                                 AND discharge_blocker_overrides.discharge_case_id = dc.id
                                 AND discharge_blocker_overrides.blocker_type = 'pharmacy_clearance'
                           )
                           THEN 1 ELSE 0
                       END
                   )::bigint AS open_discharge_blocker_count
            FROM discharge_cases dc
            WHERE dc.facility_id = admission_cases.facility_id
              AND dc.admission_case_id = admission_cases.id
              AND dc.status = 'requested'
            LIMIT 1
        ) discharge_counts ON true
        "#,
    )
}

fn ward_board_list_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        WITH ranked_admissions AS (
            SELECT id,
                   facility_id,
                   patient_id,
                   ward_id,
                   bed_id,
                   encounter_id,
                   visit_id,
                   status,
                   admitted_at,
                   placement_revision,
                   updated_at,
                   CASE
                       WHEN EXISTS (
                           SELECT 1
                           FROM nursing_alerts
                           WHERE nursing_alerts.facility_id = admission_cases.facility_id
                             AND nursing_alerts.admission_case_id = admission_cases.id
                             AND nursing_alerts.status = 'open'
                             AND nursing_alerts.severity IN ('critical', 'high')
                       )
                       OR EXISTS (
                           SELECT 1
                           FROM lab_results
                           JOIN lab_orders
                             ON lab_orders.id = lab_results.order_id
                            AND lab_orders.facility_id = lab_results.facility_id
                           WHERE lab_results.facility_id = admission_cases.facility_id
                             AND lab_results.patient_id = admission_cases.patient_id
                             AND lab_results.verified_at IS NULL
                             AND lab_results.status <> 'verified'
                             AND lab_results.is_critical = TRUE
                             AND (
                                 (
                                     admission_cases.encounter_id IS NOT NULL
                                     AND (
                                         lab_orders.encounter_id = admission_cases.encounter_id
                                         OR (
                                             lab_orders.encounter_id IS NULL
                                             AND admission_cases.visit_id IS NOT NULL
                                             AND lab_orders.visit_id = admission_cases.visit_id
                                         )
                                     )
                                 )
                                 OR (
                                     admission_cases.encounter_id IS NULL
                                     AND admission_cases.visit_id IS NOT NULL
                                     AND lab_orders.visit_id = admission_cases.visit_id
                                 )
                                 OR (
                                     admission_cases.encounter_id IS NULL
                                     AND admission_cases.visit_id IS NULL
                                     AND lab_orders.ordered_at >= admission_cases.admitted_at
                                 )
                             )
                       )
                       OR EXISTS (SELECT 1 FROM fluid_admission_monitoring f WHERE f.facility_id=admission_cases.facility_id AND f.admission_case_id=admission_cases.id AND f.critical_count>0)
                       THEN 0
                       WHEN EXISTS (
                           SELECT 1
                           FROM nursing_alerts
                           WHERE nursing_alerts.facility_id = admission_cases.facility_id
                             AND nursing_alerts.admission_case_id = admission_cases.id
                             AND nursing_alerts.status = 'open'
                       )
                       OR EXISTS (
                           SELECT 1
                           FROM nursing_tasks
                           WHERE nursing_tasks.facility_id = admission_cases.facility_id
                             AND nursing_tasks.admission_case_id = admission_cases.id
                             AND nursing_tasks.status = 'open'
                             AND nursing_tasks.due_at <= now()
                       )
                       OR EXISTS (
                           SELECT 1
                           FROM medication_administrations
                           WHERE medication_administrations.facility_id = admission_cases.facility_id
                             AND medication_administrations.admission_case_id = admission_cases.id
                             AND medication_administrations.status = 'scheduled'
                             AND medication_administrations.scheduled_at <= now()
                       )
                       OR EXISTS (SELECT 1 FROM fluid_admission_monitoring f WHERE f.facility_id=admission_cases.facility_id AND f.admission_case_id=admission_cases.id AND f.condition_count>0)
                       THEN 1
                       WHEN EXISTS (
                           SELECT 1
                           FROM nursing_tasks
                           WHERE nursing_tasks.facility_id = admission_cases.facility_id
                             AND nursing_tasks.admission_case_id = admission_cases.id
                             AND nursing_tasks.status = 'open'
                       )
                       OR EXISTS (
                           SELECT 1
                           FROM lab_results
                           JOIN lab_orders
                             ON lab_orders.id = lab_results.order_id
                            AND lab_orders.facility_id = lab_results.facility_id
                           WHERE lab_results.facility_id = admission_cases.facility_id
                             AND lab_results.patient_id = admission_cases.patient_id
                             AND lab_results.verified_at IS NULL
                             AND lab_results.status <> 'verified'
                             AND (
                                 (
                                     admission_cases.encounter_id IS NOT NULL
                                     AND (
                                         lab_orders.encounter_id = admission_cases.encounter_id
                                         OR (
                                             lab_orders.encounter_id IS NULL
                                             AND admission_cases.visit_id IS NOT NULL
                                             AND lab_orders.visit_id = admission_cases.visit_id
                                         )
                                     )
                                 )
                                 OR (
                                     admission_cases.encounter_id IS NULL
                                     AND admission_cases.visit_id IS NOT NULL
                                     AND lab_orders.visit_id = admission_cases.visit_id
                                 )
                                 OR (
                                     admission_cases.encounter_id IS NULL
                                     AND admission_cases.visit_id IS NULL
                                     AND lab_orders.ordered_at >= admission_cases.admitted_at
                                 )
                             )
                       )
                       OR EXISTS (
                           SELECT 1
                           FROM lab_orders
                           WHERE lab_orders.facility_id = admission_cases.facility_id
                             AND lab_orders.patient_id = admission_cases.patient_id
                             AND lab_orders.status IN ('ordered', 'specimen_collected')
                             AND (
                                 (
                                     admission_cases.encounter_id IS NOT NULL
                                     AND (
                                         lab_orders.encounter_id = admission_cases.encounter_id
                                         OR (
                                             lab_orders.encounter_id IS NULL
                                             AND admission_cases.visit_id IS NOT NULL
                                             AND lab_orders.visit_id = admission_cases.visit_id
                                         )
                                     )
                                 )
                                 OR (
                                     admission_cases.encounter_id IS NULL
                                     AND admission_cases.visit_id IS NOT NULL
                                     AND lab_orders.visit_id = admission_cases.visit_id
                                 )
                                 OR (
                                     admission_cases.encounter_id IS NULL
                                     AND admission_cases.visit_id IS NULL
                                     AND lab_orders.ordered_at >= admission_cases.admitted_at
                                 )
                             )
                       )
                       OR EXISTS (
                           SELECT 1
                           FROM discharge_cases
                           WHERE discharge_cases.facility_id = admission_cases.facility_id
                             AND discharge_cases.admission_case_id = admission_cases.id
                             AND discharge_cases.status = 'requested'
                       )
                       THEN 2
                       ELSE 3
                   END AS attention_rank
            FROM admission_cases
        ),
        selected_admissions AS (
            SELECT id,
                   facility_id,
                   patient_id,
                   ward_id,
                   bed_id,
                   encounter_id,
                   visit_id,
                   status,
                   admitted_at,
                   placement_revision,
                   updated_at,
                   attention_rank
            FROM ranked_admissions admission_cases
        "#,
    )
}

fn ward_board_list_select() -> &'static str {
    r#"
        )
        SELECT admission_cases.id AS admission_id,
               admission_cases.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               admission_cases.ward_id,
               wards.name AS ward_name,
               admission_cases.bed_id,
               beds.bed_code,
               admission_cases.status AS admission_status,
               admission_cases.admitted_at,
               admission_cases.placement_revision,
               COALESCE(task_counts.open_nursing_task_count, 0) AS open_nursing_task_count,
               COALESCE(task_counts.overdue_nursing_task_count, 0) AS overdue_nursing_task_count,
               task_counts.next_nursing_task_due_at,
               COALESCE(med_counts.due_medication_count, 0) AS due_medication_count,
               med_counts.next_due_medication_at,
               COALESCE(alert_counts.active_alert_count, 0) AS active_alert_count,
               COALESCE(alert_counts.critical_alert_count, 0) AS critical_alert_count,
               COALESCE(fluid_monitor.condition_count,0) AS fluid_condition_count,
               COALESCE(fluid_monitor.critical_count,0) AS fluid_critical_count,
               COALESCE(fluid_monitor.assessment_status,'no_data') AS fluid_assessment_status,
               vitals.last_vitals_recorded_at,
               COALESCE(result_counts.unverified_result_count, 0) AS unverified_result_count,
               COALESCE(result_counts.critical_unverified_result_count, 0) AS critical_unverified_result_count,
               COALESCE(lab_order_counts.pending_lab_order_count, 0) AS pending_lab_order_count,
               discharge_counts.discharge_case_id,
               discharge_counts.discharge_status,
               COALESCE(discharge_counts.open_discharge_blocker_count, 0) AS open_discharge_blocker_count,
               GREATEST(
                   admission_cases.updated_at,
                   COALESCE(fluid_monitor.last_activity_at,admission_cases.updated_at),
                   COALESCE(task_counts.last_task_activity_at, admission_cases.updated_at),
                   COALESCE(med_counts.last_medication_activity_at, admission_cases.updated_at),
                   COALESCE(alert_counts.last_alert_activity_at, admission_cases.updated_at),
                   COALESCE(vitals.last_vitals_recorded_at, admission_cases.updated_at),
                   COALESCE(result_counts.last_result_activity_at, admission_cases.updated_at),
                   COALESCE(lab_order_counts.last_lab_order_activity_at, admission_cases.updated_at),
                   COALESCE(discharge_counts.discharge_last_activity_at, admission_cases.updated_at)
               ) AS last_activity_at
        FROM selected_admissions admission_cases
        JOIN patients
          ON patients.id = admission_cases.patient_id
         AND patients.facility_id = admission_cases.facility_id
        JOIN wards
          ON wards.id = admission_cases.ward_id
         AND wards.facility_id = admission_cases.facility_id
        LEFT JOIN fluid_admission_monitoring fluid_monitor ON fluid_monitor.facility_id=admission_cases.facility_id AND fluid_monitor.admission_case_id=admission_cases.id
        LEFT JOIN beds
          ON beds.id = admission_cases.bed_id
         AND beds.facility_id = admission_cases.facility_id
        LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE nursing_tasks.status = 'open') AS open_nursing_task_count,
                   count(*) FILTER (
                       WHERE nursing_tasks.status = 'open'
                         AND nursing_tasks.due_at <= now()
                   ) AS overdue_nursing_task_count,
                   min(nursing_tasks.due_at) FILTER (WHERE nursing_tasks.status = 'open') AS next_nursing_task_due_at,
                   max(nursing_tasks.updated_at) FILTER (WHERE nursing_tasks.status = 'open') AS last_task_activity_at
            FROM nursing_tasks
            WHERE nursing_tasks.admission_case_id = admission_cases.id
              AND nursing_tasks.facility_id = admission_cases.facility_id
        ) task_counts ON true
        LEFT JOIN LATERAL (
            SELECT count(*) FILTER (
                       WHERE medication_administrations.status = 'scheduled'
                         AND medication_administrations.scheduled_at <= now()
                   ) AS due_medication_count,
                   min(medication_administrations.scheduled_at) FILTER (
                       WHERE medication_administrations.status = 'scheduled'
                         AND medication_administrations.scheduled_at <= now()
                   ) AS next_due_medication_at,
                   max(medication_administrations.updated_at) FILTER (
                       WHERE medication_administrations.status = 'scheduled'
                   ) AS last_medication_activity_at
            FROM medication_administrations
            WHERE medication_administrations.admission_case_id = admission_cases.id
              AND medication_administrations.facility_id = admission_cases.facility_id
        ) med_counts ON true
        LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE nursing_alerts.status = 'open') AS active_alert_count,
                   count(*) FILTER (
                       WHERE nursing_alerts.status = 'open'
                         AND nursing_alerts.severity IN ('critical', 'high')
                   ) AS critical_alert_count,
                   max(nursing_alerts.updated_at) FILTER (WHERE nursing_alerts.status = 'open') AS last_alert_activity_at
            FROM nursing_alerts
            WHERE nursing_alerts.admission_case_id = admission_cases.id
              AND nursing_alerts.facility_id = admission_cases.facility_id
        ) alert_counts ON true
        LEFT JOIN LATERAL (
            SELECT max(patient_vitals.recorded_at) AS last_vitals_recorded_at
            FROM patient_vitals
            WHERE patient_vitals.facility_id = admission_cases.facility_id
              AND patient_vitals.admission_case_id = admission_cases.id
        ) vitals ON true
        LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE lab_results.verified_at IS NULL) AS unverified_result_count,
                   count(*) FILTER (
                       WHERE lab_results.verified_at IS NULL
                         AND lab_results.is_critical = TRUE
                   ) AS critical_unverified_result_count,
                   max(lab_results.updated_at) FILTER (WHERE lab_results.verified_at IS NULL) AS last_result_activity_at
            FROM lab_results
            JOIN lab_orders
              ON lab_orders.id = lab_results.order_id
             AND lab_orders.facility_id = lab_results.facility_id
            WHERE lab_results.facility_id = admission_cases.facility_id
              AND lab_results.patient_id = admission_cases.patient_id
              AND lab_results.status <> 'verified'
              AND (
                  (
                      admission_cases.encounter_id IS NOT NULL
                      AND (
                          lab_orders.encounter_id = admission_cases.encounter_id
                          OR (
                              lab_orders.encounter_id IS NULL
                              AND admission_cases.visit_id IS NOT NULL
                              AND lab_orders.visit_id = admission_cases.visit_id
                          )
                      )
                  )
                  OR (
                      admission_cases.encounter_id IS NULL
                      AND admission_cases.visit_id IS NOT NULL
                      AND lab_orders.visit_id = admission_cases.visit_id
                  )
                  OR (
                      admission_cases.encounter_id IS NULL
                      AND admission_cases.visit_id IS NULL
                      AND lab_orders.ordered_at >= admission_cases.admitted_at
                  )
              )
        ) result_counts ON true
        LEFT JOIN LATERAL (
            SELECT count(*) AS pending_lab_order_count,
                   max(lab_orders.updated_at) AS last_lab_order_activity_at
            FROM lab_orders
            WHERE lab_orders.facility_id = admission_cases.facility_id
              AND lab_orders.patient_id = admission_cases.patient_id
              AND lab_orders.status IN ('ordered', 'specimen_collected')
              AND (
                  (
                      admission_cases.encounter_id IS NOT NULL
                      AND (
                          lab_orders.encounter_id = admission_cases.encounter_id
                          OR (
                              lab_orders.encounter_id IS NULL
                              AND admission_cases.visit_id IS NOT NULL
                              AND lab_orders.visit_id = admission_cases.visit_id
                          )
                      )
                  )
                  OR (
                      admission_cases.encounter_id IS NULL
                      AND admission_cases.visit_id IS NOT NULL
                      AND lab_orders.visit_id = admission_cases.visit_id
                  )
                  OR (
                      admission_cases.encounter_id IS NULL
                      AND admission_cases.visit_id IS NULL
                      AND lab_orders.ordered_at >= admission_cases.admitted_at
                  )
              )
        ) lab_order_counts ON true
        LEFT JOIN LATERAL (
            SELECT dc.id AS discharge_case_id,
                   dc.status AS discharge_status,
                   dc.updated_at AS discharge_last_activity_at,
                   (
                       CASE
                           WHEN NOT EXISTS (
                               SELECT 1
                               FROM clinical_notes
                               WHERE clinical_notes.facility_id = dc.facility_id
                                 AND clinical_notes.patient_id = dc.patient_id
                                 AND clinical_notes.note_type = 'doctor_note'
                                 AND lower(clinical_notes.title) = 'discharge summary'
                                 AND clinical_notes.status IN ('signed', 'amended')
                                 AND (
                                     (
                                         COALESCE(dc.encounter_id, admission_cases.encounter_id) IS NOT NULL
                                         AND clinical_notes.encounter_id = COALESCE(dc.encounter_id, admission_cases.encounter_id)
                                     )
                                     OR (
                                         COALESCE(dc.encounter_id, admission_cases.encounter_id) IS NULL
                                         AND COALESCE(dc.visit_id, admission_cases.visit_id) IS NOT NULL
                                         AND EXISTS (
                                             SELECT 1
                                             FROM encounters
                                             WHERE encounters.facility_id = dc.facility_id
                                               AND encounters.id = clinical_notes.encounter_id
                                               AND encounters.visit_id = COALESCE(dc.visit_id, admission_cases.visit_id)
                                         )
                                     )
                                 )
                           )
                           AND NOT EXISTS (
                               SELECT 1
                               FROM discharge_blocker_overrides
                               WHERE discharge_blocker_overrides.facility_id = dc.facility_id
                                 AND discharge_blocker_overrides.discharge_case_id = dc.id
                                 AND discharge_blocker_overrides.blocker_type = 'discharge_summary'
                           )
                           THEN 1 ELSE 0
                       END
                       + CASE
                           WHEN (
                               trim(COALESCE(dc.nursing_release_education, '')) = ''
                               OR trim(COALESCE(dc.nursing_release_instructions, '')) = ''
                           )
                           AND NOT EXISTS (
                               SELECT 1
                               FROM discharge_blocker_overrides
                               WHERE discharge_blocker_overrides.facility_id = dc.facility_id
                                 AND discharge_blocker_overrides.discharge_case_id = dc.id
                                 AND discharge_blocker_overrides.blocker_type = 'nursing_release'
                           )
                           THEN 1 ELSE 0
                       END
                       + CASE
                           WHEN EXISTS (
                               SELECT 1
                               FROM invoices
                               WHERE invoices.facility_id = dc.facility_id
                                 AND invoices.patient_id = dc.patient_id
                                 AND invoices.status <> 'void'
                                 AND GREATEST(invoices.gross_amount_minor - invoices.paid_amount_minor, 0) > 0
                                 AND (
                                     invoices.admission_case_id = dc.admission_case_id
                                     OR (
                                         invoices.admission_case_id IS NULL
                                         AND COALESCE(dc.encounter_id, admission_cases.encounter_id) IS NOT NULL
                                         AND invoices.encounter_id = COALESCE(dc.encounter_id, admission_cases.encounter_id)
                                     )
                                     OR (
                                         invoices.admission_case_id IS NULL
                                         AND COALESCE(dc.encounter_id, admission_cases.encounter_id) IS NULL
                                         AND COALESCE(dc.visit_id, admission_cases.visit_id) IS NOT NULL
                                         AND invoices.visit_id = COALESCE(dc.visit_id, admission_cases.visit_id)
                                     )
                                 )
                           )
                           AND NOT EXISTS (
                               SELECT 1
                               FROM discharge_blocker_overrides
                               WHERE discharge_blocker_overrides.facility_id = dc.facility_id
                                 AND discharge_blocker_overrides.discharge_case_id = dc.id
                                 AND discharge_blocker_overrides.blocker_type = 'billing_clearance'
                           )
                           THEN 1 ELSE 0
                       END
                       + CASE
                           WHEN dc.pharmacy_required
                           AND NOT EXISTS (
                               SELECT 1
                               FROM pharmacy_fulfillments
                               WHERE pharmacy_fulfillments.facility_id = dc.facility_id
                                 AND pharmacy_fulfillments.patient_id = dc.patient_id
                                 AND pharmacy_fulfillments.admission_case_id = dc.admission_case_id
                                 AND pharmacy_fulfillments.status = 'dispensed'
                           )
                           AND NOT EXISTS (
                               SELECT 1
                               FROM discharge_blocker_overrides
                               WHERE discharge_blocker_overrides.facility_id = dc.facility_id
                                 AND discharge_blocker_overrides.discharge_case_id = dc.id
                                 AND discharge_blocker_overrides.blocker_type = 'pharmacy_clearance'
                           )
                           THEN 1 ELSE 0
                       END
                   )::bigint AS open_discharge_blocker_count
            FROM discharge_cases dc
            WHERE dc.facility_id = admission_cases.facility_id
              AND dc.admission_case_id = admission_cases.id
              AND dc.status = 'requested'
            LIMIT 1
        ) discharge_counts ON true
        "#
}

fn push_ward_board_cursor(
    query: &mut QueryBuilder<'static, Postgres>,
    cursor: Option<WardBoardCursor>,
) {
    match cursor {
        Some(WardBoardCursor::Admitted(cursor)) => {
            query.push(" AND (admitted_at, id) > (");
            query.push_bind(cursor.occurred_at);
            query.push(", ");
            query.push_bind(cursor.id);
            query.push(")");
        }
        Some(WardBoardCursor::Attention {
            rank,
            occurred_at,
            id,
        }) => {
            query.push(" AND (attention_rank, admitted_at, id) > (");
            query.push_bind(rank);
            query.push(", ");
            query.push_bind(occurred_at);
            query.push(", ");
            query.push_bind(id);
            query.push(")");
        }
        None => {}
    }
}

fn push_ward_board_order(query: &mut QueryBuilder<'static, Postgres>, sort: WardBoardSort) {
    match sort {
        WardBoardSort::Attention => {
            query.push(
                " ORDER BY admission_cases.attention_rank ASC, admission_cases.admitted_at ASC, admission_cases.id ASC",
            );
        }
        WardBoardSort::Admitted => {
            query.push(" ORDER BY admission_cases.admitted_at ASC, admission_cases.id ASC");
        }
    }
}

fn admission_case_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT admission_cases.id,
               admission_cases.patient_id,
               admission_cases.encounter_id,
               admission_cases.visit_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               admission_cases.ward_id,
               wards.name AS ward_name,
               admission_cases.bed_id,
               beds.bed_code,
               admission_cases.status,
               admission_cases.created_at,
               CASE
                   WHEN admission_cases.status IN ('admitted', 'discharge_pending', 'discharged')
                   THEN admission_cases.admitted_at
                   ELSE NULL
               END AS admitted_at,
               admission_cases.discharged_at,
               admission_cases.placement_revision
        FROM admission_cases
        JOIN patients
          ON patients.id = admission_cases.patient_id
         AND patients.facility_id = admission_cases.facility_id
        JOIN wards
          ON wards.id = admission_cases.ward_id
         AND wards.facility_id = admission_cases.facility_id
        LEFT JOIN fluid_admission_monitoring fluid_monitor ON fluid_monitor.facility_id=admission_cases.facility_id AND fluid_monitor.admission_case_id=admission_cases.id
        LEFT JOIN beds
          ON beds.id = admission_cases.bed_id
         AND beds.facility_id = admission_cases.facility_id
        "#,
    )
}

async fn ward_board_item_by_admission(
    pool: &PgPool,
    facility_id: Uuid,
    admission_id: Uuid,
) -> anyhow::Result<WardBoardItem> {
    get_ward_board_admission(pool, facility_id, admission_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("ward board admission was not found after write"))
}

async fn admission_case_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<AdmissionCaseListItem> {
    optional_admission_case_by_id(pool, facility_id, admission_case_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("admission case was not found after write"))
}

async fn optional_admission_case_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    let mut query = admission_case_query();
    query.push(" WHERE admission_cases.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND admission_cases.id = ");
    query.push_bind(admission_case_id);
    let row = observe_db_query(
        "ward.admission_cases.get",
        query
            .build_query_as::<AdmissionCaseRow>()
            .fetch_optional(pool),
    )
    .await?;
    row.map(admission_case_from_row).transpose()
}

#[derive(FromRow)]
struct LockedAdmissionBed {
    id: Uuid,
    section_id: Option<Uuid>,
}

async fn lock_available_bed(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    ward_id: Uuid,
    bed_id: Option<Uuid>,
    owner_case_id: Option<Uuid>,
) -> anyhow::Result<Option<Uuid>> {
    // All canonical placement producers retain the same order: ward, bed,
    // then its actual section. Section administration never locks a bed.
    let ward: Option<Uuid> = observe_db_query(
        "ward.admission_cases.placement.active_ward",
        sqlx::query_scalar(
            "SELECT id FROM wards WHERE facility_id=$1 AND id=$2 AND status='active' FOR SHARE",
        )
        .bind(facility_id)
        .bind(ward_id)
        .fetch_optional(&mut **transaction),
    )
    .await?;
    if ward.is_none() {
        return Ok(None);
    }
    let bed = match bed_id {
        Some(bed_id) => {
            observe_db_query(
                "ward.admission_cases.lock_requested_bed",
                sqlx::query_as::<_, LockedAdmissionBed>(
                    r#"
            SELECT id, section_id
            FROM beds
            WHERE facility_id = $1
              AND ward_id = $2
              AND id = $3
              AND (status='available' OR (status='reserved' AND EXISTS(
                SELECT 1 FROM admission_cases own
                WHERE own.id=$4 AND own.facility_id=beds.facility_id
                  AND own.ward_id=beds.ward_id AND own.bed_id=beds.id
                  AND own.status='ready_for_activation')))
              AND NOT EXISTS(
                SELECT 1 FROM admission_cases a
                WHERE a.facility_id=beds.facility_id AND a.bed_id=beds.id
                  AND a.status IN('ready_for_activation','admitted','discharge_pending')
                  AND ($4::uuid IS NULL OR a.id<>$4))
            FOR UPDATE
            "#,
                )
                .bind(facility_id)
                .bind(ward_id)
                .bind(bed_id)
                .bind(owner_case_id)
                .fetch_optional(&mut **transaction),
            )
            .await?
        }
        None => {
            observe_db_query(
                "ward.admission_cases.lock_first_available_bed",
                sqlx::query_as::<_, LockedAdmissionBed>(
                    r#"
            SELECT id, section_id
            FROM beds
            WHERE facility_id = $1
              AND ward_id = $2
              AND status='available'
              AND NOT EXISTS(
                SELECT 1 FROM admission_cases a
                WHERE a.facility_id=beds.facility_id AND a.bed_id=beds.id
                  AND a.status IN('ready_for_activation','admitted','discharge_pending')
                  AND ($3::uuid IS NULL OR a.id<>$3))
              AND (section_id IS NULL OR EXISTS(
                SELECT 1 FROM ward_sections s
                WHERE s.id=beds.section_id AND s.facility_id=beds.facility_id
                  AND s.ward_id=beds.ward_id AND s.status='active'))
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            "#,
                )
                .bind(facility_id)
                .bind(ward_id)
                .bind(owner_case_id)
                .fetch_optional(&mut **transaction),
            )
            .await?
        }
    };
    let Some(bed) = bed else {
        return Ok(None);
    };
    // This is a fresh statement after the bed lock, not an EXISTS evaluated
    // before its wait. The locked bed also retains the reviewed section ID.
    if let Some(section_id) = bed.section_id {
        let section: Option<Uuid> = observe_db_query(
            "ward.admission_cases.placement.active_section",
            sqlx::query_scalar(
                "SELECT id FROM ward_sections WHERE facility_id=$1 AND ward_id=$2 AND id=$3 AND status='active' FOR SHARE",
            )
            .bind(facility_id)
            .bind(ward_id)
            .bind(section_id)
            .fetch_optional(&mut **transaction),
        )
        .await?;
        if section.is_none() {
            return Ok(None);
        }
    }
    Ok(Some(bed.id))
}

#[derive(Clone, Debug, FromRow)]
struct AdmissionContextRow {
    id: Uuid,
    patient_id: Uuid,
    ward_id: Uuid,
    bed_id: Option<Uuid>,
    encounter_id: Option<Uuid>,
    visit_id: Option<Uuid>,
}

#[derive(Clone, Debug, FromRow)]
struct AdmissionContextStatusRow {
    id: Uuid,
    ward_id: Uuid,
    bed_id: Option<Uuid>,
    status: String,
}

fn ward_board_from_row(row: WardBoardRow) -> anyhow::Result<WardBoardItem> {
    Ok(WardBoardItem {
        placement_revision: row.placement_revision,
        admission_id: row.admission_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        ward_id: row.ward_id,
        ward_name: row.ward_name,
        bed_id: row.bed_id,
        bed_code: row.bed_code,
        admission_status: codec::decode(&row.admission_status)?,
        admitted_at: row.admitted_at,
        open_nursing_task_count: row.open_nursing_task_count,
        overdue_nursing_task_count: row.overdue_nursing_task_count,
        next_nursing_task_due_at: row.next_nursing_task_due_at,
        due_medication_count: row.due_medication_count,
        next_due_medication_at: row.next_due_medication_at,
        active_alert_count: row.active_alert_count,
        fluid_condition_count: row.fluid_condition_count,
        fluid_critical_count: row.fluid_critical_count,
        fluid_assessment_status: codec::decode(&row.fluid_assessment_status)?,
        critical_alert_count: row.critical_alert_count,
        last_vitals_recorded_at: row.last_vitals_recorded_at,
        unverified_result_count: row.unverified_result_count,
        critical_unverified_result_count: row.critical_unverified_result_count,
        pending_lab_order_count: row.pending_lab_order_count,
        discharge_case_id: row.discharge_case_id,
        discharge_status: row
            .discharge_status
            .as_deref()
            .map(codec::decode::<DischargeStatus>)
            .transpose()?,
        open_discharge_blocker_count: row.open_discharge_blocker_count,
        last_activity_at: row.last_activity_at,
    })
}

fn like_contains_pattern(search: Option<&str>) -> Option<String> {
    let trimmed = search?.trim();
    if trimmed.is_empty() {
        return None;
    }
    let escaped = trimmed
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    Some(format!("%{escaped}%"))
}

fn push_monitoring_filter(
    query: &mut QueryBuilder<'static, Postgres>,
    monitoring_filter: WardBoardMonitoringFilter,
) {
    match monitoring_filter {
        WardBoardMonitoringFilter::NeedsAttention => {
            query.push(" AND admission_cases.attention_rank < 3");
        }
        WardBoardMonitoringFilter::Critical => {
            query.push(
                r#" AND (
                    EXISTS (SELECT 1 FROM fluid_admission_monitoring f WHERE f.facility_id=admission_cases.facility_id AND f.admission_case_id=admission_cases.id AND f.critical_count>0) OR EXISTS (
                        SELECT 1
                        FROM nursing_alerts
                        WHERE nursing_alerts.facility_id = admission_cases.facility_id
                          AND nursing_alerts.admission_case_id = admission_cases.id
                          AND nursing_alerts.status = 'open'
                          AND nursing_alerts.severity IN ('critical', 'high')
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM lab_results
                        JOIN lab_orders
                          ON lab_orders.id = lab_results.order_id
                         AND lab_orders.facility_id = lab_results.facility_id
                        WHERE lab_results.facility_id = admission_cases.facility_id
                          AND lab_results.patient_id = admission_cases.patient_id
                          AND lab_results.verified_at IS NULL
                          AND lab_results.status <> 'verified'
                          AND lab_results.is_critical = TRUE
                          AND (
                              (
                                  admission_cases.encounter_id IS NOT NULL
                                  AND (
                                      lab_orders.encounter_id = admission_cases.encounter_id
                                      OR (
                                          lab_orders.encounter_id IS NULL
                                          AND admission_cases.visit_id IS NOT NULL
                                          AND lab_orders.visit_id = admission_cases.visit_id
                                      )
                                  )
                              )
                              OR (
                                  admission_cases.encounter_id IS NULL
                                  AND admission_cases.visit_id IS NOT NULL
                                  AND lab_orders.visit_id = admission_cases.visit_id
                              )
                              OR (
                                  admission_cases.encounter_id IS NULL
                                  AND admission_cases.visit_id IS NULL
                                  AND lab_orders.ordered_at >= admission_cases.admitted_at
                              )
                          )
                    )
                )"#,
            );
        }
        WardBoardMonitoringFilter::Alerts => {
            query.push(
                r#" AND (EXISTS (SELECT 1 FROM fluid_admission_monitoring f WHERE f.facility_id=admission_cases.facility_id AND f.admission_case_id=admission_cases.id AND f.condition_count>0) OR EXISTS (
                    SELECT 1
                    FROM nursing_alerts
                    WHERE nursing_alerts.facility_id = admission_cases.facility_id
                      AND nursing_alerts.admission_case_id = admission_cases.id
                      AND nursing_alerts.status = 'open'
                ))"#,
            );
        }
        WardBoardMonitoringFilter::Tasks => {
            query.push(
                r#" AND EXISTS (
                    SELECT 1
                    FROM nursing_tasks
                    WHERE nursing_tasks.facility_id = admission_cases.facility_id
                      AND nursing_tasks.admission_case_id = admission_cases.id
                      AND nursing_tasks.status = 'open'
                )"#,
            );
        }
        WardBoardMonitoringFilter::Results => {
            query.push(
                r#" AND (
                    EXISTS (
                        SELECT 1
                        FROM lab_results
                        JOIN lab_orders
                          ON lab_orders.id = lab_results.order_id
                         AND lab_orders.facility_id = lab_results.facility_id
                        WHERE lab_results.facility_id = admission_cases.facility_id
                          AND lab_results.patient_id = admission_cases.patient_id
                          AND lab_results.verified_at IS NULL
                          AND lab_results.status <> 'verified'
                          AND (
                              (
                                  admission_cases.encounter_id IS NOT NULL
                                  AND (
                                      lab_orders.encounter_id = admission_cases.encounter_id
                                      OR (
                                          lab_orders.encounter_id IS NULL
                                          AND admission_cases.visit_id IS NOT NULL
                                          AND lab_orders.visit_id = admission_cases.visit_id
                                      )
                                  )
                              )
                              OR (
                                  admission_cases.encounter_id IS NULL
                                  AND admission_cases.visit_id IS NOT NULL
                                  AND lab_orders.visit_id = admission_cases.visit_id
                              )
                              OR (
                                  admission_cases.encounter_id IS NULL
                                  AND admission_cases.visit_id IS NULL
                                  AND lab_orders.ordered_at >= admission_cases.admitted_at
                              )
                          )
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM lab_orders
                        WHERE lab_orders.facility_id = admission_cases.facility_id
                          AND lab_orders.patient_id = admission_cases.patient_id
                          AND lab_orders.status IN ('ordered', 'specimen_collected')
                          AND (
                              (
                                  admission_cases.encounter_id IS NOT NULL
                                  AND (
                                      lab_orders.encounter_id = admission_cases.encounter_id
                                      OR (
                                          lab_orders.encounter_id IS NULL
                                          AND admission_cases.visit_id IS NOT NULL
                                          AND lab_orders.visit_id = admission_cases.visit_id
                                      )
                                  )
                              )
                              OR (
                                  admission_cases.encounter_id IS NULL
                                  AND admission_cases.visit_id IS NOT NULL
                                  AND lab_orders.visit_id = admission_cases.visit_id
                              )
                              OR (
                                  admission_cases.encounter_id IS NULL
                                  AND admission_cases.visit_id IS NULL
                                  AND lab_orders.ordered_at >= admission_cases.admitted_at
                              )
                          )
                    )
                )"#,
            );
        }
        WardBoardMonitoringFilter::Discharge => {
            query.push(
                r#" AND EXISTS (
                    SELECT 1
                    FROM discharge_cases
                    WHERE discharge_cases.facility_id = admission_cases.facility_id
                      AND discharge_cases.admission_case_id = admission_cases.id
                      AND discharge_cases.status = 'requested'
                )"#,
            );
        }
        WardBoardMonitoringFilter::DueWork | WardBoardMonitoringFilter::MyWork => {
            query.push(
                r#" AND (
                    EXISTS (
                        SELECT 1
                        FROM nursing_tasks
                        WHERE nursing_tasks.facility_id = admission_cases.facility_id
                          AND nursing_tasks.admission_case_id = admission_cases.id
                          AND nursing_tasks.status = 'open'
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM medication_administrations
                        WHERE medication_administrations.facility_id = admission_cases.facility_id
                          AND medication_administrations.admission_case_id = admission_cases.id
                          AND medication_administrations.status = 'scheduled'
                          AND medication_administrations.scheduled_at <= now()
                    )
                )"#,
            );
        }
    }
}

fn admission_case_from_row(row: AdmissionCaseRow) -> anyhow::Result<AdmissionCaseListItem> {
    Ok(AdmissionCaseListItem {
        placement_revision: row.placement_revision,
        id: row.id,
        patient_id: row.patient_id,
        encounter_id: row.encounter_id,
        visit_id: row.visit_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        ward_id: row.ward_id,
        ward_name: row.ward_name,
        bed_id: row.bed_id,
        bed_code: row.bed_code,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
        admitted_at: row.admitted_at,
        discharged_at: row.discharged_at,
    })
}
