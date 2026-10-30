//! Internal database authorization observation, aged only by monotonic time.
//! This type is deliberately absent from serde, OpenAPI, tokens and cache keys.
use chrono::{DateTime, Duration, Utc};
use std::time::Instant;

#[derive(Clone, Copy, Debug)]
pub struct AuthorizationClock {
    observed_at: DateTime<Utc>,
    started_at: Instant,
}
impl AuthorizationClock {
    /// Capture started_at immediately before the SQL that supplies observed_at.
    /// Including query/transport duration conservatively shortens deadlines.
    pub fn new(observed_at: DateTime<Utc>, started_at: Instant) -> Self {
        Self {
            observed_at,
            started_at,
        }
    }
    pub fn observed_at(self) -> DateTime<Utc> {
        self.observed_at
    }
    pub fn at(self, instant: Instant) -> Option<DateTime<Utc>> {
        let elapsed = instant.checked_duration_since(self.started_at)?;
        self.observed_at
            .checked_add_signed(Duration::from_std(elapsed).ok()?)
    }
    pub fn now(self) -> Option<DateTime<Utc>> {
        self.at(Instant::now())
    }
    /// Elapsed time must never turn evidence rejected at observation into proof.
    pub fn admits_verified_at(self, verified_at: DateTime<Utc>) -> bool {
        verified_at <= self.observed_at
    }
    pub fn remaining_until(self, deadline: DateTime<Utc>) -> Option<std::time::Duration> {
        let remaining = deadline.signed_duration_since(self.now()?).to_std().ok()?;
        (!remaining.is_zero()).then_some(remaining)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn database_time_ages_conservatively_without_host_wall_clock() {
        let host = Utc::now();
        let start = Instant::now();
        for offset in [-3600, 3600] {
            let database = host + Duration::seconds(offset);
            let clock = AuthorizationClock::new(database, start);
            assert_eq!(clock.at(start), Some(database));
            assert_eq!(
                clock.at(start + std::time::Duration::from_secs(900)),
                Some(database + Duration::minutes(15))
            );
            assert!(clock.admits_verified_at(database));
            assert!(!clock.admits_verified_at(database + Duration::nanoseconds(1)));
            assert!(!clock.admits_verified_at(database + Duration::seconds(1)));
            assert!(clock
                .at(start - std::time::Duration::from_nanos(1))
                .is_none());
        }
    }
    #[test]
    fn clone_keeps_admission_age_and_deadline_does_not_renew() {
        let start = Instant::now() - std::time::Duration::from_secs(901);
        let database = Utc::now();
        let clock = AuthorizationClock::new(database, start);
        assert!(clock
            .remaining_until(database + Duration::minutes(15))
            .is_none());
        assert!(clock
            .clone()
            .remaining_until(database + Duration::minutes(15))
            .is_none());
    }
}
