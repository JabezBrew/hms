use super::*;
use chrono::{Duration, NaiveDate};

pub(super) fn finite_end(row: &rows::CourseRow) -> anyhow::Result<Option<DateTime<Utc>>> {
    let p = &row.source_snapshot.0;
    let Some(days) = p["duration_days"].as_i64() else {
        return Ok(None);
    };
    if days <= 0 {
        return Err(TreatmentCourseError::ReviewRequired.into());
    }
    let anchor = if !p["first_dose_at"].is_null() {
        serde_json::from_value(p["first_dose_at"].clone())
            .map_err(|_| TreatmentCourseError::ReviewRequired)?
    } else if let Some(date) = p["start_date"].as_str() {
        date.parse::<NaiveDate>()
            .map_err(|_| TreatmentCourseError::ReviewRequired)?
            .and_hms_opt(0, 0, 0)
            .ok_or(TreatmentCourseError::ReviewRequired)?
            .and_utc()
    } else {
        row.summary.first_dose_at
    };
    Ok(Some(
        anchor
            .checked_add_signed(
                Duration::try_days(days).ok_or(TreatmentCourseError::ReviewRequired)?,
            )
            .ok_or(TreatmentCourseError::ReviewRequired)?,
    ))
}
pub(super) fn constraints(
    row: &rows::CourseRow,
    now: DateTime<Utc>,
) -> anyhow::Result<Option<TreatmentWindowConstraints>> {
    let Some(from) = row.summary.scheduled_through else {
        return Ok(None);
    };
    let span = Duration::days(MAX_TREATMENT_WINDOW_DAYS);
    let mut end = from
        .checked_add_signed(span)
        .ok_or(TreatmentCourseError::ReviewRequired)?
        .min(
            now.checked_add_signed(span)
                .ok_or(TreatmentCourseError::ReviewRequired)?,
        );
    if let Some(prescribed) = finite_end(row)? {
        end = end.min(prescribed);
    }
    if end <= from {
        return Ok(None);
    }
    Ok(Some(TreatmentWindowConstraints {
        scheduled_from: from,
        scheduled_before_max: end,
        maximum_new_doses: MAX_TREATMENT_WINDOW_DOSES as u16,
    }))
}
pub(super) fn dose_times(
    row: &rows::CourseRow,
    before: DateTime<Utc>,
) -> anyhow::Result<Vec<(DateTime<Utc>, i32)>> {
    let from = row
        .summary
        .scheduled_through
        .ok_or(TreatmentCourseError::ReviewRequired)?;
    if row.summary.generation_window_start != row.summary.first_dose_at
        || row.summary.generation_window_end <= row.summary.generation_window_start
        || from < row.summary.generation_window_end
    {
        return Err(TreatmentCourseError::ReviewRequired.into());
    }
    let interval = row.course_snapshot["interval_minutes"]
        .as_i64()
        .filter(|n| *n > 0)
        .ok_or(TreatmentCourseError::WindowUnsupported)?;
    let actual = crate::pharmacy::reviewed_interval_minutes(&row.summary.frequency)
        .map_err(|_| TreatmentCourseError::WindowUnsupported)?;
    if actual.map(i64::from) != Some(interval) {
        return Err(TreatmentCourseError::ReviewRequired.into());
    }
    let step = interval
        .checked_mul(60_000_000)
        .ok_or(TreatmentCourseError::WindowInvalid)?;
    let elapsed = (from - row.summary.first_dose_at)
        .num_microseconds()
        .filter(|n| *n >= 0)
        .ok_or(TreatmentCourseError::ReviewRequired)?;
    let mut sequence = elapsed
        .checked_add(step - 1)
        .ok_or(TreatmentCourseError::WindowInvalid)?
        / step;
    let mut at = row
        .summary
        .first_dose_at
        .checked_add_signed(Duration::microseconds(
            sequence
                .checked_mul(step)
                .ok_or(TreatmentCourseError::WindowInvalid)?,
        ))
        .ok_or(TreatmentCourseError::WindowInvalid)?;
    let mut times = Vec::new();
    while at < before {
        if times.len() >= MAX_TREATMENT_WINDOW_DOSES {
            return Err(TreatmentCourseError::WindowInvalid.into());
        }
        times.push((
            at,
            i32::try_from(
                sequence
                    .checked_add(1)
                    .ok_or(TreatmentCourseError::WindowInvalid)?,
            )
            .map_err(|_| TreatmentCourseError::WindowInvalid)?,
        ));
        sequence = sequence
            .checked_add(1)
            .ok_or(TreatmentCourseError::WindowInvalid)?;
        at = at
            .checked_add_signed(Duration::microseconds(step))
            .ok_or(TreatmentCourseError::WindowInvalid)?;
    }
    if times.is_empty() {
        return Err(TreatmentCourseError::WindowInvalid.into());
    }
    Ok(times)
}
