use super::*;
use crate::care::lifecycle::{self, CareLifecycleError};
use hms_domain::care::{EncounterStatus, VisitStatus};
#[derive(FromRow)]
struct EncounterRow {
    id: Uuid,
    patient_id: Uuid,
    visit_id: Option<Uuid>,
    encounter_type: String,
    status: String,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
}
pub(super) async fn encounter(
    tx: &mut Tx<'_>,
    a: &ConsultationActor,
    id: Uuid,
    patient: Uuid,
) -> anyhow::Result<Option<ReferralConsultationEncounter>> {
    let row:Option<EncounterRow>=observe_db_query("referrals.consultation.encounter",sqlx::query_as("SELECT id,patient_id,visit_id,encounter_type,status,started_at,ended_at FROM encounters WHERE facility_id=$1 AND patient_id=$2 AND id=$3 FOR SHARE NOWAIT").bind(a.facility_id).bind(patient).bind(id).fetch_optional(&mut **tx)).await.map_err(lock_error)?;
    row.map(|r| {
        Ok(ReferralConsultationEncounter {
            id: r.id,
            patient_id: r.patient_id,
            visit_id: r.visit_id,
            encounter_type: codec::decode(&r.encounter_type)?,
            status: codec::decode(&r.status)?,
            started_at: r.started_at,
            ended_at: r.ended_at,
        })
    })
    .transpose()
}
#[derive(FromRow)]
struct AppointmentRow {
    id: Uuid,
    practitioner_user_id: Option<Uuid>,
    patient_id: Uuid,
    clinic_id: Option<Uuid>,
    status: String,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
}
#[derive(FromRow)]
struct AdmissionRow {
    id: Uuid,
    encounter_id: Option<Uuid>,
    visit_id: Option<Uuid>,
    status: String,
    admitted_at: DateTime<Utc>,
    placement_revision: i64,
    ward_id: Uuid,
    ward_name: String,
}
pub(super) async fn selection(
    tx: &mut Tx<'_>,
    a: &ConsultationActor,
    r: &Root,
    scope: &access::Scope,
    patient: &access::Patient,
    source: ReferralConsultationSource,
) -> anyhow::Result<(Option<ReferralConsultationSelection>, Option<String>)> {
    let mut reason = if r.status == "accepted" && r.scheduled_appointment_id.is_some() {
        Some("source_inconsistent".to_owned())
    } else {
        None
    };
    let appointment = if r.status == "scheduled" {
        if let Some(id) = r.scheduled_appointment_id {
            observe_db_query("referrals.consultation.appointment",sqlx::query_as::<_,AppointmentRow>("SELECT id,patient_id,clinic_id,practitioner_user_id,status,starts_at,ends_at FROM appointments a WHERE facility_id=$1 AND patient_id=$2 AND id=$3 AND (clinic_id IS NULL OR EXISTS(SELECT 1 FROM clinics c WHERE c.id=a.clinic_id AND c.facility_id=a.facility_id)) AND (practitioner_user_id IS NULL OR EXISTS(SELECT 1 FROM users u WHERE u.id=a.practitioner_user_id AND u.facility_id=a.facility_id)) FOR SHARE NOWAIT").bind(a.facility_id).bind(r.patient_id).bind(id).fetch_optional(&mut **tx)).await.map_err(lock_error)?
        } else {
            None
        }
    } else {
        None
    };
    if r.status == "scheduled"
        && appointment.as_ref().is_none_or(|v| {
            v.patient_id != r.patient_id || !matches!(v.status.as_str(), "scheduled" | "checked_in")
        })
    {
        reason = Some("appointment_unavailable".to_owned())
    }
    let mut selected = ReferralConsultationSelection {
        source: source.clone(),
        restricted_override_required: false,
        encounter: None,
        visit: None,
        appointment: appointment
            .as_ref()
            .map(|v| {
                Ok::<_, anyhow::Error>(ReferralConsultationAppointment {
                    id: v.id,
                    clinic_id: v.clinic_id,
                    practitioner_user_id: v.practitioner_user_id,
                    status: codec::decode(&v.status)?,
                    starts_at: v.starts_at,
                    ends_at: v.ends_at,
                })
            })
            .transpose()?,
        admission: None,
    };
    match source {
        ReferralConsultationSource::NewOutpatient { visit } => {
            if patient.vital_status == "deceased"
                || !matches!(patient.record_status.as_str(), "registered" | "restricted")
            {
                reason = Some("patient_intake_unavailable".to_owned())
            }
            selected.restricted_override_required = patient.record_status == "restricted";
            if selected.restricted_override_required && !scope.can_override {
                reason = Some("restricted_override_authority_required".to_owned())
            }
            if let ReferralConsultationVisitChoice::ExistingVisit { visit_id } = visit {
                let visit =
                    match lifecycle::lock_visit_tx(tx, a.facility_id, r.patient_id, visit_id, true)
                        .await
                    {
                        Ok(v) => Some(v),
                        Err(e)
                            if e.downcast_ref::<CareLifecycleError>()
                                == Some(&CareLifecycleError::NotFound) =>
                        {
                            None
                        }
                        Err(e) => return Err(e),
                    };
                if let Some(v) = visit {
                    if !matches!(
                        v.status,
                        VisitStatus::Waiting
                            | VisitStatus::Called
                            | VisitStatus::InTriage
                            | VisitStatus::Triaged
                            | VisitStatus::InConsultation
                            | VisitStatus::OnHold
                    ) {
                        reason = Some("selected_visit_unavailable".to_owned())
                    }
                    if let Some(p) = appointment.as_ref() {
                        if v.appointment_id != Some(p.id)
                            || v.clinic_id.zip(p.clinic_id).is_some_and(|(a, b)| a != b)
                        {
                            reason = Some("appointment_unavailable".to_owned())
                        }
                    }
                    selected.visit = Some(ReferralConsultationVisit {
                        id: v.id,
                        patient_id: v.patient_id,
                        appointment_id: v.appointment_id,
                        clinic_id: v.clinic_id,
                        status: v.status,
                        checked_in_at: v.checked_in_at,
                        consultation_started_at: v.consultation_started_at,
                    });
                } else {
                    reason = Some("selected_visit_unavailable".to_owned())
                }
            }
        }
        ReferralConsultationSource::ExistingAdmissionEncounter {
            admission_case_id,
            encounter_id,
        } => {
            let admission:Option<AdmissionRow>=observe_db_query("referrals.consultation.admission",sqlx::query_as("SELECT c.id,c.encounter_id,c.visit_id,c.status,c.admitted_at,c.placement_revision,c.ward_id,w.name AS ward_name FROM admission_cases c JOIN wards w ON w.id=c.ward_id AND w.facility_id=c.facility_id WHERE c.facility_id=$1 AND c.patient_id=$2 AND c.id=$3 FOR SHARE OF c,w NOWAIT").bind(a.facility_id).bind(r.patient_id).bind(admission_case_id).fetch_optional(&mut **tx)).await.map_err(lock_error)?;
            if let Some(c) = admission {
                let e = encounter(tx, a, encounter_id, r.patient_id).await?;
                if c.encounter_id != Some(encounter_id)
                    || !matches!(c.status.as_str(), "admitted" | "discharge_pending")
                    || e.as_ref().is_none_or(|e| {
                        e.status != EncounterStatus::InProgress
                            || e.ended_at.is_some()
                            || e.visit_id != c.visit_id
                    })
                {
                    reason = Some("selected_admission_unavailable".to_owned())
                }
                if let Some(visit_id) = c.visit_id {
                    let visit:Option<(Option<Uuid>,Option<Uuid>)>=observe_db_query("referrals.consultation.admission_visit",sqlx::query_as("SELECT appointment_id,clinic_id FROM visits WHERE facility_id=$1 AND patient_id=$2 AND id=$3 FOR SHARE NOWAIT").bind(a.facility_id).bind(r.patient_id).bind(visit_id).fetch_optional(&mut **tx)).await.map_err(lock_error)?;
                    if let Some((appointment_id, clinic_id)) = visit {
                        if let Some(p) = appointment.as_ref() {
                            if appointment_id != Some(p.id)
                                || clinic_id.zip(p.clinic_id).is_some_and(|(a, b)| a != b)
                            {
                                reason = Some("appointment_unavailable".to_owned())
                            }
                        }
                    } else {
                        reason = Some("selected_admission_unavailable".to_owned())
                    }
                }
                if c.encounter_id == Some(encounter_id)
                    && matches!(c.status.as_str(), "admitted" | "discharge_pending")
                {
                    selected.admission = Some(ReferralConsultationAdmission {
                        id: c.id,
                        encounter_id,
                        visit_id: c.visit_id,
                        status: codec::decode(&c.status)?,
                        admitted_at: c.admitted_at,
                        placement_revision: c.placement_revision,
                        ward_id: c.ward_id,
                        ward_name: c.ward_name,
                    });
                    selected.encounter = e
                }
            } else {
                reason = Some("selected_admission_unavailable".to_owned())
            }
        }
    }
    if matches!(reason.as_deref(), Some("selected_visit_unavailable")) && selected.visit.is_none() {
        return Ok((None, reason));
    }
    if matches!(reason.as_deref(), Some("selected_admission_unavailable"))
        && (selected.admission.is_none() || selected.encounter.is_none())
    {
        return Ok((None, reason));
    }
    Ok((Some(selected), reason))
}
