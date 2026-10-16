use super::{common, FluidActor, FluidError};
use crate::PgPool;
use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::fluid::*;
use sqlx::{types::Json, FromRow};
use uuid::Uuid;

#[derive(FromRow)]
struct SettingsRow {
    version: i64,
    values: Json<FluidRuleValues>,
    updated_at: Option<DateTime<Utc>>,
    updated_by_user_id: Option<Uuid>,
}
fn settings(row: Option<SettingsRow>) -> FluidRuleSettings {
    match row {
        Some(r) if r.version > 0 => FluidRuleSettings {
            version: r.version,
            configured: true,
            values: r.values.0,
            updated_at: r.updated_at,
            updated_by_user_id: r.updated_by_user_id,
        },
        _ => FluidRuleSettings {
            version: 0,
            configured: false,
            values: FluidRuleValues::default(),
            updated_at: None,
            updated_by_user_id: None,
        },
    }
}
pub async fn get_fluid_rules(pool: &PgPool, facility: Uuid) -> anyhow::Result<FluidRuleSettings> {
    Ok(settings(sqlx::query_as::<_,SettingsRow>("SELECT version,values,updated_at,updated_by_user_id FROM fluid_rule_settings WHERE facility_id=$1 AND version>0").bind(facility).fetch_optional(pool).await?))
}
pub async fn update_fluid_rules(
    pool: &PgPool,
    actor: FluidActor,
    mut input: UpdateFluidRuleSettingsRequest,
) -> anyhow::Result<FluidRuleSettings> {
    input.reason = common::reason(&input.reason)?;
    let v = &input.values;
    if input.expected_version < 0
        || !(0..=10000).contains(&v.min_daily_intake_target)
        || !(0..=20000).contains(&v.max_daily_output_threshold)
        || !(-10000..=0).contains(&v.negative_balance_alert_threshold)
        || !(0..=10000).contains(&v.positive_balance_alert_threshold)
    {
        return Err(FluidError::InvalidRules.into());
    }
    let mut tx = pool.begin().await?;
    if let Some(saved) =
        common::reserve(&mut tx, &actor, input.client_request_id, "rules", &input).await?
    {
        let version = saved
            .result_version
            .ok_or_else(|| anyhow::anyhow!("fluid_rule_command_incomplete"))?;
        let row=sqlx::query_as::<_,SettingsRow>("SELECT version,values,published_at AS updated_at,actor_user_id AS updated_by_user_id FROM fluid_rule_versions WHERE facility_id=$1 AND version=$2").bind(actor.facility_id).bind(version).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        return Ok(settings(Some(row)));
    }
    sqlx::query("INSERT INTO fluid_rule_settings(facility_id) VALUES($1) ON CONFLICT DO NOTHING")
        .bind(actor.facility_id)
        .execute(&mut *tx)
        .await?;
    let version = sqlx::query_scalar::<_, i64>(
        "SELECT version FROM fluid_rule_settings WHERE facility_id=$1 FOR UPDATE",
    )
    .bind(actor.facility_id)
    .fetch_one(&mut *tx)
    .await?;
    if version != input.expected_version {
        return Err(FluidError::RuleConflict.into());
    }
    let next = version.checked_add(1).ok_or(FluidError::RuleConflict)?;
    let row=sqlx::query_as::<_,SettingsRow>("UPDATE fluid_rule_settings SET version=$2,values=$3,updated_at=clock_timestamp(),updated_by_user_id=$4 WHERE facility_id=$1 RETURNING version,values,updated_at,updated_by_user_id").bind(actor.facility_id).bind(next).bind(Json(&input.values)).bind(actor.user_id).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO fluid_rule_versions(facility_id,version,values,reason,actor_user_id,published_at) VALUES($1,$2,$3,$4,$5,$6)").bind(actor.facility_id).bind(next).bind(Json(&input.values)).bind(&input.reason).bind(actor.user_id).bind(row.updated_at).execute(&mut *tx).await?;
    common::finish(
        &mut tx,
        &actor,
        input.client_request_id,
        actor.facility_id,
        None,
        next,
    )
    .await?;
    common::audit(
        &mut tx,
        &actor,
        actor.facility_id,
        "fluid.rules.updated",
        next,
    )
    .await?;
    tx.commit().await?;
    Ok(settings(Some(row)))
}
#[derive(FromRow)]
struct AssessmentRow {
    evaluated_at: DateTime<Utc>,
    entry_count: i64,
    intake_ml: i64,
    output_ml: i64,
    version: Option<i64>,
    values: Option<Json<FluidRuleValues>>,
    updated_at: Option<DateTime<Utc>>,
    updated_by_user_id: Option<Uuid>,
}
pub async fn fluid_assessment(
    pool: &PgPool,
    facility: Uuid,
    patient: Uuid,
    admission: Uuid,
    date: NaiveDate,
) -> anyhow::Result<FluidAssessment> {
    let row=sqlx::query_as::<_,AssessmentRow>(r#"SELECT clock_timestamp() AS evaluated_at,COALESCE(d.entry_count,0) AS entry_count,COALESCE(d.intake_ml,0) AS intake_ml,COALESCE(d.output_ml,0) AS output_ml,s.version,s.values,s.updated_at,s.updated_by_user_id FROM (SELECT 1) base LEFT JOIN fluid_effective_daily_totals d ON d.facility_id=$1 AND d.patient_id=$2 AND d.admission_case_id=$3 AND d.date=$4 LEFT JOIN fluid_rule_settings s ON s.facility_id=$1 AND s.version>0"#).bind(facility).bind(patient).bind(admission).bind(date).fetch_one(pool).await?;
    let configured = row.version.is_some();
    let policy = FluidRuleSettings {
        version: row.version.unwrap_or(0),
        configured,
        values: row.values.map_or_else(FluidRuleValues::default, |v| v.0),
        updated_at: row.updated_at,
        updated_by_user_id: row.updated_by_user_id,
    };
    let net = row.intake_ml - row.output_ml;
    let v = &policy.values;
    let mut conditions = Vec::new();
    let status = if !configured {
        FluidAssessmentStatus::Unconfigured
    } else if !v.enable_intake_alerts && !v.enable_output_alerts && !v.enable_balance_alerts {
        FluidAssessmentStatus::Disabled
    } else if row.entry_count == 0 {
        FluidAssessmentStatus::NoData
    } else {
        if v.enable_intake_alerts && row.intake_ml < i64::from(v.min_daily_intake_target) {
            conditions.push(FluidMonitoringCondition {
                kind: FluidConditionKind::LowIntake,
                severity: FluidConditionSeverity::Warning,
                value_ml: row.intake_ml,
                threshold_ml: v.min_daily_intake_target,
            });
        }
        if v.enable_output_alerts && row.output_ml > i64::from(v.max_daily_output_threshold) {
            conditions.push(FluidMonitoringCondition {
                kind: FluidConditionKind::HighOutput,
                severity: FluidConditionSeverity::Warning,
                value_ml: row.output_ml,
                threshold_ml: v.max_daily_output_threshold,
            });
        }
        if v.enable_balance_alerts && net < i64::from(v.negative_balance_alert_threshold) {
            conditions.push(FluidMonitoringCondition {
                kind: FluidConditionKind::NegativeBalance,
                severity: FluidConditionSeverity::Critical,
                value_ml: net,
                threshold_ml: v.negative_balance_alert_threshold,
            });
        }
        if v.enable_balance_alerts && net > i64::from(v.positive_balance_alert_threshold) {
            conditions.push(FluidMonitoringCondition {
                kind: FluidConditionKind::PositiveBalance,
                severity: FluidConditionSeverity::Warning,
                value_ml: net,
                threshold_ml: v.positive_balance_alert_threshold,
            });
        }
        FluidAssessmentStatus::Assessed
    };
    Ok(FluidAssessment {
        patient_id: patient,
        admission_case_id: admission,
        date,
        evaluated_at: row.evaluated_at,
        partial_day: date == row.evaluated_at.date_naive(),
        status,
        settings: policy,
        entry_count: row.entry_count,
        total_intake_ml: row.intake_ml,
        total_output_ml: row.output_ml,
        net_ml: net,
        conditions,
    })
}
