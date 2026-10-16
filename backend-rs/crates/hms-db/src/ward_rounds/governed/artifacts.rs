use super::*;
use crate::clinical::prescription_courses::{details_tx, PrescriptionDocumentation};
use hms_domain::clinical::{PrescriptionDetail, PrescriptionStatus, UpdatePrescriptionRequest};
use std::collections::{BTreeMap, BTreeSet};

pub(super) async fn lock_prescriptions(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    patient: Uuid,
    actions: &[WardRoundDraftActionInput],
) -> anyhow::Result<()> {
    let ids: Vec<Uuid> = actions
        .iter()
        .filter_map(|a| match a {
            WardRoundDraftActionInput::Prescription(WardRoundPrescriptionCommand::Status(p)) => {
                Some(p.prescription_id)
            }
            _ => None,
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if !ids.is_empty() {
        let found: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM prescriptions WHERE facility_id=$1 AND patient_id=$2 AND id=ANY($3) ORDER BY id FOR UPDATE")
            .bind(actor.facility_id).bind(patient).bind(&ids).fetch_all(&mut **tx).await?;
        if found != ids {
            return Err(WardRoundError::SourceChanged.into());
        }
    }
    Ok(())
}

/// Different prescriptions can share a PRN safety group. Lock it before admission,
/// matching request/supply/outcome writers even when this round also requests discharge.
pub(super) async fn lock_groups(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    patient: Uuid,
    actions: &[WardRoundDraftActionInput],
) -> anyhow::Result<()> {
    let sources: Vec<Uuid> = actions
        .iter()
        .filter_map(|a| match a {
            WardRoundDraftActionInput::Prescription(WardRoundPrescriptionCommand::Status(p)) => {
                Some(p.prescription_id)
            }
            _ => None,
        })
        .collect();
    if !sources.is_empty() {
        sqlx::query("SELECT g.id FROM prescription_prn_safety_groups g WHERE g.facility_id=$1 AND g.patient_id=$2 AND EXISTS(SELECT 1 FROM prescriptions p WHERE p.facility_id=g.facility_id AND p.patient_id=g.patient_id AND p.prn_safety_group_id=g.id AND p.id=ANY($3)) ORDER BY g.id FOR UPDATE")
            .bind(actor.facility_id).bind(patient).bind(&sources).execute(&mut **tx).await?;
    }
    Ok(())
}

pub(super) struct PreparedSources {
    pub prescriptions: BTreeMap<Uuid, PrescriptionDetail>,
    pub laboratory: Option<PreparedLab>,
    pub targets: Vec<Vec<WardRoundReviewedTarget>>,
}
pub(super) struct PreparedLab {
    pub tests: Vec<Uuid>,
    pub targets: Vec<WardRoundReviewedTarget>,
}
pub(super) async fn prepare(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    actions: &[WardRoundDraftActionInput],
) -> anyhow::Result<PreparedSources> {
    let ids: Vec<Uuid> = actions
        .iter()
        .filter_map(|a| match a {
            WardRoundDraftActionInput::Prescription(WardRoundPrescriptionCommand::Status(p)) => {
                Some(p.prescription_id)
            }
            _ => None,
        })
        .collect();
    let prescriptions = if ids.is_empty() {
        BTreeMap::new()
    } else {
        details_tx(tx, actor.facility_id, &ids)
            .await?
            .into_iter()
            .map(|p| (p.prescription.id, p))
            .collect()
    };
    let mut laboratory = None;
    let mut targets = Vec::with_capacity(actions.len());
    for action in actions {
        let value = match action {
            WardRoundDraftActionInput::Prescription(WardRoundPrescriptionCommand::Status(p)) => {
                let source = prescriptions
                    .get(&p.prescription_id)
                    .ok_or(WardRoundError::SourceChanged)?;
                if source.snapshot_token != p.expected_snapshot_token {
                    return Err(WardRoundError::SourceChanged.into());
                }
                let source = &source.prescription;
                if matches!(
                    source.status,
                    PrescriptionStatus::Stopped | PrescriptionStatus::Completed
                ) && source.status != p.status
                {
                    return Err(WardRoundError::PrescriptionClosed.into());
                }
                vec![WardRoundReviewedTarget {
                    resource_type: WardRoundTargetType::Prescription,
                    resource_id: source.id,
                    display_name: source.medication_name.clone(),
                    code: None,
                    selected: true,
                    prescription: Some(WardRoundPrescriptionReview {
                        medication_name: source.medication_name.clone(),
                        dose: source.dose.clone(),
                        route: source.route.clone(),
                        frequency: source.frequency.clone(),
                        status: source.status,
                    }),
                }]
            }
            WardRoundDraftActionInput::LabOrder(p) => {
                let lab = lab_tests(tx, actor, p).await?;
                let targets = lab.targets.clone();
                laboratory = Some(lab);
                targets
            }
            _ => Vec::new(),
        };
        targets.push(value);
    }
    Ok(PreparedSources {
        prescriptions,
        laboratory,
        targets,
    })
}

/// Reserve/lock the discharge source BEFORE admission, matching canonical case -> admission writers.
/// A provisional insert is rolled back on any later authorization or context failure.
pub(super) async fn discharge_source(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    patient: Uuid,
    admission: Uuid,
    actions: &[WardRoundDraftActionInput],
) -> anyhow::Result<Option<Uuid>> {
    if !actions
        .iter()
        .any(|a| matches!(a, WardRoundDraftActionInput::DischargeRequest(_)))
    {
        return Ok(None);
    }
    sqlx::query("INSERT INTO discharge_cases(id,facility_id,patient_id,admission_case_id,status,created_by_user_id) VALUES($1,$2,$3,$4,'requested',$5) ON CONFLICT(admission_case_id) DO NOTHING")
        .bind(Uuid::new_v4()).bind(actor.facility_id).bind(patient).bind(admission).bind(actor.user_id).execute(&mut **tx).await?;
    let row: Option<(Uuid,String,Uuid)> = sqlx::query_as("SELECT id,status,patient_id FROM discharge_cases WHERE facility_id=$1 AND admission_case_id=$2 FOR UPDATE")
        .bind(actor.facility_id).bind(admission).fetch_optional(&mut **tx).await?;
    let (id, status, p) = row.ok_or(WardRoundError::ContextChanged)?;
    if p != patient || status != "requested" {
        return Err(WardRoundError::DischargeReviewRequired.into());
    }
    Ok(Some(id))
}

async fn lab_tests(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    p: &WardRoundLabOrderInput,
) -> anyhow::Result<PreparedLab> {
    let mut panels = p.panel_ids.clone();
    panels.sort();
    let panel_rows:Vec<(Uuid,String,String)>=sqlx::query_as("SELECT id,name,code FROM lab_panels WHERE facility_id=$1 AND is_active AND id=ANY($2) ORDER BY id FOR SHARE").bind(actor.facility_id).bind(&panels).fetch_all(&mut **tx).await?;
    if panel_rows.iter().map(|r| r.0).collect::<Vec<_>>() != panels {
        return Err(WardRoundError::CatalogChanged.into());
    }
    // A panel with >500 distinct members cannot fit the governed expansion. Bound
    // each indexed panel read before materializing imported catalog memberships.
    let members:Vec<(Uuid,Uuid)>=sqlx::query_as("SELECT selected.id,m.test_id FROM unnest($1::uuid[]) selected(id) CROSS JOIN LATERAL (SELECT test_id FROM lab_panel_tests WHERE panel_id=selected.id ORDER BY test_id LIMIT 501 FOR SHARE) m ORDER BY selected.id,m.test_id").bind(&panels).fetch_all(&mut **tx).await?;
    if panels
        .iter()
        .any(|id| !members.iter().any(|(panel, _)| panel == id))
    {
        return Err(WardRoundError::CatalogChanged.into());
    }
    let ids: Vec<Uuid> = p
        .test_ids
        .iter()
        .copied()
        .chain(members.into_iter().map(|(_, test)| test))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if ids.is_empty() || ids.len() > 500 {
        return Err(WardRoundError::CatalogChanged.into());
    }
    let rows:Vec<(Uuid,String,String)>=sqlx::query_as("SELECT id,name,code FROM lab_tests WHERE facility_id=$1 AND is_active AND id=ANY($2) ORDER BY id FOR SHARE").bind(actor.facility_id).bind(&ids).fetch_all(&mut **tx).await?;
    if rows.iter().map(|r| r.0).collect::<Vec<_>>() != ids {
        return Err(WardRoundError::CatalogChanged.into());
    }
    let mut targets: Vec<WardRoundReviewedTarget> = panel_rows
        .into_iter()
        .map(|(id, name, code)| WardRoundReviewedTarget {
            resource_type: WardRoundTargetType::LabPanel,
            resource_id: id,
            display_name: name,
            code: Some(code),
            selected: true,
            prescription: None,
        })
        .collect();
    targets.extend(
        rows.into_iter()
            .map(|(id, name, code)| WardRoundReviewedTarget {
                resource_type: WardRoundTargetType::LabTest,
                resource_id: id,
                display_name: name,
                code: Some(code),
                selected: p.test_ids.contains(&id),
                prescription: None,
            }),
    );
    Ok(PreparedLab {
        tests: ids,
        targets,
    })
}

pub(super) async fn commit(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    patient: Uuid,
    admission: &GovernedAdmission,
    action_id: Uuid,
    input: &WardRoundDraftActionInput,
    discharge: Option<Uuid>,
    prepared: &PreparedSources,
) -> anyhow::Result<super::super::CreatedArtifact> {
    let (resource_type, resource_id, title) = match input {
        WardRoundDraftActionInput::Prescription(WardRoundPrescriptionCommand::Start(p)) => {
            let row = crate::clinical::insert_prescription_in_transaction(
                tx,
                crate::clinical::NewPrescription {
                    id: Uuid::new_v4(),
                    facility_id: actor.facility_id,
                    patient_id: patient,
                    encounter_id: admission.encounter_id,
                    visit_id: admission.visit_id,
                    discharge_case_id: None,
                    medication_name: p.medication_name.clone(),
                    dose: p.dose.clone(),
                    route: p.route.clone(),
                    frequency: p.frequency.clone(),
                    inventory_item_id: None,
                    start_date: Some(p.start_date),
                    duration_days: p.duration_days,
                    first_dose_at: p.first_dose_at,
                    actor_user_id: actor.user_id,
                },
                None,
                PrescriptionDocumentation {
                    instructions: p.instructions.clone(),
                    reason: p.reason.clone(),
                },
                None,
                None,
            )
            .await?;
            clinical_audit(tx, actor, row.id, "prescription.created").await?;
            ("prescription", row.id, row.medication_name)
        }
        WardRoundDraftActionInput::Prescription(WardRoundPrescriptionCommand::Status(p)) => {
            let current = prepared
                .prescriptions
                .get(&p.prescription_id)
                .ok_or(WardRoundError::SourceChanged)?;
            if current.prescription.status != p.status {
                crate::clinical::update_prescription_in_transaction(
                    tx,
                    actor.facility_id,
                    p.prescription_id,
                    Some(patient),
                    UpdatePrescriptionRequest {
                        medication_name: None,
                        dose: None,
                        route: None,
                        frequency: None,
                        inventory_item_id: None,
                        start_date: None,
                        duration_days: None,
                        first_dose_at: None,
                        status: Some(p.status),
                    },
                )
                .await?
                .ok_or(WardRoundError::SourceChanged)?;
                clinical_audit(tx, actor, p.prescription_id, "prescription.status.changed").await?;
            }
            (
                "prescription",
                p.prescription_id,
                current.prescription.medication_name.clone(),
            )
        }
        WardRoundDraftActionInput::LabOrder(p) => {
            let tests = &prepared
                .laboratory
                .as_ref()
                .ok_or(WardRoundError::CatalogChanged)?
                .tests;
            let id = Uuid::new_v4();
            sqlx::query("INSERT INTO lab_orders(id,facility_id,patient_id,encounter_id,visit_id,priority,status,ordered_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'ordered',$7)")
                .bind(id).bind(actor.facility_id).bind(patient).bind(admission.encounter_id).bind(admission.visit_id).bind(codec::encode(p.priority)?).bind(actor.user_id).execute(&mut **tx).await?;
            sqlx::query(
                "INSERT INTO lab_order_tests(order_id,test_id) SELECT $1,unnest($2::uuid[])",
            )
            .bind(id)
            .bind(tests)
            .execute(&mut **tx)
            .await?;
            audit_resource(tx, actor, id, "laboratory.order.created", "lab_order").await?;
            ("lab_order", id, "Laboratory order".to_owned())
        }
        WardRoundDraftActionInput::NursingTask(p) => {
            // The phase9 actor/ward/assignee policy has already been verified under these locks.
            let old = super::super::CommitActionRow {
                id: action_id,
                action_type: "nursing_task".into(),
                title: Some(p.title.clone()),
                instruction: Some(p.instruction.clone()),
                payload: serde_json::to_value(p)?,
                reviewed_targets: None,
            };
            let value = super::super::commit_nursing_task_action(
                tx,
                actor.facility_id,
                patient,
                &admission.scope(),
                &old,
                actor.user_id,
            )
            .await?;
            crate::ward::nursing_access::audit(
                tx,
                &access::nursing_actor(actor),
                value.resource_id,
                "nursing.task.created",
                "nursing_task",
            )
            .await?;
            return Ok(value);
        }
        WardRoundDraftActionInput::DischargeRequest(_) => {
            let id = discharge.ok_or(WardRoundError::ContextChanged)?;
            sqlx::query("UPDATE discharge_cases SET encounter_id=COALESCE(encounter_id,$3),visit_id=COALESCE(visit_id,$4),updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2 AND status='requested'")
                .bind(actor.facility_id).bind(id).bind(admission.encounter_id).bind(admission.visit_id).execute(&mut **tx).await?;
            sqlx::query("UPDATE admission_cases SET status='discharge_pending',updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(admission.id).execute(&mut **tx).await?;
            audit_resource(tx, actor, id, "discharge.requested", "discharge_case").await?;
            ("discharge_case", id, "Discharge requested".to_owned())
        }
    };
    Ok(super::super::CreatedArtifact {
        action_id,
        resource_type: resource_type.to_owned(),
        resource_id,
        title,
    })
}
async fn clinical_audit(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    id: Uuid,
    event: &str,
) -> anyhow::Result<()> {
    audit_resource(tx, actor, id, event, "prescription").await
}
async fn audit_resource(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    id: Uuid,
    event: &str,
    resource: &str,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb)")
        .bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(event).bind(resource).bind(id).execute(&mut **tx).await?;
    Ok(())
}
