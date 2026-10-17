use super::*;
pub enum RoutingTransition {
    Accept(Option<String>),
    Decline(String),
}
// Routing remains a demographic purpose; it does not grant response-body reads.
pub async fn route_transition(
    pool: &PgPool,
    mut actor: ReferralResponseActor,
    id: Uuid,
    transition: RoutingTransition,
) -> anyhow::Result<ReferralListItem> {
    let mut tx = pool.begin().await?;
    let r = root(&mut tx, &actor, None, id, true).await?;
    access::authority(&mut tx, &mut actor, false, false).await?;
    access::patient(&mut tx, &actor, &r, false).await?;
    match transition {
        RoutingTransition::Accept(notes) => {
            if r.status != "sent" || notes.as_ref().is_some_and(|n| n.chars().count() > 2000) {
                return Err(ResponseError::SourceChanged.into());
            }
            hms_observability::observe_db_query("referrals.response.route.accept", sqlx::query("UPDATE referrals SET status='accepted',accepted_by_user_id=$3,acceptance_notes=$4,accepted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(id).bind(actor.user_id).bind(notes).execute(&mut *tx)).await?;
        }
        RoutingTransition::Decline(reason) => {
            if !matches!(r.status.as_str(), "sent" | "accepted")
                || reason.trim().is_empty()
                || reason.chars().count() > 2000
            {
                return Err(ResponseError::SourceChanged.into());
            }
            hms_observability::observe_db_query("referrals.response.route.decline", sqlx::query("UPDATE referrals SET status='declined',decline_reason=$3,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(id).bind(reason).execute(&mut *tx)).await?;
        }
    }
    hms_observability::observe_db_query("referrals.response.route.audit", sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,'referral.routing_changed','referral',$4,'{}')").bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(id).execute(&mut *tx)).await?;
    let result = hms_observability::observe_db_query(
        "referrals.response.route.projection",
        super::super::referral_query()
            .push(" WHERE referrals.facility_id = ")
            .push_bind(actor.facility_id)
            .push(" AND referrals.id = ")
            .push_bind(id)
            .build_query_as::<super::super::ReferralRow>()
            .fetch_one(&mut *tx),
    )
    .await?;
    let result = super::super::referral_from_row(result)?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn schedule(
    pool: &PgPool,
    mut actor: ReferralResponseActor,
    id: Uuid,
    input: ScheduleReferralAppointmentRequest,
) -> anyhow::Result<ReferralListItem> {
    let mut tx = pool.begin().await?;
    let r = root(&mut tx, &actor, None, id, true).await?;
    access::authority(&mut tx, &mut actor, false, true).await?;
    access::patient(&mut tx, &actor, &r, false).await?;
    if !matches!(r.status.as_str(), "sent" | "accepted") || input.ends_at <= input.starts_at {
        return Err(ResponseError::SourceChanged.into());
    }
    let manual = input
        .manual_booking_reason
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    if (input.session_id.is_none() && manual.is_none())
        || manual.is_some_and(|v| v.chars().count() > 1000)
        || input
            .overbook_reason
            .as_ref()
            .is_some_and(|v| v.trim().is_empty() || v.chars().count() > 1000)
    {
        return Err(ResponseError::InvalidInput.into());
    }
    // Scope every explicit FK before the shared booking implementation. Its
    // capacity/session/practitioner locks and histories remain authoritative.
    let session_clinic = if let Some(session) = input.session_id {
        let row: Option<Option<Uuid>> = hms_observability::observe_db_query(
            "referrals.response.schedule.session",
            sqlx::query_scalar(
                "SELECT clinic_id FROM clinic_sessions WHERE facility_id=$1 AND id=$2 FOR UPDATE",
            )
            .bind(actor.facility_id)
            .bind(session)
            .fetch_optional(&mut *tx),
        )
        .await?;
        Some(row.ok_or(ResponseError::SourceChanged)?)
    } else {
        None
    };
    if let (Some(clinic), Some(Some(expected))) = (input.clinic_id, session_clinic) {
        if clinic != expected {
            return Err(ResponseError::InvalidInput.into());
        }
    }
    let clinic = input.clinic_id.or(session_clinic.flatten());
    if let Some(clinic) = clinic {
        let found: Option<Uuid> = hms_observability::observe_db_query(
            "referrals.response.schedule.clinic",
            sqlx::query_scalar(
                "SELECT id FROM clinics WHERE facility_id=$1 AND id=$2 AND is_active FOR SHARE",
            )
            .bind(actor.facility_id)
            .bind(clinic)
            .fetch_optional(&mut *tx),
        )
        .await?;
        if found.is_none() {
            return Err(ResponseError::SourceChanged.into());
        }
    }
    if let Some(service) = input.service_id {
        let found:Option<Uuid>=hms_observability::observe_db_query("referrals.response.schedule.service", sqlx::query_scalar("SELECT id FROM appointment_types WHERE facility_id=$1 AND id=$2 AND is_active FOR SHARE").bind(actor.facility_id).bind(service).fetch_optional(&mut *tx)).await?;
        if found.is_none() {
            return Err(ResponseError::SourceChanged.into());
        }
    }
    if let Some(user) = input.practitioner_user_id {
        let found:Option<Uuid>=hms_observability::observe_db_query("referrals.response.schedule.practitioner", sqlx::query_scalar("SELECT u.id FROM users u JOIN staff_profiles s ON s.user_id=u.id AND s.facility_id=u.facility_id JOIN practitioner_profiles p ON p.staff_id=s.id AND p.facility_id=s.facility_id WHERE u.facility_id=$1 AND u.id=$2 AND u.is_active FOR SHARE OF u,s,p").bind(actor.facility_id).bind(user).fetch_optional(&mut *tx)).await?;
        if found.is_none() {
            return Err(ResponseError::SourceChanged.into());
        }
    }
    let appointment = crate::care::create_booked_appointment_in_transaction(
        pool,
        &mut tx,
        crate::care::NewBookedAppointment {
            id: Uuid::new_v4(),
            facility_id: actor.facility_id,
            patient_id: r.patient_id,
            clinic_id: clinic,
            clinic_session_id: input.session_id,
            appointment_type_id: input.service_id,
            practitioner_user_id: input.practitioner_user_id,
            starts_at: input.starts_at,
            ends_at: input.ends_at,
            overbook_reason: input.overbook_reason,
            series_id: None,
            created_by_user_id: actor.user_id,
        },
    )
    .await?;
    if let Some(reason) = manual {
        crate::care::insert_appointment_history(
            &mut tx,
            actor.facility_id,
            appointment.id,
            "manual_booked",
            actor.user_id,
            Some(reason),
            None,
            None,
            Some(appointment.starts_at),
            Some(appointment.ends_at),
        )
        .await?;
    }
    hms_observability::observe_db_query("referrals.response.schedule.root", sqlx::query("UPDATE referrals SET status='scheduled',scheduled_appointment_id=$3,scheduled_by_user_id=$4,scheduled_at=clock_timestamp(),updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(id).bind(appointment.id).bind(actor.user_id).execute(&mut *tx)).await?;
    hms_observability::observe_db_query("referrals.response.schedule.audit", sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,'referral.scheduled','referral',$4,jsonb_build_object('appointment_id',$5::uuid))").bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(id).bind(appointment.id).execute(&mut *tx)).await?;
    let result = hms_observability::observe_db_query(
        "referrals.response.schedule.projection",
        super::super::referral_query()
            .push(" WHERE referrals.facility_id = ")
            .push_bind(actor.facility_id)
            .push(" AND referrals.id = ")
            .push_bind(id)
            .build_query_as::<super::super::ReferralRow>()
            .fetch_one(&mut *tx),
    )
    .await?;
    let result = super::super::referral_from_row(result)?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
