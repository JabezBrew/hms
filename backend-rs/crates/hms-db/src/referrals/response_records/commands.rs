use super::*;
use sqlx::types::Json;
#[derive(FromRow)]
struct Saved {
    patient_id: Uuid,
    referral_id: Uuid,
    actor_user_id: Uuid,
    operation: String,
    payload_digest: Vec<u8>,
    result_id: Option<Uuid>,
    receipt: Option<Json<ReferralResponseReceipt>>,
}
fn validate(input: &ReferralResponseCommandRequest) -> anyhow::Result<Option<String>> {
    if input.client_request_id.is_nil()
        || input.expected_version < 0
        || input.expected_context_token.len() != 64
        || !input
            .expected_context_token
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
        || input.specialist_notes.trim().chars().count() < 10
        || input.specialist_notes.chars().take(20001).count() > 20000
        || input.recommendations.chars().take(10001).count() > 10000
    {
        return Err(ResponseError::InvalidInput.into());
    }
    let reason = input
        .amendment_reason
        .as_ref()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty());
    if reason.as_ref().is_some_and(|v| v.chars().count() > 500)
        || (input.operation == ReferralResponseCommandKind::Amend) != reason.is_some()
    {
        return Err(ResponseError::InvalidInput.into());
    }
    Ok(reason)
}
pub async fn command(
    pool: &PgPool,
    mut actor: ReferralResponseActor,
    patient: Uuid,
    id: Uuid,
    input: ReferralResponseCommandRequest,
) -> anyhow::Result<ReferralResponseReceipt> {
    let reason = validate(&input)?;
    let digest = hash(serde_json::to_vec(&input)?);
    let key_hash = hash(input.client_request_id.as_bytes());
    let operation = codec::encode(input.operation)?;
    let mut tx = pool.begin().await?;
    let r = root(&mut tx, &actor, Some(patient), id, true).await?;
    access::authority(&mut tx, &mut actor, true, false).await?;
    access::patient(&mut tx, &actor, &r, true).await?;
    hms_observability::observe_db_query("referrals.response.command.reserve", sqlx::query("INSERT INTO referral_response_commands(facility_id,request_key_hash,patient_id,referral_id,actor_user_id,operation,payload_digest) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING").bind(actor.facility_id).bind(&key_hash).bind(patient).bind(id).bind(actor.user_id).bind(&operation).bind(&digest).execute(&mut *tx)).await?;
    let saved:Saved=hms_observability::observe_db_query("referrals.response.command.existing", sqlx::query_as("SELECT patient_id,referral_id,actor_user_id,operation,payload_digest,result_id,receipt FROM referral_response_commands WHERE facility_id=$1 AND request_key_hash=$2 FOR UPDATE").bind(actor.facility_id).bind(&key_hash).fetch_one(&mut *tx)).await?;
    if saved.patient_id != patient
        || saved.referral_id != id
        || saved.actor_user_id != actor.user_id
        || saved.operation != operation
        || saved.payload_digest != digest
    {
        return Err(ResponseError::RequestConflict.into());
    }
    let saved_result_id = saved.result_id;
    if let Some(saved) = saved.receipt {
        let result = checked_receipt(
            &mut tx,
            &actor,
            &r,
            input.client_request_id,
            &operation,
            saved_result_id,
            saved.0,
        )
        .await?;
        access::deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(result);
    }
    if r.response_version != input.expected_version || r.token()? != input.expected_context_token {
        return Err(ResponseError::SourceChanged.into());
    }
    let allowed = match input.operation {
        ReferralResponseCommandKind::SaveDraft => r.can_draft(),
        ReferralResponseCommandKind::Complete => r.can_complete(),
        ReferralResponseCommandKind::Amend => r.status == "completed",
    };
    if !allowed {
        return Err(ResponseError::SourceChanged.into());
    }
    let version = r
        .response_version
        .checked_add(1)
        .ok_or(ResponseError::SourceChanged)?;
    let now: DateTime<Utc> = hms_observability::observe_db_query(
        "referrals.response.command.clock",
        sqlx::query_scalar("SELECT clock_timestamp()").fetch_one(&mut *tx),
    )
    .await?;
    let status = if input.operation == ReferralResponseCommandKind::Complete {
        "completed"
    } else {
        r.status.as_str()
    };
    let completed_at = if input.operation == ReferralResponseCommandKind::Complete {
        Some(now)
    } else {
        r.completed_at
    };
    let event = match input.operation {
        ReferralResponseCommandKind::SaveDraft => ReferralResponseVersionKind::DraftSaved,
        ReferralResponseCommandKind::Complete => ReferralResponseVersionKind::Completed,
        ReferralResponseCommandKind::Amend => ReferralResponseVersionKind::Amended,
    };
    let name: String = hms_observability::observe_db_query(
        "referrals.response.command.author",
        sqlx::query_scalar("SELECT display_name FROM users WHERE facility_id=$1 AND id=$2")
            .bind(actor.facility_id)
            .bind(actor.user_id)
            .fetch_one(&mut *tx),
    )
    .await?;
    let revision_id = Uuid::new_v4();
    hms_observability::observe_db_query("referrals.response.command.revision", sqlx::query("INSERT INTO referral_response_revisions(id,facility_id,referral_id,patient_id,version,operation,status,to_service,priority,specialist_notes,recommendations,amendment_reason,completed_at,recorded_by_user_id,recorded_by_display_name,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)").bind(revision_id).bind(actor.facility_id).bind(id).bind(patient).bind(version).bind(codec::encode(event)?).bind(status).bind(&r.to_service).bind(&r.priority).bind(&input.specialist_notes).bind(&input.recommendations).bind(reason).bind(completed_at).bind(actor.user_id).bind(name).bind(now).execute(&mut *tx)).await?;
    let updated=hms_observability::observe_db_query("referrals.response.command.root", sqlx::query("UPDATE referrals SET response_version=$3,status=$4,specialist_notes=$5,recommendations=$6,completed_at=$7,updated_at=$8 WHERE facility_id=$1 AND id=$2 AND response_version=$9").bind(actor.facility_id).bind(id).bind(version).bind(status).bind(&input.specialist_notes).bind(&input.recommendations).bind(completed_at).bind(now).bind(r.response_version).execute(&mut *tx)).await?;
    if updated.rows_affected() != 1 {
        return Err(ResponseError::SourceChanged.into());
    }
    let response = version_tx(&mut tx, &actor, &r, Some(revision_id)).await?;
    let result = ReferralResponseReceipt {
        client_request_id: input.client_request_id,
        operation: event,
        replayed: false,
        recorded_at: now,
        response,
    };
    hms_observability::observe_db_query("referrals.response.command.receipt", sqlx::query("UPDATE referral_response_commands SET result_id=$3,receipt=$4 WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(&key_hash).bind(revision_id).bind(Json(&result)).execute(&mut *tx)).await?;
    hms_observability::observe_db_query("referrals.response.command.audit", sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,'referral.response_recorded','referral',$4,jsonb_build_object('operation',$5::text,'version',$6::bigint,'status',$7::text))").bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(id).bind(codec::encode(event)?).bind(version).bind(status).execute(&mut *tx)).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
