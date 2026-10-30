//! Governed scheduling defaults and bounded future-generator retirement.
use crate::clinical::{
    medication_access,
    prescription_courses::{self, PrescriptionActor, PrescriptionAuthorization},
};
use crate::PgPool;
use chrono::{DateTime, Utc};
use hms_domain::{appointment_types::*, deployment::FeatureKey};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{types::Json, FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;
type Tx<'a> = Transaction<'a, Postgres>;
#[derive(Clone)]
pub struct AppointmentTypeActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: String,
    pub authorization: PrescriptionAuthorization,
}
#[derive(Clone, Copy, Debug)]
pub enum AppointmentTypeError {
    Invalid,
    NotFound,
    VersionConflict,
    RequestConflict,
    FutureGenerator,
    Authority,
    Busy,
}
impl std::fmt::Display for AppointmentTypeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Current appointment type review is required.")
    }
}
impl std::error::Error for AppointmentTypeError {}
#[derive(FromRow)]
struct Row {
    id: Uuid,
    code: String,
    name: String,
    default_duration_minutes: i32,
    is_active: bool,
    version: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}
impl From<Row> for GovernedAppointmentType {
    fn from(r: Row) -> Self {
        Self {
            id: r.id,
            code: r.code,
            name: r.name,
            default_duration_minutes: r.default_duration_minutes,
            is_active: r.is_active,
            version: r.version,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}
const COLUMNS: &str =
    "id,code,name,default_duration_minutes,is_active,version,created_at,updated_at";
fn hash(v: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(v).to_vec()
}
fn lock_error(e: sqlx::Error) -> anyhow::Error {
    if e.as_database_error()
        .is_some_and(|d| d.code().as_deref() == Some("55P03"))
    {
        AppointmentTypeError::Busy.into()
    } else {
        e.into()
    }
}
async fn authority(
    tx: &mut Tx<'_>,
    a: &mut AppointmentTypeActor,
) -> anyhow::Result<PrescriptionActor> {
    let mut identity = PrescriptionActor {
        facility_id: a.facility_id,
        user_id: a.user_id,
        request_id: Some(a.request_id.clone()),
        authorization: Some(a.authorization.clone()),
    };
    prescription_courses::verify_actor(tx, &mut identity).await?;
    a.authorization = identity
        .authorization
        .clone()
        .ok_or(AppointmentTypeError::Authority)?;
    medication_access::require_current_features_tx(
        tx,
        a.facility_id,
        a.authorization.active_profile,
        &[FeatureKey::Appointments],
    )
    .await?;
    let(ok,boundary):(bool,Option<DateTime<Utc>>)=hms_observability::observe_db_query("scheduling.type.proof.permissions",sqlx::query_as(r#"
 WITH point AS MATERIALIZED(SELECT clock_timestamp() at),effective AS(
 SELECT permission_code FROM user_permissions WHERE user_id=$2
 UNION SELECT permission_code FROM permission_assignments p CROSS JOIN point n WHERE p.facility_id=$1 AND p.grantee_user_id=$2 AND p.scope_type='facility' AND p.scope_id IS NULL AND p.status='active' AND p.starts_at<=n.at AND(p.ends_at IS NULL OR p.ends_at>n.at)
 UNION SELECT permission_code FROM delegations d CROSS JOIN point n WHERE d.facility_id=$1 AND d.delegate_user_id=$2 AND d.status='active' AND d.starts_at<=n.at AND(d.ends_at IS NULL OR d.ends_at>n.at))
 SELECT (SELECT count(*) FROM effective WHERE permission_code IN('appointment.manage','patient.demographics.view'))=2
 AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='demographics')
 AND EXISTS(SELECT 1 FROM user_features WHERE user_id=$2 AND feature_key='appointments'),
 (SELECT min(boundary) FROM user_authority_boundaries b CROSS JOIN LATERAL(VALUES(b.starts_at),(b.ends_at)) boundaries(boundary) CROSS JOIN point n WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
 "#).bind(a.facility_id).bind(a.user_id).fetch_one(&mut **tx)).await?;
    if !ok {
        return Err(AppointmentTypeError::Authority.into());
    }
    if let Some(at) = boundary {
        a.authorization.valid_until = a.authorization.valid_until.min(at);
    }
    identity.authorization = Some(a.authorization.clone());
    prescription_courses::check_authorization(tx, &identity).await?;
    Ok(identity)
}
async fn gate(tx: &mut Tx<'_>, facility: Uuid, namespace: &[u8], key: &[u8]) -> anyhow::Result<()> {
    let mut material = namespace.to_vec();
    material.extend_from_slice(facility.as_bytes());
    material.extend_from_slice(key);
    let bytes = hash(material);
    let number = i64::from_be_bytes(bytes[..8].try_into()?);
    let ok: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(number)
        .fetch_one(&mut **tx)
        .await?;
    if !ok {
        return Err(AppointmentTypeError::Busy.into());
    }
    Ok(())
}
fn facts(i: &AppointmentTypeReviewedInput) -> (Uuid, Option<Uuid>, &'static str, Option<i64>) {
    match i {
        AppointmentTypeReviewedInput::Create {
            client_request_id, ..
        } => (*client_request_id, None, "create", None),
        AppointmentTypeReviewedInput::Metadata {
            client_request_id,
            service_id,
            expected_version,
            ..
        } => (
            *client_request_id,
            Some(*service_id),
            "metadata",
            Some(*expected_version),
        ),
        AppointmentTypeReviewedInput::Retire {
            client_request_id,
            service_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*service_id),
            "retire",
            Some(*expected_version),
        ),
        AppointmentTypeReviewedInput::Reactivate {
            client_request_id,
            service_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*service_id),
            "reactivate",
            Some(*expected_version),
        ),
    }
}
fn validate(i: &AppointmentTypeReviewedInput) -> anyhow::Result<()> {
    let (k, id, _, v) = facts(i);
    if k.is_nil() || id.is_some_and(|i| i.is_nil()) || v.is_some_and(|v| v < 1) {
        return Err(AppointmentTypeError::Invalid.into());
    }
    match i {
        AppointmentTypeReviewedInput::Create {
            default_duration_minutes,
            ..
        }
        | AppointmentTypeReviewedInput::Metadata {
            default_duration_minutes,
            ..
        } if !(1..=1440).contains(default_duration_minutes) => {
            return Err(AppointmentTypeError::Invalid.into())
        }
        _ => {}
    }
    let name = match i {
        AppointmentTypeReviewedInput::Create { name, code, .. } => {
            if code.is_empty()
                || code.len() > 48
                || !code
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            {
                return Err(AppointmentTypeError::Invalid.into());
            }
            Some(name)
        }
        AppointmentTypeReviewedInput::Metadata { name, .. } => Some(name),
        _ => None,
    };
    if name.is_some_and(|v| {
        v.trim() != v || v.is_empty() || v.len() > 160 || v.chars().any(char::is_control)
    }) {
        return Err(AppointmentTypeError::Invalid.into());
    }
    Ok(())
}
async fn locked_type(
    tx: &mut Tx<'_>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<GovernedAppointmentType> {
    let sql = format!(
        "SELECT {COLUMNS} FROM appointment_types WHERE facility_id=$1 AND id=$2 FOR UPDATE NOWAIT"
    );
    Ok(sqlx::query_as::<_, Row>(&sql)
        .bind(facility)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(lock_error)?
        .ok_or(AppointmentTypeError::NotFound)?
        .into())
}
#[derive(FromRow)]
struct Saved {
    actor_user_id: Uuid,
    payload_digest: Vec<u8>,
    receipt: Json<AppointmentTypeCommandReceipt>,
}
pub async fn execute(
    pool: &PgPool,
    mut actor: AppointmentTypeActor,
    input: AppointmentTypeReviewedInput,
) -> anyhow::Result<AppointmentTypeCommandReceipt> {
    validate(&input)?;
    let (key, id, action, expected) = facts(&input);
    let digest = hash(serde_json::to_vec(&serde_json::to_value(&input)?)?);
    let key_hash = hash(key.as_bytes());
    let mut tx = pool.begin().await?;
    let proof = authority(&mut tx, &mut actor).await?;
    gate(
        &mut tx,
        actor.facility_id,
        b"hms.appointment.type.command.v1",
        &key_hash,
    )
    .await?;
    let saved=sqlx::query_as::<_,Saved>("SELECT actor_user_id,payload_digest,receipt FROM appointment_type_commands WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(&key_hash).fetch_optional(&mut *tx).await?;
    if let Some(saved) = saved {
        if saved.actor_user_id != actor.user_id || saved.payload_digest != digest {
            return Err(AppointmentTypeError::RequestConflict.into());
        }
        prescription_courses::check_authorization(&mut tx, &proof).await?;
        tx.commit().await?;
        return Ok(saved.receipt.0);
    }
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await?;
    let (service, changed) = if let AppointmentTypeReviewedInput::Create {
        code,
        name,
        default_duration_minutes,
        ..
    } = &input
    {
        gate(
            &mut tx,
            actor.facility_id,
            b"hms.appointment.type.code.v1",
            code.as_bytes(),
        )
        .await?;
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO appointment_types(id,facility_id,code,name,default_duration_minutes,created_at,updated_at)VALUES($1,$2,$3,$4,$5,$6,$6)").bind(id).bind(actor.facility_id).bind(code).bind(name).bind(default_duration_minutes).bind(now).execute(&mut *tx).await?;
        (locked_type(&mut tx, actor.facility_id, id).await?, true)
    } else {
        let id = id.ok_or(AppointmentTypeError::Invalid)?;
        let old = locked_type(&mut tx, actor.facility_id, id).await?;
        if Some(old.version) != expected {
            return Err(AppointmentTypeError::VersionConflict.into());
        }
        let (name, duration, active) = match &input {
            AppointmentTypeReviewedInput::Metadata {
                name,
                default_duration_minutes,
                ..
            } => (name.clone(), *default_duration_minutes, old.is_active),
            AppointmentTypeReviewedInput::Retire { .. } => {
                (old.name.clone(), old.default_duration_minutes, false)
            }
            AppointmentTypeReviewedInput::Reactivate { .. } => {
                (old.name.clone(), old.default_duration_minutes, true)
            }
            _ => return Err(AppointmentTypeError::Invalid.into()),
        };
        let changed =
            name != old.name || duration != old.default_duration_minutes || active != old.is_active;
        if changed {
            if old.is_active && !active {
                let used: bool = hms_observability::observe_db_query(
                    "scheduling.type.future_generator",
                    sqlx::query_scalar(
                        "SELECT appointment_type_has_future_generator($1,$2,clock_timestamp())",
                    )
                    .bind(actor.facility_id)
                    .bind(id)
                    .fetch_one(&mut *tx),
                )
                .await?;
                if used {
                    return Err(AppointmentTypeError::FutureGenerator.into());
                }
            }
            sqlx::query("UPDATE appointment_types SET name=$3,default_duration_minutes=$4,is_active=$5,version=version+1,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(id).bind(name).bind(duration).bind(active).execute(&mut *tx).await?;
        }
        (locked_type(&mut tx, actor.facility_id, id).await?, changed)
    };
    let receipt = AppointmentTypeCommandReceipt {
        client_request_id: key,
        input_digest: digest.iter().map(|v| format!("{v:02x}")).collect(),
        reviewed_input: input,
        recorded_by_user_id: actor.user_id,
        service,
        changed,
        recorded_at: now,
    };
    sqlx::query("INSERT INTO appointment_type_commands(facility_id,request_key_hash,actor_user_id,type_id,action,payload_digest,receipt,recorded_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(actor.facility_id).bind(key_hash).bind(actor.user_id).bind(receipt.service.id).bind(action).bind(digest).bind(Json(&receipt)).bind(now).execute(&mut *tx).await?;
    crate::admin::insert_audit_event_tx(
        &mut tx,
        crate::admin::NewAuditEvent {
            facility_id: actor.facility_id,
            actor_user_id: Some(actor.user_id),
            request_id: Some(actor.request_id),
            event_type: format!("scheduling.appointment_type.{action}"),
            resource_type: "appointment_type".into(),
            resource_id: Some(receipt.service.id),
            metadata: json!({"action":action,"version":receipt.service.version,"changed":changed}),
        },
    )
    .await?;
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(receipt)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: AppointmentTypeActor,
    key: Uuid,
) -> anyhow::Result<AppointmentTypeCommandReceipt> {
    if key.is_nil() {
        return Err(AppointmentTypeError::Invalid.into());
    }
    let mut tx = pool.begin().await?;
    let proof = authority(&mut tx, &mut actor).await?;
    let r=sqlx::query_scalar::<_,Json<AppointmentTypeCommandReceipt>>("SELECT receipt FROM appointment_type_commands WHERE facility_id=$1 AND request_key_hash=$2 AND actor_user_id=$3").bind(actor.facility_id).bind(hash(key.as_bytes())).bind(actor.user_id).fetch_optional(&mut *tx).await?.ok_or(AppointmentTypeError::NotFound)?;
    prescription_courses::check_authorization(&mut tx, &proof).await?;
    tx.commit().await?;
    Ok(r.0)
}
pub async fn detail(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<GovernedAppointmentType>> {
    let sql = format!("SELECT {COLUMNS} FROM appointment_types WHERE facility_id=$1 AND id=$2");
    Ok(sqlx::query_as::<_, Row>(&sql)
        .bind(facility)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(Into::into))
}
pub async fn list(
    pool: &PgPool,
    facility: Uuid,
    cursor: Option<crate::scheduling::SchedulingCursor>,
    limit: i64,
    query: AppointmentTypeAdministrationQuery,
) -> anyhow::Result<Vec<GovernedAppointmentType>> {
    let mut q = QueryBuilder::<Postgres>::new(format!(
        "SELECT {COLUMNS} FROM appointment_types WHERE facility_id="
    ));
    q.push_bind(facility);
    if let Some(active) = query.is_active {
        q.push(" AND is_active=").push_bind(active);
    }
    if let Some(v) = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| {
            format!(
                "%{}%",
                v.replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            )
        })
    {
        q.push(" AND (code ILIKE ")
            .push_bind(v.clone())
            .push(" ESCAPE '\\' OR name ILIKE ")
            .push_bind(v)
            .push(" ESCAPE '\\')");
    }
    if let Some(c) = cursor {
        q.push(" AND (created_at,id)<(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY created_at DESC,id DESC LIMIT ")
        .push_bind(limit);
    Ok(hms_observability::observe_db_query(
        "scheduling.type.administration_page",
        q.build_query_as::<Row>().fetch_all(pool),
    )
    .await?
    .into_iter()
    .map(Into::into)
    .collect())
}

/// Sorted exact active local type gates shared by new publication producers.
/// Existing unchanged booked-care closure deliberately does not call this.
pub async fn retain_active_types_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    types: &[Uuid],
) -> anyhow::Result<()> {
    sqlx::query("SELECT appointment_type_require_active($1,$2)")
        .bind(facility)
        .bind(types)
        .execute(&mut **tx)
        .await
        .map_err(lock_error)?;
    Ok(())
}
