use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::ward::{
    WardAdmissionMetric, WardAnalyticsMeta, WardAnalyticsResponse, WardLengthOfStayBucket,
    WardOccupancyTrendPoint, WardUtilizationMetric,
};
use hms_observability::observe_db_query;
use sqlx::FromRow;
use uuid::Uuid;

use crate::PgPool;

#[derive(Clone, Debug, FromRow)]
struct OccupancyTrendRow {
    date: NaiveDate,
    ward_id: Uuid,
    ward: String,
    occupancy_rate: f64,
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
    occupancy_rate: f64,
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
}

pub async fn ward_analytics(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> anyhow::Result<WardAnalyticsResponse> {
    let occupancy_trends = occupancy_trends(pool, facility_id, ward_id, start_at, end_at).await?;
    let length_of_stay =
        length_of_stay_distribution(pool, facility_id, ward_id, start_at, end_at).await?;
    let ward_utilization =
        utilization_metrics(pool, facility_id, ward_id, start_at, end_at).await?;
    let admissions_by_ward =
        admission_metrics(pool, facility_id, ward_id, start_at, end_at).await?;

    Ok(WardAnalyticsResponse {
        meta: WardAnalyticsMeta {
            mode: "rust_v2_aggregates".to_owned(),
            unavailable_metrics: vec!["transfers".to_owned(), "revenue".to_owned()],
        },
        occupancy_trends,
        length_of_stay,
        ward_utilization,
        admissions_by_ward,
    })
}

async fn occupancy_trends(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> anyhow::Result<Vec<WardOccupancyTrendPoint>> {
    let rows = observe_db_query(
        "ward.analytics.occupancy_trends",
        sqlx::query_as::<_, OccupancyTrendRow>(
            r#"
        WITH selected_wards AS (
            SELECT wards.id, wards.name
            FROM wards
            WHERE wards.facility_id = $1
              AND wards.status = 'active'
              AND ($4::uuid IS NULL OR wards.id = $4)
        ),
        days AS (
            SELECT generate_series($2::date, ($3::date - INTERVAL '1 day')::date, INTERVAL '1 day')::date AS day
        ),
        bed_counts AS (
            SELECT beds.ward_id,
                   count(*) FILTER (WHERE beds.status != 'closed')::BIGINT AS total_beds
            FROM beds
            JOIN selected_wards ON selected_wards.id = beds.ward_id
            WHERE beds.facility_id = $1
            GROUP BY beds.ward_id
        )
        SELECT days.day AS date,
               selected_wards.id AS ward_id,
               selected_wards.name AS ward,
               CASE
                   WHEN COALESCE(bed_counts.total_beds, 0) > 0 THEN
                       (
                           COALESCE(SUM(
                               GREATEST(
                                   EXTRACT(EPOCH FROM (
                                       LEAST(COALESCE(admission_cases.discharged_at, $3), days.day::timestamptz + INTERVAL '1 day', $3)
                                       - GREATEST(admission_cases.admitted_at, days.day::timestamptz, $2)
                                   )),
                                   0
                               )
                           ), 0) / 86400.0
                       ) / bed_counts.total_beds::DOUBLE PRECISION * 100.0
                   ELSE 0.0
               END::DOUBLE PRECISION AS occupancy_rate,
               (COALESCE(SUM(
                   GREATEST(
                       EXTRACT(EPOCH FROM (
                           LEAST(COALESCE(admission_cases.discharged_at, $3), days.day::timestamptz + INTERVAL '1 day', $3)
                           - GREATEST(admission_cases.admitted_at, days.day::timestamptz, $2)
                       )),
                       0
                   )
               ), 0) / 86400.0)::DOUBLE PRECISION AS occupied_bed_days,
               COALESCE(bed_counts.total_beds, 0)::BIGINT AS total_beds
        FROM days
        CROSS JOIN selected_wards
        LEFT JOIN bed_counts ON bed_counts.ward_id = selected_wards.id
        LEFT JOIN admission_cases
               ON admission_cases.facility_id = $1
              AND admission_cases.ward_id = selected_wards.id
              AND admission_cases.status IN ('admitted', 'discharge_pending', 'discharged')
              AND admission_cases.admitted_at < LEAST(days.day::timestamptz + INTERVAL '1 day', $3)
              AND COALESCE(admission_cases.discharged_at, $3) > GREATEST(days.day::timestamptz, $2)
        GROUP BY days.day, selected_wards.id, selected_wards.name, bed_counts.total_beds
        ORDER BY days.day ASC, selected_wards.name ASC, selected_wards.id ASC
        "#,
        )
        .bind(facility_id)
        .bind(start_at)
        .bind(end_at)
        .bind(ward_id)
        .fetch_all(pool),
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
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> anyhow::Result<Vec<WardLengthOfStayBucket>> {
    let rows = observe_db_query(
        "ward.analytics.length_of_stay",
        sqlx::query_as::<_, LengthOfStayBucketRow>(
            r#"
        WITH selected_wards AS (
            SELECT wards.id
            FROM wards
            WHERE wards.facility_id = $1
              AND wards.status = 'active'
              AND ($4::uuid IS NULL OR wards.id = $4)
        ),
        buckets(range, ordinal) AS (
            VALUES ('0-2 days', 1),
                   ('3-5 days', 2),
                   ('6-10 days', 3),
                   ('11-20 days', 4),
                   ('21+ days', 5)
        ),
        completed AS (
            SELECT CASE
                       WHEN EXTRACT(EPOCH FROM (admission_cases.discharged_at - admission_cases.admitted_at)) / 86400.0 < 3 THEN '0-2 days'
                       WHEN EXTRACT(EPOCH FROM (admission_cases.discharged_at - admission_cases.admitted_at)) / 86400.0 < 6 THEN '3-5 days'
                       WHEN EXTRACT(EPOCH FROM (admission_cases.discharged_at - admission_cases.admitted_at)) / 86400.0 < 11 THEN '6-10 days'
                       WHEN EXTRACT(EPOCH FROM (admission_cases.discharged_at - admission_cases.admitted_at)) / 86400.0 < 21 THEN '11-20 days'
                       ELSE '21+ days'
                   END AS range
            FROM admission_cases
            JOIN selected_wards ON selected_wards.id = admission_cases.ward_id
            WHERE admission_cases.facility_id = $1
              AND admission_cases.status = 'discharged'
              AND admission_cases.discharged_at >= $2
              AND admission_cases.discharged_at < $3
        ),
        counts AS (
            SELECT completed.range, count(*)::BIGINT AS count
            FROM completed
            GROUP BY completed.range
        ),
        total AS (
            SELECT COALESCE(sum(counts.count), 0)::BIGINT AS count
            FROM counts
        )
        SELECT buckets.range,
               COALESCE(counts.count, 0)::BIGINT AS count,
               CASE
                   WHEN total.count > 0 THEN COALESCE(counts.count, 0)::DOUBLE PRECISION / total.count::DOUBLE PRECISION * 100.0
                   ELSE 0.0
               END::DOUBLE PRECISION AS percentage
        FROM buckets
        CROSS JOIN total
        LEFT JOIN counts ON counts.range = buckets.range
        ORDER BY buckets.ordinal ASC
        "#,
        )
        .bind(facility_id)
        .bind(start_at)
        .bind(end_at)
        .bind(ward_id)
        .fetch_all(pool),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| WardLengthOfStayBucket {
            range: row.range,
            count: row.count,
            percentage: row.percentage,
        })
        .collect())
}

async fn utilization_metrics(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> anyhow::Result<Vec<WardUtilizationMetric>> {
    let rows = observe_db_query(
        "ward.analytics.utilization",
        sqlx::query_as::<_, UtilizationRow>(
            r#"
        WITH selected_wards AS (
            SELECT wards.id, wards.name
            FROM wards
            WHERE wards.facility_id = $1
              AND wards.status = 'active'
              AND ($4::uuid IS NULL OR wards.id = $4)
        ),
        bed_counts AS (
            SELECT beds.ward_id,
                   count(*) FILTER (WHERE beds.status != 'closed')::BIGINT AS total_beds,
                   count(*) FILTER (WHERE beds.status = 'occupied')::BIGINT AS occupied_beds_count
            FROM beds
            JOIN selected_wards ON selected_wards.id = beds.ward_id
            WHERE beds.facility_id = $1
            GROUP BY beds.ward_id
        ),
        stay_days AS (
            SELECT admission_cases.ward_id,
                   (COALESCE(SUM(
                       GREATEST(
                           EXTRACT(EPOCH FROM (
                               LEAST(COALESCE(admission_cases.discharged_at, $3), $3)
                               - GREATEST(admission_cases.admitted_at, $2)
                           )),
                           0
                       )
                   ), 0) / 86400.0)::DOUBLE PRECISION AS bed_days
            FROM admission_cases
            JOIN selected_wards ON selected_wards.id = admission_cases.ward_id
            WHERE admission_cases.facility_id = $1
              AND admission_cases.status IN ('admitted', 'discharge_pending', 'discharged')
              AND admission_cases.admitted_at < $3
              AND COALESCE(admission_cases.discharged_at, $3) > $2
            GROUP BY admission_cases.ward_id
        ),
        discharge_metrics AS (
            SELECT admission_cases.ward_id,
                   count(*)::BIGINT AS discharges,
                   (AVG(EXTRACT(EPOCH FROM (admission_cases.discharged_at - admission_cases.admitted_at)) / 86400.0))::DOUBLE PRECISION AS avg_los
            FROM admission_cases
            JOIN selected_wards ON selected_wards.id = admission_cases.ward_id
            WHERE admission_cases.facility_id = $1
              AND admission_cases.status = 'discharged'
              AND admission_cases.discharged_at >= $2
              AND admission_cases.discharged_at < $3
            GROUP BY admission_cases.ward_id
        ),
        range_span AS (
            SELECT GREATEST(EXTRACT(EPOCH FROM ($3 - $2)) / 86400.0, 1.0)::DOUBLE PRECISION AS days
        )
        SELECT selected_wards.id AS ward_id,
               selected_wards.name AS ward,
               CASE
                   WHEN COALESCE(bed_counts.total_beds, 0) > 0 THEN
                       COALESCE(stay_days.bed_days, 0.0) / (bed_counts.total_beds::DOUBLE PRECISION * range_span.days) * 100.0
                   ELSE 0.0
               END::DOUBLE PRECISION AS occupancy_rate,
               COALESCE(bed_counts.occupied_beds_count, 0)::BIGINT AS occupied_beds_count,
               COALESCE(bed_counts.total_beds, 0)::BIGINT AS total_beds,
               CASE
                   WHEN COALESCE(bed_counts.total_beds, 0) > 0 THEN
                       COALESCE(discharge_metrics.discharges, 0)::DOUBLE PRECISION / bed_counts.total_beds::DOUBLE PRECISION
                   ELSE NULL
               END::DOUBLE PRECISION AS turnover_rate,
               discharge_metrics.avg_los,
               COALESCE(stay_days.bed_days, 0.0)::DOUBLE PRECISION AS bed_days
        FROM selected_wards
        CROSS JOIN range_span
        LEFT JOIN bed_counts ON bed_counts.ward_id = selected_wards.id
        LEFT JOIN stay_days ON stay_days.ward_id = selected_wards.id
        LEFT JOIN discharge_metrics ON discharge_metrics.ward_id = selected_wards.id
        ORDER BY selected_wards.name ASC, selected_wards.id ASC
        "#,
        )
        .bind(facility_id)
        .bind(start_at)
        .bind(end_at)
        .bind(ward_id)
        .fetch_all(pool),
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
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> anyhow::Result<Vec<WardAdmissionMetric>> {
    let rows = observe_db_query(
        "ward.analytics.admissions",
        sqlx::query_as::<_, AdmissionMetricRow>(
            r#"
        WITH selected_wards AS (
            SELECT wards.id, wards.name
            FROM wards
            WHERE wards.facility_id = $1
              AND wards.status = 'active'
              AND ($4::uuid IS NULL OR wards.id = $4)
        ),
        admissions AS (
            SELECT admission_cases.ward_id, count(*)::BIGINT AS admissions
            FROM admission_cases
            JOIN selected_wards ON selected_wards.id = admission_cases.ward_id
            WHERE admission_cases.facility_id = $1
              AND admission_cases.status IN ('admitted', 'discharge_pending', 'discharged')
              AND admission_cases.admitted_at >= $2
              AND admission_cases.admitted_at < $3
            GROUP BY admission_cases.ward_id
        ),
        discharges AS (
            SELECT admission_cases.ward_id, count(*)::BIGINT AS discharges
            FROM admission_cases
            JOIN selected_wards ON selected_wards.id = admission_cases.ward_id
            WHERE admission_cases.facility_id = $1
              AND admission_cases.status = 'discharged'
              AND admission_cases.discharged_at >= $2
              AND admission_cases.discharged_at < $3
            GROUP BY admission_cases.ward_id
        )
        SELECT selected_wards.id AS ward_id,
               selected_wards.name AS ward,
               COALESCE(admissions.admissions, 0)::BIGINT AS admissions,
               COALESCE(discharges.discharges, 0)::BIGINT AS discharges
        FROM selected_wards
        LEFT JOIN admissions ON admissions.ward_id = selected_wards.id
        LEFT JOIN discharges ON discharges.ward_id = selected_wards.id
        ORDER BY selected_wards.name ASC, selected_wards.id ASC
        "#,
        )
        .bind(facility_id)
        .bind(start_at)
        .bind(end_at)
        .bind(ward_id)
        .fetch_all(pool),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| WardAdmissionMetric {
            ward_id: row.ward_id,
            ward: row.ward,
            admissions: row.admissions,
            discharges: row.discharges,
            transfers: None,
        })
        .collect())
}
