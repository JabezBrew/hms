//! Eligibility of a named local billing reviewer; no second-person ceremony.
use chrono::{DateTime, Utc};
use hms_domain::deployment::{DeploymentProfile, FeatureKey};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BillingApproverError {
    InvalidApprover,
    AuthorityExpired,
}
impl BillingApproverError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidApprover => "billing_approver_required",
            Self::AuthorityExpired => "billing_approver_authority_expired",
        }
    }
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidApprover => "Choose a distinct active billing reviewer in this facility.",
            Self::AuthorityExpired => {
                "The billing reviewer's authority changed. Review before continuing."
            }
        }
    }
}
impl std::fmt::Display for BillingApproverError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message())
    }
}
impl std::error::Error for BillingApproverError {}

#[derive(Clone, Copy)]
pub(super) struct Deadline(Option<DateTime<Utc>>);

/// Facility and deterministic actor/reviewer locks precede factor/policy locks.
/// Managed permission writers use the same user lock, so a reviewer cannot lose
/// authority between this proof and commit. Time boundaries need a final check.
pub(super) async fn lock(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    actor: Uuid,
    approver: Uuid,
) -> anyhow::Result<Deadline> {
    if actor == approver || approver.is_nil() {
        return Err(BillingApproverError::InvalidApprover.into());
    }
    let profile: Option<String> = sqlx::query_scalar(
        "SELECT deployment_profile FROM facilities WHERE id=$1 AND is_active FOR SHARE",
    )
    .bind(facility)
    .fetch_optional(&mut **tx)
    .await?;
    let profile: DeploymentProfile =
        crate::codec::decode(&profile.ok_or(BillingApproverError::InvalidApprover)?)?;
    let mut users = [actor, approver];
    users.sort_unstable();
    let locked: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND id=ANY($2) ORDER BY id FOR NO KEY UPDATE",
    )
    .bind(facility)
    .bind(users.as_slice())
    .fetch_all(&mut **tx)
    .await?;
    if locked.len() != 2 {
        return Err(BillingApproverError::InvalidApprover.into());
    }
    let billing_default = hms_domain::capabilities::feature_flags_for_profile(profile)
        .get(&FeatureKey::Billing)
        .copied()
        .unwrap_or(false);
    // effective_user_permissions uses transaction-start now(). Evaluate its
    // actual source semantics at DB time after every potentially blocking lock.
    let (eligible, boundary): (bool, Option<DateTime<Utc>>) = sqlx::query_as(
        r#"
        WITH point AS MATERIALIZED (SELECT clock_timestamp() AS at)
        SELECT EXISTS(
          SELECT 1 FROM users u CROSS JOIN point n
          WHERE u.facility_id=$1 AND u.id=$2 AND u.is_active AND NOT u.password_change_required
            AND EXISTS(SELECT 1 FROM user_features WHERE user_id=u.id AND feature_key='billing')
            AND COALESCE((SELECT enabled FROM facility_feature_entitlements WHERE facility_id=$1 AND feature_key='billing'),$3)
            AND (
              EXISTS(SELECT 1 FROM user_permissions WHERE user_id=u.id AND permission_code='billing.manage')
              OR EXISTS(SELECT 1 FROM permission_assignments pa WHERE pa.facility_id=$1 AND pa.grantee_user_id=u.id
                AND pa.permission_code='billing.manage' AND pa.status='active' AND pa.scope_type='facility' AND pa.scope_id IS NULL
                AND pa.starts_at<=n.at AND (pa.ends_at IS NULL OR pa.ends_at>n.at))
              OR EXISTS(SELECT 1 FROM delegations d WHERE d.facility_id=$1 AND d.delegate_user_id=u.id
                AND d.permission_code='billing.manage' AND d.status='active'
                AND d.starts_at<=n.at AND (d.ends_at IS NULL OR d.ends_at>n.at))
            )
        ),(
          SELECT min(boundary) FROM user_authority_boundaries b
          CROSS JOIN LATERAL (VALUES(b.starts_at),(b.ends_at)) AS boundaries(boundary)
          CROSS JOIN point n
          WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at
        )
        "#,
    )
    .bind(facility)
    .bind(approver)
    .bind(billing_default)
    .fetch_one(&mut **tx)
    .await?;
    if !eligible {
        return Err(BillingApproverError::InvalidApprover.into());
    }
    Ok(Deadline(boundary))
}

pub(super) async fn finish(
    tx: &mut Transaction<'_, Postgres>,
    deadline: Deadline,
    privileged: Option<crate::auth::assurance::PrivilegedDeadline>,
) -> anyhow::Result<()> {
    if deadline.0.is_none() && privileged.is_none() {
        return Ok(());
    }
    // Check every retained temporal proof at one final database instant. A
    // subsequent factor-clock query must not outlive the reviewer's cutoff.
    let at: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut **tx)
        .await?;
    if deadline.0.is_some_and(|end| at >= end) {
        return Err(BillingApproverError::AuthorityExpired.into());
    }
    if let Some(end) = privileged {
        end.check_at(at)?;
    }
    Ok(())
}
