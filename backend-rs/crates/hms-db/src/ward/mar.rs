use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::ward::{
    MedicationAdministrationListItem, MedicationAdministrationOutcome,
    MedicationAdministrationStatus, TreatmentSheetListItem, TreatmentSheetStatus,
};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::clinical::stock_basis as basis;
use crate::codec;
use crate::PgPool;

use super::WardCursor;

#[derive(Clone, Debug)]
pub struct NewMedicationAdministration {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub medication_name: String,
    pub dose: Option<String>,
    pub route: Option<String>,
    pub frequency: Option<String>,
    pub scheduled_at: DateTime<Utc>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewTreatmentSheet {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub sheet_date: NaiveDate,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct MedicationAdministrationRow {
    scheduled_stock_policy: Option<sqlx::types::Json<hms_domain::clinical::ScheduledStockPolicy>>,
    dispensed_stock_quantity: Option<i64>,
    dispensed_stock_unit: Option<String>,
    prn_indication: Option<String>,
    prn_request_id: Option<Uuid>,
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    prescription_id: Option<Uuid>,
    medication_course_id: Option<Uuid>,
    pharmacy_fulfillment_id: Option<Uuid>,
    patient_code: String,
    patient_display_name: String,
    medication_name: String,
    dose: Option<String>,
    route: Option<String>,
    frequency: Option<String>,
    dose_sequence: Option<i32>,
    scheduled_at: DateTime<Utc>,
    administered_at: Option<DateTime<Utc>>,
    is_dispensed: bool,
    dispensed_at: Option<DateTime<Utc>>,
    status: String,
    prescription_held: bool,
    reason_not_given: Option<String>,
    administration_notes: Option<String>,
    outcome_recorded_at: Option<DateTime<Utc>>,
    outcome_recorded_by_user_id: Option<Uuid>,
    outcome_recorded_by_display_name: Option<String>,
}

#[derive(Clone, Debug)]
pub struct RecordMedicationOutcome {
    pub authorization: Option<crate::clinical::prescription_courses::PrescriptionAuthorization>,
    pub facility_id: Uuid,
    pub medication_id: Uuid,
    pub actor_user_id: Uuid,
    pub status: MedicationAdministrationOutcome,
    pub witness_user_id: Option<Uuid>,
    pub reason_not_given: Option<String>,
    pub administration_notes: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MedicationOutcomeError {
    InvalidReason,
    NotesTooLong,
    InvalidWitness,
    NotActionable,
    NotDispensed,
    FutureMissed,
}

impl std::fmt::Display for MedicationOutcomeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message())
    }
}
impl MedicationOutcomeError {
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidReason => "A reason of at most 1000 bytes is required when a dose is not given.",
            Self::NotesTooLong => "Administration notes must be at most 2000 bytes.",
            Self::InvalidWitness => "The witness must be active in this facility and can only witness an administered dose.",
            Self::NotActionable => "This dose can no longer be recorded. Reload the schedule and check the current prescription.",
            Self::NotDispensed => "This prescribed dose has not been dispensed. Record its supply before administering it.",
            Self::FutureMissed => "A future dose cannot be recorded as missed.",
        }
    }
}
impl std::error::Error for MedicationOutcomeError {}

#[derive(FromRow)]
struct LockedMedicationOutcomeRow {
    scheduled_stock_policy: Option<sqlx::types::Json<hms_domain::clinical::ScheduledStockPolicy>>,
    dispensed_stock_quantity: Option<i64>,
    dispensed_stock_unit: Option<String>,
    frequency: Option<String>,
    prescription_id: Option<Uuid>,
    medication_course_id: Option<Uuid>,
    pharmacy_fulfillment_id: Option<Uuid>,
    status: String,
    is_dispensed: bool,
    is_due: bool,
    administered_at: Option<DateTime<Utc>>,
    administered_by_user_id: Option<Uuid>,
    witness_user_id: Option<Uuid>,
    outcome_recorded_at: Option<DateTime<Utc>>,
    outcome_recorded_by_user_id: Option<Uuid>,
    reason_not_given: Option<String>,
    administration_notes: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
struct TreatmentSheetRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    sheet_date: NaiveDate,
    status: String,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Default)]
pub struct MedicationAdministrationFilters {
    pub patient_id: Option<Uuid>,
    pub admission_case_id: Option<Uuid>,
    pub scheduled_from: Option<DateTime<Utc>>,
    pub scheduled_before: Option<DateTime<Utc>>,
    pub status: Option<MedicationAdministrationStatus>,
    pub descending: bool,
}

pub async fn list_medication_administrations(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<MedicationAdministrationListItem>> {
    list_medication_administrations_scoped(
        pool,
        facility_id,
        MedicationAdministrationFilters::default(),
        cursor,
        limit,
    )
    .await
}

pub async fn list_medication_administrations_scoped(
    pool: &PgPool,
    facility_id: Uuid,
    filters: MedicationAdministrationFilters,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<MedicationAdministrationListItem>> {
    let mut query = medication_list_query(facility_id, filters, cursor, limit, None)?;
    let rows = observe_db_query(
        "ward.mar.medication_administrations.list",
        query
            .build_query_as::<MedicationAdministrationRow>()
            .fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(medication_from_row).collect()
}

pub async fn list_medication_administrations_authorized(
    pool: &PgPool,
    mut actor: crate::clinical::medication_access::MedicationActor,
    filters: MedicationAdministrationFilters,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<MedicationAdministrationListItem>> {
    use crate::clinical::medication_access as access;
    use hms_domain::deployment::FeatureKey;
    let mut tx = pool.begin().await?;
    access::verify(
        &mut tx,
        &mut actor,
        &[FeatureKey::Patients, FeatureKey::Nursing],
    )
    .await?;
    let wards = access::wards(&mut tx, &actor).await?;
    let patient = if let Some(admission) = filters.admission_case_id {
        let patient: Uuid = observe_db_query(
            "ward.medication.scope",
            sqlx::query_scalar(
                "SELECT patient_id FROM admission_cases WHERE facility_id=$1 AND id=$2",
            )
            .bind(actor.identity.facility_id)
            .bind(admission)
            .fetch_optional(&mut *tx),
        )
        .await?
        .ok_or(access::MedicationAccessError::ContextChanged)?;
        if filters.patient_id.is_some_and(|id| id != patient) {
            return Err(access::MedicationAccessError::ContextChanged.into());
        }
        access::patient(&mut tx, &actor, patient).await?;
        access::admission(&mut tx, &actor, &wards, admission, patient, false).await?;
        Some(patient)
    } else {
        filters.patient_id
    };
    if let Some(patient) = patient {
        access::patient(&mut tx, &actor, patient).await?;
    }
    let mut q = medication_list_query(
        actor.identity.facility_id,
        filters,
        cursor,
        limit,
        Some((&actor, wards)),
    )?;
    let result = observe_db_query(
        "ward.mar.medication_administrations.list",
        q.build_query_as::<MedicationAdministrationRow>()
            .fetch_all(&mut *tx),
    )
    .await?
    .into_iter()
    .map(medication_from_row)
    .collect::<anyhow::Result<_>>()?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
fn medication_list_query(
    facility_id: Uuid,
    filters: MedicationAdministrationFilters,
    cursor: Option<WardCursor>,
    limit: i64,
    scope: Option<(
        &crate::clinical::medication_access::MedicationActor,
        Option<Vec<Uuid>>,
    )>,
) -> anyhow::Result<QueryBuilder<'static, Postgres>> {
    // Scope before pagination. The outer status filter uses the effective MAR
    // status, including the fail-closed projection for stale source orders.
    let mut query = QueryBuilder::<Postgres>::new("SELECT * FROM (");
    query.push(medication_query().sql());
    query.push(" WHERE medication_administrations.facility_id = ");
    query.push_bind(facility_id);
    if let Some(patient_id) = filters.patient_id {
        query.push(" AND medication_administrations.patient_id = ");
        query.push_bind(patient_id);
    }
    if let Some(admission_case_id) = filters.admission_case_id {
        query.push(" AND medication_administrations.admission_case_id = ");
        query.push_bind(admission_case_id);
    }
    if let Some(scheduled_from) = filters.scheduled_from {
        query.push(" AND medication_administrations.scheduled_at >= ");
        query.push_bind(scheduled_from);
    }
    if let Some(scheduled_before) = filters.scheduled_before {
        query.push(" AND medication_administrations.scheduled_at < ");
        query.push_bind(scheduled_before);
    }
    if let Some((actor, wards)) = scope {
        crate::clinical::medication_access::ordinary_patient_predicate(
            &mut query,
            actor,
            "medication_administrations.patient_id",
        );
        if let Some(ids) = wards {
            query
                .push(" AND mar_admission.ward_id=ANY(")
                .push_bind(ids)
                .push(")");
        }
    }
    query.push(") scoped WHERE TRUE");
    if let Some(status) = filters.status {
        query.push(" AND scoped.status = ");
        query.push_bind(codec::encode(status)?);
    }
    if let Some(cursor) = cursor {
        query.push(" AND (scoped.scheduled_at, scoped.id) ");
        query.push(if filters.descending { "< (" } else { "> (" });
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(if filters.descending {
        " ORDER BY scoped.scheduled_at DESC, scoped.id DESC LIMIT "
    } else {
        " ORDER BY scoped.scheduled_at ASC, scoped.id ASC LIMIT "
    });
    query.push_bind(limit.clamp(1, 101));

    Ok(query)
}

pub async fn schedule_medication_administration(
    pool: &PgPool,
    medication: NewMedicationAdministration,
) -> anyhow::Result<MedicationAdministrationListItem> {
    schedule_medication_inner(pool, medication, None).await
}
pub async fn schedule_medication_administration_authorized(
    pool: &PgPool,
    medication: NewMedicationAdministration,
    actor: crate::clinical::medication_access::MedicationActor,
) -> anyhow::Result<MedicationAdministrationListItem> {
    crate::clinical::medication_access::bound(
        &actor,
        medication.facility_id,
        medication.actor_user_id,
    )?;
    schedule_medication_inner(pool, medication, Some(actor)).await
}
async fn schedule_medication_inner(
    pool: &PgPool,
    medication: NewMedicationAdministration,
    mut actor: Option<crate::clinical::medication_access::MedicationActor>,
) -> anyhow::Result<MedicationAdministrationListItem> {
    if medication
        .frequency
        .as_deref()
        .is_some_and(|frequency| frequency.trim().eq_ignore_ascii_case("prn"))
    {
        return Err(super::prn::PrnError::Unconfigured.into());
    }
    let mut tx = pool.begin().await?;
    if let Some(actor) = actor.as_mut() {
        use crate::clinical::medication_access as access;
        access::verify(
            &mut tx,
            actor,
            &[
                hms_domain::deployment::FeatureKey::Patients,
                hms_domain::deployment::FeatureKey::Nursing,
            ],
        )
        .await?;
        access::patient(&mut tx, actor, medication.patient_id).await?;
        let wards = access::wards(&mut tx, actor).await?;
        access::admission(
            &mut tx,
            actor,
            &wards,
            medication.admission_case_id,
            medication.patient_id,
            true,
        )
        .await?;
    }
    observe_db_query(
        "ward.mar.medication_administrations.schedule",
        sqlx::query(
            r#"
        INSERT INTO medication_administrations (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            medication_name,
            dose,
            route,
            frequency,
            scheduled_at,
            status,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        "#,
        )
        .bind(medication.id)
        .bind(medication.facility_id)
        .bind(medication.admission_case_id)
        .bind(medication.patient_id)
        .bind(&medication.medication_name)
        .bind(&medication.dose)
        .bind(&medication.route)
        .bind(&medication.frequency)
        .bind(medication.scheduled_at)
        .bind(codec::encode(MedicationAdministrationStatus::Scheduled)?)
        .bind(medication.actor_user_id)
        .execute(&mut *tx),
    )
    .await?;

    let result = medication_in_transaction(&mut tx, medication.facility_id, medication.id)
        .await?
        .ok_or(MedicationOutcomeError::NotActionable)?;
    if let Some(actor) = actor.as_ref() {
        sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,'nursing.medication.scheduled','medication_administration',$5,'{}'::jsonb)")
            .bind(Uuid::new_v4()).bind(actor.identity.facility_id).bind(actor.identity.user_id).bind(&actor.identity.request_id).bind(medication.id).execute(&mut *tx).await?;
        crate::clinical::medication_access::deadline(&mut tx, actor).await?;
    }
    tx.commit().await?;
    Ok(result)
}

pub async fn administer_medication(
    pool: &PgPool,
    facility_id: Uuid,
    medication_id: Uuid,
    actor_user_id: Uuid,
    witness_user_id: Option<Uuid>,
) -> anyhow::Result<Option<MedicationAdministrationListItem>> {
    record_medication_outcome(
        pool,
        RecordMedicationOutcome {
            authorization: None,
            facility_id,
            medication_id,
            actor_user_id,
            status: MedicationAdministrationOutcome::Administered,
            witness_user_id,
            reason_not_given: None,
            administration_notes: None,
            request_id: None,
        },
    )
    .await
}

pub async fn record_medication_outcome(
    pool: &PgPool,
    command: RecordMedicationOutcome,
) -> anyhow::Result<Option<MedicationAdministrationListItem>> {
    record_medication_outcome_inner(pool, command, None).await
}
pub async fn record_medication_outcome_authorized(
    pool: &PgPool,
    command: RecordMedicationOutcome,
    actor: crate::clinical::medication_access::MedicationActor,
) -> anyhow::Result<Option<MedicationAdministrationListItem>> {
    crate::clinical::medication_access::bound(&actor, command.facility_id, command.actor_user_id)?;
    record_medication_outcome_inner(pool, command, Some(actor)).await
}
async fn record_medication_outcome_inner(
    pool: &PgPool,
    command: RecordMedicationOutcome,
    mut access_actor: Option<crate::clinical::medication_access::MedicationActor>,
) -> anyhow::Result<Option<MedicationAdministrationListItem>> {
    let status = codec::encode(command.status)?;
    let reason = command
        .reason_not_given
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let notes = command
        .administration_notes
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let administered = command.status == MedicationAdministrationOutcome::Administered;
    if (!administered && reason.is_none())
        || reason.is_some_and(|value| value.len() > 1000)
        || (administered && reason.is_some())
    {
        return Err(MedicationOutcomeError::InvalidReason.into());
    }
    if notes.is_some_and(|value| value.len() > 2000) {
        return Err(MedicationOutcomeError::NotesTooLong.into());
    }
    if !administered && command.witness_user_id.is_some() {
        return Err(MedicationOutcomeError::InvalidWitness.into());
    }
    let mut transaction = pool.begin().await?;
    let source = sqlx::query_as::<_, (Option<Uuid>,Uuid,Uuid)>(
        "SELECT prescription_id,patient_id,admission_case_id FROM medication_administrations WHERE facility_id = $1 AND id = $2",
    )
    .bind(command.facility_id)
    .bind(command.medication_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some((prescription_id, patient_id, admission_id)) = source else {
        return Ok(None);
    };
    let prescription = if let Some(prescription_id) = prescription_id {
        Some(
            crate::clinical::lock_prescription(
                &mut transaction,
                command.facility_id,
                prescription_id,
            )
            .await?
            .ok_or(MedicationOutcomeError::NotActionable)?,
        )
    } else {
        None
    };
    let actor = if let Some(actor) = access_actor.as_mut() {
        crate::clinical::medication_access::verify(
            &mut transaction,
            actor,
            &[
                hms_domain::deployment::FeatureKey::Patients,
                hms_domain::deployment::FeatureKey::Nursing,
            ],
        )
        .await?;
        actor.identity.clone()
    } else {
        basis::authorize(
            &mut transaction,
            command.facility_id,
            command.actor_user_id,
            command.authorization.clone(),
        )
        .await?
    };
    let prn_safety_group = if let Some(source) = prescription
        .as_ref()
        .filter(|source| source.frequency.trim().eq_ignore_ascii_case("prn"))
    {
        Some(
            crate::clinical::prescription_courses::lock_prn_safety_group(
                &mut transaction,
                command.facility_id,
                source.id,
            )
            .await?
            .ok_or(super::prn::PrnError::Unconfigured)?,
        )
    } else {
        None
    };
    if let Some(actor) = access_actor.as_ref() {
        use crate::clinical::medication_access as access;
        access::patient(&mut transaction, actor, patient_id).await?;
        let wards = access::wards(&mut transaction, actor).await?;
        // Exact terminal replay remains readable after discharge; only a new
        // administration requires an active admission below.
        access::admission(
            &mut transaction,
            actor,
            &wards,
            admission_id,
            patient_id,
            false,
        )
        .await?;
    }
    // All source-based writers lock prescription and PRN group before child rows. Competing
    // dose outcomes then serialize on this row; a terminal decision is immutable.
    let existing = sqlx::query_as::<_, LockedMedicationOutcomeRow>(
        r#"SELECT scheduled_stock_policy,dispensed_stock_quantity,dispensed_stock_unit,frequency, prescription_id, medication_course_id, pharmacy_fulfillment_id,
            status, is_dispensed, scheduled_at <= clock_timestamp() AS is_due,
            administered_at, administered_by_user_id, witness_user_id,
            outcome_recorded_at, outcome_recorded_by_user_id,
            reason_not_given, administration_notes
        FROM medication_administrations WHERE facility_id = $1 AND id = $2 FOR UPDATE"#,
    )
    .bind(command.facility_id)
    .bind(command.medication_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(existing) = existing else {
        return Ok(None);
    };
    if existing.prescription_id != prescription_id {
        return Err(MedicationOutcomeError::NotActionable.into());
    }
    if existing.outcome_recorded_at.is_some()
        && existing.status == status
        && existing.outcome_recorded_by_user_id == Some(command.actor_user_id)
        && existing.reason_not_given.as_deref() == reason
        && existing.administration_notes.as_deref() == notes
        && existing.witness_user_id == command.witness_user_id
    {
        let receipt =
            medication_in_transaction(&mut transaction, command.facility_id, command.medication_id)
                .await?;
        basis::check_authorization(&mut transaction, &actor).await?;
        transaction.commit().await?;
        return Ok(receipt);
    }
    if prescription_id.is_none()
        && existing
            .frequency
            .as_deref()
            .is_some_and(|frequency| frequency.trim().eq_ignore_ascii_case("prn"))
    {
        return Err(super::prn::PrnError::Unconfigured.into());
    }
    if existing.status != "scheduled"
        || existing.outcome_recorded_at.is_some()
        || existing.administered_at.is_some()
        || existing.administered_by_user_id.is_some()
        || (prescription_id.is_none()
            && (existing.medication_course_id.is_some()
                || existing.pharmacy_fulfillment_id.is_some()))
    {
        return Err(MedicationOutcomeError::NotActionable.into());
    }
    if prescription
        .as_ref()
        .is_some_and(|source| source.status != hms_domain::clinical::PrescriptionStatus::Active)
    {
        return Err(MedicationOutcomeError::NotActionable.into());
    }
    if administered && prescription_id.is_some() && !existing.is_dispensed {
        return Err(MedicationOutcomeError::NotDispensed.into());
    }
    if administered {
        basis::lock_active_admission(
            &mut transaction,
            command.facility_id,
            admission_id,
            patient_id,
        )
        .await?;
        if let Some(source) = prescription
            .as_ref()
            .filter(|p| !p.frequency.trim().eq_ignore_ascii_case("prn"))
        {
            let policy =
                basis::source_policy(&mut transaction, command.facility_id, source.id).await?;
            let policy = basis::validate_policy(
                &mut transaction,
                command.facility_id,
                source.inventory_item_id,
                policy,
            )
            .await?;
            if existing.scheduled_stock_policy.as_ref().map(|p| &p.0) != Some(&policy)
                || existing.dispensed_stock_quantity != Some(policy.stock_units_per_dose)
                || existing.dispensed_stock_unit.as_deref() != Some(policy.stock_unit.as_str())
            {
                return Err(basis::StockBasisError::ReviewRequired.into());
            }
        }
    }
    if let Some(source) = prescription
        .as_ref()
        .filter(|p| p.frequency.trim().eq_ignore_ascii_case("prn"))
    {
        let requested_admission: Option<Uuid> = sqlx::query_scalar("SELECT admission_case_id FROM medication_administrations WHERE facility_id=$1 AND id=$2 AND prn_request_id IS NOT NULL AND prn_safety_group_id=$3")
            .bind(command.facility_id).bind(command.medication_id).bind(prn_safety_group).fetch_optional(&mut *transaction).await?;
        let admission = requested_admission.ok_or(super::prn::PrnError::NotActionable)?;
        let at = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(&mut *transaction)
            .await?;
        let policy = super::prn::validate_prn_source(
            &mut transaction,
            command.facility_id,
            admission,
            source,
            at,
        )
        .await?;
        if administered {
            super::prn::enforce_prn_limits(
                &mut transaction,
                command.facility_id,
                prn_safety_group.ok_or(super::prn::PrnError::Unconfigured)?,
                &policy,
                at,
            )
            .await?;
        }
    }
    if command.status == MedicationAdministrationOutcome::Missed && !existing.is_due {
        return Err(MedicationOutcomeError::FutureMissed.into());
    }
    if let Some(witness_id) = command.witness_user_id {
        let witness = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM users WHERE facility_id = $1 AND id = $2 AND is_active = TRUE FOR SHARE",
        ).bind(command.facility_id).bind(witness_id).fetch_optional(&mut *transaction).await?;
        if witness.is_none() {
            return Err(MedicationOutcomeError::InvalidWitness.into());
        }
    }
    basis::check_authorization(&mut transaction, &actor).await?;
    let result = observe_db_query(
        "ward.mar.medication_administrations.administer",
        sqlx::query(
            r#"
        UPDATE medication_administrations m
        SET status = $5, administered_at = CASE WHEN $5 = 'administered' THEN clock_timestamp() END,
            administered_by_user_id = CASE WHEN $5 = 'administered' THEN $1 END,
            witness_user_id = $2, updated_at = now(), prescription_held = false,
            reason_not_given = $6, administration_notes = $7,
            outcome_recorded_at = clock_timestamp(), outcome_recorded_by_user_id = $1
        WHERE m.facility_id = $3 AND m.id = $4 AND m.status = 'scheduled'
          AND (m.prescription_id IS NULL OR EXISTS (
            SELECT 1 FROM prescriptions p
            JOIN medication_courses c ON c.id = m.medication_course_id
                AND c.prescription_id = p.id AND c.facility_id = p.facility_id
                AND c.patient_id = p.patient_id AND c.admission_case_id = m.admission_case_id
            WHERE p.id = m.prescription_id AND p.facility_id = m.facility_id
                AND p.patient_id = m.patient_id AND p.status = 'active' AND c.status = 'active'
                AND NOT EXISTS(SELECT 1 FROM medication_course_stops local_stop WHERE local_stop.facility_id=c.facility_id AND local_stop.medication_course_id=c.id)
                AND m.medication_name = p.medication_name AND m.dose = p.dose
                AND m.route = p.route AND m.frequency = p.frequency
                AND c.medication_name = p.medication_name AND c.dose = p.dose
                AND c.route = p.route AND c.frequency = p.frequency
                AND c.inventory_item_id IS NOT DISTINCT FROM p.inventory_item_id
                AND c.prescription_start_date IS NOT DISTINCT FROM p.start_date
                AND c.prescription_duration_days IS NOT DISTINCT FROM p.duration_days
                AND c.prescription_first_dose_at IS NOT DISTINCT FROM p.first_dose_at
                AND c.prescription_prn_policy IS NOT DISTINCT FROM p.prn_policy
                AND c.prescription_scheduled_stock_policy IS NOT DISTINCT FROM p.scheduled_stock_policy
                AND m.scheduled_stock_policy IS NOT DISTINCT FROM p.scheduled_stock_policy
          ))
        "#,
        )
        .bind(command.actor_user_id)
        .bind(command.witness_user_id)
        .bind(command.facility_id)
        .bind(command.medication_id)
        .bind(&status)
        .bind(reason)
        .bind(notes)
        .execute(&mut *transaction),
    )
    .await?;
    if result.rows_affected() != 1 {
        return Err(MedicationOutcomeError::NotActionable.into());
    }
    if !administered {
        // Retire only unsupplied planned work. Never rewrite stock movements,
        // dispensed counts, actors or timestamps when a dose is not given.
        sqlx::query(r#"
            UPDATE pharmacy_fulfillments f
            SET requested_dose_count = f.dispensed_dose_count + remaining.pending_count,
                status = CASE WHEN remaining.pending_count = 0
                    THEN CASE WHEN f.dispensed_dose_count > 0 THEN 'dispensed' ELSE 'cancelled' END
                    WHEN f.dispensed_dose_count > 0 THEN 'partially_dispensed' ELSE 'pending' END,
                updated_at = now()
            FROM (SELECT count(*)::integer AS pending_count FROM medication_administrations
                WHERE facility_id = $1 AND pharmacy_fulfillment_id = $2
                    AND status = 'scheduled' AND NOT is_dispensed) remaining
            WHERE f.facility_id = $1 AND f.id = $2 AND f.status IN ('pending', 'partially_dispensed')
        "#).bind(command.facility_id).bind(existing.pharmacy_fulfillment_id)
            .execute(&mut *transaction).await?;
    }
    sqlx::query(r#"INSERT INTO audit_events
        (id, facility_id, actor_user_id, request_id, event_type, resource_type, resource_id, metadata)
        VALUES ($1, $2, $3, $4, 'nursing.medication_outcome.recorded', 'medication_administration', $5, $6)"#)
        .bind(Uuid::new_v4()).bind(command.facility_id).bind(command.actor_user_id)
        .bind(command.request_id).bind(command.medication_id)
        .bind(serde_json::json!({ "outcome": status })).execute(&mut *transaction).await?;
    basis::check_authorization(&mut transaction, &actor).await?;
    let receipt =
        medication_in_transaction(&mut transaction, command.facility_id, command.medication_id)
            .await?;
    basis::check_authorization(&mut transaction, &actor).await?;
    transaction.commit().await?;
    Ok(receipt)
}

pub async fn get_medication_administration(
    pool: &PgPool,
    facility_id: Uuid,
    medication_id: Uuid,
) -> anyhow::Result<Option<MedicationAdministrationListItem>> {
    optional_medication_by_id(pool, facility_id, medication_id).await
}

#[derive(Clone, Debug, Default)]
pub struct TreatmentSheetFilters {
    pub id: Option<Uuid>,
    pub patient_id: Option<Uuid>,
    pub admission_case_id: Option<Uuid>,
    pub ward_id: Option<Uuid>,
    pub sheet_date: Option<NaiveDate>,
    pub status: Option<TreatmentSheetStatus>,
    pub descending: bool,
}

pub async fn list_treatment_sheets(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<TreatmentSheetListItem>> {
    list_treatment_sheets_scoped(
        pool,
        facility_id,
        cursor,
        limit,
        TreatmentSheetFilters::default(),
    )
    .await
}

/// Minimal coherent target context; authorization precedes the clinical projection.
pub async fn treatment_sheet_access_context(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<(Uuid, Uuid)>> {
    Ok(observe_db_query("ward.mar.treatment_sheets.context", sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT sheet.patient_id, sheet.admission_case_id FROM treatment_sheets sheet JOIN admission_cases admission ON admission.id = sheet.admission_case_id AND admission.facility_id = sheet.facility_id AND admission.patient_id = sheet.patient_id WHERE sheet.facility_id = $1 AND sheet.id = $2"
    ).bind(facility_id).bind(id).fetch_optional(pool)).await?)
}

pub async fn list_treatment_sheets_scoped(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
    filters: TreatmentSheetFilters,
) -> anyhow::Result<Vec<TreatmentSheetListItem>> {
    let mut query = treatment_list_query(facility_id, cursor, limit, filters, None)?;
    let rows = observe_db_query(
        "ward.mar.treatment_sheets.list",
        query.build_query_as::<TreatmentSheetRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(treatment_sheet_from_row).collect()
}
pub async fn list_treatment_sheets_authorized(
    pool: &PgPool,
    mut actor: crate::clinical::medication_access::MedicationActor,
    cursor: Option<WardCursor>,
    limit: i64,
    filters: TreatmentSheetFilters,
) -> anyhow::Result<Vec<TreatmentSheetListItem>> {
    use crate::clinical::medication_access as access;
    let mut tx = pool.begin().await?;
    access::verify(
        &mut tx,
        &mut actor,
        &[
            hms_domain::deployment::FeatureKey::Patients,
            hms_domain::deployment::FeatureKey::Nursing,
        ],
    )
    .await?;
    let wards = access::wards(&mut tx, &actor).await?;
    if let Some(patient) = filters.patient_id {
        access::local_patient(&mut tx, &actor, patient).await?;
    }
    if let Some(admission) = filters.admission_case_id {
        let patient: Uuid = observe_db_query(
            "ward.medication.scope",
            sqlx::query_scalar(
                "SELECT patient_id FROM admission_cases WHERE facility_id=$1 AND id=$2",
            )
            .bind(actor.identity.facility_id)
            .bind(admission)
            .fetch_optional(&mut *tx),
        )
        .await?
        .ok_or(access::MedicationAccessError::ContextChanged)?;
        if filters.patient_id.is_some_and(|id| id != patient) {
            return Err(access::MedicationAccessError::ContextChanged.into());
        }
        access::admission(&mut tx, &actor, &wards, admission, patient, false).await?;
    }
    if filters
        .ward_id
        .is_some_and(|ward| wards.as_ref().is_some_and(|ids| !ids.contains(&ward)))
    {
        return Err(access::MedicationAccessError::WardDenied.into());
    }
    let mut query =
        treatment_list_query(actor.identity.facility_id, cursor, limit, filters, wards)?;
    let result = observe_db_query(
        "ward.mar.treatment_sheets.list",
        query
            .build_query_as::<TreatmentSheetRow>()
            .fetch_all(&mut *tx),
    )
    .await?
    .into_iter()
    .map(treatment_sheet_from_row)
    .collect::<anyhow::Result<_>>()?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
fn treatment_list_query(
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
    filters: TreatmentSheetFilters,
    wards: Option<Vec<Uuid>>,
) -> anyhow::Result<QueryBuilder<'static, Postgres>> {
    let mut query = treatment_sheet_query();
    query
        .push(" WHERE treatment_sheets.facility_id = ")
        .push_bind(facility_id);
    if let Some(wards) = wards {
        query
            .push(" AND sheet_admission.ward_id=ANY(")
            .push_bind(wards)
            .push(")");
    }
    if let Some(id) = filters.id {
        query.push(" AND treatment_sheets.id = ").push_bind(id);
    }
    if let Some(id) = filters.patient_id {
        query
            .push(" AND treatment_sheets.patient_id = ")
            .push_bind(id);
    }
    if let Some(id) = filters.admission_case_id {
        query
            .push(" AND treatment_sheets.admission_case_id = ")
            .push_bind(id);
    }
    if let Some(id) = filters.ward_id {
        query.push(" AND sheet_admission.ward_id = ").push_bind(id);
    }
    if let Some(date) = filters.sheet_date {
        query
            .push(" AND treatment_sheets.sheet_date = ")
            .push_bind(date);
    }
    if let Some(status) = filters.status {
        query
            .push(" AND treatment_sheets.status = ")
            .push_bind(codec::encode(status)?);
    }
    if let Some(cursor) = cursor {
        query.push(if filters.descending {
            " AND (treatment_sheets.updated_at, treatment_sheets.id) < ("
        } else {
            " AND (treatment_sheets.updated_at, treatment_sheets.id) > ("
        });
        query
            .push_bind(cursor.occurred_at)
            .push(", ")
            .push_bind(cursor.id)
            .push(")");
    }
    query
        .push(if filters.descending {
            " ORDER BY treatment_sheets.updated_at DESC, treatment_sheets.id DESC LIMIT "
        } else {
            " ORDER BY treatment_sheets.updated_at ASC, treatment_sheets.id ASC LIMIT "
        })
        .push_bind(limit.clamp(1, 101));
    Ok(query)
}

pub async fn create_treatment_sheet(
    pool: &PgPool,
    sheet: NewTreatmentSheet,
) -> anyhow::Result<TreatmentSheetListItem> {
    create_treatment_sheet_inner(pool, sheet, None).await
}
pub async fn create_treatment_sheet_authorized(
    pool: &PgPool,
    sheet: NewTreatmentSheet,
    actor: crate::clinical::medication_access::MedicationActor,
) -> anyhow::Result<TreatmentSheetListItem> {
    crate::clinical::medication_access::bound(&actor, sheet.facility_id, sheet.actor_user_id)?;
    create_treatment_sheet_inner(pool, sheet, Some(actor)).await
}
async fn create_treatment_sheet_inner(
    pool: &PgPool,
    sheet: NewTreatmentSheet,
    mut actor: Option<crate::clinical::medication_access::MedicationActor>,
) -> anyhow::Result<TreatmentSheetListItem> {
    let mut tx = pool.begin().await?;
    if let Some(actor) = actor.as_mut() {
        use crate::clinical::medication_access as access;
        access::verify(
            &mut tx,
            actor,
            &[
                hms_domain::deployment::FeatureKey::Patients,
                hms_domain::deployment::FeatureKey::Nursing,
            ],
        )
        .await?;
        access::local_patient(&mut tx, actor, sheet.patient_id).await?;
        let wards = access::wards(&mut tx, actor).await?;
        access::admission(
            &mut tx,
            actor,
            &wards,
            sheet.admission_case_id,
            sheet.patient_id,
            true,
        )
        .await?;
    }

    observe_db_query(
        "ward.mar.treatment_sheets.create",
        sqlx::query(
            r#"
        INSERT INTO treatment_sheets (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            sheet_date,
            status,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (admission_case_id, sheet_date) DO UPDATE
        SET updated_at = now()
        "#,
        )
        .bind(sheet.id)
        .bind(sheet.facility_id)
        .bind(sheet.admission_case_id)
        .bind(sheet.patient_id)
        .bind(sheet.sheet_date)
        .bind(codec::encode(TreatmentSheetStatus::Active)?)
        .bind(sheet.actor_user_id)
        .execute(&mut *tx),
    )
    .await?;

    let mut query = treatment_sheet_query();
    query
        .push(" WHERE treatment_sheets.facility_id=")
        .push_bind(sheet.facility_id)
        .push(" AND treatment_sheets.admission_case_id=")
        .push_bind(sheet.admission_case_id)
        .push(" AND treatment_sheets.sheet_date=")
        .push_bind(sheet.sheet_date);
    let result = treatment_sheet_from_row(
        query
            .build_query_as::<TreatmentSheetRow>()
            .fetch_one(&mut *tx)
            .await?,
    )?;
    if let Some(actor) = actor.as_ref() {
        crate::clinical::medication_access::deadline(&mut tx, actor).await?;
    }
    tx.commit().await?;
    Ok(result)
}

fn medication_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT medication_administrations.scheduled_stock_policy,medication_administrations.dispensed_stock_quantity,medication_administrations.dispensed_stock_unit,medication_administrations.prn_indication, medication_administrations.prn_request_id, medication_administrations.id,
               medication_administrations.admission_case_id,
               medication_administrations.patient_id,
               medication_administrations.prescription_id,
               medication_administrations.medication_course_id,
               medication_administrations.pharmacy_fulfillment_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               medication_administrations.medication_name,
               medication_administrations.dose,
               medication_administrations.route,
               medication_administrations.frequency,
               medication_administrations.dose_sequence,
               medication_administrations.scheduled_at,
               medication_administrations.administered_at,
               medication_administrations.is_dispensed,
               medication_administrations.dispensed_at,
               medication_administrations.prescription_held,
               medication_administrations.reason_not_given,
               medication_administrations.administration_notes,
               medication_administrations.outcome_recorded_at,
               medication_administrations.outcome_recorded_by_user_id,
               outcome_actor.display_name AS outcome_recorded_by_display_name,
               CASE WHEN medication_administrations.status = 'scheduled'
                    AND medication_administrations.prescription_id IS NOT NULL
                    AND (prescriptions.id IS NULL OR prescriptions.status <> 'active'
                        OR medication_courses.id IS NULL OR medication_courses.status <> 'active'
                        OR medication_administrations.medication_name IS DISTINCT FROM prescriptions.medication_name
                        OR medication_administrations.dose IS DISTINCT FROM prescriptions.dose
                        OR medication_administrations.route IS DISTINCT FROM prescriptions.route
                        OR medication_administrations.frequency IS DISTINCT FROM prescriptions.frequency
                        OR medication_courses.medication_name IS DISTINCT FROM prescriptions.medication_name
                        OR medication_courses.dose IS DISTINCT FROM prescriptions.dose
                        OR medication_courses.route IS DISTINCT FROM prescriptions.route
                        OR medication_courses.frequency IS DISTINCT FROM prescriptions.frequency
                        OR medication_courses.inventory_item_id IS DISTINCT FROM prescriptions.inventory_item_id
                        OR medication_courses.prescription_start_date IS DISTINCT FROM prescriptions.start_date
                        OR medication_courses.prescription_duration_days IS DISTINCT FROM prescriptions.duration_days
                        OR medication_courses.prescription_first_dose_at IS DISTINCT FROM prescriptions.first_dose_at
                        OR medication_courses.prescription_prn_policy IS DISTINCT FROM prescriptions.prn_policy)
                    THEN 'held' ELSE medication_administrations.status END AS status
        FROM medication_administrations
        JOIN patients ON patients.id = medication_administrations.patient_id
            AND patients.facility_id = medication_administrations.facility_id
        JOIN admission_cases mar_admission ON mar_admission.id=medication_administrations.admission_case_id
            AND mar_admission.facility_id=medication_administrations.facility_id
            AND mar_admission.patient_id=medication_administrations.patient_id
        LEFT JOIN users outcome_actor ON outcome_actor.id = medication_administrations.outcome_recorded_by_user_id
            AND outcome_actor.facility_id = medication_administrations.facility_id
        LEFT JOIN prescriptions ON prescriptions.id = medication_administrations.prescription_id
            AND prescriptions.facility_id = medication_administrations.facility_id
            AND prescriptions.patient_id = medication_administrations.patient_id
        LEFT JOIN medication_courses ON medication_courses.id = medication_administrations.medication_course_id
            AND medication_courses.facility_id = medication_administrations.facility_id
            AND medication_courses.patient_id = medication_administrations.patient_id
            AND medication_courses.admission_case_id = medication_administrations.admission_case_id
            AND medication_courses.prescription_id = medication_administrations.prescription_id
        "#,
    )
}

fn treatment_sheet_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT treatment_sheets.id,
               treatment_sheets.admission_case_id,
               treatment_sheets.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               treatment_sheets.sheet_date,
               treatment_sheets.status,
               treatment_sheets.updated_at
        FROM treatment_sheets
        JOIN admission_cases sheet_admission
          ON sheet_admission.id = treatment_sheets.admission_case_id
         AND sheet_admission.facility_id = treatment_sheets.facility_id
         AND sheet_admission.patient_id = treatment_sheets.patient_id
        JOIN patients ON patients.id = treatment_sheets.patient_id
            AND patients.facility_id = treatment_sheets.facility_id
        "#,
    )
}

async fn optional_medication_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    medication_id: Uuid,
) -> anyhow::Result<Option<MedicationAdministrationListItem>> {
    let mut query = medication_query();
    query.push(" WHERE medication_administrations.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND medication_administrations.id = ");
    query.push_bind(medication_id);
    let row = observe_db_query(
        "ward.mar.medication_administrations.get",
        query
            .build_query_as::<MedicationAdministrationRow>()
            .fetch_optional(pool),
    )
    .await?;
    row.map(medication_from_row).transpose()
}

async fn medication_in_transaction(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<MedicationAdministrationListItem>> {
    let mut query = medication_query();
    query
        .push(" WHERE medication_administrations.facility_id=")
        .push_bind(facility)
        .push(" AND medication_administrations.id=")
        .push_bind(id);
    query
        .build_query_as::<MedicationAdministrationRow>()
        .fetch_optional(&mut **tx)
        .await?
        .map(medication_from_row)
        .transpose()
}

fn medication_from_row(
    row: MedicationAdministrationRow,
) -> anyhow::Result<MedicationAdministrationListItem> {
    Ok(MedicationAdministrationListItem {
        scheduled_stock_policy: row.scheduled_stock_policy.map(|p| p.0),
        dispensed_stock_quantity: row.dispensed_stock_quantity,
        dispensed_stock_unit: row.dispensed_stock_unit,
        prn_indication: row.prn_indication,
        prn_request_id: row.prn_request_id,
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        prescription_id: row.prescription_id,
        medication_course_id: row.medication_course_id,
        pharmacy_fulfillment_id: row.pharmacy_fulfillment_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        medication_name: row.medication_name,
        dose: row.dose,
        route: row.route,
        frequency: row.frequency,
        dose_sequence: row.dose_sequence,
        scheduled_at: row.scheduled_at,
        administered_at: row.administered_at,
        is_dispensed: row.is_dispensed,
        dispensed_at: row.dispensed_at,
        status: codec::decode(&row.status)?,
        prescription_held: row.prescription_held,
        reason_not_given: row.reason_not_given,
        administration_notes: row.administration_notes,
        outcome_recorded_at: row.outcome_recorded_at,
        outcome_recorded_by_user_id: row.outcome_recorded_by_user_id,
        outcome_recorded_by_display_name: row.outcome_recorded_by_display_name,
    })
}

fn treatment_sheet_from_row(row: TreatmentSheetRow) -> anyhow::Result<TreatmentSheetListItem> {
    Ok(TreatmentSheetListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        sheet_date: row.sheet_date,
        status: codec::decode(&row.status)?,
        updated_at: row.updated_at,
    })
}
