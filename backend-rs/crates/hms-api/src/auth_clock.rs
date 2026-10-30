use chrono::{DateTime, Utc};
use hms_domain::auth_assurance::AuthClockObservation;

pub(crate) fn observation(
    database: DateTime<Utc>,
    issuer_window: Option<(DateTime<Utc>, DateTime<Utc>)>,
) -> Option<AuthClockObservation> {
    observation_at(database, issuer_window, Utc::now())
}
fn observation_at(
    database: DateTime<Utc>,
    issuer_window: Option<(DateTime<Utc>, DateTime<Utc>)>,
    issuer: DateTime<Utc>,
) -> Option<AuthClockObservation> {
    let remaining = if let Some((issued, end)) = issuer_window {
        if issued > issuer || issuer >= end || issued >= end {
            return None;
        }
        Some(u64::try_from((end - issuer).num_milliseconds()).ok()?)
    } else {
        None
    };
    Some(AuthClockObservation {
        database_observed_at: database,
        issuer_observed_at: issuer,
        access_token_remaining_ms: remaining,
    })
}
pub(crate) fn window(claims: &crate::auth::AccessClaims) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    Some((
        DateTime::from_timestamp(i64::try_from(claims.iat).ok()?, 0)?,
        DateTime::from_timestamp(i64::try_from(claims.exp).ok()?, 0)?,
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn issuer_budget_uses_actual_signed_window_without_clock_domain_comparison() {
        let issuer = Utc::now();
        for skew in [-3600, 3600] {
            let raw = issuer + chrono::Duration::seconds(skew);
            let out = observation_at(
                raw,
                Some((
                    issuer - chrono::Duration::seconds(1),
                    issuer + chrono::Duration::milliseconds(1234),
                )),
                issuer,
            )
            .unwrap();
            assert_eq!(out.access_token_remaining_ms, Some(1234));
            assert_eq!(out.database_observed_at, raw);
        }
        assert!(observation_at(
            issuer,
            Some((
                issuer + chrono::Duration::nanoseconds(1),
                issuer + chrono::Duration::seconds(1)
            )),
            issuer
        )
        .is_none());
        assert!(observation_at(
            issuer,
            Some((issuer - chrono::Duration::seconds(1), issuer)),
            issuer
        )
        .is_none());
    }
}
