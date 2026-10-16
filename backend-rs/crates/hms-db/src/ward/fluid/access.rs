//! Live proof and current admission-ward scope for current and compatibility fluid APIs.
use super::*;
use crate::ward::nursing_access as nursing;
use chrono::NaiveDate;
use hms_domain::ward::{
    AdmissionStatus, FluidBalanceListItem, FluidBalanceSummary, FluidBalanceTrendPoint,
};

pub(super) async fn clinical(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut FluidActor,
) -> anyhow::Result<Option<Vec<Uuid>>> {
    nursing::verify(tx, actor).await
}
pub(super) async fn deadline(
    tx: &mut Transaction<'_, Postgres>,
    actor: &FluidActor,
) -> anyhow::Result<()> {
    nursing::deadline(tx, actor).await
}
pub(super) async fn admin_deadline(
    tx: &mut Transaction<'_, Postgres>,
    actor: &FluidActor,
) -> anyhow::Result<()> {
    deadline(tx, actor).await.map_err(|e| {
        if e.downcast_ref::<nursing::NursingError>()
            == Some(&nursing::NursingError::AuthorizationExpired)
        {
            FluidError::AuthorizationExpired.into()
        } else {
            e
        }
    })
}
pub(super) async fn administrative(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut FluidActor,
) -> anyhow::Result<()> {
    use crate::clinical::prescription_courses::{
        PrescriptionActor, PrescriptionAuthorization, PrescriptionCourseError,
    };
    let mut proof = PrescriptionActor {
        facility_id: actor.facility_id,
        user_id: actor.user_id,
        request_id: actor.request_id.clone(),
        authorization: Some(PrescriptionAuthorization {
            session_id: actor.session_id,
            session_version: actor.session_version,
            permission_version: actor.permission_version,
            active_profile: actor.active_profile,
            valid_until: actor.valid_until,
        }),
    };
    crate::clinical::prescription_courses::verify_actor(tx, &mut proof)
        .await
        .map_err(|e| {
            if e.is::<PrescriptionCourseError>() {
                FluidError::AuthorizationExpired.into()
            } else {
                e
            }
        })?;
    actor.valid_until = proof
        .authorization
        .ok_or(FluidError::AuthorizationExpired)?
        .valid_until;
    let enabled:Option<bool>=hms_observability::observe_db_query("ward.fluid.admin_feature",sqlx::query_scalar("SELECT enabled FROM facility_feature_entitlements WHERE facility_id=$1 AND feature_key='admin'").bind(actor.facility_id).fetch_optional(&mut **tx)).await?;
    let defaults = hms_domain::capabilities::feature_flags_for_profile(actor.active_profile);
    if !enabled.unwrap_or_else(|| {
        defaults
            .get(&hms_domain::deployment::FeatureKey::Admin)
            .copied()
            .unwrap_or(false)
    }) {
        return Err(FluidError::FeatureDisabled.into());
    }
    admin_deadline(tx, actor).await
}
pub async fn fluid_observation_scope(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<(Uuid, Uuid, Uuid)>> {
    Ok(hms_observability::observe_db_query("ward.fluid.scope",sqlx::query_as("SELECT r.id,e.patient_id,e.admission_case_id FROM fluid_balance_entries e JOIN fluid_observation_roots r ON r.id=COALESCE(e.root_entry_id,e.id) AND r.facility_id=e.facility_id AND r.patient_id=e.patient_id AND r.admission_case_id=e.admission_case_id WHERE e.facility_id=$1 AND e.id=$2").bind(facility).bind(id).fetch_optional(pool)).await?)
}
async fn source<'a>(
    pool: &'a PgPool,
    actor: &mut FluidActor,
    id: Uuid,
) -> anyhow::Result<(Transaction<'a, Postgres>, Uuid)> {
    let mut tx = pool.begin().await?;
    let row:Option<(Uuid,Uuid,Uuid)>=hms_observability::observe_db_query("ward.fluid.source",sqlx::query_as("SELECT r.id,r.patient_id,r.admission_case_id FROM fluid_balance_entries e JOIN fluid_observation_roots r ON r.id=COALESCE(e.root_entry_id,e.id) AND r.facility_id=e.facility_id AND r.patient_id=e.patient_id AND r.admission_case_id=e.admission_case_id WHERE e.facility_id=$1 AND e.id=$2 FOR SHARE OF r").bind(actor.facility_id).bind(id).fetch_optional(&mut *tx)).await?;
    let (root, patient, admission) = row.ok_or(nursing::NursingError::NotFound)?;
    let wards = clinical(&mut tx, actor).await?;
    nursing::admission(&mut tx, actor, &wards, admission, patient, None, false).await?;
    Ok((tx, root))
}
pub async fn fluid_context_for_actor(
    pool: &PgPool,
    mut actor: FluidActor,
    patient: Uuid,
    admission: Uuid,
) -> anyhow::Result<FluidObservationContext> {
    let mut tx = pool.begin().await?;
    let wards = clinical(&mut tx, &mut actor).await?;
    nursing::admission(&mut tx, &actor, &wards, admission, patient, None, false).await?;
    let (status,ward_active):(String,bool)=hms_observability::observe_db_query("ward.fluid.context",sqlx::query_as("SELECT a.status,w.status='active' FROM admission_cases a JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id WHERE a.facility_id=$1 AND a.id=$2 AND a.patient_id=$3").bind(actor.facility_id).bind(admission).bind(patient).fetch_one(&mut *tx)).await?;
    let status: AdmissionStatus = codec::decode(&status)?;
    let result = FluidObservationContext {
        patient_id: patient,
        admission_case_id: admission,
        status,
        can_record_observation: ward_active
            && matches!(
                status,
                AdmissionStatus::Admitted | AdmissionStatus::DischargePending
            ),
    };
    deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn get_fluid_observation_for_actor(
    pool: &PgPool,
    mut actor: FluidActor,
    id: Uuid,
) -> anyhow::Result<FluidObservation> {
    let (mut tx, _) = source(pool, &mut actor, id).await?;
    let mut q = observation_query();
    q.push(" WHERE e.facility_id=")
        .push_bind(actor.facility_id)
        .push(" AND e.id=")
        .push_bind(id);
    let result = from_row(
        hms_observability::observe_db_query(
            "ward.fluid.detail",
            q.build_query_as::<ObservationRow>().fetch_one(&mut *tx),
        )
        .await?,
    )?;
    deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
fn scope(
    q: &mut QueryBuilder<'_, Postgres>,
    actor: &FluidActor,
    wards: Option<Vec<Uuid>>,
    f: &FluidBalanceFilters,
) {
    q.push(" WHERE e.facility_id=").push_bind(actor.facility_id);
    if let Some(ids) = wards {
        q.push(" AND admission_scope.ward_id=ANY(")
            .push_bind(ids)
            .push(")");
    }
    if let Some(id) = f.patient_id {
        q.push(" AND e.patient_id=").push_bind(id);
    }
    if let Some(id) = f.admission_case_id {
        q.push(" AND e.admission_case_id=").push_bind(id);
    }
    if let Some(at) = f.recorded_from {
        q.push(" AND e.recorded_at>=").push_bind(at);
    }
    if let Some(at) = f.recorded_before {
        q.push(" AND e.recorded_at<").push_bind(at);
    }
}
pub async fn list_fluid_observations_for_actor(
    pool: &PgPool,
    mut actor: FluidActor,
    f: FluidBalanceFilters,
    include_closed: bool,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<FluidObservation>> {
    let mut tx = pool.begin().await?;
    let wards = filters_proof(&mut tx, &mut actor, &f).await?;
    let mut q = observation_query();
    scope(&mut q, &actor, wards, &f);
    q.push(if include_closed {
        " AND (r.current_entry_id=e.id OR (r.current_entry_id IS NULL AND e.revision=r.revision-1))"
    } else {
        " AND r.current_entry_id=e.id"
    });
    if let Some(c) = cursor {
        q.push(if f.descending {
            " AND (e.recorded_at,e.id)<("
        } else {
            " AND (e.recorded_at,e.id)>("
        })
        .push_bind(c.occurred_at)
        .push(",")
        .push_bind(c.id)
        .push(")");
    }
    q.push(if f.descending {
        " ORDER BY e.recorded_at DESC,e.id DESC LIMIT "
    } else {
        " ORDER BY e.recorded_at,e.id LIMIT "
    })
    .push_bind(limit.clamp(1, 101));
    let result = hms_observability::observe_db_query(
        "ward.fluid.observations",
        q.build_query_as::<ObservationRow>().fetch_all(&mut *tx),
    )
    .await?
    .into_iter()
    .map(from_row)
    .collect::<anyhow::Result<_>>()?;
    deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn fluid_history_for_actor(
    pool: &PgPool,
    mut actor: FluidActor,
    id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<FluidObservation>> {
    let (mut tx, root) = source(pool, &mut actor, id).await?;
    let mut q = observation_query();
    q.push(" WHERE e.facility_id=")
        .push_bind(actor.facility_id)
        .push(" AND r.id=")
        .push_bind(root);
    if let Some(c) = cursor {
        q.push(" AND (e.created_at,e.id)<(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY e.created_at DESC,e.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let result = hms_observability::observe_db_query(
        "ward.fluid.observations",
        q.build_query_as::<ObservationRow>().fetch_all(&mut *tx),
    )
    .await?
    .into_iter()
    .map(from_row)
    .collect::<anyhow::Result<_>>()?;
    deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}

async fn filters_proof(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut FluidActor,
    f: &FluidBalanceFilters,
) -> anyhow::Result<Option<Vec<Uuid>>> {
    let wards = clinical(tx, actor).await?;
    if let Some(admission) = f.admission_case_id {
        let patient: Uuid = if let Some(patient) = f.patient_id {
            patient
        } else {
            hms_observability::observe_db_query(
                "ward.fluid.admission_scope",
                sqlx::query_scalar(
                    "SELECT patient_id FROM admission_cases WHERE facility_id=$1 AND id=$2",
                )
                .bind(actor.facility_id)
                .bind(admission)
                .fetch_optional(&mut **tx),
            )
            .await?
            .ok_or(nursing::NursingError::InvalidContext)?
        };
        nursing::admission(tx, actor, &wards, admission, patient, None, false).await?;
    }
    Ok(wards)
}
pub async fn fluid_effective_summary_for_actor(
    pool: &PgPool,
    mut actor: FluidActor,
    f: FluidBalanceFilters,
) -> anyhow::Result<FluidEffectiveSummary> {
    let mut tx = pool.begin().await?;
    let wards = filters_proof(&mut tx, &mut actor, &f).await?;
    let row = hms_observability::observe_db_query(
        "ward.fluid.rich_summary",
        summary_query(actor.facility_id, f, wards)
            .build_query_as::<SummaryRow>()
            .fetch_one(&mut *tx),
    )
    .await?;
    let result = FluidEffectiveSummary {
        entry_count: row.entry_count,
        total_intake_ml: row.total_intake_ml,
        total_output_ml: row.total_output_ml,
        net_ml: row.total_intake_ml - row.total_output_ml,
        intake_breakdown: row.intake_breakdown.0,
        output_breakdown: row.output_breakdown.0,
    };
    deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
const EFFECTIVE_FROM:&str=" FROM fluid_balance_entries e JOIN fluid_observation_roots r ON r.facility_id=e.facility_id AND r.patient_id=e.patient_id AND r.admission_case_id=e.admission_case_id AND r.current_entry_id=e.id JOIN patients p ON p.id=e.patient_id AND p.facility_id=e.facility_id JOIN admission_cases admission_scope ON admission_scope.id=e.admission_case_id AND admission_scope.facility_id=e.facility_id AND admission_scope.patient_id=e.patient_id";
#[derive(FromRow)]
struct LegacyRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    recorded_at: DateTime<Utc>,
    intake_ml: i32,
    output_ml: i32,
    net_ml: i32,
}
fn legacy(row: LegacyRow) -> FluidBalanceListItem {
    FluidBalanceListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        recorded_at: row.recorded_at,
        intake_ml: row.intake_ml,
        output_ml: row.output_ml,
        net_ml: row.net_ml,
    }
}
fn legacy_query() -> QueryBuilder<'static, Postgres> {
    let mut q=QueryBuilder::new("SELECT e.id,e.admission_case_id,e.patient_id,p.patient_code,p.first_name || ' ' || p.last_name AS patient_display_name,e.recorded_at,e.intake_ml,e.output_ml,(e.intake_ml-e.output_ml) AS net_ml");
    q.push(EFFECTIVE_FROM);
    q
}
pub async fn list_fluid_balance_for_actor(
    pool: &PgPool,
    mut actor: FluidActor,
    f: FluidBalanceFilters,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<FluidBalanceListItem>> {
    let mut tx = pool.begin().await?;
    let wards = filters_proof(&mut tx, &mut actor, &f).await?;
    let mut q = legacy_query();
    scope(&mut q, &actor, wards, &f);
    if let Some(c) = cursor {
        q.push(if f.descending {
            " AND (e.recorded_at,e.id)<("
        } else {
            " AND (e.recorded_at,e.id)>("
        })
        .push_bind(c.occurred_at)
        .push(",")
        .push_bind(c.id)
        .push(")");
    }
    q.push(if f.descending {
        " ORDER BY e.recorded_at DESC,e.id DESC LIMIT "
    } else {
        " ORDER BY e.recorded_at,e.id LIMIT "
    })
    .push_bind(limit.clamp(1, 101));
    let rows = hms_observability::observe_db_query(
        "ward.fluid.legacy_list",
        q.build_query_as::<LegacyRow>().fetch_all(&mut *tx),
    )
    .await?;
    deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(rows.into_iter().map(legacy).collect())
}
#[derive(FromRow)]
struct ScalarRow {
    entry_count: i64,
    total_intake_ml: i64,
    total_output_ml: i64,
}
pub async fn fluid_scalar_summary_for_actor(
    pool: &PgPool,
    mut actor: FluidActor,
    f: FluidBalanceFilters,
) -> anyhow::Result<FluidBalanceSummary> {
    let mut tx = pool.begin().await?;
    let wards = filters_proof(&mut tx, &mut actor, &f).await?;
    let mut q=QueryBuilder::new("SELECT count(*)::bigint AS entry_count,COALESCE(sum(e.intake_ml),0)::bigint AS total_intake_ml,COALESCE(sum(e.output_ml),0)::bigint AS total_output_ml");
    q.push(EFFECTIVE_FROM);
    scope(&mut q, &actor, wards, &f);
    let r = hms_observability::observe_db_query(
        "ward.fluid.scalar_summary",
        q.build_query_as::<ScalarRow>().fetch_one(&mut *tx),
    )
    .await?;
    deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(FluidBalanceSummary {
        entry_count: r.entry_count,
        total_intake_ml: r.total_intake_ml,
        total_output_ml: r.total_output_ml,
        net_ml: r.total_intake_ml - r.total_output_ml,
    })
}
#[derive(FromRow)]
struct TrendRow {
    date: NaiveDate,
    entry_count: i64,
    total_intake_ml: i64,
    total_output_ml: i64,
}
pub async fn fluid_scalar_trends_for_actor(
    pool: &PgPool,
    mut actor: FluidActor,
    f: FluidBalanceFilters,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<FluidBalanceTrendPoint>> {
    let mut tx = pool.begin().await?;
    let wards = filters_proof(&mut tx, &mut actor, &f).await?;
    let mut q=QueryBuilder::new("SELECT (e.recorded_at AT TIME ZONE 'UTC')::date AS date,count(*)::bigint AS entry_count,COALESCE(sum(e.intake_ml),0)::bigint AS total_intake_ml,COALESCE(sum(e.output_ml),0)::bigint AS total_output_ml");
    q.push(EFFECTIVE_FROM);
    scope(&mut q, &actor, wards, &f);
    q.push(" GROUP BY 1");
    if let Some(c) = cursor {
        q.push(if f.descending {
            " HAVING (e.recorded_at AT TIME ZONE 'UTC')::date<"
        } else {
            " HAVING (e.recorded_at AT TIME ZONE 'UTC')::date>"
        })
        .push_bind(c.occurred_at.date_naive());
    }
    q.push(if f.descending {
        " ORDER BY date DESC LIMIT "
    } else {
        " ORDER BY date LIMIT "
    })
    .push_bind(limit.clamp(1, 101));
    let rows = hms_observability::observe_db_query(
        "ward.fluid.scalar_trends",
        q.build_query_as::<TrendRow>().fetch_all(&mut *tx),
    )
    .await?;
    deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(rows
        .into_iter()
        .map(|r| FluidBalanceTrendPoint {
            date: r.date,
            entry_count: r.entry_count,
            total_intake_ml: r.total_intake_ml,
            total_output_ml: r.total_output_ml,
            net_ml: r.total_intake_ml - r.total_output_ml,
        })
        .collect())
}
/// Legacy combined entry: no fabricated idempotency key; mandatory live proof and active care.
pub async fn create_fluid_balance_for_actor(
    pool: &PgPool,
    mut actor: FluidActor,
    input: super::super::NewFluidBalanceEntry,
) -> anyhow::Result<FluidBalanceListItem> {
    if input.facility_id != actor.facility_id
        || input.recorded_by_user_id != actor.user_id
        || input.intake_ml < 0
        || input.output_ml < 0
        || input.intake_ml > 10000
        || input.output_ml > 10000
        || input.intake_ml + input.output_ml == 0
    {
        return Err(FluidError::InvalidValues.into());
    }
    let mut tx = pool.begin().await?;
    let wards = clinical(&mut tx, &mut actor).await?;
    nursing::admission(
        &mut tx,
        &actor,
        &wards,
        input.admission_case_id,
        input.patient_id,
        None,
        true,
    )
    .await?;
    if input.recorded_at > common::clock(&mut tx).await? {
        return Err(FluidError::FutureObservation.into());
    }
    insert_entry(
        &mut tx,
        &actor,
        input.id,
        None,
        1,
        input.patient_id,
        input.admission_case_id,
        &FluidObservationValues {
            recorded_at: input.recorded_at,
            intake_ml: input.intake_ml,
            output_ml: input.output_ml,
            metadata: FluidMetadata::default(),
        },
    )
    .await?;
    common::audit(&mut tx, &actor, input.id, "fluid.observation.created", 1).await?;
    let mut q = legacy_query();
    q.push(" WHERE e.facility_id=")
        .push_bind(actor.facility_id)
        .push(" AND e.id=")
        .push_bind(input.id);
    let row = q.build_query_as::<LegacyRow>().fetch_one(&mut *tx).await?;
    deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(legacy(row))
}
