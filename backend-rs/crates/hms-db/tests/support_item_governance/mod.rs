//! Trusted repository fixtures. HTTP password/reauthentication is independently
//! covered by inventory_item_governance_contract; this helper persists a real
//! synthetic session and supplies the mandatory repository proof.
#![allow(dead_code)]
use chrono::{Duration, Utc};
use hms_db::{inventory::items::InventoryItemActor, PgPool};
use hms_domain::{deployment::DeploymentProfile, inventory_items::*};
use uuid::Uuid;
pub async fn actor(pool: &PgPool, facility: Uuid) -> InventoryItemActor {
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    sqlx::query("UPDATE users SET password_change_required=false WHERE id=$1")
        .bind(user)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code) VALUES($1,'inventory.manage'),($1,'patient.demographics.view') ON CONFLICT DO NOTHING").bind(user).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO user_features(user_id,feature_key)VALUES($1,'inventory') ON CONFLICT DO NOTHING").bind(user).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO user_patient_visibility(user_id,visibility)VALUES($1,'demographics') ON CONFLICT DO NOTHING").bind(user).execute(pool).await.unwrap();
    let (sv, pv): (i64, i64) =
        sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
            .bind(user)
            .fetch_one(pool)
            .await
            .unwrap();
    let now: chrono::DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(pool)
        .await
        .unwrap();
    let session = Uuid::new_v4();
    hms_db::auth::insert_refresh_session(
        pool,
        &hms_db::auth::NewRefreshSession {
            token_hash: session.to_string(),
            session_id: session,
            session_family_id: session,
            rotated_from_session_id: None,
            user_id: user,
            facility_id: facility,
            session_version: sv,
            permission_version_at_issue: pv,
            csrf_token_hash: "synthetic-item24-session".into(),
            expires_at: now + Duration::hours(1),
            session_started_at: now,
            idle_expires_at: now + Duration::hours(1),
            absolute_expires_at: now + Duration::hours(1),
            device_label: None,
        },
    )
    .await
    .unwrap();
    let verified: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT password_verified_at FROM refresh_sessions WHERE session_id=$1")
            .bind(session)
            .fetch_one(pool)
            .await
            .unwrap();
    InventoryItemActor {
        facility_id: facility,
        user_id: user,
        request_id: "synthetic-item-governance-repository".into(),
        authorization: hms_db::clinical::prescription_courses::PrescriptionAuthorization {
            ordinary_reauth_required: true,
            original_password_verified_at: Some(verified),
            session_id: session,
            session_version: sv,
            permission_version: pv,
            active_profile: DeploymentProfile::Hospital,
            valid_until: verified + Duration::minutes(15),
            resolved_network_policy_version: Some(
                hms_db::network::get_policy(pool, facility)
                    .await
                    .unwrap()
                    .version,
            ),
        },
    }
}
pub async fn correct(
    pool: &PgPool,
    facility: Uuid,
    item: Uuid,
    unit: &str,
    code: &str,
    name: &str,
) -> anyhow::Result<InventoryItemCommandReceipt> {
    let actor = actor(pool, facility).await;
    let version: i64 = sqlx::query_scalar("SELECT version FROM inventory_items WHERE id=$1")
        .bind(item)
        .fetch_one(pool)
        .await?;
    let date = sqlx::query_scalar("SELECT(clock_timestamp() AT TIME ZONE 'UTC')::date")
        .fetch_one(pool)
        .await?;
    hms_db::inventory::items::command(
        pool,
        actor,
        InventoryItemReviewedInput::Correct {
            client_request_id: Uuid::new_v4(),
            item_id: item,
            expected_version: version,
            effective_from: date,
            code: code.into(),
            name: name.into(),
            unit: unit.into(),
            reason: "Synthetic reviewed catalog correction".into(),
        },
    )
    .await
}
pub fn before030() -> sqlx::migrate::Migrator {
    sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610300030)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    }
}
