pub use hms_auth::{issue_access_token, verify_access_token, AccessClaims};

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

const MAX_AUTH_IDENTITIES: usize = 4096;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum AuthAttempt {
    Login,
    PasswordReset,
}

impl AuthAttempt {
    fn policy(self) -> (u32, Option<u32>, Duration) {
        match self {
            Self::Login => (10, None, Duration::from_secs(60)),
            Self::PasswordReset => (3, Some(60), Duration::from_secs(15 * 60)),
        }
    }
}

struct AttemptWindow {
    started_at: Instant,
    attempts: u32,
}

#[derive(Default)]
struct AttemptWindows {
    identities: HashMap<(AuthAttempt, [u8; 32]), AttemptWindow>,
    overall: HashMap<AuthAttempt, AttemptWindow>,
}

pub(crate) struct AuthAttemptLimiter {
    salt: String,
    windows: Mutex<AttemptWindows>,
}

impl Default for AuthAttemptLimiter {
    fn default() -> Self {
        Self {
            salt: hms_db::provision::generate_secret_token(),
            windows: Mutex::new(AttemptWindows::default()),
        }
    }
}

impl AuthAttemptLimiter {
    pub(crate) fn claim(&self, action: AuthAttempt, email: &str, facility: &str) -> bool {
        self.claim_at(action, email, facility, Instant::now())
    }

    fn claim_at(&self, action: AuthAttempt, email: &str, facility: &str, now: Instant) -> bool {
        let mut digest = Sha256::new();
        digest.update(self.salt.as_bytes());
        for value in [
            facility.trim().to_ascii_lowercase(),
            email.trim().to_ascii_lowercase(),
        ] {
            digest.update((value.len() as u64).to_le_bytes());
            digest.update(value.as_bytes());
        }
        let key = (action, digest.finalize().into());
        let (identity_limit, overall_limit, window) = action.policy();
        let Ok(mut windows) = self.windows.lock() else {
            return false;
        };
        if let Some(overall_limit) = overall_limit {
            let overall = windows.overall.entry(action).or_insert(AttemptWindow {
                started_at: now,
                attempts: 0,
            });
            if now.duration_since(overall.started_at) >= window {
                overall.started_at = now;
                overall.attempts = 0;
            }
            if overall.attempts >= overall_limit {
                return false;
            }
        }
        if windows.identities.len() >= MAX_AUTH_IDENTITIES {
            windows.identities.retain(|(action, _), entry| {
                now.duration_since(entry.started_at) < action.policy().2
            });
            if windows.identities.len() >= MAX_AUTH_IDENTITIES
                && !windows.identities.contains_key(&key)
            {
                return false;
            }
        }
        let identity = windows.identities.entry(key).or_insert(AttemptWindow {
            started_at: now,
            attempts: 0,
        });
        if now.duration_since(identity.started_at) >= window {
            identity.started_at = now;
            identity.attempts = 0;
        }
        if identity.attempts >= identity_limit {
            return false;
        }
        identity.attempts += 1;
        if let Some(overall) = windows.overall.get_mut(&action) {
            overall.attempts += 1;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_attempts_normalize_identity_and_reopen_only_after_the_window() {
        let limiter = AuthAttemptLimiter::default();
        let now = Instant::now();
        for _ in 0..10 {
            assert!(limiter.claim_at(AuthAttempt::Login, " Staff@Example.invalid ", " HMS ", now));
        }
        assert!(!limiter.claim_at(AuthAttempt::Login, "staff@example.invalid", "hms", now));
        assert!(limiter.claim_at(AuthAttempt::Login, "other@example.invalid", "hms", now));
        assert!(limiter.claim_at(
            AuthAttempt::PasswordReset,
            "staff@example.invalid",
            "hms",
            now
        ));
        assert!(limiter.claim_at(
            AuthAttempt::Login,
            "staff@example.invalid",
            "hms",
            now + Duration::from_secs(60)
        ));
    }

    #[test]
    fn login_attempts_do_not_hold_a_shared_timed_lockout_for_other_identities() {
        let limiter = AuthAttemptLimiter::default();
        let now = Instant::now();
        for index in 0..120 {
            assert!(limiter.claim_at(
                AuthAttempt::Login,
                &format!("synthetic-{index}@example.invalid"),
                "hms",
                now
            ));
        }
        assert!(limiter.claim_at(
            AuthAttempt::Login,
            "another@example.invalid",
            "another-facility",
            now
        ));
        assert_eq!(
            limiter
                .windows
                .lock()
                .expect("windows accessible")
                .identities
                .len(),
            121
        );
    }

    #[test]
    fn concurrent_attempts_share_one_budget() {
        let limiter = std::sync::Arc::new(AuthAttemptLimiter::default());
        let now = Instant::now();
        let allowed = std::thread::scope(|scope| {
            (0..32)
                .map(|_| {
                    let limiter = limiter.clone();
                    scope.spawn(move || {
                        limiter.claim_at(
                            AuthAttempt::PasswordReset,
                            "synthetic@example.invalid",
                            "hms",
                            now,
                        )
                    })
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|handle| handle.join().expect("attempt thread succeeds"))
                .filter(|allowed| *allowed)
                .count()
        });
        assert_eq!(allowed, 3);
    }
}
