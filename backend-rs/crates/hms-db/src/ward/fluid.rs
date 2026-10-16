//! Immutable fluid evidence and transactional effective projections.
mod access;
mod common;
pub use access::*;
mod rules;
use super::{FluidBalanceFilters, WardCursor};
use crate::{codec, PgPool};
use chrono::{DateTime, Utc};
use hms_domain::fluid::*;
pub use rules::{
    fluid_assessment, fluid_assessment_for_actor, get_fluid_rules, get_fluid_rules_for_actor,
    update_fluid_rules,
};
use sqlx::{types::Json, FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

/// Mandatory live session proof for protected fluid workflows. Rule operations
/// use the same identity facts with a separate administrative feature proof.
pub type FluidActor = super::nursing_access::NursingActor;
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FluidError {
    AuthorizationExpired,
    FeatureDisabled,
    InvalidRequest,
    InvalidValues,
    InvalidMetadata,
    InvalidReason,
    FutureObservation,
    NotCurrent,
    AdmissionUnavailable,
    RequestConflict,
    RuleConflict,
    InvalidRules,
}
impl FluidError {
    pub fn message(self) -> &'static str {
        match self{
 Self::AuthorizationExpired=>"Current fluid authority is required. Sign in and review current access.",
 Self::FeatureDisabled=>"The required facility feature is not enabled.",
 Self::InvalidRequest=>"Review the supported fluid request reference and context.",
 Self::InvalidValues=>"Record a positive whole volume of at most 10000 ml for each measured direction. Preserve both sides of an older combined record.",
 Self::InvalidMetadata=>"Choose the category for each measured direction and shorten the observation details to the displayed limits.",
 Self::InvalidReason=>"A reason of at most 1000 characters is required for this change.",
 Self::FutureObservation=>"An observation time cannot be in the future.",
 Self::NotCurrent=>"This entry has already been corrected or voided. Reload its history before continuing.",
 Self::AdmissionUnavailable=>"The admission and patient must belong to this facility; new observations require an active admission.",
 Self::RequestConflict=>"This request reference was used for a different change. Reload before continuing.",
 Self::RuleConflict=>"The facility rules changed. Reload and review the current values before saving.",
 Self::InvalidRules=>"Use valid millilitre thresholds within the displayed limits.",
}
    }
}
impl std::fmt::Display for FluidError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}
impl std::error::Error for FluidError {}

#[derive(FromRow)]
struct ObservationRow {
    id: Uuid,
    root_entry_id: Uuid,
    patient_id: Uuid,
    admission_case_id: Uuid,
    revision: i64,
    recorded_at: DateTime<Utc>,
    intake_ml: i32,
    output_ml: i32,
    metadata: Json<FluidMetadata>,
    created_at: DateTime<Utc>,
    recorded_by_user_id: Option<Uuid>,
    recorded_by_display_name: Option<String>,
    current: bool,
    closed_by_action: Option<String>,
    correction_reason: Option<String>,
    closed_at: Option<DateTime<Utc>>,
    closed_by_user_id: Option<Uuid>,
    closed_by_display_name: Option<String>,
    replacement_entry_id: Option<Uuid>,
}
#[derive(FromRow)]
struct LockedRoot {
    id: Uuid,
    patient_id: Uuid,
    admission_case_id: Uuid,
    current_entry_id: Option<Uuid>,
    revision: i64,
}

fn observation_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"SELECT e.id,COALESCE(e.root_entry_id,e.id) AS root_entry_id,e.patient_id,e.admission_case_id,e.revision,e.recorded_at,e.intake_ml,e.output_ml,e.metadata,e.created_at,e.recorded_by_user_id,author.display_name AS recorded_by_display_name,
 COALESCE(r.current_entry_id=e.id,false) AS current,a.kind AS closed_by_action,a.reason AS correction_reason,a.recorded_at AS closed_at,a.actor_user_id AS closed_by_user_id,closer.display_name AS closed_by_display_name,a.replacement_entry_id
 FROM fluid_balance_entries e JOIN fluid_observation_roots r ON r.id=COALESCE(e.root_entry_id,e.id) AND r.facility_id=e.facility_id AND r.patient_id=e.patient_id AND r.admission_case_id=e.admission_case_id
 JOIN patients patient_scope ON patient_scope.id=e.patient_id AND patient_scope.facility_id=e.facility_id
 JOIN admission_cases admission_scope ON admission_scope.id=e.admission_case_id AND admission_scope.facility_id=e.facility_id AND admission_scope.patient_id=e.patient_id
 LEFT JOIN fluid_observation_actions a ON a.entry_id=e.id AND a.facility_id=e.facility_id
 LEFT JOIN users author ON author.id=e.recorded_by_user_id AND author.facility_id=e.facility_id
 LEFT JOIN users closer ON closer.id=a.actor_user_id AND closer.facility_id=e.facility_id"#,
    )
}
fn from_row(r: ObservationRow) -> anyhow::Result<FluidObservation> {
    Ok(FluidObservation {
        id: r.id,
        root_entry_id: r.root_entry_id,
        patient_id: r.patient_id,
        admission_case_id: r.admission_case_id,
        revision: r.revision,
        values: FluidObservationValues {
            recorded_at: r.recorded_at,
            intake_ml: r.intake_ml,
            output_ml: r.output_ml,
            metadata: r.metadata.0,
        },
        created_at: r.created_at,
        recorded_by_user_id: r.recorded_by_user_id,
        recorded_by_display_name: r.recorded_by_display_name,
        current: r.current,
        closed_by_action: r
            .closed_by_action
            .as_deref()
            .map(codec::decode)
            .transpose()?,
        correction_reason: r.correction_reason,
        closed_at: r.closed_at,
        closed_by_user_id: r.closed_by_user_id,
        closed_by_display_name: r.closed_by_display_name,
        replacement_entry_id: r.replacement_entry_id,
    })
}

pub async fn get_fluid_observation(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<FluidObservation>> {
    let mut q = observation_query();
    q.push(" WHERE e.facility_id=")
        .push_bind(facility)
        .push(" AND e.id=")
        .push_bind(id);
    q.build_query_as::<ObservationRow>()
        .fetch_optional(pool)
        .await?
        .map(from_row)
        .transpose()
}
pub async fn list_fluid_observations(
    pool: &PgPool,
    facility: Uuid,
    filters: FluidBalanceFilters,
    include_closed: bool,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<FluidObservation>> {
    let mut q = observation_query();
    q.push(" WHERE e.facility_id=")
        .push_bind(facility)
        .push(if include_closed { " AND (r.current_entry_id=e.id OR (r.current_entry_id IS NULL AND e.revision=r.revision-1))" } else { " AND r.current_entry_id=e.id" });
    if let Some(id) = filters.patient_id {
        q.push(" AND e.patient_id=").push_bind(id);
    }
    if let Some(id) = filters.admission_case_id {
        q.push(" AND e.admission_case_id=").push_bind(id);
    }
    if let Some(at) = filters.recorded_from {
        q.push(" AND e.recorded_at>=").push_bind(at);
    }
    if let Some(at) = filters.recorded_before {
        q.push(" AND e.recorded_at<").push_bind(at);
    }
    if let Some(c) = cursor {
        q.push(" AND (e.recorded_at,e.id) ")
            .push(if filters.descending { "<" } else { ">" })
            .push(" (")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(if filters.descending {
        " ORDER BY e.recorded_at DESC,e.id DESC LIMIT "
    } else {
        " ORDER BY e.recorded_at,e.id LIMIT "
    })
    .push_bind(limit.clamp(1, 101));
    q.build_query_as::<ObservationRow>()
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(from_row)
        .collect()
}
pub async fn fluid_observation_history(
    pool: &PgPool,
    facility: Uuid,
    root: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<FluidObservation>> {
    let mut q = observation_query();
    q.push(" WHERE e.facility_id=")
        .push_bind(facility)
        .push(" AND (e.root_entry_id=")
        .push_bind(root)
        .push(" OR e.id=")
        .push_bind(root)
        .push(")");
    if let Some(c) = cursor {
        q.push(" AND (e.created_at,e.id)<(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY e.created_at DESC,e.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    q.build_query_as::<ObservationRow>()
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(from_row)
        .collect()
}

fn normalize(
    mut v: FluidObservationValues,
    previous: Option<&FluidObservationValues>,
) -> anyhow::Result<FluidObservationValues> {
    let trim = |value: Option<String>, max: usize| -> anyhow::Result<Option<String>> {
        let value = value.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty());
        if value.as_ref().is_some_and(|s| s.chars().count() > max) {
            return Err(FluidError::InvalidMetadata.into());
        }
        Ok(value)
    };
    if v.intake_ml < 0
        || v.output_ml < 0
        || (v.intake_ml == 0 && v.output_ml == 0)
        || (v.intake_ml > 10000 && previous.is_none_or(|p| p.intake_ml != v.intake_ml))
        || (v.output_ml > 10000 && previous.is_none_or(|p| p.output_ml != v.output_ml))
    {
        return Err(FluidError::InvalidValues.into());
    }
    v.metadata.intake_subcategory = trim(v.metadata.intake_subcategory, 50)?;
    v.metadata.output_subcategory = trim(v.metadata.output_subcategory, 50)?;
    v.metadata.output_colour = trim(v.metadata.output_colour, 100)?;
    v.metadata.notes = trim(v.metadata.notes, 2000)?;
    let unknown_intake = previous
        .is_some_and(|p| p.intake_ml == v.intake_ml && p.metadata.intake_category.is_none());
    let unknown_output = previous
        .is_some_and(|p| p.output_ml == v.output_ml && p.metadata.output_category.is_none());
    if (v.intake_ml > 0 && v.metadata.intake_category.is_none() && !unknown_intake)
        || (v.output_ml > 0 && v.metadata.output_category.is_none() && !unknown_output)
        || (v.intake_ml == 0
            && (v.metadata.intake_category.is_some() || v.metadata.intake_subcategory.is_some()))
        || (v.output_ml == 0
            && (v.metadata.output_category.is_some()
                || v.metadata.output_subcategory.is_some()
                || v.metadata.output_colour.is_some()))
    {
        return Err(FluidError::InvalidMetadata.into());
    }
    Ok(v)
}
async fn insert_entry(
    tx: &mut Transaction<'_, Postgres>,
    actor: &FluidActor,
    id: Uuid,
    root: Option<Uuid>,
    revision: i64,
    patient: Uuid,
    admission: Uuid,
    v: &FluidObservationValues,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO fluid_balance_entries(id,facility_id,patient_id,admission_case_id,recorded_at,intake_ml,output_ml,recorded_by_user_id,created_at,root_entry_id,revision,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),$9,$10,$11)")
 .bind(id).bind(actor.facility_id).bind(patient).bind(admission).bind(v.recorded_at).bind(v.intake_ml).bind(v.output_ml).bind(actor.user_id).bind(root).bind(revision).bind(Json(&v.metadata)).execute(&mut **tx).await?;
    Ok(())
}
fn replay(
    key: Uuid,
    kind: FluidWriteKind,
    saved: common::SavedCommand,
) -> anyhow::Result<FluidWriteResult> {
    Ok(FluidWriteResult {
        client_request_id: key,
        root_entry_id: saved
            .result_id
            .ok_or_else(|| anyhow::anyhow!("fluid_command_incomplete"))?,
        entry_id: saved
            .result_entry_id
            .ok_or_else(|| anyhow::anyhow!("fluid_command_incomplete"))?,
        revision: saved
            .result_version
            .ok_or_else(|| anyhow::anyhow!("fluid_command_incomplete"))?,
        action: kind,
        replayed: true,
    })
}

pub async fn create_fluid_observation(
    pool: &PgPool,
    mut actor: FluidActor,
    patient: Uuid,
    mut input: CreateFluidObservationRequest,
) -> anyhow::Result<FluidWriteResult> {
    input.values = normalize(input.values, None)?;
    let mut tx = pool.begin().await?;
    let wards = access::clinical(&mut tx, &mut actor).await?;
    if input.patient_id.is_some_and(|id| id != patient) {
        return Err(FluidError::InvalidRequest.into());
    }
    if let Some(saved) = common::reserve(
        &mut tx,
        &actor,
        input.client_request_id,
        "created",
        &(patient, &input),
    )
    .await?
    {
        let result = replay(input.client_request_id, FluidWriteKind::Created, saved)?;
        super::nursing_access::admission(
            &mut tx,
            &actor,
            &wards,
            input.admission_case_id,
            patient,
            None,
            false,
        )
        .await?;
        access::deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(result);
    }
    super::nursing_access::admission(
        &mut tx,
        &actor,
        &wards,
        input.admission_case_id,
        patient,
        None,
        true,
    )
    .await?;
    if input.values.recorded_at > common::clock(&mut tx).await? {
        return Err(FluidError::FutureObservation.into());
    }
    let id = Uuid::new_v4();
    insert_entry(
        &mut tx,
        &actor,
        id,
        None,
        1,
        patient,
        input.admission_case_id,
        &input.values,
    )
    .await?;
    common::finish(&mut tx, &actor, input.client_request_id, id, Some(id), 1).await?;
    common::audit(&mut tx, &actor, id, "fluid.observation.created", 1).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(FluidWriteResult {
        client_request_id: input.client_request_id,
        root_entry_id: id,
        entry_id: id,
        revision: 1,
        action: FluidWriteKind::Created,
        replayed: false,
    })
}

pub async fn correct_fluid_observation(
    pool: &PgPool,
    actor: FluidActor,
    source: FluidObservation,
    mut input: CorrectFluidObservationRequest,
) -> anyhow::Result<FluidWriteResult> {
    input.reason = common::reason(&input.reason)?;
    input.replacement = normalize(input.replacement, Some(&source.values))?;
    change_observation(
        pool,
        actor,
        source,
        input.client_request_id,
        &input.reason,
        Some(input.replacement),
    )
    .await
}
pub async fn void_fluid_observation(
    pool: &PgPool,
    actor: FluidActor,
    source: FluidObservation,
    input: VoidFluidObservationRequest,
) -> anyhow::Result<FluidWriteResult> {
    let reason = common::reason(&input.reason)?;
    change_observation(pool, actor, source, input.client_request_id, &reason, None).await
}
async fn change_observation(
    pool: &PgPool,
    mut actor: FluidActor,
    source: FluidObservation,
    key: Uuid,
    reason: &str,
    replacement: Option<FluidObservationValues>,
) -> anyhow::Result<FluidWriteResult> {
    let kind = if replacement.is_some() {
        FluidWriteKind::Corrected
    } else {
        FluidWriteKind::Voided
    };
    let encoded = codec::encode(kind)?;
    let mut tx = pool.begin().await?;
    let root=sqlx::query_as::<_,LockedRoot>("SELECT id,patient_id,admission_case_id,current_entry_id,revision FROM fluid_observation_roots WHERE facility_id=$1 AND id=$2 FOR UPDATE")
 .bind(actor.facility_id).bind(source.root_entry_id).fetch_optional(&mut *tx).await?.ok_or(FluidError::NotCurrent)?;
    let wards = access::clinical(&mut tx, &mut actor).await?;
    super::nursing_access::admission(
        &mut tx,
        &actor,
        &wards,
        root.admission_case_id,
        root.patient_id,
        None,
        false,
    )
    .await?;
    if let Some(saved) = common::reserve(
        &mut tx,
        &actor,
        key,
        &encoded,
        &(source.id, reason, &replacement),
    )
    .await?
    {
        let result = replay(key, kind, saved)?;
        access::deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(result);
    }
    if root.current_entry_id != Some(source.id)
        || root.revision != source.revision
        || root.patient_id != source.patient_id
        || root.admission_case_id != source.admission_case_id
    {
        return Err(FluidError::NotCurrent.into());
    }
    let revision = root.revision.checked_add(1).ok_or(FluidError::NotCurrent)?;
    let new_id = if let Some(v) = replacement.as_ref() {
        if v.recorded_at > common::clock(&mut tx).await? {
            return Err(FluidError::FutureObservation.into());
        }
        let id = Uuid::new_v4();
        insert_entry(
            &mut tx,
            &actor,
            id,
            Some(root.id),
            revision,
            root.patient_id,
            root.admission_case_id,
            v,
        )
        .await?;
        Some(id)
    } else {
        None
    };
    sqlx::query("INSERT INTO fluid_observation_actions(id,facility_id,root_entry_id,entry_id,replacement_entry_id,kind,reason,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
 .bind(Uuid::new_v4()).bind(actor.facility_id).bind(root.id).bind(source.id).bind(new_id).bind(&encoded).bind(reason).bind(actor.user_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE fluid_observation_roots SET updated_at=clock_timestamp(),current_entry_id=$3,revision=$4,recorded_at=$5,intake_ml=$6,output_ml=$7 WHERE facility_id=$1 AND id=$2")
 .bind(actor.facility_id).bind(root.id).bind(new_id).bind(revision).bind(replacement.as_ref().map(|v|v.recorded_at)).bind(replacement.as_ref().map_or(0,|v|v.intake_ml)).bind(replacement.as_ref().map_or(0,|v|v.output_ml)).execute(&mut *tx).await?;
    let entry = new_id.unwrap_or(source.id);
    common::finish(&mut tx, &actor, key, root.id, Some(entry), revision).await?;
    common::audit(
        &mut tx,
        &actor,
        root.id,
        if new_id.is_some() {
            "fluid.observation.corrected"
        } else {
            "fluid.observation.voided"
        },
        revision,
    )
    .await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(FluidWriteResult {
        client_request_id: key,
        root_entry_id: root.id,
        entry_id: entry,
        revision,
        action: kind,
        replayed: false,
    })
}

#[derive(FromRow)]
struct SummaryRow {
    entry_count: i64,
    total_intake_ml: i64,
    total_output_ml: i64,
    intake_breakdown: Json<Vec<FluidCategoryTotals>>,
    output_breakdown: Json<Vec<FluidCategoryTotals>>,
}
pub async fn fluid_effective_summary(
    pool: &PgPool,
    facility: Uuid,
    filters: FluidBalanceFilters,
) -> anyhow::Result<FluidEffectiveSummary> {
    let mut q = summary_query(facility, filters, None);
    let row = q.build_query_as::<SummaryRow>().fetch_one(pool).await?;
    Ok(FluidEffectiveSummary {
        entry_count: row.entry_count,
        total_intake_ml: row.total_intake_ml,
        total_output_ml: row.total_output_ml,
        net_ml: row.total_intake_ml - row.total_output_ml,
        intake_breakdown: row.intake_breakdown.0,
        output_breakdown: row.output_breakdown.0,
    })
}

fn summary_query(
    facility: Uuid,
    filters: FluidBalanceFilters,
    wards: Option<Vec<Uuid>>,
) -> QueryBuilder<'static, Postgres> {
    let mut q=QueryBuilder::<Postgres>::new("WITH effective AS MATERIALIZED(SELECT e.intake_ml,e.output_ml,e.metadata->>'intake_category' AS intake_category,e.metadata->>'output_category' AS output_category FROM fluid_balance_entries e JOIN fluid_observation_roots r ON r.facility_id=e.facility_id AND r.patient_id=e.patient_id AND r.admission_case_id=e.admission_case_id AND r.current_entry_id=e.id JOIN patients p ON p.id=e.patient_id AND p.facility_id=e.facility_id JOIN admission_cases a ON a.id=e.admission_case_id AND a.facility_id=e.facility_id AND a.patient_id=e.patient_id WHERE e.facility_id=");
    q.push_bind(facility);
    if let Some(ids) = wards {
        q.push(" AND a.ward_id=ANY(").push_bind(ids).push(")");
    }
    if let Some(id) = filters.patient_id {
        q.push(" AND e.patient_id=").push_bind(id);
    }
    if let Some(id) = filters.admission_case_id {
        q.push(" AND e.admission_case_id=").push_bind(id);
    }
    if let Some(at) = filters.recorded_from {
        q.push(" AND e.recorded_at>=").push_bind(at);
    }
    if let Some(at) = filters.recorded_before {
        q.push(" AND e.recorded_at<").push_bind(at);
    }
    q.push(r#") SELECT count(*) AS entry_count,COALESCE(sum(intake_ml),0)::bigint AS total_intake_ml,COALESCE(sum(output_ml),0)::bigint AS total_output_ml,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('category',category,'total_ml',total_ml) ORDER BY category) FROM (SELECT COALESCE(intake_category,'unspecified') AS category,sum(intake_ml)::bigint AS total_ml FROM effective WHERE intake_ml>0 GROUP BY 1) x),'[]'::jsonb) AS intake_breakdown,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('category',category,'total_ml',total_ml) ORDER BY category) FROM (SELECT COALESCE(output_category,'unspecified') AS category,sum(output_ml)::bigint AS total_ml FROM effective WHERE output_ml>0 GROUP BY 1) x),'[]'::jsonb) AS output_breakdown FROM effective"#);
    q
}
