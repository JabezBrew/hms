use super::*;
use hms_domain::care::{EncounterStatus, EncounterType, VisitStatus};
#[derive(FromRow)]
struct Saved {
    patient_id: Uuid,
    referral_id: Uuid,
    actor_user_id: Uuid,
    payload_digest: Vec<u8>,
    receipt: Option<Json<ReferralConsultationStartReceipt>>,
}
fn normalize(
    mut input: ReferralConsultationStartRequest,
) -> anyhow::Result<ReferralConsultationStartRequest> {
    if input.client_request_id.is_nil()
        || input.expected_link_version != 0
        || input.expected_context_token.len() != 64
        || !input
            .expected_context_token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(ConsultationError::InvalidInput.into());
    }
    match &input.source {
        ReferralConsultationSource::NewOutpatient {
            visit: ReferralConsultationVisitChoice::ExistingVisit { visit_id },
        } if visit_id.is_nil() => return Err(ConsultationError::InvalidInput.into()),
        ReferralConsultationSource::ExistingAdmissionEncounter {
            admission_case_id,
            encounter_id,
        } if admission_case_id.is_nil() || encounter_id.is_nil() => {
            return Err(ConsultationError::InvalidInput.into())
        }
        _ => {}
    }
    if let Some(v) = input.restricted_record_override.as_mut() {
        v.reason_code = v.reason_code.trim().to_owned();
        v.reason_note = v
            .reason_note
            .take()
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty());
        if v.reason_code.is_empty()
            || v.reason_code.len() > 64
            || v.reason_note.as_ref().is_some_and(|v| v.len() > 500)
        {
            return Err(ConsultationError::InvalidInput.into());
        }
    }
    Ok(input)
}
fn reviewed(input: &ReferralConsultationStartRequest) -> ReferralConsultationReviewedInput {
    ReferralConsultationReviewedInput {
        client_request_id: input.client_request_id,
        expected_link_version: input.expected_link_version,
        expected_context_token: input.expected_context_token.clone(),
        source: input.source.clone(),
        restricted_record_override: input.restricted_record_override.as_ref().map(|v| {
            ReferralConsultationOverrideEvidence {
                reason_code: v.reason_code.clone(),
                reason_note_present: v.reason_note.is_some(),
            }
        }),
    }
}
pub async fn start(
    pool: &PgPool,
    mut actor: ConsultationActor,
    patient_id: Uuid,
    id: Uuid,
    input: ReferralConsultationStartRequest,
) -> anyhow::Result<ReferralConsultationStartReceipt> {
    let input = normalize(input)?;
    let payload = digest(&input)?;
    let key = hash(input.client_request_id.as_bytes());
    let mut tx = pool.begin().await?;
    let r = root(&mut tx, &actor, patient_id, id, true).await?;
    let scope = access::authority(&mut tx, &mut actor).await?;
    let patient = access::patient(&mut tx, &actor, &r).await?;
    if !scope.can_issue || (input.restricted_record_override.is_some() && !scope.can_override) {
        return Err(ConsultationError::Unavailable.into());
    }
    // Serialize the exact facility/request reference before its unique insert.
    // Different referrals never wait on an in-flight command's unique index.
    let mut gate_material = b"hms.referral.consultation.start.request.v1".to_vec();
    gate_material.extend_from_slice(actor.facility_id.as_bytes());
    gate_material.extend_from_slice(&key);
    let gate_digest = hash(gate_material);
    let gate_key = i64::from_be_bytes(
        gate_digest[..8]
            .try_into()
            .map_err(|_| ConsultationError::InvalidInput)?,
    );
    let acquired: bool = observe_db_query(
        "referrals.consultation.command.gate",
        sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
            .bind(gate_key)
            .fetch_one(&mut *tx),
    )
    .await?;
    if !acquired {
        return Err(ConsultationError::Busy.into());
    }
    observe_db_query("referrals.consultation.command.reserve",sqlx::query("INSERT INTO referral_consultation_start_commands(facility_id,request_key_hash,patient_id,referral_id,actor_user_id,payload_digest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING").bind(actor.facility_id).bind(&key).bind(patient_id).bind(id).bind(actor.user_id).bind(&payload).execute(&mut *tx)).await?;
    let saved:Saved=observe_db_query("referrals.consultation.command.existing",sqlx::query_as("SELECT patient_id,referral_id,actor_user_id,payload_digest,receipt FROM referral_consultation_start_commands WHERE facility_id=$1 AND request_key_hash=$2 FOR UPDATE NOWAIT").bind(actor.facility_id).bind(&key).fetch_one(&mut *tx)).await.map_err(lock_error)?;
    if saved.patient_id != patient_id
        || saved.referral_id != id
        || saved.actor_user_id != actor.user_id
        || saved.payload_digest != payload
    {
        return Err(ConsultationError::RequestConflict.into());
    }
    if let Some(v) = saved.receipt {
        let mut result = v.0;
        if result.client_request_id != input.client_request_id
            || result.input_digest != hex(&payload)
            || result.link.recorded_by_user_id != actor.user_id
            || link(&mut tx, &actor, &r)
                .await?
                .as_ref()
                .map(serde_json::to_value)
                .transpose()?
                != Some(serde_json::to_value(&result.link)?)
        {
            return Err(ConsultationError::SourceChanged.into());
        }
        result.replayed = true;
        access::deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(result);
    }
    let context = context_tx(
        &mut tx,
        &actor,
        &r,
        &scope,
        &patient,
        Some(input.source.clone()),
    )
    .await?;
    if !context.can_start
        || context.link_version != input.expected_link_version
        || context.context_token != input.expected_context_token
    {
        return Err(ConsultationError::SourceChanged.into());
    }
    let selection = context.selection.ok_or(ConsultationError::SourceChanged)?;
    if selection.restricted_override_required != input.restricted_record_override.is_some()
        || selection.restricted_override_required && !scope.can_override
    {
        return Err(ConsultationError::InvalidInput.into());
    }
    let now: DateTime<Utc> = observe_db_query(
        "referrals.consultation.command.clock",
        sqlx::query_scalar("SELECT clock_timestamp()").fetch_one(&mut *tx),
    )
    .await?;
    let (
        encounter_id,
        visit_id,
        admission_case_id,
        encounter_created,
        encounter_type,
        encounter_started_at,
        admitted_at,
        placement,
        transition,
    ) = match &input.source {
        ReferralConsultationSource::NewOutpatient { visit } => {
            let visit_id = match visit {
                ReferralConsultationVisitChoice::NoVisit => None,
                ReferralConsultationVisitChoice::ExistingVisit { visit_id } => Some(*visit_id),
            };
            let transition = if let Some(v) = selection.visit.as_ref() {
                crate::care::lifecycle::promote_visit_to_consultation_tx(
                    &mut tx,
                    actor.facility_id,
                    patient_id,
                    v.id,
                    v.status,
                    now,
                )
                .await?;
                observe_db_query("referrals.consultation.visit.audit",sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,'visit.consultation_started','visit',$4,jsonb_build_object('before_status',$5::text,'after_status','in_consultation','source','referral_consultation'))").bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(v.id).bind(codec::encode(v.status)?).execute(&mut *tx)).await?;
                Some(ReferralConsultationVisitTransition {
                    visit_id: v.id,
                    before_status: v.status,
                    after_status: VisitStatus::InConsultation,
                })
            } else {
                None
            };
            let encounter = Uuid::new_v4();
            observe_db_query("referrals.consultation.encounter.create",sqlx::query("INSERT INTO encounters(id,facility_id,patient_id,visit_id,encounter_type,status,started_at,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,'outpatient','in_progress',$5,$6,$5,$5)").bind(encounter).bind(actor.facility_id).bind(patient_id).bind(visit_id).bind(now).bind(actor.user_id).execute(&mut *tx)).await?;
            (
                encounter,
                visit_id,
                None,
                true,
                EncounterType::Outpatient,
                now,
                None,
                None,
                transition,
            )
        }
        ReferralConsultationSource::ExistingAdmissionEncounter {
            admission_case_id,
            encounter_id,
        } => {
            let e = selection
                .encounter
                .as_ref()
                .ok_or(ConsultationError::SourceChanged)?;
            let c = selection
                .admission
                .as_ref()
                .ok_or(ConsultationError::SourceChanged)?;
            (
                *encounter_id,
                e.visit_id,
                Some(*admission_case_id),
                false,
                e.encounter_type,
                e.started_at,
                Some(c.admitted_at),
                Some(c.placement_revision),
                None,
            )
        }
    };
    let display: String = observe_db_query(
        "referrals.consultation.command.actor",
        sqlx::query_scalar("SELECT display_name FROM users WHERE facility_id=$1 AND id=$2")
            .bind(actor.facility_id)
            .bind(actor.user_id)
            .fetch_one(&mut *tx),
    )
    .await?;
    let link = ReferralConsultationStart {
        appointment_at_start: selection.appointment.clone(),
        id: Uuid::new_v4(),
        patient_id,
        referral_id: id,
        link_version: 1,
        source_mode: if encounter_created {
            "new_outpatient"
        } else {
            "existing_admission_encounter"
        }
        .to_owned(),
        encounter_id,
        visit_id,
        admission_case_id,
        scheduled_appointment_id: r.scheduled_appointment_id,
        encounter_created,
        encounter_type,
        encounter_status_at_start: EncounterStatus::InProgress,
        encounter_started_at,
        admission_admitted_at: admitted_at,
        admission_placement_revision_at_start: placement,
        source_referral_status: codec::decode(&r.status)?,
        resulting_referral_status: codec::decode(&r.status)?,
        visit_transition: transition,
        recorded_by_user_id: actor.user_id,
        recorded_by_practitioner_profile_id: scope
            .practitioner
            .ok_or(ConsultationError::Unavailable)?,
        recorded_by_display_name: display,
        recorded_at: now,
    };
    observe_db_query("referrals.consultation.link.create",sqlx::query("INSERT INTO referral_consultation_starts(id,facility_id,patient_id,referral_id,encounter_id,visit_id,admission_case_id,actor_user_id,practitioner_profile_id,source_mode,recorded_at,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)").bind(link.id).bind(actor.facility_id).bind(patient_id).bind(id).bind(encounter_id).bind(visit_id).bind(admission_case_id).bind(actor.user_id).bind(link.recorded_by_practitioner_profile_id).bind(&link.source_mode).bind(now).bind(Json(&link)).execute(&mut *tx)).await?;
    let receipt = ReferralConsultationStartReceipt {
        client_request_id: input.client_request_id,
        replayed: false,
        recorded_at: now,
        input_digest: hex(&payload),
        reviewed_input: reviewed(&input),
        link,
    };
    observe_db_query("referrals.consultation.command.finish",sqlx::query("UPDATE referral_consultation_start_commands SET result_id=$3,receipt=$4 WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(&key).bind(receipt.link.id).bind(Json(&receipt)).execute(&mut *tx)).await?;
    if let Some(v) = input.restricted_record_override.as_ref() {
        observe_db_query("referrals.consultation.override.audit",sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,'patient.identity.record_override','patient',$4,jsonb_build_object('reason_code',$5::text,'reason_note_present',$6::boolean,'source','referral_consultation'))").bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(patient_id).bind(&v.reason_code).bind(v.reason_note.is_some()).execute(&mut *tx)).await?;
    }
    observe_db_query("referrals.consultation.start.audit",sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,'referral.consultation_started','referral',$4,jsonb_build_object('source_mode',$5::text,'encounter_created',$6::boolean,'link_version',1))").bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(id).bind(&receipt.link.source_mode).bind(encounter_created).execute(&mut *tx)).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(receipt)
}
