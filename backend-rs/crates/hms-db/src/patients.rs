use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::patients::{
    PatientAdministrativeStatus, PatientContextKind, PatientContextListItem, PatientRecord,
    PatientRegistrationValidationRule, Sex,
};
use serde_json::json;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct PatientCursor {
    pub created_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Debug)]
pub struct PatientContextCursor {
    pub updated_at: DateTime<Utc>,
    pub patient_id: Uuid,
}

#[derive(Clone, Debug, Default)]
pub struct PatientContextFilters {
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewPatient {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_code: String,
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: NaiveDate,
    pub sex: Sex,
}

#[derive(Clone, Debug)]
pub struct PatientUpdate {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub sex: Option<Sex>,
    pub status: Option<PatientAdministrativeStatus>,
    pub actor_user_id: Uuid,
    pub request_id: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
struct PatientRow {
    id: Uuid,
    facility_id: Uuid,
    patient_code: String,
    first_name: String,
    last_name: String,
    date_of_birth: NaiveDate,
    sex: String,
    status: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PatientContextRow {
    id: Uuid,
    patient_code: String,
    first_name: String,
    last_name: String,
    date_of_birth: NaiveDate,
    sex: String,
    status: String,
    context_kind: String,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PatientRegistrationValidationRuleRow {
    id: Uuid,
    field_name: String,
    validation_regex: Option<String>,
    validation_message: String,
    is_required: bool,
    is_active: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

pub async fn list_patients(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<PatientCursor>,
    limit: i64,
    search: Option<&str>,
) -> anyhow::Result<Vec<PatientRecord>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT id,
               facility_id,
               patient_code,
               first_name,
               last_name,
               date_of_birth,
               sex,
               status,
               created_at,
               updated_at
        FROM patients
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);

    if let Some(cursor) = cursor {
        query.push(" AND (created_at, id) > (");
        query.push_bind(cursor.created_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    if let Some(search) = search.map(str::trim).filter(|value| !value.is_empty()) {
        let pattern = format!("%{}%", search.to_lowercase());
        query.push(" AND (lower(patient_code) LIKE ");
        query.push_bind(pattern.clone());
        query.push(" OR lower(first_name) LIKE ");
        query.push_bind(pattern.clone());
        query.push(" OR lower(last_name) LIKE ");
        query.push_bind(pattern);
        query.push(")");
    }

    query.push(" ORDER BY created_at ASC, id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query.build_query_as::<PatientRow>().fetch_all(pool).await?;
    rows.into_iter().map(patient_from_row).collect()
}

pub async fn get_patient(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
) -> anyhow::Result<Option<PatientRecord>> {
    let row = sqlx::query_as::<_, PatientRow>(
        r#"
        SELECT id,
               facility_id,
               patient_code,
               first_name,
               last_name,
               date_of_birth,
               sex,
               status,
               created_at,
               updated_at
        FROM patients
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(patient_id)
    .fetch_optional(pool)
    .await?;

    row.map(patient_from_row).transpose()
}

pub async fn list_patient_registration_validation_rules(
    pool: &PgPool,
    facility_id: Uuid,
    limit: i64,
) -> anyhow::Result<Vec<PatientRegistrationValidationRule>> {
    let rows = sqlx::query_as::<_, PatientRegistrationValidationRuleRow>(
        r#"
        SELECT id,
               field_name,
               validation_regex,
               validation_message,
               is_required,
               is_active,
               created_at,
               updated_at
        FROM patient_registration_validation_rules
        WHERE facility_id = $1
          AND is_active = TRUE
        ORDER BY field_name ASC
        LIMIT $2
        "#,
    )
    .bind(facility_id)
    .bind(limit.clamp(1, 100))
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| PatientRegistrationValidationRule {
            id: row.id,
            field_name: row.field_name,
            validation_regex: row.validation_regex,
            validation_message: row.validation_message,
            is_required: row.is_required,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect())
}

pub async fn update_patient(
    pool: &PgPool,
    patient: PatientUpdate,
) -> anyhow::Result<Option<PatientRecord>> {
    let mut transaction = pool.begin().await?;
    let mut changed_fields = Vec::new();
    if patient.first_name.is_some() {
        changed_fields.push("first_name");
    }
    if patient.last_name.is_some() {
        changed_fields.push("last_name");
    }
    if patient.date_of_birth.is_some() {
        changed_fields.push("date_of_birth");
    }
    if patient.sex.is_some() {
        changed_fields.push("sex");
    }
    if patient.status.is_some() {
        changed_fields.push("status");
    }

    let row = sqlx::query_as::<_, PatientRow>(
        r#"
        UPDATE patients
        SET first_name = COALESCE($3, first_name),
            last_name = COALESCE($4, last_name),
            date_of_birth = COALESCE($5, date_of_birth),
            sex = COALESCE($6, sex),
            status = COALESCE($7, status),
            updated_at = now()
        WHERE facility_id = $1 AND id = $2
        RETURNING id,
                  facility_id,
                  patient_code,
                  first_name,
                  last_name,
                  date_of_birth,
                  sex,
                  status,
                  created_at,
                  updated_at
        "#,
    )
    .bind(patient.facility_id)
    .bind(patient.id)
    .bind(patient.first_name)
    .bind(patient.last_name)
    .bind(patient.date_of_birth)
    .bind(patient.sex.map(codec::encode).transpose()?)
    .bind(patient.status.map(codec::encode).transpose()?)
    .fetch_optional(&mut *transaction)
    .await?;

    let Some(row) = row else {
        transaction.commit().await?;
        return Ok(None);
    };

    upsert_patient_context_tx(
        &mut transaction,
        patient.facility_id,
        patient.actor_user_id,
        row.id,
        PatientContextKind::Recent,
        None,
    )
    .await?;

    sqlx::query(
        r#"
        INSERT INTO audit_events (
            id,
            facility_id,
            actor_user_id,
            request_id,
            event_type,
            resource_type,
            resource_id,
            metadata
        )
        VALUES ($1, $2, $3, $4, 'patient.demographics.updated', 'patient', $5, $6)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(patient.facility_id)
    .bind(patient.actor_user_id)
    .bind(patient.request_id)
    .bind(row.id)
    .bind(json!({ "changed_fields": changed_fields }))
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    patient_from_row(row).map(Some)
}

pub async fn create_patient(pool: &PgPool, patient: NewPatient) -> anyhow::Result<PatientRecord> {
    let mut transaction = pool.begin().await?;
    let row = sqlx::query_as::<_, PatientRow>(
        r#"
        INSERT INTO patients (
            id,
            facility_id,
            patient_code,
            first_name,
            last_name,
            date_of_birth,
            sex,
            status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
        RETURNING id,
                  facility_id,
                  patient_code,
                  first_name,
                  last_name,
                  date_of_birth,
                  sex,
                  status,
                  created_at,
                  updated_at
        "#,
    )
    .bind(patient.id)
    .bind(patient.facility_id)
    .bind(&patient.patient_code)
    .bind(&patient.first_name)
    .bind(&patient.last_name)
    .bind(patient.date_of_birth)
    .bind(codec::encode(patient.sex)?)
    .fetch_one(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO patient_chronicle_read_models (patient_id, facility_id, summary_status)
        VALUES ($1, $2, 'empty')
        ON CONFLICT (patient_id) DO NOTHING
        "#,
    )
    .bind(row.id)
    .bind(row.facility_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    patient_from_row(row)
}

pub async fn list_context_patients(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    cursor: Option<PatientContextCursor>,
    limit: i64,
    filters: PatientContextFilters,
) -> anyhow::Result<Vec<PatientContextListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT patients.id,
               patients.patient_code,
               patients.first_name,
               patients.last_name,
               patients.date_of_birth,
               patients.sex,
               patients.status,
               patient_contexts.context_kind,
               patient_contexts.updated_at
        FROM patient_contexts
        INNER JOIN patients ON patients.id = patient_contexts.patient_id
        WHERE patient_contexts.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND patient_contexts.user_id = ");
    query.push_bind(user_id);
    query.push(" AND patients.facility_id = ");
    query.push_bind(facility_id);

    if let Some(patient_id) = filters.patient_id {
        query.push(" AND patients.id = ");
        query.push_bind(patient_id);
    }

    if let Some(search) = filters
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let pattern = format!("%{}%", search.to_lowercase());
        query.push(" AND (lower(patients.patient_code) LIKE ");
        query.push_bind(pattern.clone());
        query.push(" OR lower(patients.first_name) LIKE ");
        query.push_bind(pattern.clone());
        query.push(" OR lower(patients.last_name) LIKE ");
        query.push_bind(pattern);
        query.push(")");
    }

    if let Some(cursor) = cursor {
        query.push(" AND (patient_contexts.updated_at, patient_contexts.patient_id) < (");
        query.push_bind(cursor.updated_at);
        query.push(", ");
        query.push_bind(cursor.patient_id);
        query.push(")");
    }

    query.push(
        " ORDER BY patient_contexts.updated_at DESC, patient_contexts.patient_id DESC LIMIT ",
    );
    query.push_bind(limit);

    let rows = query
        .build_query_as::<PatientContextRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(patient_context_from_row).collect()
}

pub async fn upsert_patient_context(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    patient_id: Uuid,
    context_kind: PatientContextKind,
    label: Option<String>,
) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;
    upsert_patient_context_tx(
        &mut transaction,
        facility_id,
        user_id,
        patient_id,
        context_kind,
        label,
    )
    .await?;
    transaction.commit().await?;
    Ok(())
}

async fn upsert_patient_context_tx(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
    user_id: Uuid,
    patient_id: Uuid,
    context_kind: PatientContextKind,
    label: Option<String>,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO patient_contexts (
            id,
            facility_id,
            user_id,
            patient_id,
            context_kind,
            label
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, patient_id, context_kind)
        DO UPDATE SET label = EXCLUDED.label,
                      updated_at = now()
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(facility_id)
    .bind(user_id)
    .bind(patient_id)
    .bind(codec::encode(context_kind)?)
    .bind(label)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

fn patient_from_row(row: PatientRow) -> anyhow::Result<PatientRecord> {
    Ok(PatientRecord {
        id: row.id,
        facility_id: row.facility_id,
        patient_code: row.patient_code,
        first_name: row.first_name,
        last_name: row.last_name,
        date_of_birth: row.date_of_birth,
        sex: codec::decode(&row.sex)?,
        status: codec::decode::<PatientAdministrativeStatus>(&row.status)?,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn patient_context_from_row(row: PatientContextRow) -> anyhow::Result<PatientContextListItem> {
    let display_name = format!("{} {}", row.first_name, row.last_name);
    Ok(PatientContextListItem {
        id: row.id,
        patient_code: row.patient_code,
        display_name,
        sex: codec::decode(&row.sex)?,
        birth_year: row
            .date_of_birth
            .format("%Y")
            .to_string()
            .parse()
            .unwrap_or_default(),
        status: codec::decode(&row.status)?,
        context_kind: codec::decode(&row.context_kind)?,
        updated_at: row.updated_at,
    })
}
