use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::auth::PatientDataVisibility;
use hms_domain::deployment::{FeatureKey, PermissionCode};
use hms_domain::search::{
    OmniSearchGroups, OmniSearchItem, SearchIndexState, SearchIndexStatus, SearchResourceType,
};
use hms_observability::observe_db_query;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use sqlx::{FromRow, Postgres};
use uuid::Uuid;

use crate::{codec, PgPool};

const SEARCH_RESOURCE_TYPES: [SearchResourceType; 12] = [
    SearchResourceType::Patients,
    SearchResourceType::Wards,
    SearchResourceType::Encounters,
    SearchResourceType::Appointments,
    SearchResourceType::Admissions,
    SearchResourceType::Staff,
    SearchResourceType::Visits,
    SearchResourceType::Clinics,
    SearchResourceType::Laboratory,
    SearchResourceType::Billing,
    SearchResourceType::Inventory,
    SearchResourceType::Referrals,
];

#[derive(Clone, Debug)]
pub struct OmniSearchFilters {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub query: Option<String>,
    pub types: Vec<SearchResourceType>,
    pub limit_per_group: i64,
    pub permission_codes: Vec<PermissionCode>,
    pub feature_keys: Vec<FeatureKey>,
    pub patient_visibility: Vec<PatientDataVisibility>,
}

#[derive(Clone, Debug)]
pub struct OmniSearchResult {
    pub groups: OmniSearchGroups,
    pub index_status: Vec<SearchIndexStatus>,
}

#[derive(Clone, Debug, Deserialize, FromRow)]
struct SearchDocumentRow {
    id: Uuid,
    resource_type: String,
    title: String,
    subtitle: Option<String>,
    route_path: String,
    patient_id: Option<Uuid>,
    patient_code: Option<String>,
    patient_name: Option<String>,
    patient_date_of_birth: Option<NaiveDate>,
    status_label: Option<String>,
    occurred_at: Option<DateTime<Utc>>,
    metadata: Value,
    score: f64,
}

#[derive(Clone, Debug, Deserialize, FromRow)]
struct SearchIndexStatusRow {
    resource_type: String,
    status: String,
    indexed_count: i64,
    last_backfilled_at: Option<DateTime<Utc>>,
    last_error: Option<String>,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct SearchResultSetRow {
    documents: Value,
    index_status: Value,
}

pub async fn omni_search(
    pool: &PgPool,
    filters: OmniSearchFilters,
) -> anyhow::Result<OmniSearchResult> {
    let query = filters
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| value.len() >= 2)
        .map(|value| value.chars().take(120).collect::<String>());
    let query_is_empty = query.is_none();
    let type_codes = search_type_codes(&filters.types)?;
    let permission_codes = codec::encode_slice(&filters.permission_codes)?;
    let feature_keys = codec::encode_slice(&filters.feature_keys)?;
    let can_view_patient_demographics = filters
        .patient_visibility
        .contains(&PatientDataVisibility::Demographics)
        && filters
            .permission_codes
            .contains(&PermissionCode::PatientDemographicsView);
    let limit_per_group = filters.limit_per_group.clamp(1, 25);

    let (rows, index_status) = match query.as_deref() {
        Some(query) => {
            search_documents_with_status(
                pool,
                filters.facility_id,
                query,
                &type_codes,
                &permission_codes,
                &feature_keys,
                can_view_patient_demographics,
                limit_per_group,
            )
            .await?
        }
        None => {
            recent_patient_documents_with_status(
                pool,
                filters.facility_id,
                filters.user_id,
                &permission_codes,
                &feature_keys,
                can_view_patient_demographics,
                limit_per_group,
            )
            .await?
        }
    };

    let mut groups = OmniSearchGroups::default();
    for row in rows {
        let item = search_item_from_row(row)?;
        if query_is_empty && item.resource_type == SearchResourceType::Patients {
            groups.recent_patients.push(item);
        } else {
            groups.push(item);
        }
    }

    Ok(OmniSearchResult {
        groups,
        index_status,
    })
}

async fn search_documents_with_status(
    pool: &PgPool,
    facility_id: Uuid,
    query_text: &str,
    type_codes: &[String],
    permission_codes: &[String],
    feature_keys: &[String],
    can_view_patient_demographics: bool,
    limit_per_group: i64,
) -> anyhow::Result<(Vec<SearchDocumentRow>, Vec<SearchIndexStatus>)> {
    let row = observe_db_query(
        "search.documents_with_status",
        sqlx::query_as::<_, SearchResultSetRow>(
            r#"
        WITH candidates AS (
            SELECT id,
                   resource_type,
                   title,
                   subtitle,
                   route_path,
                   patient_id,
                   patient_code,
                   patient_name,
                   patient_date_of_birth,
                   status_label,
                   occurred_at,
                   metadata,
                   (
                       rank_boost::double precision
                       + CASE
                           WHEN lower(title) = lower($2) THEN 250
                           WHEN lower(title) LIKE lower($2) || '%' THEN 175
                           WHEN lower(coalesce(patient_code, '')) = lower($2) THEN 225
                           WHEN lower(coalesce(patient_code, '')) LIKE lower($2) || '%' THEN 160
                           ELSE 0
                         END
                       + (ts_rank_cd(to_tsvector('simple', search_text), plainto_tsquery('simple', $2)) * 100)
                       + (similarity(lower(search_text), lower($2)) * 50)
                   ) AS score,
                   source_updated_at
            FROM search_documents
            WHERE facility_id = $1
              AND is_active = true
              AND resource_type = ANY($3)
              AND permission_code = ANY($4)
              AND (feature_key IS NULL OR feature_key = ANY($5))
              AND (requires_patient_demographics = false OR $6 = true)
              AND (
                  to_tsvector('simple', search_text) @@ plainto_tsquery('simple', $2)
                  OR lower(search_text) LIKE '%' || lower($2) || '%'
                  OR similarity(lower(search_text), lower($2)) > 0.18
              )
        ),
        ranked AS (
            SELECT *,
                   row_number() OVER (
                       PARTITION BY resource_type
                       ORDER BY score DESC, source_updated_at DESC NULLS LAST, id
                   ) AS resource_rank
            FROM candidates
        ),
        result_rows AS (
            SELECT id,
                   resource_type,
                   title,
                   subtitle,
                   route_path,
                   patient_id,
                   patient_code,
                   patient_name,
                   patient_date_of_birth,
                   status_label,
                   occurred_at,
                   metadata,
                   score
            FROM ranked
            WHERE resource_rank <= $7
            ORDER BY score DESC, occurred_at DESC NULLS LAST, id
            LIMIT $8
        ),
        status_rows AS (
            SELECT resource_type,
                   status,
                   indexed_count,
                   last_backfilled_at,
                   last_error,
                   updated_at
            FROM search_index_status
            WHERE facility_id = $1
        )
        SELECT COALESCE((
                   SELECT jsonb_agg(to_jsonb(result_rows) ORDER BY result_rows.score DESC, result_rows.occurred_at DESC NULLS LAST, result_rows.id)
                   FROM result_rows
               ), '[]'::jsonb) AS documents,
               COALESCE((
                   SELECT jsonb_agg(to_jsonb(status_rows) ORDER BY status_rows.resource_type ASC)
                   FROM status_rows
               ), '[]'::jsonb) AS index_status
        "#,
        )
        .bind(facility_id)
        .bind(query_text)
        .bind(type_codes)
        .bind(permission_codes)
        .bind(feature_keys)
        .bind(can_view_patient_demographics)
        .bind(limit_per_group)
        .bind(limit_per_group * type_codes.len() as i64)
        .fetch_one(pool),
    )
    .await?;

    Ok((
        decode_search_json(row.documents, "documents")?,
        search_statuses_from_rows(decode_search_json(row.index_status, "index_status")?)?,
    ))
}

async fn recent_patient_documents_with_status(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    permission_codes: &[String],
    feature_keys: &[String],
    can_view_patient_demographics: bool,
    limit: i64,
) -> anyhow::Result<(Vec<SearchDocumentRow>, Vec<SearchIndexStatus>)> {
    if !can_view_patient_demographics {
        return Ok((Vec::new(), search_index_status(pool, facility_id).await?));
    }

    let row = observe_db_query(
        "search.recent_patients_with_status",
        sqlx::query_as::<_, SearchResultSetRow>(
            r#"
        WITH result_rows AS (
        SELECT search_documents.id,
               search_documents.resource_type,
               search_documents.title,
               search_documents.subtitle,
               search_documents.route_path,
               search_documents.patient_id,
               search_documents.patient_code,
               search_documents.patient_name,
               search_documents.patient_date_of_birth,
               search_documents.status_label,
               patient_contexts.updated_at AS occurred_at,
               search_documents.metadata,
               100::double precision AS score
        FROM patient_contexts
        INNER JOIN search_documents
          ON search_documents.facility_id = patient_contexts.facility_id
         AND search_documents.resource_type = 'patients'
         AND search_documents.resource_id = patient_contexts.patient_id
         AND search_documents.is_active = true
        WHERE patient_contexts.facility_id = $1
          AND patient_contexts.user_id = $2
          AND search_documents.permission_code = ANY($3)
          AND (search_documents.feature_key IS NULL OR search_documents.feature_key = ANY($4))
        ORDER BY patient_contexts.updated_at DESC, patient_contexts.patient_id DESC
        LIMIT $5
        ),
        status_rows AS (
            SELECT resource_type,
                   status,
                   indexed_count,
                   last_backfilled_at,
                   last_error,
                   updated_at
            FROM search_index_status
            WHERE facility_id = $1
        )
        SELECT COALESCE((
                   SELECT jsonb_agg(to_jsonb(result_rows) ORDER BY result_rows.occurred_at DESC NULLS LAST, result_rows.patient_id DESC)
                   FROM result_rows
               ), '[]'::jsonb) AS documents,
               COALESCE((
                   SELECT jsonb_agg(to_jsonb(status_rows) ORDER BY status_rows.resource_type ASC)
                   FROM status_rows
               ), '[]'::jsonb) AS index_status
        "#,
        )
        .bind(facility_id)
        .bind(user_id)
        .bind(permission_codes)
        .bind(feature_keys)
        .bind(limit)
        .fetch_one(pool),
    )
    .await?;

    Ok((
        decode_search_json(row.documents, "documents")?,
        search_statuses_from_rows(decode_search_json(row.index_status, "index_status")?)?,
    ))
}

pub async fn search_index_status(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Vec<SearchIndexStatus>> {
    let rows = observe_db_query(
        "search.index_status",
        sqlx::query_as::<_, SearchIndexStatusRow>(
            r#"
        SELECT resource_type,
               status,
               indexed_count,
               last_backfilled_at,
               last_error,
               updated_at
        FROM search_index_status
        WHERE facility_id = $1
        ORDER BY resource_type ASC
        "#,
        )
        .bind(facility_id)
        .fetch_all(pool),
    )
    .await?;

    search_statuses_from_rows(rows)
}

fn search_statuses_from_rows(
    rows: Vec<SearchIndexStatusRow>,
) -> anyhow::Result<Vec<SearchIndexStatus>> {
    if rows.is_empty() {
        return SEARCH_RESOURCE_TYPES
            .into_iter()
            .map(|resource_type| {
                Ok(SearchIndexStatus {
                    resource_type,
                    status: SearchIndexState::Empty,
                    indexed_count: 0,
                    last_backfilled_at: None,
                    last_error: None,
                    updated_at: Utc::now(),
                })
            })
            .collect();
    }

    rows.into_iter().map(search_status_from_row).collect()
}

fn decode_search_json<T>(value: Value, section: &'static str) -> anyhow::Result<Vec<T>>
where
    T: DeserializeOwned,
{
    serde_json::from_value(value)
        .map_err(|error| anyhow::anyhow!("search {section} could not be decoded: {error}"))
}

pub async fn rebuild_search_index_for_all_facilities(pool: &PgPool) -> anyhow::Result<()> {
    let facility_ids = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id
        FROM facilities
        WHERE is_active = true
        ORDER BY created_at ASC, id ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    for facility_id in facility_ids {
        rebuild_search_index_for_facility(pool, facility_id).await?;
    }

    Ok(())
}

pub async fn rebuild_search_index_for_facility(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Vec<SearchIndexStatus>> {
    let mut transaction = pool.begin().await?;

    for resource_type in SEARCH_RESOURCE_TYPES {
        mark_index_state(
            &mut transaction,
            facility_id,
            resource_type,
            SearchIndexState::Rebuilding,
            0,
            None,
        )
        .await?;
    }

    sqlx::query("DELETE FROM search_documents WHERE facility_id = $1")
        .bind(facility_id)
        .execute(&mut *transaction)
        .await?;

    let patients = insert_patient_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Patients,
        patients,
    )
    .await?;

    let staff = insert_staff_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Staff,
        staff,
    )
    .await?;

    let wards = insert_ward_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Wards,
        wards,
    )
    .await?;

    let appointments = insert_appointment_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Appointments,
        appointments,
    )
    .await?;

    let encounters = insert_encounter_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Encounters,
        encounters,
    )
    .await?;

    let admissions = insert_admission_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Admissions,
        admissions,
    )
    .await?;

    let visits = insert_visit_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Visits,
        visits,
    )
    .await?;

    let clinics = insert_clinic_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Clinics,
        clinics,
    )
    .await?;

    let laboratory = insert_laboratory_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Laboratory,
        laboratory,
    )
    .await?;

    let billing = insert_billing_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Billing,
        billing,
    )
    .await?;

    let inventory = insert_inventory_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Inventory,
        inventory,
    )
    .await?;

    let referrals = insert_referral_documents(&mut transaction, facility_id).await?;
    mark_index_ready(
        &mut transaction,
        facility_id,
        SearchResourceType::Referrals,
        referrals,
    )
    .await?;

    transaction.commit().await?;
    search_index_status(pool, facility_id).await
}

async fn insert_patient_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            patient_id,
            patient_code,
            patient_name,
            patient_date_of_birth,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            requires_patient_demographics,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               patients.facility_id,
               'patients',
               patients.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               patients.first_name || ' ' || patients.last_name,
               'MRN ' || patients.patient_code,
               '/patients/' || patients.id::text,
               patients.status,
               'patients',
               'patient.demographics.view',
               true,
               concat_ws(' ',
                   patients.patient_code,
                   patients.first_name,
                   patients.last_name,
                   patients.first_name || ' ' || patients.last_name,
                   patients.status
               ),
               120,
               patients.updated_at,
               patients.updated_at,
               jsonb_build_object('sex', patients.sex, 'status', patients.status),
               patients.status <> 'inactive'
        FROM patients
        WHERE patients.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn insert_staff_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               staff_profiles.facility_id,
               'staff',
               staff_profiles.id,
               users.display_name,
               staff_profiles.employee_id || ' · ' || staff_profiles.position,
               '/staff/' || staff_profiles.id::text,
               CASE WHEN users.is_active THEN 'active' ELSE 'inactive' END,
               'admin',
               'admin.staff.manage',
               concat_ws(' ',
                   users.display_name,
                   users.email,
                   staff_profiles.employee_id,
                   staff_profiles.department,
                   staff_profiles.position,
                   practitioner_profiles.license_number,
                   practitioner_profiles.specialization
               ),
               CASE WHEN practitioner_profiles.id IS NULL THEN 30 ELSE 55 END,
               greatest(staff_profiles.updated_at, users.updated_at),
               staff_profiles.updated_at,
               jsonb_build_object(
                   'employee_id', staff_profiles.employee_id,
                   'department', staff_profiles.department,
                   'position', staff_profiles.position,
                   'practitioner_id', practitioner_profiles.id,
                   'license_number', practitioner_profiles.license_number,
                   'specialization', practitioner_profiles.specialization
               ),
               users.is_active
        FROM staff_profiles
        INNER JOIN users ON users.id = staff_profiles.user_id
        LEFT JOIN practitioner_profiles ON practitioner_profiles.staff_id = staff_profiles.id
        WHERE staff_profiles.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn insert_ward_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               wards.facility_id,
               'wards',
               wards.id,
               wards.name,
               'Ward ' || wards.code,
               '/wards/' || wards.id::text,
               wards.status,
               'wards',
               'ward.view',
               concat_ws(' ', wards.code, wards.name, wards.status),
               70,
               wards.updated_at,
               wards.updated_at,
               jsonb_build_object('code', wards.code, 'status', wards.status),
               wards.status = 'active'
        FROM wards
        WHERE wards.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn insert_appointment_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            patient_id,
            patient_code,
            patient_name,
            patient_date_of_birth,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            requires_patient_demographics,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               appointments.facility_id,
               'appointments',
               appointments.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               patients.first_name || ' ' || patients.last_name,
               coalesce(clinics.name || ' · ', '') || appointments.starts_at::text,
               '/appointments/' || appointments.id::text,
               appointments.status,
               'appointments',
               'appointment.view',
               true,
               concat_ws(' ',
                   patients.patient_code,
                   patients.first_name,
                   patients.last_name,
                   clinics.code,
                   clinics.name,
                   appointments.status,
                   appointments.starts_at::text
               ),
               80,
               appointments.updated_at,
               appointments.starts_at,
               jsonb_build_object(
                   'clinic_id', clinics.id,
                   'clinic_name', clinics.name,
                   'starts_at', appointments.starts_at,
                   'ends_at', appointments.ends_at
               ),
               appointments.status <> 'cancelled'
        FROM appointments
        INNER JOIN patients ON patients.id = appointments.patient_id
        LEFT JOIN clinics ON clinics.id = appointments.clinic_id
        WHERE appointments.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn insert_encounter_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            patient_id,
            patient_code,
            patient_name,
            patient_date_of_birth,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            requires_patient_demographics,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               encounters.facility_id,
               'encounters',
               encounters.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               patients.first_name || ' ' || patients.last_name,
               encounters.encounter_type || ' encounter',
               '/encounters/' || encounters.id::text,
               encounters.status,
               'encounters',
               'encounter.view',
               true,
               concat_ws(' ',
                   patients.patient_code,
                   patients.first_name,
                   patients.last_name,
                   encounters.encounter_type,
                   encounters.status
               ),
               75,
               encounters.updated_at,
               encounters.started_at,
               jsonb_build_object(
                   'encounter_type', encounters.encounter_type,
                   'started_at', encounters.started_at,
                   'ended_at', encounters.ended_at
               ),
               encounters.status <> 'cancelled'
        FROM encounters
        INNER JOIN patients ON patients.id = encounters.patient_id
        WHERE encounters.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn insert_admission_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            patient_id,
            patient_code,
            patient_name,
            patient_date_of_birth,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            requires_patient_demographics,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               admission_cases.facility_id,
               'admissions',
               admission_cases.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               patients.first_name || ' ' || patients.last_name,
               wards.name || coalesce(' · Bed ' || beds.bed_code, ''),
               '/admissions/' || admission_cases.id::text,
               admission_cases.status,
               'admissions',
               'admission.manage',
               true,
               concat_ws(' ',
                   patients.patient_code,
                   patients.first_name,
                   patients.last_name,
                   wards.code,
                   wards.name,
                   beds.bed_code,
                   admission_cases.status
               ),
               80,
               admission_cases.updated_at,
               admission_cases.admitted_at,
               jsonb_build_object(
                   'ward_id', wards.id,
                   'ward_name', wards.name,
                   'bed_id', beds.id,
                   'bed_number', beds.bed_code,
                   'admitted_at', admission_cases.admitted_at,
                   'discharged_at', admission_cases.discharged_at
               ),
               admission_cases.status IN ('admitted', 'discharge_pending', 'reserved')
        FROM admission_cases
        INNER JOIN patients ON patients.id = admission_cases.patient_id
        INNER JOIN wards ON wards.id = admission_cases.ward_id
        LEFT JOIN beds ON beds.id = admission_cases.bed_id
        WHERE admission_cases.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn insert_visit_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            patient_id,
            patient_code,
            patient_name,
            patient_date_of_birth,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            requires_patient_demographics,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               visits.facility_id,
               'visits',
               visits.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               patients.first_name || ' ' || patients.last_name,
               coalesce(clinics.name || ' · ', '') || visits.status,
               '/visits/' || visits.id::text,
               visits.status,
               'encounters',
               'encounter.view',
               true,
               concat_ws(' ',
                   patients.patient_code,
                   patients.first_name,
                   patients.last_name,
                   clinics.code,
                   clinics.name,
                   visits.status
               ),
               65,
               visits.updated_at,
               visits.checked_in_at,
               jsonb_build_object(
                   'appointment_id', visits.appointment_id,
                   'clinic_id', clinics.id,
                   'clinic_name', clinics.name,
                   'checked_in_at', visits.checked_in_at
               ),
               visits.status NOT IN ('checked_out', 'cancelled', 'no_show')
        FROM visits
        INNER JOIN patients ON patients.id = visits.patient_id
        LEFT JOIN clinics ON clinics.id = visits.clinic_id
        WHERE visits.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn insert_clinic_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               clinics.facility_id,
               'clinics',
               clinics.id,
               clinics.name,
               'Clinic ' || clinics.code,
               '/appointments',
               CASE WHEN clinics.is_active THEN 'active' ELSE 'inactive' END,
               'appointments',
               'appointment.view',
               concat_ws(' ', clinics.code, clinics.name),
               55,
               clinics.updated_at,
               clinics.updated_at,
               jsonb_build_object('code', clinics.code),
               clinics.is_active
        FROM clinics
        WHERE clinics.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn insert_laboratory_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            patient_id,
            patient_code,
            patient_name,
            patient_date_of_birth,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            requires_patient_demographics,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               lab_tests.facility_id,
               'laboratory',
               lab_tests.id,
               NULL::uuid,
               NULL::text,
               NULL::text,
               NULL::date,
               lab_tests.name,
               'Lab test ' || lab_tests.code,
               '/laboratory/catalog',
               CASE WHEN lab_tests.is_active THEN 'active' ELSE 'inactive' END,
               'laboratory',
               'laboratory.order.manage',
               false,
               concat_ws(' ', lab_tests.code, lab_tests.name, lab_tests.specimen_type, lab_tests.result_unit),
               45,
               lab_tests.updated_at,
               lab_tests.updated_at,
               jsonb_build_object('source_table', 'lab_tests', 'code', lab_tests.code, 'specimen_type', lab_tests.specimen_type),
               lab_tests.is_active
        FROM lab_tests
        WHERE lab_tests.facility_id = $1
        UNION ALL
        SELECT gen_random_uuid(),
               lab_panels.facility_id,
               'laboratory',
               lab_panels.id,
               NULL::uuid,
               NULL::text,
               NULL::text,
               NULL::date,
               lab_panels.name,
               'Lab panel ' || lab_panels.code,
               '/laboratory/panels/' || lab_panels.id::text,
               CASE WHEN lab_panels.is_active THEN 'active' ELSE 'inactive' END,
               'laboratory',
               'laboratory.order.manage',
               false,
               concat_ws(' ', lab_panels.code, lab_panels.name),
               45,
               lab_panels.updated_at,
               lab_panels.updated_at,
               jsonb_build_object('source_table', 'lab_panels', 'code', lab_panels.code),
               lab_panels.is_active
        FROM lab_panels
        WHERE lab_panels.facility_id = $1
        UNION ALL
        SELECT gen_random_uuid(),
               lab_orders.facility_id,
               'laboratory',
               lab_orders.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               'Lab order',
               patients.first_name || ' ' || patients.last_name || ' · ' || lab_orders.priority,
               '/laboratory/orders/' || lab_orders.id::text,
               lab_orders.status,
               'laboratory',
               'laboratory.order.manage',
               true,
               concat_ws(' ', patients.patient_code, patients.first_name, patients.last_name, lab_orders.priority, lab_orders.status),
               70,
               lab_orders.updated_at,
               lab_orders.ordered_at,
               jsonb_build_object('source_table', 'lab_orders', 'priority', lab_orders.priority, 'ordered_at', lab_orders.ordered_at),
               lab_orders.status <> 'cancelled'
        FROM lab_orders
        INNER JOIN patients ON patients.id = lab_orders.patient_id
        WHERE lab_orders.facility_id = $1
        UNION ALL
        SELECT gen_random_uuid(),
               lab_results.facility_id,
               'laboratory',
               lab_results.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               lab_tests.name || ' result',
               patients.first_name || ' ' || patients.last_name,
               '/laboratory/results',
               lab_results.status,
               'laboratory',
               'laboratory.result.verify',
               true,
               concat_ws(' ', patients.patient_code, patients.first_name, patients.last_name, lab_tests.code, lab_tests.name, lab_results.status),
               65,
               lab_results.updated_at,
               lab_results.entered_at,
               jsonb_build_object('source_table', 'lab_results', 'test_id', lab_tests.id, 'test_name', lab_tests.name),
               lab_results.status <> 'cancelled'
        FROM lab_results
        INNER JOIN patients ON patients.id = lab_results.patient_id
        INNER JOIN lab_tests ON lab_tests.id = lab_results.test_id
        WHERE lab_results.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn insert_billing_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            patient_id,
            patient_code,
            patient_name,
            patient_date_of_birth,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            requires_patient_demographics,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               service_catalog.facility_id,
               'billing',
               service_catalog.id,
               NULL::uuid,
               NULL::text,
               NULL::text,
               NULL::date,
               service_catalog.name,
               'Service ' || service_catalog.code,
               '/billing/catalog',
               CASE WHEN service_catalog.active THEN 'active' ELSE 'inactive' END,
               'billing',
               'billing.view',
               false,
               concat_ws(' ', service_catalog.code, service_catalog.name, service_catalog.service_kind),
               40,
               service_catalog.created_at,
               service_catalog.created_at,
               jsonb_build_object('source_table', 'service_catalog', 'code', service_catalog.code, 'service_kind', service_catalog.service_kind),
               service_catalog.active
        FROM service_catalog
        WHERE service_catalog.facility_id = $1
        UNION ALL
        SELECT gen_random_uuid(),
               invoices.facility_id,
               'billing',
               invoices.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               invoices.invoice_number,
               patients.first_name || ' ' || patients.last_name,
               '/billing/invoices/' || invoices.id::text,
               invoices.status,
               'billing',
               'billing.view',
               true,
               concat_ws(' ', invoices.invoice_number, patients.patient_code, patients.first_name, patients.last_name, invoices.status),
               70,
               invoices.updated_at,
               invoices.issued_at,
               jsonb_build_object('source_table', 'invoices', 'currency', invoices.currency, 'issued_at', invoices.issued_at),
               true
        FROM invoices
        INNER JOIN patients ON patients.id = invoices.patient_id
        WHERE invoices.facility_id = $1
        UNION ALL
        SELECT gen_random_uuid(),
               payments.facility_id,
               'billing',
               payments.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               payments.receipt_number,
               patients.first_name || ' ' || patients.last_name,
               '/billing/payments',
               payments.status,
               'billing',
               'billing.view',
               true,
               concat_ws(' ', payments.receipt_number, patients.patient_code, patients.first_name, patients.last_name, payments.method, payments.status),
               65,
               payments.paid_at,
               payments.paid_at,
               jsonb_build_object('source_table', 'payments', 'invoice_id', invoices.id, 'method', payments.method),
               true
        FROM payments
        INNER JOIN invoices ON invoices.id = payments.invoice_id
        INNER JOIN patients ON patients.id = invoices.patient_id
        WHERE payments.facility_id = $1
        UNION ALL
        SELECT gen_random_uuid(),
               nhis_claims.facility_id,
               'billing',
               nhis_claims.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               nhis_claims.claim_number,
               patients.first_name || ' ' || patients.last_name,
               '/billing/claims',
               nhis_claims.status,
               'nhis',
               'nhis.claim.manage',
               true,
               concat_ws(' ', nhis_claims.claim_number, patients.patient_code, patients.first_name, patients.last_name, nhis_claims.status),
               60,
               nhis_claims.updated_at,
               nhis_claims.created_at,
               jsonb_build_object('source_table', 'nhis_claims', 'invoice_id', invoices.id),
               true
        FROM nhis_claims
        INNER JOIN invoices ON invoices.id = nhis_claims.invoice_id
        INNER JOIN patients ON patients.id = nhis_claims.patient_id
        WHERE nhis_claims.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn insert_inventory_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               inventory_items.facility_id,
               'inventory',
               inventory_items.id,
               inventory_items.name,
               inventory_items.code || ' · ' || inventory_items.unit,
               '/inventory/items/' || inventory_items.id::text,
               CASE WHEN inventory_items.is_active THEN 'active' ELSE 'inactive' END,
               'inventory',
               CASE WHEN inventory_items.controlled THEN 'controlled_substance.manage' ELSE 'inventory.view' END,
               concat_ws(' ', inventory_items.code, inventory_items.name, inventory_items.item_type, inventory_items.unit, inventory_categories.name),
               55,
               inventory_items.updated_at,
               inventory_items.updated_at,
               jsonb_build_object(
                   'source_table', 'inventory_items',
                   'code', inventory_items.code,
                   'item_type', inventory_items.item_type,
                   'controlled', inventory_items.controlled,
                   'category', inventory_categories.name
               ),
               inventory_items.is_active
        FROM inventory_items
        INNER JOIN inventory_categories ON inventory_categories.id = inventory_items.category_id
        WHERE inventory_items.facility_id = $1
        UNION ALL
        SELECT gen_random_uuid(),
               storage_locations.facility_id,
               'inventory',
               storage_locations.id,
               storage_locations.name,
               'Location ' || storage_locations.code,
               '/inventory/locations',
               CASE WHEN storage_locations.is_active THEN 'active' ELSE 'inactive' END,
               'inventory',
               'inventory.view',
               concat_ws(' ', storage_locations.code, storage_locations.name),
               45,
               storage_locations.created_at,
               storage_locations.created_at,
               jsonb_build_object('source_table', 'storage_locations', 'code', storage_locations.code),
               storage_locations.is_active
        FROM storage_locations
        WHERE storage_locations.facility_id = $1
        UNION ALL
        SELECT gen_random_uuid(),
               inventory_suppliers.facility_id,
               'inventory',
               inventory_suppliers.id,
               inventory_suppliers.name,
               'Supplier ' || inventory_suppliers.code,
               '/inventory/suppliers',
               CASE WHEN inventory_suppliers.is_active THEN 'active' ELSE 'inactive' END,
               'inventory',
               'inventory.view',
               concat_ws(' ', inventory_suppliers.code, inventory_suppliers.name, inventory_suppliers.contact_name, inventory_suppliers.phone, inventory_suppliers.email),
               40,
               inventory_suppliers.updated_at,
               inventory_suppliers.created_at,
               jsonb_build_object('source_table', 'inventory_suppliers', 'code', inventory_suppliers.code),
               inventory_suppliers.is_active
        FROM inventory_suppliers
        WHERE inventory_suppliers.facility_id = $1
        UNION ALL
        SELECT gen_random_uuid(),
               purchase_orders.facility_id,
               'inventory',
               purchase_orders.id,
               purchase_orders.supplier_name,
               'Purchase order',
               '/inventory/purchase-orders/' || purchase_orders.id::text,
               purchase_orders.status,
               'inventory',
               'inventory.view',
               concat_ws(' ', purchase_orders.supplier_name, purchase_orders.status),
               35,
               purchase_orders.created_at,
               purchase_orders.created_at,
               jsonb_build_object('source_table', 'purchase_orders', 'supplier_name', purchase_orders.supplier_name),
               true
        FROM purchase_orders
        WHERE purchase_orders.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn insert_referral_documents(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<i64> {
    let result = sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            patient_id,
            patient_code,
            patient_name,
            patient_date_of_birth,
            title,
            subtitle,
            route_path,
            status_label,
            feature_key,
            permission_code,
            requires_patient_demographics,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        SELECT gen_random_uuid(),
               referrals.facility_id,
               'referrals',
               referrals.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               referrals.to_service,
               patients.first_name || ' ' || patients.last_name || ' · ' || referrals.priority,
               '/referrals/' || referrals.id::text,
               referrals.status,
               'referrals',
               'referral.manage',
               true,
               concat_ws(' ', referrals.to_service, referrals.priority, referrals.status, patients.patient_code, patients.first_name, patients.last_name),
               65,
               referrals.updated_at,
               referrals.created_at,
               jsonb_build_object('source_table', 'referrals', 'sla_due_at', referrals.sla_due_at),
               referrals.status NOT IN ('completed', 'declined')
        FROM referrals
        INNER JOIN patients ON patients.id = referrals.patient_id
        WHERE referrals.facility_id = $1
        UNION ALL
        SELECT gen_random_uuid(),
               clinic_waitlist_entries.facility_id,
               'referrals',
               clinic_waitlist_entries.id,
               patients.id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name,
               patients.date_of_birth,
               clinic_waitlist_entries.service,
               patients.first_name || ' ' || patients.last_name || ' · waitlist',
               '/referrals/waitlist',
               clinic_waitlist_entries.status,
               'referrals',
               'referral.manage',
               true,
               concat_ws(' ', clinic_waitlist_entries.service, clinic_waitlist_entries.priority, clinic_waitlist_entries.status, patients.patient_code, patients.first_name, patients.last_name),
               60,
               clinic_waitlist_entries.updated_at,
               clinic_waitlist_entries.created_at,
               jsonb_build_object('source_table', 'clinic_waitlist_entries', 'priority', clinic_waitlist_entries.priority),
               clinic_waitlist_entries.status NOT IN ('completed', 'cancelled')
        FROM clinic_waitlist_entries
        INNER JOIN patients ON patients.id = clinic_waitlist_entries.patient_id
        WHERE clinic_waitlist_entries.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .execute(&mut **transaction)
    .await?;

    Ok(result.rows_affected() as i64)
}

async fn mark_index_ready(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
    resource_type: SearchResourceType,
    indexed_count: i64,
) -> anyhow::Result<()> {
    let status = if indexed_count == 0 {
        SearchIndexState::Empty
    } else {
        SearchIndexState::Ready
    };
    mark_index_state(
        transaction,
        facility_id,
        resource_type,
        status,
        indexed_count,
        None,
    )
    .await
}

async fn mark_index_state(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
    resource_type: SearchResourceType,
    status: SearchIndexState,
    indexed_count: i64,
    last_error: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO search_index_status (
            facility_id,
            resource_type,
            status,
            indexed_count,
            last_backfilled_at,
            last_error,
            updated_at
        )
        VALUES ($1, $2, $3, $4, now(), $5, now())
        ON CONFLICT (facility_id, resource_type) DO UPDATE
        SET status = EXCLUDED.status,
            indexed_count = EXCLUDED.indexed_count,
            last_backfilled_at = EXCLUDED.last_backfilled_at,
            last_error = EXCLUDED.last_error,
            updated_at = now()
        "#,
    )
    .bind(facility_id)
    .bind(codec::encode(resource_type)?)
    .bind(codec::encode(status)?)
    .bind(indexed_count)
    .bind(last_error)
    .execute(&mut **transaction)
    .await?;

    Ok(())
}

fn search_type_codes(types: &[SearchResourceType]) -> anyhow::Result<Vec<String>> {
    let selected = if types.is_empty() {
        SEARCH_RESOURCE_TYPES.to_vec()
    } else {
        types.to_vec()
    };

    selected.into_iter().map(codec::encode).collect()
}

fn search_item_from_row(row: SearchDocumentRow) -> anyhow::Result<OmniSearchItem> {
    Ok(OmniSearchItem {
        id: row.id,
        resource_type: codec::decode(&row.resource_type)?,
        title: row.title,
        subtitle: row.subtitle,
        route_path: row.route_path,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_name: row.patient_name,
        patient_date_of_birth: row.patient_date_of_birth,
        status_label: row.status_label,
        occurred_at: row.occurred_at,
        metadata: row.metadata,
        score: row.score,
    })
}

fn search_status_from_row(row: SearchIndexStatusRow) -> anyhow::Result<SearchIndexStatus> {
    Ok(SearchIndexStatus {
        resource_type: codec::decode(&row.resource_type)?,
        status: codec::decode(&row.status)?,
        indexed_count: row.indexed_count,
        last_backfilled_at: row.last_backfilled_at,
        last_error: row.last_error,
        updated_at: row.updated_at,
    })
}
