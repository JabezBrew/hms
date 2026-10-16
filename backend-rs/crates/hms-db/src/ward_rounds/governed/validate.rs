use super::*;
use std::collections::HashSet;

fn text(value: &mut String, max: usize, required: bool) -> anyhow::Result<()> {
    *value = value.trim().to_owned();
    if (required && value.is_empty()) || value.chars().count() > max {
        return Err(WardRoundError::InvalidInput.into());
    }
    Ok(())
}
pub(super) fn normalize(
    mut input: SaveWardRoundDraftRequest,
) -> anyhow::Result<SaveWardRoundDraftRequest> {
    if input.client_request_id.is_nil()
        || input.admission_case_id.is_nil()
        || input.actions.len() > 100
        || input.ward_round_id.is_some_and(|id| id.is_nil())
        || (input.ward_round_id.is_none() && input.expected_version != 0)
        || (input.ward_round_id.is_some() && input.expected_version < 1)
    {
        return Err(WardRoundError::InvalidInput.into());
    }
    for value in [
        &mut input.note_sections.interval_history,
        &mut input.note_sections.examination,
        &mut input.note_sections.assessment,
        &mut input.note_sections.plan,
    ] {
        if let Some(value) = value {
            text(value, 8000, false)?;
        }
    }
    if input.note_sections.clinical_readiness_blockers.len() > 100 {
        return Err(WardRoundError::InvalidInput.into());
    }
    for value in &mut input.note_sections.clinical_readiness_blockers {
        text(value, 1000, true)?;
    }
    if let Some(value) = input.rendered_note.as_mut() {
        text(value, 32000, false)?;
    }
    let mut sources = HashSet::new();
    let mut lab = false;
    let mut discharge = false;
    for action in &mut input.actions {
        match action {
            WardRoundDraftActionInput::Prescription(WardRoundPrescriptionCommand::Start(p)) => {
                for (value, max) in [
                    (&mut p.medication_name, 160),
                    (&mut p.dose, 120),
                    (&mut p.route, 120),
                    (&mut p.frequency, 120),
                ] {
                    text(value, max, true)?;
                }
                text(&mut p.instructions, 4000, false)?;
                text(&mut p.reason, 2000, false)?;
                if p.frequency.eq_ignore_ascii_case("prn") {
                    return Err(WardRoundError::PrescribingPanelRequired.into());
                }
                if p.duration_days.is_some_and(|days| days <= 0)
                    || p.first_dose_at
                        .is_some_and(|at| at < p.start_date.and_hms_opt(0, 0, 0).unwrap().and_utc())
                    || p.duration_days.is_some_and(|days| {
                        p.start_date
                            .checked_add_days(chrono::Days::new(days as u64))
                            .is_none()
                    })
                {
                    return Err(WardRoundError::InvalidInput.into());
                }
            }
            WardRoundDraftActionInput::Prescription(WardRoundPrescriptionCommand::Status(p)) => {
                if p.prescription_id.is_nil()
                    || !sources.insert(p.prescription_id)
                    || p.expected_snapshot_token.len() != 64
                    || !p
                        .expected_snapshot_token
                        .bytes()
                        .all(|v| v.is_ascii_hexdigit())
                {
                    return Err(WardRoundError::InvalidInput.into());
                }
            }
            WardRoundDraftActionInput::LabOrder(p) => {
                if lab
                    || p.test_ids.len() + p.panel_ids.len() == 0
                    || p.test_ids.len() + p.panel_ids.len() > 100
                    || p.test_ids.iter().chain(&p.panel_ids).any(Uuid::is_nil)
                    || p.test_ids.iter().collect::<HashSet<_>>().len() != p.test_ids.len()
                    || p.panel_ids.iter().collect::<HashSet<_>>().len() != p.panel_ids.len()
                {
                    return Err(WardRoundError::InvalidInput.into());
                }
                lab = true;
            }
            WardRoundDraftActionInput::NursingTask(p) => {
                text(&mut p.title, 240, true)?;
                text(&mut p.instruction, 4000, true)?;
                if p.assigned_to_user_id.is_some_and(|id| id.is_nil()) {
                    return Err(WardRoundError::InvalidInput.into());
                }
            }
            WardRoundDraftActionInput::DischargeRequest(_) => {
                if discharge {
                    return Err(WardRoundError::InvalidInput.into());
                }
                discharge = true;
            }
        }
    }
    Ok(input)
}

pub(super) fn action_row(
    action: &WardRoundDraftActionInput,
) -> anyhow::Result<(
    WardRoundActionType,
    Option<String>,
    Option<String>,
    JsonValue,
)> {
    Ok(match action {
        WardRoundDraftActionInput::Prescription(p) => (
            WardRoundActionType::Prescription,
            Some(match p {
                WardRoundPrescriptionCommand::Start(p) => p.medication_name.clone(),
                WardRoundPrescriptionCommand::Status(_) => "Prescription decision".to_owned(),
            }),
            None,
            serde_json::to_value(p)?,
        ),
        WardRoundDraftActionInput::LabOrder(p) => (
            WardRoundActionType::LabOrder,
            Some("Laboratory order".to_owned()),
            None,
            serde_json::to_value(p)?,
        ),
        WardRoundDraftActionInput::NursingTask(p) => (
            WardRoundActionType::NursingTask,
            Some(p.title.clone()),
            Some(p.instruction.clone()),
            serde_json::to_value(p)?,
        ),
        WardRoundDraftActionInput::DischargeRequest(p) => (
            WardRoundActionType::DischargeRequest,
            Some("Discharge requested".to_owned()),
            None,
            serde_json::to_value(p)?,
        ),
    })
}
pub(super) fn stored(
    row: &super::super::CommitActionRow,
) -> anyhow::Result<WardRoundDraftActionInput> {
    // Earlier ambiguous payloads require a reviewed aggregate save. Compatible
    // explicit legacy inputs can still be reviewed via full detail + exact CAS.
    let value = serde_json::json!({"action_type":row.action_type,"payload":row.payload});
    serde_json::from_value(value).map_err(|_| WardRoundError::DraftReviewRequired.into())
}
