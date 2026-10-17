use chrono::{DateTime, Utc};
use hms_domain::consent::{ConsentGrantListItem, ConsentGrantStatus, ConsentScope};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct ConsentCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewConsentGrant {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub scope: ConsentScope,
    pub purpose: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct ConsentGrantRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    scope: String,
    purpose: String,
    status: String,
    expires_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
}

pub async fn list_consent_grants(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<ConsentCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ConsentGrantListItem>> {
    let mut query = consent_query();
    query.push(" WHERE consent_grants.facility_id = ");
    query.push_bind(facility_id);
    append_cursor(&mut query, cursor);
    query.push(" ORDER BY consent_grants.created_at ASC, consent_grants.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<ConsentGrantRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(consent_from_row).collect()
}

pub async fn create_consent_grant(
    pool: &PgPool,
    grant: NewConsentGrant,
) -> anyhow::Result<ConsentGrantListItem> {
    create_consent_grant_inner(pool, grant, None).await
}

pub async fn create_consent_grant_authorized(
    pool: &PgPool,
    grant: NewConsentGrant,
    authorization: crate::auth::assurance::BusinessFactorActor,
) -> anyhow::Result<ConsentGrantListItem> {
    create_consent_grant_inner(pool, grant, Some(authorization)).await
}

async fn create_consent_grant_inner(
    pool: &PgPool,
    grant: NewConsentGrant,
    authorization: Option<crate::auth::assurance::BusinessFactorActor>,
) -> anyhow::Result<ConsentGrantListItem> {
    let mut transaction = pool.begin().await?;
    let privileged_deadline = if let Some(mut actor) = authorization {
        Some(
            crate::auth::assurance::require_family_business_tx(
                &mut transaction,
                &mut actor,
                grant.facility_id,
                grant.created_by_user_id,
                hms_domain::deployment::PermissionCode::ConsentManage,
                hms_domain::deployment::FeatureKey::Patients,
            )
            .await?,
        )
    } else {
        None
    };
    sqlx::query(
        r#"
        INSERT INTO consent_grants (
            id,
            facility_id,
            patient_id,
            scope,
            purpose,
            status,
            expires_at,
            created_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE EXISTS (
            SELECT 1
            FROM patients
            WHERE patients.facility_id = $2
              AND patients.id = $3
        )
        "#,
    )
    .bind(grant.id)
    .bind(grant.facility_id)
    .bind(grant.patient_id)
    .bind(codec::encode(grant.scope)?)
    .bind(grant.purpose)
    .bind(codec::encode(ConsentGrantStatus::Active)?)
    .bind(grant.expires_at)
    .bind(grant.created_by_user_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,'consent_grant',$4,'{}'::jsonb)")
        .bind(grant.facility_id).bind(grant.created_by_user_id).bind("consent.granted").bind(grant.id).execute(&mut *transaction).await?;
    let result = consent_by_id(&mut *transaction, grant.facility_id, grant.id).await?;
    if let Some(end) = privileged_deadline {
        crate::auth::assurance::check_privileged_deadline_tx(&mut transaction, end).await?;
    }
    transaction.commit().await?;
    Ok(result)
}

pub async fn get_consent_grant(
    pool: &PgPool,
    facility_id: Uuid,
    grant_id: Uuid,
) -> anyhow::Result<Option<ConsentGrantListItem>> {
    optional_consent_by_id(pool, facility_id, grant_id).await
}

pub async fn revoke_consent_grant(
    pool: &PgPool,
    facility_id: Uuid,
    grant_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<ConsentGrantListItem>> {
    revoke_consent_grant_inner(pool, facility_id, grant_id, actor_user_id, None).await
}

pub async fn revoke_consent_grant_authorized(
    pool: &PgPool,
    facility_id: Uuid,
    grant_id: Uuid,
    actor_user_id: Uuid,
    authorization: crate::auth::assurance::BusinessFactorActor,
) -> anyhow::Result<Option<ConsentGrantListItem>> {
    revoke_consent_grant_inner(
        pool,
        facility_id,
        grant_id,
        actor_user_id,
        Some(authorization),
    )
    .await
}

async fn revoke_consent_grant_inner(
    pool: &PgPool,
    facility_id: Uuid,
    grant_id: Uuid,
    actor_user_id: Uuid,
    authorization: Option<crate::auth::assurance::BusinessFactorActor>,
) -> anyhow::Result<Option<ConsentGrantListItem>> {
    let mut transaction = pool.begin().await?;
    let privileged_deadline = if let Some(mut actor) = authorization {
        Some(
            crate::auth::assurance::require_family_business_tx(
                &mut transaction,
                &mut actor,
                facility_id,
                actor_user_id,
                hms_domain::deployment::PermissionCode::ConsentManage,
                hms_domain::deployment::FeatureKey::Patients,
            )
            .await?,
        )
    } else {
        None
    };
    let changed = sqlx::query(
        r#"
        UPDATE consent_grants
        SET status = $1,
            revoked_by_user_id = $2,
            revoked_at = COALESCE(revoked_at, now()),
            updated_at = now()
        WHERE facility_id = $3
          AND id = $4
          AND status = $5
        "#,
    )
    .bind(codec::encode(ConsentGrantStatus::Revoked)?)
    .bind(actor_user_id)
    .bind(facility_id)
    .bind(grant_id)
    .bind(codec::encode(ConsentGrantStatus::Active)?)
    .execute(&mut *transaction)
    .await?;

    if changed.rows_affected() > 0 {
        sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,'consent_grant',$4,'{}'::jsonb)")
        .bind(facility_id).bind(actor_user_id).bind("consent.revoked").bind(grant_id).execute(&mut *transaction).await?;
    }
    let result = optional_consent_by_id(&mut *transaction, facility_id, grant_id).await?;
    if let Some(end) = privileged_deadline {
        crate::auth::assurance::check_privileged_deadline_tx(&mut transaction, end).await?;
    }
    transaction.commit().await?;
    Ok(result)
}

fn consent_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT consent_grants.id,
               consent_grants.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               consent_grants.scope,
               consent_grants.purpose,
               consent_grants.status,
               consent_grants.expires_at,
               consent_grants.created_at,
               consent_grants.revoked_at
        FROM consent_grants
        JOIN patients
          ON patients.id = consent_grants.patient_id
         AND patients.facility_id = consent_grants.facility_id
        "#,
    )
}

fn append_cursor(query: &mut QueryBuilder<'_, Postgres>, cursor: Option<ConsentCursor>) {
    if let Some(cursor) = cursor {
        query.push(" AND (consent_grants.created_at, consent_grants.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
}

async fn consent_by_id<'e, E>(
    executor: E,
    facility_id: Uuid,
    grant_id: Uuid,
) -> anyhow::Result<ConsentGrantListItem>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    optional_consent_by_id(executor, facility_id, grant_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("consent grant was not found after write"))
}

async fn optional_consent_by_id<'e, E>(
    executor: E,
    facility_id: Uuid,
    grant_id: Uuid,
) -> anyhow::Result<Option<ConsentGrantListItem>>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let mut query = consent_query();
    query.push(" WHERE consent_grants.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND consent_grants.id = ");
    query.push_bind(grant_id);
    let row = query
        .build_query_as::<ConsentGrantRow>()
        .fetch_optional(executor)
        .await?;
    row.map(consent_from_row).transpose()
}

fn consent_from_row(row: ConsentGrantRow) -> anyhow::Result<ConsentGrantListItem> {
    Ok(ConsentGrantListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        scope: codec::decode(&row.scope)?,
        purpose: row.purpose,
        status: codec::decode(&row.status)?,
        expires_at: row.expires_at,
        created_at: row.created_at,
        revoked_at: row.revoked_at,
    })
}
