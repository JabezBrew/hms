use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::patients::{
    identity_for_legacy_status, PatientAdministrativeStatus, PatientContextKind,
    PatientContextListItem, PatientCurrentContexts, PatientCurrentEmergencyContext,
    PatientCurrentInpatientContext, PatientCurrentOutpatientContext, PatientIdentityCandidate,
    PatientIdentityMatchStrength, PatientRecord, PatientRecordStatus,
    PatientRegistrationValidationRule, PatientVitalStatus, Sex,
};
use hms_domain::ward::AdmissionStatus;
use hms_observability::observe_db_query;
use serde_json::json;
use sha2::{Digest, Sha256};
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

#[derive(Clone, Debug, Default)]
pub struct PatientRegistryFilters {
    pub search: Option<String>,
    pub patient_id: Option<Uuid>,
    pub status: Option<PatientAdministrativeStatus>,
    pub record_status: Option<PatientRecordStatus>,
    pub vital_status: Option<PatientVitalStatus>,
    pub admission_start_at: Option<DateTime<Utc>>,
    pub admission_end_before: Option<DateTime<Utc>>,
    pub ward_id: Option<Uuid>,
    pub admission_status: Option<AdmissionStatus>,
    pub attending_id: Option<Uuid>,
    pub date_of_birth_on_or_after: Option<NaiveDate>,
    pub date_of_birth_on_or_before: Option<NaiveDate>,
}

impl PatientRegistryFilters {
    fn has_admission_filters(&self) -> bool {
        self.admission_start_at.is_some()
            || self.admission_end_before.is_some()
            || self.ward_id.is_some()
            || self.admission_status.is_some()
            || self.attending_id.is_some()
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PatientListSortField {
    RegisteredAt,
    PatientCode,
    DisplayName,
    DateOfBirth,
    Sex,
    Status,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct PatientListOrdering {
    pub field: PatientListSortField,
    pub direction: SortDirection,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PatientListOrderingParseError;

impl PatientListOrdering {
    pub fn parse(value: Option<&str>) -> Result<Self, PatientListOrderingParseError> {
        let Some(raw) = value.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(Self::default());
        };
        let (direction, field) = match raw.strip_prefix('-') {
            Some(field) => (SortDirection::Desc, field),
            None => (SortDirection::Asc, raw),
        };
        let field = match field {
            "created_at" | "registered_at" => PatientListSortField::RegisteredAt,
            "medical_record_number" | "mrn" | "patient_code" => PatientListSortField::PatientCode,
            "name" | "display_name" => PatientListSortField::DisplayName,
            "date_of_birth" | "birth_year" => PatientListSortField::DateOfBirth,
            "gender" | "sex" => PatientListSortField::Sex,
            "registry_status" | "status" => PatientListSortField::Status,
            _ => return Err(PatientListOrderingParseError),
        };
        Ok(Self { field, direction })
    }

    pub fn cache_key(self) -> &'static str {
        match (self.field, self.direction) {
            (PatientListSortField::RegisteredAt, SortDirection::Asc) => "created_at",
            (PatientListSortField::RegisteredAt, SortDirection::Desc) => "-created_at",
            (PatientListSortField::PatientCode, SortDirection::Asc) => "patient_code",
            (PatientListSortField::PatientCode, SortDirection::Desc) => "-patient_code",
            (PatientListSortField::DisplayName, SortDirection::Asc) => "display_name",
            (PatientListSortField::DisplayName, SortDirection::Desc) => "-display_name",
            (PatientListSortField::DateOfBirth, SortDirection::Asc) => "date_of_birth",
            (PatientListSortField::DateOfBirth, SortDirection::Desc) => "-date_of_birth",
            (PatientListSortField::Sex, SortDirection::Asc) => "sex",
            (PatientListSortField::Sex, SortDirection::Desc) => "-sex",
            (PatientListSortField::Status, SortDirection::Asc) => "status",
            (PatientListSortField::Status, SortDirection::Desc) => "-status",
        }
    }
}

impl Default for PatientListOrdering {
    fn default() -> Self {
        Self {
            field: PatientListSortField::RegisteredAt,
            direction: SortDirection::Desc,
        }
    }
}

#[derive(Clone, Debug)]
pub struct PatientListRecord {
    pub patient: PatientRecord,
    pub patient_location: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewPatient {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub created_by_user_id: Uuid,
    pub request_id: Option<String>,
    pub patient_code: String,
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: NaiveDate,
    pub sex: Sex,
    pub duplicate_override: Option<DuplicateOverrideAudit>,
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
    pub record_status: Option<PatientRecordStatus>,
    pub vital_status: Option<PatientVitalStatus>,
    pub superseded_by_patient_id: Option<Uuid>,
    pub status_reason_code: Option<String>,
    pub status_reason_note: Option<String>,
    pub actor_user_id: Uuid,
    pub request_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DuplicateOverrideAudit {
    pub lookup_id: Uuid,
    pub reason_code: String,
    pub reason_note_present: bool,
    pub candidate_count: usize,
}

#[derive(Clone, Debug)]
pub struct PatientIdentityLookupFilters {
    pub patient_code: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub sex: Option<Sex>,
    pub limit: i64,
}

#[derive(Clone, Debug)]
pub struct NewPatientIdentityLookupSession {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub lookup_fingerprint: String,
    pub candidate_patient_ids: Vec<Uuid>,
    pub strong_duplicate_found: bool,
    pub created_by_user_id: Uuid,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct PatientIdentityLookupSession {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub lookup_fingerprint: String,
    pub candidate_patient_ids: Vec<Uuid>,
    pub strong_duplicate_found: bool,
    pub created_by_user_id: Uuid,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct PatientRecordOverrideAudit {
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub actor_user_id: Uuid,
    pub request_id: Option<String>,
    pub override_kind: String,
    pub reason_code: String,
    pub reason_note_present: bool,
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
    record_status: String,
    vital_status: String,
    superseded_by_patient_id: Option<Uuid>,
    record_status_reason_code: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PatientListRow {
    id: Uuid,
    facility_id: Uuid,
    patient_code: String,
    first_name: String,
    last_name: String,
    date_of_birth: NaiveDate,
    sex: String,
    status: String,
    record_status: String,
    vital_status: String,
    superseded_by_patient_id: Option<Uuid>,
    record_status_reason_code: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    patient_location: Option<String>,
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
    record_status: String,
    vital_status: String,
    superseded_by_patient_id: Option<Uuid>,
    context_kind: String,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PatientIdentityLookupSessionRow {
    id: Uuid,
    facility_id: Uuid,
    lookup_fingerprint: String,
    candidate_patient_ids: Vec<Uuid>,
    strong_duplicate_found: bool,
    created_by_user_id: Uuid,
    expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct CurrentOutpatientContextRow {
    visit_id: Uuid,
    clinic_id: Option<Uuid>,
    clinic_name: Option<String>,
    status: String,
    checked_in_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct CurrentInpatientContextRow {
    admission_case_id: Uuid,
    ward_id: Option<Uuid>,
    ward_name: Option<String>,
    bed_id: Option<Uuid>,
    bed_label: Option<String>,
    status: String,
    admitted_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct CurrentEmergencyContextRow {
    visit_id: Uuid,
    triage_id: Option<Uuid>,
    location_id: Option<Uuid>,
    status: String,
    acuity: Option<String>,
    checked_in_at: Option<DateTime<Utc>>,
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

pub async fn list_patient_registry(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<PatientCursor>,
    limit: i64,
    filters: PatientRegistryFilters,
    ordering: PatientListOrdering,
) -> anyhow::Result<Vec<PatientListRecord>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        WITH cursor_patient AS MATERIALIZED (
            SELECT patients.id,
                   patients.patient_code,
                   patients.first_name,
                   patients.last_name,
                   patients.date_of_birth,
                   patients.sex,
                   patients.status,
                   patients.record_status,
                   patients.vital_status,
                   patients.superseded_by_patient_id,
                   patients.record_status_reason_code,
                   patients.created_at
            FROM patients
            WHERE patients.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    if let Some(cursor) = cursor.as_ref() {
        query.push(" AND patients.id = ");
        query.push_bind(cursor.id);
    } else {
        query.push(" AND FALSE");
    }
    query.push(
        r#"
        ),
        patient_page AS MATERIALIZED (
            SELECT patients.id,
                   patients.facility_id,
                   patients.patient_code,
                   patients.first_name,
                   patients.last_name,
                   patients.date_of_birth,
                   patients.sex,
                   patients.status,
                   patients.record_status,
                   patients.vital_status,
                   patients.superseded_by_patient_id,
                   patients.record_status_reason_code,
                   patients.created_at,
                   patients.updated_at
            FROM patients
            WHERE patients.facility_id =
        "#,
    );
    query.push_bind(facility_id);

    if cursor.is_some() {
        push_patient_cursor_filter(&mut query, ordering);
    }
    push_patient_registry_filters(&mut query, &filters)?;

    query.push(" ORDER BY ");
    push_patient_sort_expression(&mut query, "patients", ordering.field);
    push_sort_direction(&mut query, ordering.direction);
    query.push(", patients.id");
    push_sort_direction(&mut query, ordering.direction);
    query.push(" LIMIT ");
    query.push_bind(limit);
    query.push(
        r#"
        )
        SELECT patient_page.id,
               patient_page.facility_id,
               patient_page.patient_code,
               patient_page.first_name,
               patient_page.last_name,
               patient_page.date_of_birth,
               patient_page.sex,
               patient_page.status,
               patient_page.record_status,
               patient_page.vital_status,
               patient_page.superseded_by_patient_id,
               patient_page.record_status_reason_code,
               patient_page.created_at,
               patient_page.updated_at,
               CASE
                   WHEN current_admission.id IS NULL THEN NULL
                   WHEN current_bed.bed_code IS NULL THEN current_ward.name
                   ELSE current_ward.name || ' - Bed ' || current_bed.bed_code
               END AS patient_location
        FROM patient_page
        LEFT JOIN LATERAL (
            SELECT admission_cases.id,
                   admission_cases.facility_id,
                   admission_cases.ward_id,
                   admission_cases.bed_id
            FROM admission_cases
            WHERE admission_cases.facility_id = patient_page.facility_id
              AND admission_cases.patient_id = patient_page.id
              AND admission_cases.status IN ('admitted', 'discharge_pending')
            ORDER BY admission_cases.admitted_at DESC, admission_cases.id DESC
            LIMIT 1
        ) current_admission ON TRUE
        LEFT JOIN wards current_ward
          ON current_ward.facility_id = current_admission.facility_id
         AND current_ward.id = current_admission.ward_id
        LEFT JOIN beds current_bed
          ON current_bed.facility_id = current_admission.facility_id
         AND current_bed.id = current_admission.bed_id
        "#,
    );
    query.push(" ORDER BY ");
    push_patient_sort_expression(&mut query, "patient_page", ordering.field);
    push_sort_direction(&mut query, ordering.direction);
    query.push(", patient_page.id");
    push_sort_direction(&mut query, ordering.direction);

    let rows = observe_db_query(
        "patient.registry.list_projection",
        query.build_query_as::<PatientListRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(patient_list_from_row).collect()
}

fn push_patient_registry_filters(
    query: &mut QueryBuilder<Postgres>,
    filters: &PatientRegistryFilters,
) -> anyhow::Result<()> {
    if let Some(search) = filters
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let pattern = format!("%{}%", search.to_lowercase());
        query.push(
            " AND lower(patients.patient_code || ' ' || patients.first_name || ' ' || patients.last_name) LIKE ",
        );
        query.push_bind(pattern);
    }

    if let Some(patient_id) = filters.patient_id {
        query.push(" AND patients.id = ");
        query.push_bind(patient_id);
    }

    if let Some(status) = filters.status.as_ref() {
        query.push(" AND patients.status = ");
        query.push_bind(codec::encode(status.clone())?);
    }

    if let Some(record_status) = filters.record_status {
        query.push(" AND patients.record_status = ");
        query.push_bind(codec::encode(record_status)?);
    }

    if let Some(vital_status) = filters.vital_status {
        query.push(" AND patients.vital_status = ");
        query.push_bind(codec::encode(vital_status)?);
    }

    if let Some(date_of_birth) = filters.date_of_birth_on_or_after {
        query.push(" AND patients.date_of_birth >= ");
        query.push_bind(date_of_birth);
    }

    if let Some(date_of_birth) = filters.date_of_birth_on_or_before {
        query.push(" AND patients.date_of_birth <= ");
        query.push_bind(date_of_birth);
    }

    if filters.has_admission_filters() {
        query.push(
            r#"
            AND EXISTS (
                SELECT 1
                FROM admission_cases registry_admission
                WHERE registry_admission.facility_id = patients.facility_id
                  AND registry_admission.patient_id = patients.id
            "#,
        );

        if let Some(ward_id) = filters.ward_id {
            query.push(" AND registry_admission.ward_id = ");
            query.push_bind(ward_id);
        }

        if let Some(admission_status) = filters.admission_status {
            query.push(" AND registry_admission.status = ");
            query.push_bind(codec::encode(admission_status)?);
        } else if filters.ward_id.is_some() {
            query.push(" AND registry_admission.status IN (");
            query.push_bind(codec::encode(AdmissionStatus::Admitted)?);
            query.push(", ");
            query.push_bind(codec::encode(AdmissionStatus::DischargePending)?);
            query.push(")");
        }

        if let Some(admitted_at) = filters.admission_start_at {
            query.push(" AND registry_admission.admitted_at >= ");
            query.push_bind(admitted_at);
        }

        if let Some(admitted_before) = filters.admission_end_before {
            query.push(" AND registry_admission.admitted_at < ");
            query.push_bind(admitted_before);
        }

        if let Some(attending_id) = filters.attending_id {
            query.push(" AND registry_admission.attending_user_id = ");
            query.push_bind(attending_id);
        }

        query.push(")");
    }

    Ok(())
}

fn push_patient_cursor_filter(query: &mut QueryBuilder<Postgres>, ordering: PatientListOrdering) {
    let operator = sort_comparison_operator(ordering.direction);
    query.push(" AND EXISTS (SELECT 1 FROM cursor_patient) AND (");
    push_patient_sort_expression(query, "patients", ordering.field);
    query.push(" ");
    query.push(operator);
    query.push(" (SELECT ");
    push_patient_sort_expression(query, "cursor_patient", ordering.field);
    query.push(" FROM cursor_patient) OR (");
    push_patient_sort_expression(query, "patients", ordering.field);
    query.push(" = (SELECT ");
    push_patient_sort_expression(query, "cursor_patient", ordering.field);
    query.push(" FROM cursor_patient) AND patients.id ");
    query.push(operator);
    query.push(" (SELECT cursor_patient.id FROM cursor_patient))");
    query.push(")");
}

fn push_patient_sort_expression(
    query: &mut QueryBuilder<Postgres>,
    alias: &'static str,
    field: PatientListSortField,
) {
    match field {
        PatientListSortField::RegisteredAt => {
            query.push(alias);
            query.push(".created_at");
        }
        PatientListSortField::PatientCode => {
            query.push("lower(");
            query.push(alias);
            query.push(".patient_code)");
        }
        PatientListSortField::DisplayName => {
            query.push("lower(");
            query.push(alias);
            query.push(".first_name || ' ' || ");
            query.push(alias);
            query.push(".last_name)");
        }
        PatientListSortField::DateOfBirth => {
            query.push(alias);
            query.push(".date_of_birth");
        }
        PatientListSortField::Sex => {
            query.push(alias);
            query.push(".sex");
        }
        PatientListSortField::Status => {
            query.push(alias);
            query.push(".record_status");
        }
    }
}

fn push_sort_direction(query: &mut QueryBuilder<Postgres>, direction: SortDirection) {
    match direction {
        SortDirection::Asc => query.push(" ASC"),
        SortDirection::Desc => query.push(" DESC"),
    };
}

fn sort_comparison_operator(direction: SortDirection) -> &'static str {
    match direction {
        SortDirection::Asc => ">",
        SortDirection::Desc => "<",
    }
}

fn normalize_identity_text(value: &str) -> String {
    value.trim().to_lowercase()
}

fn patient_identity_lock_id(
    facility_id: Uuid,
    first_name: &str,
    last_name: &str,
    date_of_birth: NaiveDate,
    sex_code: &str,
) -> i64 {
    let mut hasher = Sha256::new();
    hasher.update(facility_id.as_bytes());
    hasher.update([0]);
    hasher.update(normalize_identity_text(first_name).as_bytes());
    hasher.update([0]);
    hasher.update(normalize_identity_text(last_name).as_bytes());
    hasher.update([0]);
    hasher.update(date_of_birth.to_string().as_bytes());
    hasher.update([0]);
    hasher.update(sex_code.as_bytes());
    let digest = hasher.finalize();
    i64::from_be_bytes(
        digest[0..8]
            .try_into()
            .expect("sha256 digest has at least 8 bytes"),
    )
}

pub async fn list_patients(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<PatientCursor>,
    limit: i64,
    search: Option<&str>,
    status: Option<PatientAdministrativeStatus>,
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
               record_status,
               vital_status,
               superseded_by_patient_id,
               record_status_reason_code,
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
        query.push(" AND lower(patient_code || ' ' || first_name || ' ' || last_name) LIKE ");
        query.push_bind(pattern);
    }

    if let Some(status) = status {
        query.push(" AND status = ");
        query.push_bind(codec::encode(status)?);
    }

    query.push(" ORDER BY created_at ASC, id ASC LIMIT ");
    query.push_bind(limit);

    let rows = observe_db_query(
        "patient.registry.list",
        query.build_query_as::<PatientRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(patient_from_row).collect()
}

pub async fn count_patients(
    pool: &PgPool,
    facility_id: Uuid,
    filters: PatientRegistryFilters,
) -> anyhow::Result<i64> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT count(*)::bigint
        FROM patients
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);

    push_patient_registry_filters(&mut query, &filters)?;

    let count = observe_db_query(
        "patient.registry.count",
        query.build_query_scalar::<i64>().fetch_one(pool),
    )
    .await?;
    Ok(count)
}

pub async fn get_patient(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
) -> anyhow::Result<Option<PatientRecord>> {
    let row = observe_db_query(
        "patient.registry.get",
        sqlx::query_as::<_, PatientRow>(
            r#"
        SELECT id,
               facility_id,
               patient_code,
               first_name,
               last_name,
               date_of_birth,
               sex,
               status,
               record_status,
               vital_status,
               superseded_by_patient_id,
               record_status_reason_code,
               created_at,
               updated_at
        FROM patients
        WHERE facility_id = $1 AND id = $2
        "#,
        )
        .bind(facility_id)
        .bind(patient_id)
        .fetch_optional(pool),
    )
    .await?;

    row.map(patient_from_row).transpose()
}

pub async fn find_identity_candidates(
    pool: &PgPool,
    facility_id: Uuid,
    filters: PatientIdentityLookupFilters,
) -> anyhow::Result<Vec<PatientIdentityCandidate>> {
    let patient_code = filters
        .patient_code
        .as_deref()
        .map(normalize_identity_text)
        .filter(|value| !value.is_empty());
    let first_name = filters
        .first_name
        .as_deref()
        .map(normalize_identity_text)
        .filter(|value| !value.is_empty());
    let last_name = filters
        .last_name
        .as_deref()
        .map(normalize_identity_text)
        .filter(|value| !value.is_empty());
    let exact_demographics = first_name.is_some()
        && last_name.is_some()
        && filters.date_of_birth.is_some()
        && filters.sex.is_some();
    let possible_demographics =
        filters.date_of_birth.is_some() && (first_name.is_some() || last_name.is_some());

    if patient_code.is_none() && !exact_demographics && !possible_demographics {
        return Ok(Vec::new());
    }

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
               record_status,
               vital_status,
               superseded_by_patient_id,
               record_status_reason_code,
               created_at,
               updated_at
        FROM patients
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND (");
    let mut added_condition = false;
    if let Some(code) = patient_code.as_deref() {
        query.push("lower(patient_code) = ");
        query.push_bind(code);
        added_condition = true;
    }
    if exact_demographics {
        if added_condition {
            query.push(" OR ");
        }
        query.push("(lower(first_name) = ");
        query.push_bind(first_name.as_deref().unwrap_or_default());
        query.push(" AND lower(last_name) = ");
        query.push_bind(last_name.as_deref().unwrap_or_default());
        query.push(" AND date_of_birth = ");
        query.push_bind(filters.date_of_birth.expect("checked exact date"));
        query.push(" AND sex = ");
        query.push_bind(codec::encode(filters.sex.expect("checked exact sex"))?);
        query.push(")");
        added_condition = true;
    }
    if possible_demographics {
        if added_condition {
            query.push(" OR ");
        }
        query.push("(date_of_birth = ");
        query.push_bind(filters.date_of_birth.expect("checked possible date"));
        query.push(" AND (FALSE");
        if let Some(name) = first_name.as_deref() {
            query.push(" OR lower(first_name) = ");
            query.push_bind(name);
        }
        if let Some(name) = last_name.as_deref() {
            query.push(" OR lower(last_name) = ");
            query.push_bind(name);
        }
        query.push("))");
    }
    query.push(
        r#")
        ORDER BY
            CASE WHEN lower(patient_code) =
        "#,
    );
    query.push_bind(patient_code.as_deref().unwrap_or(""));
    query.push(
        r#" THEN 0 ELSE 1 END,
            CASE
                WHEN lower(first_name) =
        "#,
    );
    query.push_bind(first_name.as_deref().unwrap_or(""));
    query.push(" AND lower(last_name) = ");
    query.push_bind(last_name.as_deref().unwrap_or(""));
    query.push(" AND date_of_birth = ");
    query.push_bind(filters.date_of_birth.unwrap_or(NaiveDate::MIN));
    query.push(" THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT ");
    query.push_bind(filters.limit.clamp(1, 25));

    let rows = observe_db_query(
        "patient.identity.lookup_candidates",
        query.build_query_as::<PatientRow>().fetch_all(pool),
    )
    .await?;

    rows.into_iter()
        .map(|row| identity_candidate_from_row(row, &filters))
        .collect()
}

pub async fn create_identity_lookup_session(
    pool: &PgPool,
    session: NewPatientIdentityLookupSession,
) -> anyhow::Result<PatientIdentityLookupSession> {
    let row = observe_db_query(
        "patient.identity.lookup_session.create",
        sqlx::query_as::<_, PatientIdentityLookupSessionRow>(
            r#"
        INSERT INTO patient_identity_lookup_sessions (
            id,
            facility_id,
            lookup_fingerprint,
            candidate_patient_ids,
            strong_duplicate_found,
            created_by_user_id,
            expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id,
                  facility_id,
                  lookup_fingerprint,
                  candidate_patient_ids,
                  strong_duplicate_found,
                  created_by_user_id,
                  expires_at
        "#,
        )
        .bind(session.id)
        .bind(session.facility_id)
        .bind(session.lookup_fingerprint)
        .bind(session.candidate_patient_ids)
        .bind(session.strong_duplicate_found)
        .bind(session.created_by_user_id)
        .bind(session.expires_at)
        .fetch_one(pool),
    )
    .await?;
    Ok(identity_lookup_session_from_row(row))
}

pub async fn get_identity_lookup_session(
    pool: &PgPool,
    facility_id: Uuid,
    created_by_user_id: Uuid,
    lookup_id: Uuid,
) -> anyhow::Result<Option<PatientIdentityLookupSession>> {
    let row = observe_db_query(
        "patient.identity.lookup_session.get",
        sqlx::query_as::<_, PatientIdentityLookupSessionRow>(
            r#"
        SELECT id,
               facility_id,
               lookup_fingerprint,
               candidate_patient_ids,
               strong_duplicate_found,
               created_by_user_id,
               expires_at
        FROM patient_identity_lookup_sessions
        WHERE facility_id = $1
          AND created_by_user_id = $2
          AND id = $3
          AND expires_at > now()
        "#,
        )
        .bind(facility_id)
        .bind(created_by_user_id)
        .bind(lookup_id)
        .fetch_optional(pool),
    )
    .await?;
    Ok(row.map(identity_lookup_session_from_row))
}

pub async fn get_identity_lookup_candidates_by_ids(
    pool: &PgPool,
    facility_id: Uuid,
    patient_ids: &[Uuid],
) -> anyhow::Result<Vec<PatientIdentityCandidate>> {
    if patient_ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows = observe_db_query(
        "patient.identity.lookup_session.candidates",
        sqlx::query_as::<_, PatientRow>(
            r#"
        SELECT p.id,
               p.facility_id,
               p.patient_code,
               p.first_name,
               p.last_name,
               p.date_of_birth,
               p.sex,
               p.status,
               p.record_status,
               p.vital_status,
               p.superseded_by_patient_id,
               p.record_status_reason_code,
               p.created_at,
               p.updated_at
        FROM unnest($2::uuid[]) WITH ORDINALITY AS selected(patient_id, ordinality)
        JOIN patients p ON p.id = selected.patient_id
        WHERE p.facility_id = $1
        ORDER BY selected.ordinality
        "#,
        )
        .bind(facility_id)
        .bind(patient_ids)
        .fetch_all(pool),
    )
    .await?;

    rows.into_iter()
        .map(identity_candidate_from_lookup_session_row)
        .collect()
}

pub async fn get_patient_current_contexts(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
) -> anyhow::Result<PatientCurrentContexts> {
    let outpatient_rows = observe_db_query(
        "patient.current_contexts.outpatient",
        sqlx::query_as::<_, CurrentOutpatientContextRow>(
            r#"
        SELECT visits.id AS visit_id,
               visits.clinic_id,
               clinics.name AS clinic_name,
               visits.status,
               visits.checked_in_at
        FROM visits
        LEFT JOIN clinics
          ON clinics.facility_id = visits.facility_id
         AND clinics.id = visits.clinic_id
        WHERE visits.facility_id = $1
          AND visits.patient_id = $2
          AND visits.status NOT IN ('checked_out', 'no_show', 'cancelled')
          AND NOT EXISTS (
              SELECT 1
              FROM triage_queue
              WHERE triage_queue.facility_id = visits.facility_id
                AND triage_queue.visit_id = visits.id
          )
        ORDER BY visits.checked_in_at DESC, visits.id DESC
        LIMIT 10
        "#,
        )
        .bind(facility_id)
        .bind(patient_id)
        .fetch_all(pool),
    )
    .await?;

    let inpatient_rows = observe_db_query(
        "patient.current_contexts.inpatient",
        sqlx::query_as::<_, CurrentInpatientContextRow>(
            r#"
        SELECT admission_cases.id AS admission_case_id,
               admission_cases.ward_id,
               wards.name AS ward_name,
               admission_cases.bed_id,
               beds.bed_code AS bed_label,
               admission_cases.status,
               admission_cases.admitted_at
        FROM admission_cases
        LEFT JOIN wards
          ON wards.facility_id = admission_cases.facility_id
         AND wards.id = admission_cases.ward_id
        LEFT JOIN beds
          ON beds.facility_id = admission_cases.facility_id
         AND beds.id = admission_cases.bed_id
        WHERE admission_cases.facility_id = $1
          AND admission_cases.patient_id = $2
          AND admission_cases.status IN ('ready_for_activation', 'admitted', 'discharge_pending')
        ORDER BY admission_cases.admitted_at DESC, admission_cases.id DESC
        LIMIT 10
        "#,
        )
        .bind(facility_id)
        .bind(patient_id)
        .fetch_all(pool),
    )
    .await?;

    let emergency_rows = observe_db_query(
        "patient.current_contexts.emergency",
        sqlx::query_as::<_, CurrentEmergencyContextRow>(
            r#"
        SELECT visits.id AS visit_id,
               triage_queue.id AS triage_id,
               visits.clinic_id AS location_id,
               triage_queue.status,
               triage_queue.acuity,
               visits.checked_in_at
        FROM visits
        INNER JOIN triage_queue
          ON triage_queue.facility_id = visits.facility_id
         AND triage_queue.visit_id = visits.id
        WHERE visits.facility_id = $1
          AND visits.patient_id = $2
          AND visits.status NOT IN ('checked_out', 'no_show', 'cancelled')
          AND triage_queue.status IN ('waiting', 'assigned')
        ORDER BY visits.checked_in_at DESC, visits.id DESC
        LIMIT 10
        "#,
        )
        .bind(facility_id)
        .bind(patient_id)
        .fetch_all(pool),
    )
    .await?;

    Ok(PatientCurrentContexts {
        patient_id,
        outpatient: outpatient_rows
            .into_iter()
            .map(outpatient_context_from_row)
            .collect(),
        inpatient: inpatient_rows
            .into_iter()
            .map(inpatient_context_from_row)
            .collect::<anyhow::Result<Vec<_>>>()?,
        emergency: emergency_rows
            .into_iter()
            .map(emergency_context_from_row)
            .collect(),
    })
}

pub async fn audit_patient_record_override(
    pool: &PgPool,
    audit: PatientRecordOverrideAudit,
) -> anyhow::Result<()> {
    observe_db_query(
        "patient.audit_events.record_override",
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
        VALUES ($1, $2, $3, $4, 'patient.identity.record_override', 'patient', $5, $6)
        "#,
        )
        .bind(Uuid::new_v4())
        .bind(audit.facility_id)
        .bind(audit.actor_user_id)
        .bind(audit.request_id.as_deref())
        .bind(audit.patient_id)
        .bind(json!({
            "override_kind": audit.override_kind,
            "reason_code": audit.reason_code,
            "reason_note_present": audit.reason_note_present,
        }))
        .execute(pool),
    )
    .await?;
    Ok(())
}

pub async fn list_patient_registration_validation_rules(
    pool: &PgPool,
    facility_id: Uuid,
    limit: i64,
) -> anyhow::Result<Vec<PatientRegistrationValidationRule>> {
    let rows = observe_db_query(
        "patient.validation_rules.list",
        sqlx::query_as::<_, PatientRegistrationValidationRuleRow>(
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
        .fetch_all(pool),
    )
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
    let legacy_identity = patient.status.map(identity_for_legacy_status);
    let record_status = patient
        .record_status
        .or(legacy_identity.map(|value| value.0));
    let vital_status = patient
        .vital_status
        .or(legacy_identity.map(|value| value.1));
    let status_reason_code = patient
        .status_reason_code
        .clone()
        .or_else(|| legacy_identity.and_then(|value| value.2.map(str::to_owned)));
    let status_changed = patient.status.is_some()
        || record_status.is_some()
        || vital_status.is_some()
        || patient.superseded_by_patient_id.is_some()
        || status_reason_code.is_some()
        || patient.status_reason_note.is_some();
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
    if record_status.is_some() {
        changed_fields.push("record_status");
    }
    if vital_status.is_some() {
        changed_fields.push("vital_status");
    }
    if patient.superseded_by_patient_id.is_some() {
        changed_fields.push("superseded_by_patient_id");
    }
    if status_reason_code.is_some() {
        changed_fields.push("status_reason_code");
    }

    let row = observe_db_query(
        "patient.registry.update",
        sqlx::query_as::<_, PatientRow>(
            r#"
        UPDATE patients
        SET first_name = COALESCE($3, first_name),
            last_name = COALESCE($4, last_name),
            date_of_birth = COALESCE($5, date_of_birth),
            sex = COALESCE($6, sex),
            record_status = COALESCE($7, record_status),
            vital_status = COALESCE($8, vital_status),
            superseded_by_patient_id = CASE
                WHEN COALESCE($7, record_status) = 'superseded'
                    THEN COALESCE($9, superseded_by_patient_id)
                ELSE NULL
            END,
            record_status_reason_code = COALESCE($10, record_status_reason_code),
            record_status_reason_note = COALESCE($11, record_status_reason_note),
            record_status_updated_by_user_id = CASE
                WHEN $12 THEN $13
                ELSE record_status_updated_by_user_id
            END,
            record_status_updated_at = CASE
                WHEN $12 THEN now()
                ELSE record_status_updated_at
            END,
            status = CASE
                WHEN COALESCE($8, vital_status) = 'deceased' THEN 'deceased'
                WHEN COALESCE($7, record_status) = 'registered' THEN 'active'
                ELSE 'inactive'
            END,
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
                  record_status,
                  vital_status,
                  superseded_by_patient_id,
                  record_status_reason_code,
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
        .bind(record_status.map(codec::encode).transpose()?)
        .bind(vital_status.map(codec::encode).transpose()?)
        .bind(patient.superseded_by_patient_id)
        .bind(status_reason_code)
        .bind(patient.status_reason_note)
        .bind(status_changed)
        .bind(patient.actor_user_id)
        .fetch_optional(&mut *transaction),
    )
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

    observe_db_query(
        "patient.audit_events.demographics_update",
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
        .execute(&mut *transaction),
    )
    .await?;

    transaction.commit().await?;
    patient_from_row(row).map(Some)
}

pub async fn create_patient(pool: &PgPool, patient: NewPatient) -> anyhow::Result<PatientRecord> {
    let mut transaction = pool.begin().await?;
    let sex_code = codec::encode(patient.sex)?;
    let identity_lock_id = patient_identity_lock_id(
        patient.facility_id,
        &patient.first_name,
        &patient.last_name,
        patient.date_of_birth,
        &sex_code,
    );
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(identity_lock_id)
        .execute(&mut *transaction)
        .await?;

    if patient.duplicate_override.is_none() {
        let duplicate_exists = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM patients
                WHERE facility_id = $1
                  AND lower(first_name) = $2
                  AND lower(last_name) = $3
                  AND date_of_birth = $4
                  AND sex = $5
            )
            "#,
        )
        .bind(patient.facility_id)
        .bind(normalize_identity_text(&patient.first_name))
        .bind(normalize_identity_text(&patient.last_name))
        .bind(patient.date_of_birth)
        .bind(&sex_code)
        .fetch_one(&mut *transaction)
        .await?;
        if duplicate_exists {
            anyhow::bail!("duplicate patient identity requires review");
        }
    }

    let row = observe_db_query(
        "patient.registry.create",
        sqlx::query_as::<_, PatientRow>(
            r#"
        INSERT INTO patients (
            id,
            facility_id,
            patient_code,
            first_name,
            last_name,
            date_of_birth,
            sex,
            status,
            record_status,
            vital_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'registered', 'presumed_alive')
        RETURNING id,
                  facility_id,
                  patient_code,
                  first_name,
                  last_name,
                  date_of_birth,
                  sex,
                  status,
                  record_status,
                  vital_status,
                  superseded_by_patient_id,
                  record_status_reason_code,
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
        .bind(&sex_code)
        .fetch_one(&mut *transaction),
    )
    .await?;

    if let Some(duplicate_override) = patient.duplicate_override.as_ref() {
        observe_db_query(
            "patient.audit_events.duplicate_override",
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
            VALUES ($1, $2, $3, $4, 'patient.identity.duplicate_override', 'patient', $5, $6)
            "#,
            )
            .bind(Uuid::new_v4())
            .bind(patient.facility_id)
            .bind(patient.created_by_user_id)
            .bind(patient.request_id.as_deref())
            .bind(row.id)
            .bind(json!({
                "lookup_id": duplicate_override.lookup_id,
                "reason_code": duplicate_override.reason_code,
                "reason_note_present": duplicate_override.reason_note_present,
                "candidate_count": duplicate_override.candidate_count,
            }))
            .execute(&mut *transaction),
        )
        .await?;
    }

    observe_db_query(
        "patient.chronicle_read_model.ensure",
        sqlx::query(
            r#"
        INSERT INTO patient_chronicle_read_models (patient_id, facility_id, summary_status)
        VALUES ($1, $2, 'empty')
        ON CONFLICT (patient_id) DO NOTHING
        "#,
        )
        .bind(row.id)
        .bind(row.facility_id)
        .execute(&mut *transaction),
    )
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
               patients.record_status,
               patients.vital_status,
               patients.superseded_by_patient_id,
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
        query.push(
            " AND lower(patients.patient_code || ' ' || patients.first_name || ' ' || patients.last_name) LIKE ",
        );
        query.push_bind(pattern);
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

    let rows = observe_db_query(
        "patient.context.list",
        query.build_query_as::<PatientContextRow>().fetch_all(pool),
    )
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
    observe_db_query(
        "patient.context.upsert",
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
        .execute(&mut **transaction),
    )
    .await?;
    Ok(())
}

fn identity_lookup_session_from_row(
    row: PatientIdentityLookupSessionRow,
) -> PatientIdentityLookupSession {
    PatientIdentityLookupSession {
        id: row.id,
        facility_id: row.facility_id,
        lookup_fingerprint: row.lookup_fingerprint,
        candidate_patient_ids: row.candidate_patient_ids,
        strong_duplicate_found: row.strong_duplicate_found,
        created_by_user_id: row.created_by_user_id,
        expires_at: row.expires_at,
    }
}

fn identity_candidate_from_row(
    row: PatientRow,
    filters: &PatientIdentityLookupFilters,
) -> anyhow::Result<PatientIdentityCandidate> {
    let patient = patient_from_row(row)?;
    let patient_code = normalize_identity_text(&patient.patient_code);
    let patient_first_name = normalize_identity_text(&patient.first_name);
    let patient_last_name = normalize_identity_text(&patient.last_name);
    let lookup_code = filters.patient_code.as_deref().map(normalize_identity_text);
    let lookup_first_name = filters.first_name.as_deref().map(normalize_identity_text);
    let lookup_last_name = filters.last_name.as_deref().map(normalize_identity_text);

    let mut reasons = Vec::new();
    let code_match = lookup_code
        .as_deref()
        .is_some_and(|code| !code.is_empty() && code == patient_code.as_str());
    if code_match {
        reasons.push("patient_code".to_owned());
    }

    let dob_match = filters.date_of_birth == Some(patient.date_of_birth);
    let first_name_match = lookup_first_name
        .as_deref()
        .is_some_and(|name| !name.is_empty() && name == patient_first_name.as_str());
    let last_name_match = lookup_last_name
        .as_deref()
        .is_some_and(|name| !name.is_empty() && name == patient_last_name.as_str());
    let sex_match = filters.sex == Some(patient.sex);

    if dob_match && first_name_match && last_name_match && sex_match {
        reasons.push("exact_name_dob_sex".to_owned());
    } else {
        if dob_match {
            reasons.push("date_of_birth".to_owned());
        }
        if first_name_match {
            reasons.push("first_name".to_owned());
        }
        if last_name_match {
            reasons.push("last_name".to_owned());
        }
    }

    let match_strength =
        if code_match || (dob_match && first_name_match && last_name_match && sex_match) {
            PatientIdentityMatchStrength::Strong
        } else {
            PatientIdentityMatchStrength::Possible
        };

    let display_name = patient.display_name();
    Ok(PatientIdentityCandidate {
        patient_id: patient.id,
        patient_code: patient.patient_code,
        display_name,
        date_of_birth: patient.date_of_birth,
        sex: patient.sex,
        record_status: patient.record_status,
        vital_status: patient.vital_status,
        superseded_by_patient_id: patient.superseded_by_patient_id,
        match_strength,
        match_reasons: reasons,
    })
}

fn identity_candidate_from_lookup_session_row(
    row: PatientRow,
) -> anyhow::Result<PatientIdentityCandidate> {
    let patient = patient_from_row(row)?;
    let display_name = patient.display_name();
    Ok(PatientIdentityCandidate {
        patient_id: patient.id,
        patient_code: patient.patient_code,
        display_name,
        date_of_birth: patient.date_of_birth,
        sex: patient.sex,
        record_status: patient.record_status,
        vital_status: patient.vital_status,
        superseded_by_patient_id: patient.superseded_by_patient_id,
        match_strength: PatientIdentityMatchStrength::Possible,
        match_reasons: vec!["previous_lookup_candidate".to_owned()],
    })
}

fn outpatient_context_from_row(
    row: CurrentOutpatientContextRow,
) -> PatientCurrentOutpatientContext {
    PatientCurrentOutpatientContext {
        visit_id: row.visit_id,
        clinic_id: row.clinic_id,
        clinic_name: row.clinic_name,
        status: row.status,
        checked_in_at: row.checked_in_at,
    }
}

fn inpatient_context_from_row(
    row: CurrentInpatientContextRow,
) -> anyhow::Result<PatientCurrentInpatientContext> {
    Ok(PatientCurrentInpatientContext {
        admission_case_id: row.admission_case_id,
        ward_id: row.ward_id,
        ward_name: row.ward_name,
        bed_id: row.bed_id,
        bed_label: row.bed_label,
        status: codec::decode(&row.status)?,
        admitted_at: row.admitted_at,
    })
}

fn emergency_context_from_row(row: CurrentEmergencyContextRow) -> PatientCurrentEmergencyContext {
    PatientCurrentEmergencyContext {
        visit_id: row.visit_id,
        triage_id: row.triage_id,
        location_id: row.location_id,
        status: row.status,
        acuity: row.acuity,
        checked_in_at: row.checked_in_at,
    }
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
        record_status: codec::decode::<PatientRecordStatus>(&row.record_status)?,
        vital_status: codec::decode::<PatientVitalStatus>(&row.vital_status)?,
        superseded_by_patient_id: row.superseded_by_patient_id,
        record_status_reason_code: row.record_status_reason_code,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn patient_list_from_row(row: PatientListRow) -> anyhow::Result<PatientListRecord> {
    Ok(PatientListRecord {
        patient: PatientRecord {
            id: row.id,
            facility_id: row.facility_id,
            patient_code: row.patient_code,
            first_name: row.first_name,
            last_name: row.last_name,
            date_of_birth: row.date_of_birth,
            sex: codec::decode(&row.sex)?,
            status: codec::decode::<PatientAdministrativeStatus>(&row.status)?,
            record_status: codec::decode::<PatientRecordStatus>(&row.record_status)?,
            vital_status: codec::decode::<PatientVitalStatus>(&row.vital_status)?,
            superseded_by_patient_id: row.superseded_by_patient_id,
            record_status_reason_code: row.record_status_reason_code,
            created_at: row.created_at,
            updated_at: row.updated_at,
        },
        patient_location: row.patient_location,
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
        record_status: codec::decode(&row.record_status)?,
        vital_status: codec::decode(&row.vital_status)?,
        superseded_by_patient_id: row.superseded_by_patient_id,
        context_kind: codec::decode(&row.context_kind)?,
        updated_at: row.updated_at,
    })
}
