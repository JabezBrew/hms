use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::ward::{
    WardAdmissionMetric, WardAnalyticsMeta, WardAnalyticsResponse, WardEpisodeTotals,
    WardLengthOfStayBucket, WardOccupancyTrendPoint, WardUtilizationMetric,
};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::PgPool;

#[derive(Clone, Debug, FromRow)]
struct CoverageRow {
    observed_through: DateTime<Utc>,
    unknown_prefix: bool,
    unknown_initial: bool,
    unknown_final: bool,
    unknown_admission_time: bool,
    unknown_discharge_time: bool,
    unknown_los: bool,
    admissions: i64,
    discharges: i64,
}

#[derive(Clone, Debug, FromRow)]
struct OccupancyTrendRow {
    date: NaiveDate,
    ward_id: Uuid,
    ward: String,
    occupancy_rate: Option<f64>,
    occupied_bed_days: f64,
    total_beds: i64,
}

#[derive(Clone, Debug, FromRow)]
struct LengthOfStayBucketRow {
    range: String,
    count: i64,
    percentage: f64,
}

#[derive(Clone, Debug, FromRow)]
struct UtilizationRow {
    ward_id: Uuid,
    ward: String,
    occupancy_rate: Option<f64>,
    occupied_beds_count: i64,
    total_beds: i64,
    turnover_rate: Option<f64>,
    avg_los: Option<f64>,
    bed_days: f64,
}

#[derive(Clone, Debug, FromRow)]
struct AdmissionMetricRow {
    ward_id: Uuid,
    ward: String,
    admissions: i64,
    discharges: i64,
    transfers: i64,
}

pub async fn ward_analytics(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> anyhow::Result<WardAnalyticsResponse> {
    let mut tx = pool.begin().await?;
    // All aggregates and their availability flags describe one placement snapshot.
    observe_db_query(
        "ward.analytics.snapshot",
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY").execute(&mut *tx),
    )
    .await?;
    let coverage = coverage(&mut tx, facility_id, start_at, end_at).await?;
    let occupancy_trends = occupancy_trends(
        &mut tx,
        facility_id,
        ward_id,
        start_at,
        end_at,
        coverage.observed_through,
    )
    .await?;
    let mut length_of_stay =
        length_of_stay_distribution(&mut tx, facility_id, ward_id, start_at, end_at).await?;
    let mut ward_utilization = utilization_metrics(
        &mut tx,
        facility_id,
        ward_id,
        start_at,
        end_at,
        coverage.observed_through,
    )
    .await?;
    let mut admissions_by_ward =
        admission_metrics(&mut tx, facility_id, ward_id, start_at, end_at).await?;

    let admissions_partial = coverage.unknown_initial || coverage.unknown_admission_time;
    let discharges_partial = coverage.unknown_final || coverage.unknown_discharge_time;
    let future_partial = end_at > coverage.observed_through;
    let occupancy_partial = future_partial
        || coverage.unknown_prefix
        || coverage.unknown_admission_time
        || coverage.unknown_discharge_time;
    let los_unavailable = coverage.unknown_los || (ward_id.is_some() && discharges_partial);
    let mut partial_metrics = Vec::new();
    let mut unavailable_metrics = vec!["revenue".to_owned()];
    if occupancy_partial {
        partial_metrics.extend([
            "occupancy_trends".to_owned(),
            "ward_utilization.bed_days".to_owned(),
            "ward_utilization.occupancy_rate".to_owned(),
            "admissions_by_ward.transfers".to_owned(),
        ]);
    }
    if admissions_partial {
        partial_metrics.push("admissions_by_ward.admissions".to_owned());
        unavailable_metrics.push("admissions_by_ward.admissions".to_owned());
        for row in &mut admissions_by_ward {
            row.admissions = None;
        }
    }
    if discharges_partial {
        for key in [
            "admissions_by_ward.discharges",
            "ward_utilization.avg_los",
            "ward_utilization.turnover_rate",
        ] {
            partial_metrics.push(key.to_owned());
            unavailable_metrics.push(key.to_owned());
        }
        for row in &mut admissions_by_ward {
            row.discharges = None;
        }
        for row in &mut ward_utilization {
            row.avg_los = None;
            row.turnover_rate = None;
        }
    }
    if los_unavailable {
        partial_metrics.push("length_of_stay".to_owned());
        unavailable_metrics.push("length_of_stay".to_owned());
        for row in &mut length_of_stay {
            row.count = None;
            row.percentage = None;
        }
    }
    let facility_episode_totals = ward_id.is_none().then(|| {
        if coverage.unknown_admission_time {
            unavailable_metrics.push("facility_episode_totals.admissions".to_owned());
        }
        if coverage.unknown_discharge_time {
            unavailable_metrics.push("facility_episode_totals.discharges".to_owned());
        }
        WardEpisodeTotals {
            admissions: (!coverage.unknown_admission_time).then_some(coverage.admissions),
            discharges: (!coverage.unknown_discharge_time).then_some(coverage.discharges),
        }
    });
    if future_partial {
        // These are recorded observations through one database clock, never a
        // prediction of the remaining requested day/range.
        partial_metrics.extend([
            "admissions_by_ward.admissions".to_owned(),
            "admissions_by_ward.discharges".to_owned(),
            "ward_utilization.avg_los".to_owned(),
            "ward_utilization.turnover_rate".to_owned(),
            "length_of_stay".to_owned(),
        ]);
        if ward_id.is_none() {
            partial_metrics.extend([
                "facility_episode_totals.admissions".to_owned(),
                "facility_episode_totals.discharges".to_owned(),
            ]);
        }
    }
    partial_metrics.sort();
    partial_metrics.dedup();
    let partial = !partial_metrics.is_empty();
    tx.commit().await?;
    Ok(WardAnalyticsResponse {
        meta: WardAnalyticsMeta {
            mode: "rust_v2_aggregates".to_owned(),
            observed_through: coverage.observed_through,
            occupancy_basis: "known_placement_intervals".to_owned(),
            capacity_basis: "current_active_ward_nonclosed_beds".to_owned(),
            placement_attribution: if partial { "partial" } else { "complete" }.to_owned(),
            partial_metrics,
            unavailable_metrics,
        },
        facility_episode_totals,
        occupancy_trends,
        length_of_stay,
        ward_utilization,
        admissions_by_ward,
    })
}

async fn coverage(
    tx: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> anyhow::Result<CoverageRow> {
    // An unknown earlier ward cannot be assigned to the case's latest ward. Only
    // booleans leave this facility-bounded check; no unattributed episode counts leak.
    Ok(observe_db_query(
        "ward.analytics.coverage",
        sqlx::query_as::<_, CoverageRow>(
            r#"SELECT transaction_timestamp() AS observed_through,
            COALESCE(bool_or(c.admitted_at < $3
                AND COALESCE(c.discharged_at,$3)>$2
                AND ((c.placement_history_partial AND (c.placement_known_from IS NULL OR $2<c.placement_known_from))
                    OR NOT EXISTS(SELECT 1 FROM admission_placements p WHERE p.facility_id=c.facility_id AND p.admission_case_id=c.id))),false) AS unknown_prefix,
            COALESCE(bool_or(c.admitted_at >= $2 AND c.admitted_at < $3
                AND NOT EXISTS(SELECT 1 FROM admission_placements p WHERE p.facility_id=c.facility_id
                    AND p.admission_case_id=c.id AND p.patient_id=c.patient_id
                    AND p.origin='activation' AND p.started_at=c.admitted_at)),false) AS unknown_initial,
            COALESCE(bool_or(c.status='discharged' AND c.discharged_at >= $2 AND c.discharged_at < $3
                AND NOT EXISTS(SELECT 1 FROM admission_placements p WHERE p.facility_id=c.facility_id
                    AND p.admission_case_id=c.id AND p.patient_id=c.patient_id
                    AND p.close_kind='discharge' AND p.ended_at=c.discharged_at)),false) AS unknown_final,
            COALESCE(bool_or(c.admitted_at IS NULL),false) AS unknown_admission_time,
            COALESCE(bool_or(c.status='discharged' AND c.discharged_at IS NULL),false) AS unknown_discharge_time,
            COALESCE(bool_or(c.status='discharged' AND (c.discharged_at IS NULL OR
                (c.discharged_at >= $2 AND c.discharged_at < $3
                    AND (c.admitted_at IS NULL OR c.admitted_at>c.discharged_at)))),false) AS unknown_los,
            count(*) FILTER(WHERE c.admitted_at >= $2 AND c.admitted_at < $3)::bigint AS admissions,
            count(*) FILTER(WHERE c.status='discharged' AND c.discharged_at >= $2 AND c.discharged_at < $3)::bigint AS discharges
            FROM admission_cases c WHERE c.facility_id=$1
              AND c.status IN ('admitted','discharge_pending','discharged')
              AND (c.admitted_at IS NULL OR (c.status='discharged' AND c.discharged_at IS NULL)
                OR (c.admitted_at < $3 AND COALESCE(c.discharged_at,$3)>$2)
                OR (c.admitted_at >= $2 AND c.admitted_at < $3)
                OR (c.discharged_at >= $2 AND c.discharged_at < $3))"#,
        )
        .bind(facility_id)
        .bind(start_at)
        .bind(end_at)
        .fetch_one(&mut **tx),
    )
    .await?)
}

async fn occupancy_trends(
    tx: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
    observed_through: DateTime<Utc>,
) -> anyhow::Result<Vec<WardOccupancyTrendPoint>> {
    let rows = observe_db_query(
        "ward.analytics.occupancy_trends",
        sqlx::query_as::<_, OccupancyTrendRow>(
            r#"WITH selected_wards AS (
                SELECT id,name,status FROM wards WHERE facility_id=$1 AND ($4::uuid IS NULL OR id=$4)
            ), days AS (
                SELECT generate_series(($2 AT TIME ZONE 'UTC')::date,
                    (($3-INTERVAL '1 microsecond') AT TIME ZONE 'UTC')::date,INTERVAL '1 day')::date AS day
            ), bed_counts AS (
                SELECT b.ward_id,count(*) FILTER(WHERE w.status='active' AND b.status!='closed')::bigint AS total_beds
                FROM beds b JOIN selected_wards w ON w.id=b.ward_id WHERE b.facility_id=$1 GROUP BY b.ward_id
            ), daily AS (
                SELECT d.day,w.id,w.name,COALESCE(b.total_beds,0)::bigint AS total_beds,
                    (COALESCE(sum(GREATEST(EXTRACT(EPOCH FROM (
                        LEAST(COALESCE(p.ended_at,$5),(d.day+1)::timestamp AT TIME ZONE 'UTC',$3,$5)
                        - GREATEST(p.started_at,d.day::timestamp AT TIME ZONE 'UTC',$2))),0)) FILTER(WHERE p.id IS NOT NULL),0)/86400.0)::double precision AS bed_days
                FROM days d CROSS JOIN selected_wards w LEFT JOIN bed_counts b ON b.ward_id=w.id
                LEFT JOIN admission_placements p ON p.facility_id=$1 AND p.ward_id=w.id
                    AND p.started_at<LEAST((d.day+1)::timestamp AT TIME ZONE 'UTC',$3,$5)
                    AND (p.ended_at IS NULL OR p.ended_at>GREATEST(d.day::timestamp AT TIME ZONE 'UTC',$2))
                GROUP BY d.day,w.id,w.name,b.total_beds
            ) SELECT day AS date,id AS ward_id,name AS ward,
                CASE WHEN total_beds>0 THEN bed_days/total_beds::double precision*100 ELSE NULL END::double precision AS occupancy_rate,
                bed_days AS occupied_bed_days,total_beds FROM daily ORDER BY day,name,id"#,
        )
        .bind(facility_id)
        .bind(start_at)
        .bind(end_at)
        .bind(ward_id)
        .bind(observed_through)
        .fetch_all(&mut **tx),
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| WardOccupancyTrendPoint {
            date: row.date,
            ward_id: row.ward_id,
            ward: row.ward,
            occupancy_rate: row.occupancy_rate,
            occupied_bed_days: row.occupied_bed_days,
            total_beds: row.total_beds,
        })
        .collect())
}

async fn length_of_stay_distribution(
    tx: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> anyhow::Result<Vec<WardLengthOfStayBucket>> {
    let rows = observe_db_query(
        "ward.analytics.length_of_stay",
        sqlx::query_as::<_, LengthOfStayBucketRow>(
            r#"WITH buckets(range,ordinal) AS (
                VALUES ('0-2 days',1),('3-5 days',2),('6-10 days',3),('11-20 days',4),('21+ days',5)
            ), completed AS (
                SELECT CASE
                    WHEN EXTRACT(EPOCH FROM(c.discharged_at-c.admitted_at))/86400.0<3 THEN '0-2 days'
                    WHEN EXTRACT(EPOCH FROM(c.discharged_at-c.admitted_at))/86400.0<6 THEN '3-5 days'
                    WHEN EXTRACT(EPOCH FROM(c.discharged_at-c.admitted_at))/86400.0<11 THEN '6-10 days'
                    WHEN EXTRACT(EPOCH FROM(c.discharged_at-c.admitted_at))/86400.0<21 THEN '11-20 days'
                    ELSE '21+ days' END AS range
                FROM admission_cases c WHERE c.facility_id=$1 AND c.status='discharged'
                    AND c.admitted_at IS NOT NULL AND c.discharged_at>=c.admitted_at
                    AND c.discharged_at >= $2 AND c.discharged_at < $3
                    AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM admission_placements p
                        WHERE p.facility_id=c.facility_id AND p.admission_case_id=c.id AND p.patient_id=c.patient_id
                            AND p.ward_id=$4 AND p.close_kind='discharge' AND p.ended_at=c.discharged_at))
            ), counts AS (SELECT range,count(*)::bigint AS count FROM completed GROUP BY range),
            total AS (SELECT COALESCE(sum(count),0)::bigint AS count FROM counts)
            SELECT b.range,COALESCE(c.count,0)::bigint AS count,
                CASE WHEN t.count>0 THEN COALESCE(c.count,0)::double precision/t.count::double precision*100
                    ELSE 0 END::double precision AS percentage
            FROM buckets b CROSS JOIN total t LEFT JOIN counts c ON c.range=b.range ORDER BY b.ordinal"#,
        )
        .bind(facility_id)
        .bind(start_at)
        .bind(end_at)
        .bind(ward_id)
        .fetch_all(&mut **tx),
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| WardLengthOfStayBucket {
            range: row.range,
            count: Some(row.count),
            percentage: Some(row.percentage),
        })
        .collect())
}

async fn utilization_metrics(
    tx: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
    observed_through: DateTime<Utc>,
) -> anyhow::Result<Vec<WardUtilizationMetric>> {
    let rows = observe_db_query(
        "ward.analytics.utilization",
        sqlx::query_as::<_, UtilizationRow>(
            r#"WITH selected_wards AS (
                SELECT id,name,status FROM wards WHERE facility_id=$1 AND ($4::uuid IS NULL OR id=$4)
            ), bed_counts AS (
                SELECT b.ward_id,count(*) FILTER(WHERE w.status='active' AND b.status!='closed')::bigint AS total_beds,
                    count(*) FILTER(WHERE b.status='occupied')::bigint AS occupied_beds_count
                FROM beds b JOIN selected_wards w ON w.id=b.ward_id WHERE b.facility_id=$1 GROUP BY b.ward_id
            ), stay_days AS (
                SELECT p.ward_id,(COALESCE(sum(GREATEST(EXTRACT(EPOCH FROM(
                    LEAST(COALESCE(p.ended_at,$5),$3,$5)-GREATEST(p.started_at,$2))),0)),0)/86400.0)::double precision AS bed_days
                FROM admission_placements p JOIN selected_wards w ON w.id=p.ward_id
                WHERE p.facility_id=$1 AND p.started_at<LEAST($3,$5) AND (p.ended_at IS NULL OR p.ended_at>$2) GROUP BY p.ward_id
            ), discharge_metrics AS (
                SELECT p.ward_id,count(*)::bigint AS discharges,
                    avg(EXTRACT(EPOCH FROM(c.discharged_at-c.admitted_at))/86400.0)::double precision AS avg_los
                FROM admission_cases c JOIN admission_placements p ON p.facility_id=c.facility_id
                    AND p.admission_case_id=c.id AND p.patient_id=c.patient_id
                    AND p.close_kind='discharge' AND p.ended_at=c.discharged_at
                JOIN selected_wards w ON w.id=p.ward_id
                WHERE c.facility_id=$1 AND c.status='discharged' AND c.admitted_at IS NOT NULL
                    AND c.discharged_at>=c.admitted_at AND c.discharged_at >= $2 AND c.discharged_at < $3 GROUP BY p.ward_id
            ), range_span AS (SELECT EXTRACT(EPOCH FROM($3-$2))/86400.0 AS days)
            SELECT w.id AS ward_id,w.name AS ward,
                CASE WHEN COALESCE(b.total_beds,0)>0 AND r.days>0 THEN
                    COALESCE(s.bed_days,0)/(b.total_beds::double precision*r.days)*100 ELSE NULL END::double precision AS occupancy_rate,
                COALESCE(b.occupied_beds_count,0)::bigint AS occupied_beds_count,
                COALESCE(b.total_beds,0)::bigint AS total_beds,
                CASE WHEN COALESCE(b.total_beds,0)>0 THEN COALESCE(d.discharges,0)::double precision/b.total_beds::double precision
                    ELSE NULL END::double precision AS turnover_rate,
                d.avg_los,COALESCE(s.bed_days,0)::double precision AS bed_days
            FROM selected_wards w CROSS JOIN range_span r LEFT JOIN bed_counts b ON b.ward_id=w.id
                LEFT JOIN stay_days s ON s.ward_id=w.id LEFT JOIN discharge_metrics d ON d.ward_id=w.id ORDER BY w.name,w.id"#,
        )
        .bind(facility_id)
        .bind(start_at)
        .bind(end_at)
        .bind(ward_id)
        .bind(observed_through)
        .fetch_all(&mut **tx),
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| WardUtilizationMetric {
            ward_id: row.ward_id,
            ward: row.ward,
            occupancy_rate: row.occupancy_rate,
            occupied_beds_count: row.occupied_beds_count,
            total_beds: row.total_beds,
            turnover_rate: row.turnover_rate,
            avg_los: row.avg_los,
            bed_days: row.bed_days,
        })
        .collect())
}

async fn admission_metrics(
    tx: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> anyhow::Result<Vec<WardAdmissionMetric>> {
    let rows = observe_db_query(
        "ward.analytics.admissions",
        sqlx::query_as::<_, AdmissionMetricRow>(
            r#"WITH selected_wards AS (
                SELECT id,name FROM wards WHERE facility_id=$1 AND ($4::uuid IS NULL OR id=$4)
            ), admissions AS (
                SELECT p.ward_id,count(*)::bigint AS admissions
                FROM admission_cases c JOIN admission_placements p ON p.facility_id=c.facility_id
                    AND p.admission_case_id=c.id AND p.patient_id=c.patient_id
                    AND p.origin='activation' AND p.started_at=c.admitted_at
                WHERE c.facility_id=$1 AND c.status IN ('admitted','discharge_pending','discharged')
                    AND c.admitted_at >= $2 AND c.admitted_at < $3 GROUP BY p.ward_id
            ), discharges AS (
                SELECT p.ward_id,count(*)::bigint AS discharges
                FROM admission_cases c JOIN admission_placements p ON p.facility_id=c.facility_id
                    AND p.admission_case_id=c.id AND p.patient_id=c.patient_id
                    AND p.close_kind='discharge' AND p.ended_at=c.discharged_at
                WHERE c.facility_id=$1 AND c.status='discharged'
                    AND c.discharged_at >= $2 AND c.discharged_at < $3 GROUP BY p.ward_id
            ), move_wards AS (
                SELECT source_ward_id AS ward_id FROM admission_moves WHERE facility_id=$1
                    AND moved_at >= $2 AND moved_at < $3 AND source_ward_id!=destination_ward_id
                UNION ALL
                SELECT destination_ward_id AS ward_id FROM admission_moves WHERE facility_id=$1
                    AND moved_at >= $2 AND moved_at < $3 AND source_ward_id!=destination_ward_id
            ), transfers AS (SELECT ward_id,count(*)::bigint AS transfers FROM move_wards GROUP BY ward_id)
            SELECT w.id AS ward_id,w.name AS ward,COALESCE(a.admissions,0)::bigint AS admissions,
                COALESCE(d.discharges,0)::bigint AS discharges,COALESCE(t.transfers,0)::bigint AS transfers
            FROM selected_wards w LEFT JOIN admissions a ON a.ward_id=w.id LEFT JOIN discharges d ON d.ward_id=w.id
                LEFT JOIN transfers t ON t.ward_id=w.id ORDER BY w.name,w.id"#,
        )
        .bind(facility_id)
        .bind(start_at)
        .bind(end_at)
        .bind(ward_id)
        .fetch_all(&mut **tx),
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| WardAdmissionMetric {
            ward_id: row.ward_id,
            ward: row.ward,
            admissions: Some(row.admissions),
            discharges: Some(row.discharges),
            transfers: Some(row.transfers),
        })
        .collect())
}
