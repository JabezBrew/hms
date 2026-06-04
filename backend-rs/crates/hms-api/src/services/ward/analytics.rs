use chrono::{DateTime, Duration, NaiveDate, NaiveTime, Utc};
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{WardAnalyticsQuery, WardAnalyticsResponse};

use super::common;
use crate::error::ApiError;
use crate::response::{object, ObjectResponse};
use crate::state::AppState;

const DEFAULT_ANALYTICS_DAYS: i64 = 30;
const MAX_ANALYTICS_DAYS: i64 = 366;

#[derive(Clone)]
pub struct WardAnalyticsService {
    state: AppState,
}

impl WardAnalyticsService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn analytics(
        &self,
        ctx: &hms_access::RequestContext,
        query: WardAnalyticsQuery,
    ) -> Result<ObjectResponse<WardAnalyticsResponse>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;

        if let Some(ward_id) = query.ward_id {
            let _ward = common::load_ward(&self.state, ward_id).await?;
        }

        let (start_at, end_at) = normalize_analytics_range(query.start_date, query.end_date)?;
        let analytics = hms_db::ward::ward_analytics(
            self.state.db_pool(),
            self.state.facility_id(),
            query.ward_id,
            start_at,
            end_at,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_analytics_failed",
                "Ward analytics could not be loaded.",
            )
        })?;

        Ok(object(analytics))
    }
}

fn normalize_analytics_range(
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
) -> Result<(DateTime<Utc>, DateTime<Utc>), ApiError> {
    let today = Utc::now().date_naive();
    let start = start_date.unwrap_or(today - Duration::days(DEFAULT_ANALYTICS_DAYS));
    let end = end_date.unwrap_or(today);

    if end < start {
        return Err(ApiError::bad_request(
            "invalid_date_range",
            "End date must be on or after start date.",
        ));
    }

    let end_exclusive = end
        .checked_add_signed(Duration::days(1))
        .ok_or_else(|| ApiError::bad_request("invalid_date_range", "End date is out of range."))?;
    let day_count = end_exclusive.signed_duration_since(start).num_days();
    if day_count > MAX_ANALYTICS_DAYS {
        return Err(ApiError::bad_request(
            "invalid_date_range",
            "Ward analytics date range cannot exceed 366 days.",
        ));
    }

    Ok((date_start(start), date_start(end_exclusive)))
}

fn date_start(date: NaiveDate) -> DateTime<Utc> {
    DateTime::from_naive_utc_and_offset(date.and_time(NaiveTime::MIN), Utc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn analytics_range_treats_end_date_as_inclusive() {
        let (start, end) = normalize_analytics_range(
            Some(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap()),
            Some(NaiveDate::from_ymd_opt(2026, 6, 4).unwrap()),
        )
        .expect("range is valid");

        assert_eq!(start, Utc.with_ymd_and_hms(2026, 6, 1, 0, 0, 0).unwrap());
        assert_eq!(end, Utc.with_ymd_and_hms(2026, 6, 5, 0, 0, 0).unwrap());
    }

    #[test]
    fn analytics_range_rejects_reversed_dates() {
        let result = normalize_analytics_range(
            Some(NaiveDate::from_ymd_opt(2026, 6, 4).unwrap()),
            Some(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap()),
        );

        assert!(result.is_err());
    }
}
