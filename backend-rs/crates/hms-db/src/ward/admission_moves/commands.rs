use super::super::task_routing;
use super::*;
use sqlx::types::Json;

pub(super) fn validate(input: &AdmissionMoveRequest) -> anyhow::Result<()> {
    let valid_token = |s: &str| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
    if input.client_request_id.is_nil()
        || input.destination_bed_id.is_nil()
        || !valid_token(&input.expected_placement_token)
        || !valid_token(&input.expected_destination_token)
        || !valid_token(&input.expected_task_membership_token)
        || input.reason != input.reason.trim()
        || !(1..=1000).contains(&input.reason.chars().count())
    {
        return Err(MoveError::InvalidInput.into());
    }
    Ok(())
}
pub async fn move_admission(
    pool: &PgPool,
    mut actor: AdmissionMoveActor,
    patient: Uuid,
    case: Uuid,
    input: AdmissionMoveRequest,
) -> anyhow::Result<AdmissionMoveReceipt> {
    validate(&input)?;
    if patient.is_nil() || case.is_nil() {
        return Err(MoveError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    let scope = access::authority(&mut tx, &mut actor).await?;
    access::patient(&mut tx, &actor, patient).await?;
    let initial = root(&mut tx, &actor, patient, case, None).await?;
    access::ward(&scope, initial.ward_id)?;
    let digest = hash(serde_json::to_vec(&input)?);
    if let Some(saved) = reads::saved(&mut tx, &actor, input.client_request_id).await? {
        if saved.payload_digest != digest {
            return Err(MoveError::RequestConflict.into());
        }
        // A receipt is evidence only: reacquire the current case and current ward scope.
        let r = root(&mut tx, &actor, patient, case, Some(false)).await?;
        access::ward(&scope, r.ward_id)?;
        let result = reads::checked(
            &mut tx,
            &actor,
            patient,
            case,
            input.client_request_id,
            saved,
        )
        .await?;
        access::deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(result);
    }
    // An original receipt is read above without creating another command.
    // New cooperating writers acquire the facility/request gate before any
    // reviewed task/resource locks or the later unique command-row insertion.
    let mut gate_material = b"hms.admission.move.request.v1".to_vec();
    gate_material.extend_from_slice(actor.facility_id.as_bytes());
    gate_material.extend_from_slice(input.client_request_id.as_bytes());
    let gate_digest = hash(gate_material);
    let gate_key = i64::from_be_bytes(
        gate_digest[..8]
            .try_into()
            .map_err(|_| MoveError::InvalidInput)?,
    );
    let acquired: bool = observe_db_query(
        "ward.moves.command.gate",
        sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
            .bind(gate_key)
            .fetch_one(&mut *tx),
    )
    .await?;
    if !acquired {
        return Err(MoveError::Busy.into());
    }
    if initial.source_token()? != input.expected_placement_token {
        return Err(MoveError::SourceChanged.into());
    }
    access::task_scope(&mut tx, &actor, &initial).await?;
    let reviewed = task_routing::read_open_routes_tx(&mut tx, actor.facility_id, case)
        .await
        .map_err(route_error)?;
    if reads::membership(&actor, &initial, &reviewed)? != input.expected_task_membership_token {
        return Err(MoveError::TasksChanged.into());
    }
    if !reviewed.is_empty() && !scope.can_route_tasks {
        return Err(MoveError::Unavailable.into());
    }
    task_routing::lock_reviewed_routes_tx(&mut tx, actor.facility_id, case, &reviewed)
        .await
        .map_err(route_error)?;
    let mut r = root(&mut tx, &actor, patient, case, Some(true)).await?;
    access::ward(&scope, r.ward_id)?;
    let fresh = task_routing::read_open_routes_tx(&mut tx, actor.facility_id, case)
        .await
        .map_err(route_error)?;
    if fresh != reviewed
        || reads::membership(&actor, &r, &fresh)? != input.expected_task_membership_token
    {
        return Err(MoveError::TasksChanged.into());
    }
    if !r.consistent() || r.source_token()? != input.expected_placement_token {
        return Err(MoveError::SourceChanged.into());
    }
    let destination =
        placement::lock_resources(&mut tx, &actor, &r, input.destination_bed_id).await?;
    access::ward(&scope, destination.ward_id)?;
    r = root(&mut tx, &actor, patient, case, None).await?;
    if !r.consistent() || r.source_token()? != input.expected_placement_token {
        return Err(MoveError::SourceChanged.into());
    }
    if destination.token(&actor, &r)? != input.expected_destination_token {
        return Err(MoveError::DestinationChanged.into());
    }
    let source = placement::current(&mut tx, &actor, &r)
        .await?
        .filter(|p| p.placement_revision == r.placement_revision)
        .ok_or(MoveError::SourceChanged)?;
    let revision = r
        .placement_revision
        .checked_add(1)
        .ok_or(MoveError::SourceChanged)?;
    let at: DateTime<Utc> = observe_db_query(
        "ward.moves.command.clock",
        sqlx::query_scalar("SELECT clock_timestamp()").fetch_one(&mut *tx),
    )
    .await?;
    access::deadline(&mut tx, &actor).await?;
    let key = hash(input.client_request_id.as_bytes());
    let reserved=observe_db_query("ward.moves.command.reserve",sqlx::query("INSERT INTO admission_move_commands(facility_id,request_key_hash,patient_id,admission_case_id,actor_user_id,payload_digest,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING").bind(actor.facility_id).bind(&key).bind(patient).bind(case).bind(actor.user_id).bind(&digest).bind(at).execute(&mut *tx)).await?;
    if reserved.rows_affected() != 1 {
        return Err(MoveError::RequestConflict.into());
    }
    let actor_name: String = observe_db_query(
        "ward.moves.command.actor_name",
        sqlx::query_scalar("SELECT display_name FROM users WHERE facility_id=$1 AND id=$2")
            .bind(actor.facility_id)
            .bind(actor.user_id)
            .fetch_one(&mut *tx),
    )
    .await?;
    let move_id = Uuid::new_v4();
    let destination_placement = AdmissionPlacementSnapshot {
        id: Uuid::new_v4(),
        placement_revision: revision,
        labels: destination.labels(),
        started_at: at,
        origin: AdmissionPlacementOrigin::Move,
        legacy_unknown_prefix: false,
    };
    let due = at
        .checked_add_signed(chrono::Duration::minutes(i64::from(r.cleaning_minutes)))
        .ok_or(MoveError::SourceChanged)?;
    let task_result = AdmissionMoveTaskResult {
        open_task_count: reviewed.len() as i64,
        routed_task_count: reviewed.len() as i64,
        cleared_assignee_count: reviewed
            .iter()
            .filter(|v| v.assigned_to_user_id.is_some())
            .count() as i64,
    };
    let movement = AdmissionMoveDetail {
        history: AdmissionMoveHistoryItem {
            id: move_id,
            patient_id: patient,
            admission_case_id: case,
            placement_revision: revision,
            moved_at: at,
            recorded_by_user_id: actor.user_id,
            recorded_by_display_name: actor_name.clone(),
            source: r.labels()?,
            destination: destination.labels(),
            routed_task_count: task_result.routed_task_count,
            cleared_assignee_count: task_result.cleared_assignee_count,
        },
        episode: AdmissionMoveEpisode {
            encounter_id: r.encounter_id,
            visit_id: r.visit_id,
            admitted_at: r.admitted_at.ok_or(MoveError::SourceChanged)?,
            status: codec::decode(&r.status)?,
        },
        source_placement: source.clone(),
        destination_placement: destination_placement.clone(),
        reason: input.reason.clone(),
        task_policy: input.task_policy,
        task_result: task_result.clone(),
        source_bed_release: AdmissionMoveBedRelease {
            status: hms_domain::ward::BedStatus::Cleaning,
            cleaning_minutes: r.cleaning_minutes,
            cleaning_due_at: due,
        },
        placement_history_partial: r.placement_history_partial,
    };
    let ids: Vec<Uuid> = reviewed.iter().map(|v| v.id).collect();
    observe_db_query("ward.moves.command.record",sqlx::query("INSERT INTO admission_moves(id,facility_id,admission_case_id,patient_id,placement_revision,actor_user_id,actor_display_name,moved_at,source_ward_id,source_bed_id,destination_ward_id,destination_bed_id,reason,source_cleaning_minutes,source_cleaning_due_at,routed_task_count,cleared_assignee_count,reviewed_task_ids,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)").bind(move_id).bind(actor.facility_id).bind(case).bind(patient).bind(revision).bind(actor.user_id).bind(actor_name).bind(at).bind(r.ward_id).bind(r.bed_id).bind(destination.ward_id).bind(destination.id).bind(&input.reason).bind(r.cleaning_minutes).bind(due).bind(task_result.routed_task_count as i32).bind(task_result.cleared_assignee_count as i32).bind(&ids).bind(Json(&movement)).execute(&mut *tx)).await?;
    let closed=observe_db_query("ward.moves.command.close_source",sqlx::query("UPDATE admission_placements SET ended_at=$3,close_kind='move',closing_move_id=$4 WHERE facility_id=$1 AND id=$2 AND ended_at IS NULL").bind(actor.facility_id).bind(source.id).bind(at).bind(move_id).execute(&mut *tx)).await?;
    if closed.rows_affected() != 1 {
        return Err(MoveError::SourceChanged.into());
    }
    observe_db_query("ward.moves.command.open_destination",sqlx::query("INSERT INTO admission_placements(id,facility_id,admission_case_id,patient_id,ward_id,bed_id,placement_revision,started_at,origin,legacy_unknown_prefix,opening_move_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'move',false,$9)").bind(destination_placement.id).bind(actor.facility_id).bind(case).bind(patient).bind(destination.ward_id).bind(destination.id).bind(revision).bind(at).bind(move_id).execute(&mut *tx)).await?;
    observe_db_query("ward.moves.command.placement",sqlx::query("UPDATE admission_cases SET ward_id=$3,bed_id=$4,placement_revision=$5,updated_at=$6 WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(case).bind(destination.ward_id).bind(destination.id).bind(revision).bind(at).execute(&mut *tx)).await?;
    observe_db_query("ward.moves.command.release_bed",sqlx::query("UPDATE beds SET status='cleaning',cleaning_due_at=$3,updated_at=$4 WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(r.bed_id).bind(due).bind(at).execute(&mut *tx)).await?;
    observe_db_query("ward.moves.command.occupy_bed",sqlx::query("UPDATE beds SET status='occupied',cleaning_due_at=NULL,updated_at=$3 WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(destination.id).bind(at).execute(&mut *tx)).await?;
    task_routing::apply_reviewed_routes_tx(
        &mut tx,
        actor.facility_id,
        case,
        patient,
        &reviewed,
        move_id,
        actor.user_id,
        at,
        destination.ward_id,
    )
    .await
    .map_err(route_error)?;
    let result = AdmissionMoveReceipt {
        client_request_id: input.client_request_id,
        replayed: false,
        recorded_at: at,
        reviewed_input: input,
        movement,
    };
    observe_db_query("ward.moves.command.receipt",sqlx::query("UPDATE admission_move_commands SET result_id=$3,receipt=$4 WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(key).bind(move_id).bind(Json(&result)).execute(&mut *tx)).await?;
    observe_db_query("ward.moves.command.audit",sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,'admission.moved','admission_case',$4,jsonb_build_object('placement_revision',$5::bigint,'routed_tasks',$6::bigint,'cleared_assignees',$7::bigint))").bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(case).bind(revision).bind(task_result.routed_task_count).bind(task_result.cleared_assignee_count).execute(&mut *tx)).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
