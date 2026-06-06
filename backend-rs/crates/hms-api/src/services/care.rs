use base64::Engine;
use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_access::AccessSubject;
use hms_db::care::{
    AppointmentFilters, AppointmentUpdate, CareAreaIntakeIdempotencyRecord, CareAreaIntakeKind,
    CareCursor, ClinicUpdate, CompleteCareAreaIntakeIdempotencyKey, EncounterFilters,
    EncounterUpdate, NewBookedAppointment, NewCareAreaIntakeIdempotencyKey, NewCareTeamAssignment,
    NewClinic, NewEncounter, NewTriage, NewVisit, TriageFilters, VisitFilters,
};
use hms_db::patients::{PatientContextFilters, PatientRecordOverrideAudit};
use hms_db::ward::NewAdmissionCase;
use hms_domain::care::{
    AppointmentListItem, AppointmentListQuery, AppointmentTypeListItem, AssignTriageRequest,
    CancelAppointmentRequest, CareAreaEmergencyMyWork, CareAreaInpatientMyWork,
    CareAreaMyWorkResponse, CareAreaOutpatientMyWork, CareAreaPatientContextMyWork,
    CareTeamAssignment, CheckInVisitRequest, ClinicListItem, CreateAppointmentRequest,
    CreateCareTeamAssignmentRequest, CreateClinicRequest, CreateEncounterRequest,
    CreateTriageRequest, CursorListQuery, EmergencyIntakeRequest, EmergencyIntakeResponse,
    EncounterListItem, EncounterListQuery, EncounterStatus, InpatientIntakeRequest,
    InpatientIntakeResponse, OutpatientIntakeRequest, OutpatientIntakeResponse,
    SpecialRecordOverride, TriageAssessmentRequest, TriageListItem, TriageListQuery, TriageStatus,
    UpdateAppointmentRequest, UpdateClinicRequest, UpdateEncounterRequest, VisitListItem,
    VisitListQuery, VisitStatus,
};
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::{PatientRecord, PatientRecordStatus, PatientVitalStatus};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const MAX_TRIAGE_NOTES_LEN: usize = 4_000;
const MAX_CLINIC_CODE_LEN: usize = 48;
const MAX_CLINIC_NAME_LEN: usize = 160;
const MY_WORK_PREVIEW_LIMIT: usize = 5;
const MAX_RECORD_OVERRIDE_REASON_LEN: usize = 500;
const MAX_CARE_INTAKE_IDEMPOTENCY_KEY_LEN: usize = 128;

#[derive(Clone)]
pub struct CareService {
    state: AppState,
}

#[derive(Clone, Debug)]
struct CareIntakeIdempotencyReservation {
    care_area: CareAreaIntakeKind,
    key_hash: String,
    request_fingerprint: String,
}

#[derive(Clone, Debug)]
enum CareIntakeIdempotencyStart {
    Reserved(CareIntakeIdempotencyReservation),
    Replay(CareAreaIntakeIdempotencyRecord),
}

impl CareService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn my_work(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<CareAreaMyWorkResponse>, ApiError> {
        let facility_id = self.facility_id();
        let can_outpatient = can_access_workflow(ctx, facility_id, PermissionCode::AppointmentView);
        let can_inpatient = can_access_workflow(ctx, facility_id, PermissionCode::WardView);
        let can_emergency =
            can_access_workflow(ctx, facility_id, PermissionCode::NursingTaskManage);
        let can_patient_context =
            can_access_workflow(ctx, facility_id, PermissionCode::PatientDemographicsView);

        if !(can_outpatient || can_inpatient || can_emergency || can_patient_context) {
            return Err(ApiError::forbidden(
                "patient_access_denied",
                "You do not have access to clinical work areas.",
            ));
        }

        let today = Utc::now().date_naive();
        let preview_fetch_limit = MY_WORK_PREVIEW_LIMIT as i64 + 1;

        let (appointments, has_more_appointments, active_visits, has_more_active_visits) =
            if can_outpatient {
                let appointments = hms_db::care::list_appointments(
                    self.pool(),
                    facility_id,
                    None,
                    AppointmentFilters {
                        date: Some(today),
                        clinic_id: None,
                        practitioner_user_id: Some(ctx.user_id),
                        status: None,
                        search: None,
                    },
                    preview_fetch_limit,
                )
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "my_work_outpatient_failed",
                        "Outpatient work could not be loaded.",
                    )
                })?;
                let visits = hms_db::care::list_visits(
                    self.pool(),
                    facility_id,
                    VisitFilters {
                        clinic_id: None,
                        practitioner_user_id: Some(ctx.user_id),
                        status: None,
                        active_only: true,
                    },
                    None,
                    preview_fetch_limit,
                )
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "my_work_outpatient_failed",
                        "Outpatient work could not be loaded.",
                    )
                })?;
                let (appointments, has_more_appointments) =
                    split_preview(appointments, MY_WORK_PREVIEW_LIMIT);
                let (active_visits, has_more_active_visits) =
                    split_preview(visits, MY_WORK_PREVIEW_LIMIT);
                (
                    appointments,
                    has_more_appointments,
                    active_visits,
                    has_more_active_visits,
                )
            } else {
                (Vec::new(), false, Vec::new(), false)
            };

        let assigned_wards = if can_inpatient {
            hms_db::ward::list_user_ward_board_assignments(self.pool(), facility_id, ctx.user_id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "my_work_inpatient_failed",
                        "Inpatient work could not be loaded.",
                    )
                })?
        } else {
            Vec::new()
        };
        let primary_ward_id = assigned_wards
            .iter()
            .find(|assignment| assignment.is_primary)
            .map(|assignment| assignment.ward_id);
        let default_ward_id = primary_ward_id
            .or_else(|| (assigned_wards.len() == 1).then(|| assigned_wards[0].ward_id));
        let can_view_all_wards = can_inpatient && can_view_all_ward_board(ctx, facility_id);

        let (assigned_triage, has_more_assigned_triage, waiting_triage, has_more_waiting_triage) =
            if can_emergency {
                let assigned = hms_db::care::list_triage(
                    self.pool(),
                    facility_id,
                    None,
                    preview_fetch_limit,
                    TriageFilters {
                        acuity: None,
                        status: Some(TriageStatus::Assigned),
                        assigned_to_user_id: Some(ctx.user_id),
                    },
                )
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "my_work_emergency_failed",
                        "Emergency work could not be loaded.",
                    )
                })?;
                let waiting = hms_db::care::list_triage(
                    self.pool(),
                    facility_id,
                    None,
                    preview_fetch_limit,
                    TriageFilters {
                        acuity: None,
                        status: Some(TriageStatus::Waiting),
                        assigned_to_user_id: None,
                    },
                )
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "my_work_emergency_failed",
                        "Emergency work could not be loaded.",
                    )
                })?;
                let (assigned, has_more_assigned) = split_preview(assigned, MY_WORK_PREVIEW_LIMIT);
                let (waiting, has_more_waiting) = split_preview(waiting, MY_WORK_PREVIEW_LIMIT);
                (assigned, has_more_assigned, waiting, has_more_waiting)
            } else {
                (Vec::new(), false, Vec::new(), false)
            };

        let (recent_patients, has_more_recent_patients) = if can_patient_context {
            let patients = hms_db::patients::list_context_patients(
                self.pool(),
                facility_id,
                ctx.user_id,
                None,
                preview_fetch_limit,
                PatientContextFilters::default(),
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "my_work_patient_context_failed",
                    "Patient context could not be loaded.",
                )
            })?;
            split_preview(patients, MY_WORK_PREVIEW_LIMIT)
        } else {
            (Vec::new(), false)
        };

        Ok(object(CareAreaMyWorkResponse {
            generated_at: Utc::now(),
            outpatient: CareAreaOutpatientMyWork {
                date: today,
                appointments,
                has_more_appointments,
                active_visits,
                has_more_active_visits,
            },
            inpatient: CareAreaInpatientMyWork {
                assigned_wards,
                primary_ward_id,
                default_ward_id,
                can_view_all_wards,
            },
            emergency: CareAreaEmergencyMyWork {
                assigned_triage,
                has_more_assigned_triage,
                waiting_triage,
                has_more_waiting_triage,
            },
            patient_context: CareAreaPatientContextMyWork {
                recent_patients,
                has_more_recent_patients,
            },
        }))
    }

    pub async fn outpatient_intake(
        &self,
        ctx: &hms_access::RequestContext,
        payload: OutpatientIntakeRequest,
    ) -> Result<ObjectResponse<OutpatientIntakeResponse>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        if payload.clinic_id.is_none() {
            return Err(ApiError::bad_request(
                "outpatient_clinic_required",
                "Outpatient intake requires an explicit clinic context.",
            ));
        }
        let patient = load_patient_for_intake(
            &self.state,
            ctx,
            payload.patient_id,
            payload.restricted_record_override.as_ref(),
            "outpatient",
        )
        .await?;
        let idempotency = begin_care_intake_idempotency(
            self.pool(),
            ctx,
            self.facility_id(),
            CareAreaIntakeKind::Outpatient,
            patient.id,
            &payload.idempotency_key,
            format!(
                "outpatient|{}|{}|{}",
                patient.id,
                optional_uuid_fingerprint(payload.appointment_id),
                optional_uuid_fingerprint(payload.clinic_id)
            ),
        )
        .await?;
        let reservation = match idempotency {
            CareIntakeIdempotencyStart::Replay(record) => {
                let visit_id = record.visit_id.ok_or_else(|| {
                    ApiError::conflict(
                        "care_intake_idempotency_failed",
                        "Care intake idempotency result is incomplete.",
                    )
                })?;
                let visit = hms_db::care::get_visit(self.pool(), self.facility_id(), visit_id)
                    .await
                    .map_err(|_| {
                        ApiError::conflict("visit_load_failed", "Visit could not be loaded.")
                    })?
                    .ok_or_else(|| {
                        ApiError::not_found("visit_not_found", "Visit was not found.")
                    })?;
                return Ok(object(OutpatientIntakeResponse {
                    patient_id: patient.id,
                    visit,
                }));
            }
            CareIntakeIdempotencyStart::Reserved(reservation) => reservation,
        };
        if payload.appointment_id.is_none() {
            let contexts = hms_db::patients::get_patient_current_contexts(
                self.pool(),
                self.facility_id(),
                patient.id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "patient_current_contexts_failed",
                    "Patient current contexts could not be loaded.",
                )
            })?;
            if let Some(existing) = contexts
                .outpatient
                .iter()
                .find(|context| context.clinic_id == payload.clinic_id)
            {
                let visit =
                    hms_db::care::get_visit(self.pool(), self.facility_id(), existing.visit_id)
                        .await
                        .map_err(|_| {
                            ApiError::conflict("visit_load_failed", "Visit could not be loaded.")
                        })?
                        .ok_or_else(|| {
                            ApiError::not_found("visit_not_found", "Visit was not found.")
                        })?;
                complete_care_intake_idempotency(
                    self.pool(),
                    self.facility_id(),
                    ctx,
                    reservation,
                    Some(visit.id),
                    None,
                    None,
                )
                .await?;
                return Ok(object(OutpatientIntakeResponse {
                    patient_id: patient.id,
                    visit,
                }));
            }
        }

        let visit = hms_db::care::check_in_visit(
            self.pool(),
            NewVisit {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: patient.id,
                appointment_id: payload.appointment_id,
                clinic_id: payload.clinic_id,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "outpatient_intake_failed",
                "Outpatient intake could not be created.",
            )
        })?;

        complete_care_intake_idempotency(
            self.pool(),
            self.facility_id(),
            ctx,
            reservation,
            Some(visit.id),
            None,
            None,
        )
        .await?;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(OutpatientIntakeResponse {
            patient_id: patient.id,
            visit,
        }))
    }

    pub async fn inpatient_intake(
        &self,
        ctx: &hms_access::RequestContext,
        payload: InpatientIntakeRequest,
    ) -> Result<ObjectResponse<InpatientIntakeResponse>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::AdmissionManage)?;
        let patient = load_patient_for_intake(
            &self.state,
            ctx,
            payload.patient_id,
            payload.restricted_record_override.as_ref(),
            "inpatient",
        )
        .await?;
        let idempotency = begin_care_intake_idempotency(
            self.pool(),
            ctx,
            self.facility_id(),
            CareAreaIntakeKind::Inpatient,
            patient.id,
            &payload.idempotency_key,
            format!(
                "inpatient|{}|{}|{}|{}",
                patient.id,
                payload.ward_id,
                optional_uuid_fingerprint(payload.encounter_id),
                optional_uuid_fingerprint(payload.visit_id)
            ),
        )
        .await?;
        let reservation = match idempotency {
            CareIntakeIdempotencyStart::Replay(record) => {
                let admission_case_id = record.admission_case_id.ok_or_else(|| {
                    ApiError::conflict(
                        "care_intake_idempotency_failed",
                        "Care intake idempotency result is incomplete.",
                    )
                })?;
                let admission_case = hms_db::ward::get_admission_case(
                    self.pool(),
                    self.facility_id(),
                    admission_case_id,
                )
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "admission_case_load_failed",
                        "Admission case could not be loaded.",
                    )
                })?
                .ok_or_else(|| {
                    ApiError::not_found("admission_case_not_found", "Admission case was not found.")
                })?;
                return Ok(object(InpatientIntakeResponse {
                    patient_id: patient.id,
                    admission_case,
                }));
            }
            CareIntakeIdempotencyStart::Reserved(reservation) => reservation,
        };
        let contexts = hms_db::patients::get_patient_current_contexts(
            self.pool(),
            self.facility_id(),
            patient.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_current_contexts_failed",
                "Patient current contexts could not be loaded.",
            )
        })?;
        if let Some(existing) = contexts.inpatient.first() {
            let admission_case = hms_db::ward::get_admission_case(
                self.pool(),
                self.facility_id(),
                existing.admission_case_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "admission_case_load_failed",
                    "Admission case could not be loaded.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("admission_case_not_found", "Admission case was not found.")
            })?;
            complete_care_intake_idempotency(
                self.pool(),
                self.facility_id(),
                ctx,
                reservation,
                None,
                Some(admission_case.id),
                None,
            )
            .await?;
            return Ok(object(InpatientIntakeResponse {
                patient_id: patient.id,
                admission_case,
            }));
        }

        let admission_case = hms_db::ward::create_admission_case(
            self.pool(),
            NewAdmissionCase {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: patient.id,
                ward_id: payload.ward_id,
                encounter_id: payload.encounter_id,
                visit_id: payload.visit_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "inpatient_intake_failed",
                "Inpatient intake could not be created.",
            )
        })?;

        complete_care_intake_idempotency(
            self.pool(),
            self.facility_id(),
            ctx,
            reservation,
            None,
            Some(admission_case.id),
            None,
        )
        .await?;
        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(InpatientIntakeResponse {
            patient_id: patient.id,
            admission_case,
        }))
    }

    pub async fn emergency_intake(
        &self,
        ctx: &hms_access::RequestContext,
        payload: EmergencyIntakeRequest,
    ) -> Result<ObjectResponse<EmergencyIntakeResponse>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::NursingTaskManage)?;
        let patient = load_patient_for_intake(
            &self.state,
            ctx,
            payload.patient_id,
            payload.restricted_record_override.as_ref(),
            "emergency",
        )
        .await?;
        let idempotency = begin_care_intake_idempotency(
            self.pool(),
            ctx,
            self.facility_id(),
            CareAreaIntakeKind::Emergency,
            patient.id,
            &payload.idempotency_key,
            format!(
                "emergency|{}|{}|{:?}",
                patient.id,
                optional_uuid_fingerprint(payload.clinic_id),
                payload.acuity
            ),
        )
        .await?;
        let reservation = match idempotency {
            CareIntakeIdempotencyStart::Replay(record) => {
                let visit_id = record.visit_id.ok_or_else(|| {
                    ApiError::conflict(
                        "care_intake_idempotency_failed",
                        "Care intake idempotency result is incomplete.",
                    )
                })?;
                let triage_id = record.triage_id.ok_or_else(|| {
                    ApiError::conflict(
                        "care_intake_idempotency_failed",
                        "Care intake idempotency result is incomplete.",
                    )
                })?;
                let visit = hms_db::care::get_visit(self.pool(), self.facility_id(), visit_id)
                    .await
                    .map_err(|_| {
                        ApiError::conflict("visit_load_failed", "Visit could not be loaded.")
                    })?
                    .ok_or_else(|| {
                        ApiError::not_found("visit_not_found", "Visit was not found.")
                    })?;
                let triage = hms_db::care::get_triage(self.pool(), self.facility_id(), triage_id)
                    .await
                    .map_err(|_| {
                        ApiError::conflict("triage_load_failed", "Triage item could not be loaded.")
                    })?
                    .ok_or_else(|| {
                        ApiError::not_found("triage_not_found", "Triage item was not found.")
                    })?;
                return Ok(object(EmergencyIntakeResponse {
                    patient_id: patient.id,
                    visit,
                    triage,
                }));
            }
            CareIntakeIdempotencyStart::Reserved(reservation) => reservation,
        };
        let contexts = hms_db::patients::get_patient_current_contexts(
            self.pool(),
            self.facility_id(),
            patient.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_current_contexts_failed",
                "Patient current contexts could not be loaded.",
            )
        })?;
        if let Some(existing) = contexts.emergency.first() {
            let visit = hms_db::care::get_visit(self.pool(), self.facility_id(), existing.visit_id)
                .await
                .map_err(|_| ApiError::conflict("visit_load_failed", "Visit could not be loaded."))?
                .ok_or_else(|| ApiError::not_found("visit_not_found", "Visit was not found."))?;
            if let Some(triage_id) = existing.triage_id {
                let triage = hms_db::care::get_triage(self.pool(), self.facility_id(), triage_id)
                    .await
                    .map_err(|_| {
                        ApiError::conflict("triage_load_failed", "Triage item could not be loaded.")
                    })?
                    .ok_or_else(|| {
                        ApiError::not_found("triage_not_found", "Triage item was not found.")
                    })?;
                complete_care_intake_idempotency(
                    self.pool(),
                    self.facility_id(),
                    ctx,
                    reservation,
                    Some(visit.id),
                    None,
                    Some(triage.id),
                )
                .await?;
                return Ok(object(EmergencyIntakeResponse {
                    patient_id: patient.id,
                    visit,
                    triage,
                }));
            }
        }

        let visit_id = Uuid::new_v4();
        let (visit, triage) = hms_db::care::create_emergency_visit_with_triage(
            self.pool(),
            NewVisit {
                id: visit_id,
                facility_id: self.facility_id(),
                patient_id: patient.id,
                appointment_id: None,
                clinic_id: payload.clinic_id,
                created_by_user_id: ctx.user_id,
            },
            NewTriage {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                visit_id,
                patient_id: patient.id,
                acuity: payload.acuity,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "emergency_intake_failed",
                "Emergency intake could not be created.",
            )
        })?;

        complete_care_intake_idempotency(
            self.pool(),
            self.facility_id(),
            ctx,
            reservation,
            Some(visit.id),
            None,
            Some(triage.id),
        )
        .await?;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(EmergencyIntakeResponse {
            patient_id: patient.id,
            visit,
            triage,
        }))
    }

    pub async fn list_appointments(
        &self,
        ctx: &hms_access::RequestContext,
        query: AppointmentListQuery,
    ) -> Result<ListResponse<AppointmentListItem>, ApiError> {
        require_workflow_list_access(ctx, self.facility_id(), PermissionCode::AppointmentView)?;
        let (cursor, page_size) = page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let rows = hms_db::care::list_appointments(
            self.pool(),
            self.facility_id(),
            cursor,
            AppointmentFilters {
                date: query.date,
                clinic_id: query.clinic_id,
                practitioner_user_id: query.practitioner_user_id,
                status: query.status,
                search: query.search,
            },
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "appointment_list_failed",
                "Appointments could not be loaded.",
            )
        })?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.starts_at, item.id)
        }))
    }

    pub async fn list_clinics(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<ClinicListItem>, ApiError> {
        require_workflow_list_access(ctx, self.facility_id(), PermissionCode::AppointmentView)?;
        let (cursor, page_size) = page_request(query)?;
        let rows = hms_db::care::list_clinics(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| ApiError::conflict("clinic_list_failed", "Clinics could not be loaded."))?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn list_appointment_types(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<AppointmentTypeListItem>, ApiError> {
        require_workflow_list_access(ctx, self.facility_id(), PermissionCode::AppointmentView)?;
        let (cursor, page_size) = page_request(query)?;
        let rows = hms_db::care::list_appointment_types(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "appointment_type_list_failed",
                "Appointment types could not be loaded.",
            )
        })?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_clinic(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ClinicListItem>, ApiError> {
        require_workflow_list_access(ctx, self.facility_id(), PermissionCode::AppointmentView)?;
        let clinic = hms_db::care::get_clinic(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| ApiError::conflict("clinic_load_failed", "Clinic could not be loaded."))?
            .ok_or_else(|| ApiError::not_found("clinic_not_found", "Clinic was not found."))?;

        Ok(object(clinic))
    }

    pub async fn create_clinic(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateClinicRequest,
    ) -> Result<ObjectResponse<ClinicListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        let clinic = hms_db::care::create_clinic(
            self.pool(),
            NewClinic {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                code: validate_required_text(payload.code, MAX_CLINIC_CODE_LEN, "clinic_code")?,
                name: validate_required_text(payload.name, MAX_CLINIC_NAME_LEN, "clinic_name")?,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| ApiError::conflict("clinic_create_failed", "Clinic could not be created."))?;

        Ok(object(clinic))
    }

    pub async fn update_clinic(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdateClinicRequest,
    ) -> Result<ObjectResponse<ClinicListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        let clinic = hms_db::care::update_clinic(
            self.pool(),
            ClinicUpdate {
                id,
                facility_id: self.facility_id(),
                code: validate_optional_text(payload.code, MAX_CLINIC_CODE_LEN, "clinic_code")?,
                name: validate_optional_text(payload.name, MAX_CLINIC_NAME_LEN, "clinic_name")?,
                is_active: payload.is_active,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| ApiError::conflict("clinic_update_failed", "Clinic could not be updated."))?
        .ok_or_else(|| ApiError::not_found("clinic_not_found", "Clinic was not found."))?;

        Ok(object(clinic))
    }

    pub async fn delete_clinic(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ClinicListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        let clinic =
            hms_db::care::deactivate_clinic(self.pool(), self.facility_id(), id, ctx.user_id)
                .await
                .map_err(|_| {
                    ApiError::conflict("clinic_delete_failed", "Clinic could not be deactivated.")
                })?
                .ok_or_else(|| ApiError::not_found("clinic_not_found", "Clinic was not found."))?;

        Ok(object(clinic))
    }

    pub async fn create_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateAppointmentRequest,
    ) -> Result<ObjectResponse<AppointmentListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        let _patient = load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        if payload.ends_at <= payload.starts_at {
            return Err(ApiError::bad_request(
                "invalid_appointment",
                "Appointment end time must be after start time.",
            ));
        }

        let appointment = hms_db::care::create_booked_appointment(
            self.pool(),
            NewBookedAppointment {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: payload.patient_id,
                clinic_id: payload.clinic_id,
                clinic_session_id: payload.clinic_session_id,
                appointment_type_id: payload.appointment_type_id,
                practitioner_user_id: payload.practitioner_user_id,
                starts_at: payload.starts_at,
                ends_at: payload.ends_at,
                overbook_reason: validate_optional_reason(payload.overbook_reason)?,
                series_id: None,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "appointment_create_failed",
                "Appointment could not be created.",
            )
        })?;

        Ok(object(appointment))
    }

    pub async fn get_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<AppointmentListItem>, ApiError> {
        Ok(object(
            load_appointment_for_access(&self.state, ctx, id, PermissionCode::AppointmentView)
                .await?,
        ))
    }

    pub async fn update_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdateAppointmentRequest,
    ) -> Result<ObjectResponse<AppointmentListItem>, ApiError> {
        let existing =
            load_appointment_for_access(&self.state, ctx, id, PermissionCode::AppointmentManage)
                .await?;

        if payload.starts_at.is_none() && payload.ends_at.is_none() {
            return Err(ApiError::bad_request(
                "invalid_appointment",
                "At least one appointment time field must be supplied.",
            ));
        }

        let starts_at = payload.starts_at.unwrap_or(existing.starts_at);
        let ends_at = payload.ends_at.unwrap_or(existing.ends_at);
        if ends_at <= starts_at {
            return Err(ApiError::bad_request(
                "invalid_appointment",
                "Appointment end time must be after start time.",
            ));
        }

        let appointment = hms_db::care::update_appointment(
            self.pool(),
            AppointmentUpdate {
                id,
                facility_id: self.facility_id(),
                starts_at: Some(starts_at),
                ends_at: Some(ends_at),
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "appointment_update_failed",
                "Appointment could not be updated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "appointment_update_failed",
                "Only scheduled appointments can be updated.",
            )
        })?;

        Ok(object(appointment))
    }

    pub async fn cancel_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: CancelAppointmentRequest,
    ) -> Result<ObjectResponse<AppointmentListItem>, ApiError> {
        let _existing =
            load_appointment_for_access(&self.state, ctx, id, PermissionCode::AppointmentManage)
                .await?;
        let reason = validate_optional_reason(Some(payload.reason))?.ok_or_else(|| {
            ApiError::bad_request("invalid_appointment", "Cancellation reason is required.")
        })?;
        let appointment = hms_db::care::cancel_appointment(
            self.pool(),
            self.facility_id(),
            id,
            ctx.user_id,
            reason,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "appointment_cancel_failed",
                "Appointment could not be cancelled.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "appointment_cancel_failed",
                "Only scheduled appointments can be cancelled.",
            )
        })?;

        Ok(object(appointment))
    }

    pub async fn list_visits(
        &self,
        ctx: &hms_access::RequestContext,
        query: VisitListQuery,
    ) -> Result<ListResponse<VisitListItem>, ApiError> {
        require_workflow_list_access(ctx, self.facility_id(), PermissionCode::AppointmentView)?;
        let (cursor, page_size) = page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let rows = hms_db::care::list_visits(
            self.pool(),
            self.facility_id(),
            VisitFilters {
                clinic_id: query.clinic_id,
                practitioner_user_id: query.practitioner_user_id,
                status: query.status,
                active_only: query.active_only.unwrap_or(false),
            },
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| ApiError::conflict("visit_list_failed", "Visits could not be loaded."))?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.checked_in_at, item.id)
        }))
    }

    pub async fn get_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::AppointmentView)?;
        Ok(object(load_visit_for_access(&self.state, ctx, id).await?))
    }

    pub async fn check_in_visit(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CheckInVisitRequest,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        let _patient = load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let visit = hms_db::care::check_in_visit(
            self.pool(),
            NewVisit {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: payload.patient_id,
                appointment_id: payload.appointment_id,
                clinic_id: payload.clinic_id,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("visit_check_in_failed", "Visit could not be checked in.")
        })?;

        Ok(object(visit))
    }

    pub async fn call_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::Called,
            PermissionCode::AppointmentManage,
        )
        .await
    }

    pub async fn start_visit_consultation(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::InConsultation,
            PermissionCode::EncounterManage,
        )
        .await
    }

    pub async fn hold_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::OnHold,
            PermissionCode::EncounterManage,
        )
        .await
    }

    pub async fn ready_checkout_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::ReadyCheckout,
            PermissionCode::EncounterManage,
        )
        .await
    }

    pub async fn checkout_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::CheckedOut,
            PermissionCode::AppointmentManage,
        )
        .await
    }

    pub async fn no_show_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::NoShow,
            PermissionCode::AppointmentManage,
        )
        .await
    }

    async fn update_visit_with_access(
        &self,
        ctx: &hms_access::RequestContext,
        visit_id: Uuid,
        status: VisitStatus,
        permission: PermissionCode,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), permission)?;
        let _visit = load_visit_for_access(&self.state, ctx, visit_id).await?;
        let updated =
            hms_db::care::update_visit_status(self.pool(), self.facility_id(), visit_id, status)
                .await
                .map_err(|_| {
                    ApiError::conflict("visit_update_failed", "Visit could not be updated.")
                })?
                .ok_or_else(|| ApiError::not_found("visit_not_found", "Visit was not found."))?;

        Ok(object(updated))
    }

    pub async fn list_triage(
        &self,
        ctx: &hms_access::RequestContext,
        query: TriageListQuery,
    ) -> Result<ListResponse<TriageListItem>, ApiError> {
        require_workflow_list_access(ctx, self.facility_id(), PermissionCode::NursingTaskManage)?;
        let (cursor, page_size) = page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let rows = hms_db::care::list_triage(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
            TriageFilters {
                acuity: query.acuity,
                status: query.status,
                assigned_to_user_id: query.assigned_to_user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("triage_list_failed", "Triage queue could not be loaded.")
        })?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_triage(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateTriageRequest,
    ) -> Result<ObjectResponse<TriageListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::NursingTaskManage)?;
        let visit = load_visit_for_access(&self.state, ctx, payload.visit_id).await?;
        let triage = hms_db::care::create_triage(
            self.pool(),
            NewTriage {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                visit_id: payload.visit_id,
                patient_id: visit.patient_id,
                acuity: payload.acuity,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("triage_create_failed", "Triage item could not be created.")
        })?;

        Ok(object(triage))
    }

    pub async fn get_triage(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<TriageListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::NursingTaskManage)?;
        let triage = load_triage_for_access(&self.state, ctx, id).await?;

        Ok(object(triage))
    }

    pub async fn assess_triage(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        mut payload: TriageAssessmentRequest,
    ) -> Result<ObjectResponse<TriageListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::NursingTaskManage)?;
        let _existing = load_triage_for_access(&self.state, ctx, id).await?;
        if let Some(notes) = payload.notes.take() {
            let notes = notes.trim().to_owned();
            if notes.len() > MAX_TRIAGE_NOTES_LEN {
                return Err(ApiError::bad_request(
                    "invalid_triage_notes",
                    "Triage notes are too long.",
                ));
            }
            payload.notes = if notes.is_empty() { None } else { Some(notes) };
        }
        let triage = hms_db::care::assess_triage(self.pool(), self.facility_id(), id, payload)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "triage_assessment_failed",
                    "Triage assessment could not be saved.",
                )
            })?
            .ok_or_else(|| ApiError::not_found("triage_not_found", "Triage item was not found."))?;

        Ok(object(triage))
    }

    pub async fn assign_triage(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: AssignTriageRequest,
    ) -> Result<ObjectResponse<TriageListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::NursingTaskManage)?;
        let existing = load_triage_for_access(&self.state, ctx, id).await?;
        if !matches!(
            existing.status,
            TriageStatus::Waiting | TriageStatus::Assigned
        ) {
            return Err(ApiError::conflict(
                "triage_assign_invalid_status",
                "Only waiting or assigned triage entries can be assigned.",
            ));
        }
        let triage = hms_db::care::assign_triage(
            self.pool(),
            self.facility_id(),
            id,
            payload.assigned_to_user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("triage_assign_failed", "Triage item could not be assigned.")
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "triage_assign_invalid_status",
                "Only waiting or assigned triage entries can be assigned.",
            )
        })?;

        Ok(object(triage))
    }

    pub async fn cancel_triage(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<TriageListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::NursingTaskManage)?;
        let existing = load_triage_for_access(&self.state, ctx, id).await?;
        if existing.status != TriageStatus::Waiting {
            return Err(ApiError::conflict(
                "triage_cancel_invalid_status",
                "Only waiting triage entries can be cancelled.",
            ));
        }

        let triage = hms_db::care::cancel_triage(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "triage_cancel_failed",
                    "Triage item could not be cancelled.",
                )
            })?
            .ok_or_else(|| ApiError::not_found("triage_not_found", "Triage item was not found."))?;

        Ok(object(triage))
    }

    pub async fn list_encounters(
        &self,
        ctx: &hms_access::RequestContext,
        query: EncounterListQuery,
    ) -> Result<ListResponse<EncounterListItem>, ApiError> {
        require_workflow_list_access(ctx, self.facility_id(), PermissionCode::EncounterView)?;
        if let Some(patient_id) = query.patient_id {
            let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        }
        let (cursor, page_size) = page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let rows = hms_db::care::list_encounters(
            self.pool(),
            self.facility_id(),
            EncounterFilters {
                patient_id: query.patient_id,
                patient_search: query.patient_search,
                practitioner_search: query.practitioner_search,
                date: query.date,
                status: query.status,
                encounter_type: query.encounter_type,
            },
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("encounter_list_failed", "Encounters could not be loaded.")
        })?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.started_at, item.id)
        }))
    }

    pub async fn create_encounter(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateEncounterRequest,
    ) -> Result<ObjectResponse<EncounterListItem>, ApiError> {
        require_action_permission(ctx, self.facility_id(), PermissionCode::EncounterManage)?;
        let _patient = load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        if let Some(visit_id) = payload.visit_id {
            let visit = load_visit_for_access(&self.state, ctx, visit_id).await?;
            if visit.patient_id != payload.patient_id {
                return Err(ApiError::bad_request(
                    "invalid_encounter",
                    "Visit does not belong to the supplied patient.",
                ));
            }
        }
        let encounter = hms_db::care::create_encounter(
            self.pool(),
            NewEncounter {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: payload.patient_id,
                visit_id: payload.visit_id,
                encounter_type: payload.encounter_type,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("encounter_create_failed", "Encounter could not be created.")
        })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(encounter))
    }

    pub async fn get_encounter(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<EncounterListItem>, ApiError> {
        Ok(object(
            load_encounter_for_access(&self.state, ctx, id, PermissionCode::EncounterView).await?,
        ))
    }

    pub async fn update_encounter(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdateEncounterRequest,
    ) -> Result<ObjectResponse<EncounterListItem>, ApiError> {
        if payload.visit_id.is_none() && payload.encounter_type.is_none() {
            return Err(ApiError::bad_request(
                "invalid_encounter_update",
                "At least one encounter field must be supplied.",
            ));
        }

        let encounter =
            load_encounter_for_access(&self.state, ctx, id, PermissionCode::EncounterManage)
                .await?;
        if let Some(visit_id) = payload.visit_id {
            let visit = load_visit_for_access(&self.state, ctx, visit_id).await?;
            if visit.patient_id != encounter.patient_id {
                return Err(ApiError::bad_request(
                    "invalid_encounter_update",
                    "Visit does not belong to the encounter patient.",
                ));
            }
        }

        let updated = hms_db::care::update_encounter(
            self.pool(),
            EncounterUpdate {
                id,
                facility_id: self.facility_id(),
                visit_id: payload.visit_id,
                encounter_type: payload.encounter_type,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("encounter_update_failed", "Encounter could not be updated.")
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "encounter_update_not_allowed",
                "Encounter could not be updated in its current state.",
            )
        })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(updated))
    }

    pub async fn complete_encounter(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<EncounterListItem>, ApiError> {
        self.update_encounter_with_access(ctx, id, EncounterStatus::Completed)
            .await
    }

    pub async fn cancel_encounter(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<EncounterListItem>, ApiError> {
        self.update_encounter_with_access(ctx, id, EncounterStatus::Cancelled)
            .await
    }

    pub async fn list_care_team(
        &self,
        ctx: &hms_access::RequestContext,
        encounter_id: Uuid,
    ) -> Result<ListResponse<CareTeamAssignment>, ApiError> {
        let encounter = load_encounter_for_access(
            &self.state,
            ctx,
            encounter_id,
            PermissionCode::EncounterView,
        )
        .await?;
        let assignments = hms_db::care::list_care_team_assignments(self.pool(), encounter.id)
            .await
            .map_err(|_| {
                ApiError::conflict("care_team_list_failed", "Care team could not be loaded.")
            })?;

        Ok(list(
            assignments,
            PageInfo {
                next_cursor: None,
                has_next: false,
                limit: MAX_LIMIT,
            },
        ))
    }

    pub async fn create_care_team_assignment(
        &self,
        ctx: &hms_access::RequestContext,
        encounter_id: Uuid,
        payload: CreateCareTeamAssignmentRequest,
    ) -> Result<ObjectResponse<CareTeamAssignment>, ApiError> {
        let encounter = load_encounter_for_access(
            &self.state,
            ctx,
            encounter_id,
            PermissionCode::EncounterManage,
        )
        .await?;
        let assignment = hms_db::care::create_care_team_assignment(
            self.pool(),
            NewCareTeamAssignment {
                id: Uuid::new_v4(),
                encounter_id: encounter.id,
                user_id: payload.user_id,
                role: payload.role,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "care_team_assign_failed",
                "Care team assignment could not be saved.",
            )
        })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(assignment))
    }

    async fn update_encounter_with_access(
        &self,
        ctx: &hms_access::RequestContext,
        encounter_id: Uuid,
        status: EncounterStatus,
    ) -> Result<ObjectResponse<EncounterListItem>, ApiError> {
        let _encounter = load_encounter_for_access(
            &self.state,
            ctx,
            encounter_id,
            PermissionCode::EncounterManage,
        )
        .await?;
        let updated = hms_db::care::update_encounter_status(
            self.pool(),
            self.facility_id(),
            encounter_id,
            status,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("encounter_update_failed", "Encounter could not be updated.")
        })?
        .ok_or_else(|| ApiError::not_found("encounter_not_found", "Encounter was not found."))?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(updated))
    }
}

impl AppState {
    pub fn care_service(&self) -> CareService {
        CareService::new(self.clone())
    }
}

async fn load_appointment_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    appointment_id: Uuid,
    permission: PermissionCode,
) -> Result<AppointmentListItem, ApiError> {
    require_action_permission(ctx, state.facility_id(), permission)?;
    let appointment =
        hms_db::care::get_appointment(state.db_pool(), state.facility_id(), appointment_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "appointment_load_failed",
                    "Appointment could not be loaded.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("appointment_not_found", "Appointment was not found.")
            })?;
    let _patient = load_patient_for_access(state, ctx, appointment.patient_id).await?;
    Ok(appointment)
}

async fn load_visit_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    visit_id: Uuid,
) -> Result<VisitListItem, ApiError> {
    let visit = hms_db::care::get_visit(state.db_pool(), state.facility_id(), visit_id)
        .await
        .map_err(|_| ApiError::conflict("visit_load_failed", "Visit could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("visit_not_found", "Visit was not found."))?;
    let _patient = load_patient_for_access(state, ctx, visit.patient_id).await?;
    Ok(visit)
}

async fn load_triage_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    triage_id: Uuid,
) -> Result<TriageListItem, ApiError> {
    let triage = hms_db::care::get_triage(state.db_pool(), state.facility_id(), triage_id)
        .await
        .map_err(|_| ApiError::conflict("triage_load_failed", "Triage item could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("triage_not_found", "Triage item was not found."))?;
    let _patient = load_patient_for_access(state, ctx, triage.patient_id).await?;
    Ok(triage)
}

async fn load_encounter_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    encounter_id: Uuid,
    permission: PermissionCode,
) -> Result<EncounterListItem, ApiError> {
    require_action_permission(ctx, state.facility_id(), permission)?;
    let encounter = hms_db::care::get_encounter(state.db_pool(), state.facility_id(), encounter_id)
        .await
        .map_err(|_| ApiError::conflict("encounter_load_failed", "Encounter could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("encounter_not_found", "Encounter was not found."))?;
    let _patient = load_patient_for_access(state, ctx, encounter.patient_id).await?;
    Ok(encounter)
}

async fn load_patient_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    patient_id: Uuid,
) -> Result<PatientRecord, ApiError> {
    let patient = hms_db::patients::get_patient(state.db_pool(), state.facility_id(), patient_id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

    require_patient_demographics_access(ctx, &patient).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient.",
        )
    })?;

    Ok(patient)
}

async fn begin_care_intake_idempotency(
    pool: &hms_db::PgPool,
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    care_area: CareAreaIntakeKind,
    patient_id: Uuid,
    idempotency_key: &str,
    request_fingerprint_source: String,
) -> Result<CareIntakeIdempotencyStart, ApiError> {
    let idempotency_key = validate_required_text(
        idempotency_key.to_owned(),
        MAX_CARE_INTAKE_IDEMPOTENCY_KEY_LEN,
        "idempotency_key",
    )?;
    let key_hash = care_intake_hash("key", &idempotency_key);
    let request_fingerprint = care_intake_hash("request", &request_fingerprint_source);

    let inserted = hms_db::care::create_care_area_intake_idempotency_reservation(
        pool,
        NewCareAreaIntakeIdempotencyKey {
            id: Uuid::new_v4(),
            facility_id,
            created_by_user_id: ctx.user_id,
            care_area,
            idempotency_key_hash: key_hash.clone(),
            request_fingerprint: request_fingerprint.clone(),
            patient_id,
            visit_id: None,
            admission_case_id: None,
            triage_id: None,
        },
    )
    .await
    .map_err(|_| {
        ApiError::conflict(
            "care_intake_idempotency_failed",
            "Care intake idempotency could not be checked.",
        )
    })?;

    if inserted.is_some() {
        return Ok(CareIntakeIdempotencyStart::Reserved(
            CareIntakeIdempotencyReservation {
                care_area,
                key_hash,
                request_fingerprint,
            },
        ));
    }

    let existing = hms_db::care::get_care_area_intake_idempotency_record(
        pool,
        facility_id,
        ctx.user_id,
        care_area,
        &key_hash,
    )
    .await
    .map_err(|_| {
        ApiError::conflict(
            "care_intake_idempotency_failed",
            "Care intake idempotency could not be checked.",
        )
    })?
    .ok_or_else(|| {
        ApiError::conflict(
            "care_intake_idempotency_failed",
            "Care intake idempotency could not be checked.",
        )
    })?;

    if existing.patient_id != patient_id || existing.request_fingerprint != request_fingerprint {
        return Err(ApiError::conflict(
            "care_intake_idempotency_conflict",
            "Idempotency key was already used for a different care intake request.",
        ));
    }
    if existing.completed_at.is_none() {
        return Err(ApiError::conflict(
            "care_intake_in_progress",
            "Care intake is still being processed. Retry with the same idempotency key.",
        ));
    }

    Ok(CareIntakeIdempotencyStart::Replay(existing))
}

async fn complete_care_intake_idempotency(
    pool: &hms_db::PgPool,
    facility_id: Uuid,
    ctx: &hms_access::RequestContext,
    reservation: CareIntakeIdempotencyReservation,
    visit_id: Option<Uuid>,
    admission_case_id: Option<Uuid>,
    triage_id: Option<Uuid>,
) -> Result<(), ApiError> {
    hms_db::care::complete_care_area_intake_idempotency_key(
        pool,
        CompleteCareAreaIntakeIdempotencyKey {
            facility_id,
            created_by_user_id: ctx.user_id,
            care_area: reservation.care_area,
            idempotency_key_hash: reservation.key_hash,
            request_fingerprint: reservation.request_fingerprint,
            visit_id,
            admission_case_id,
            triage_id,
        },
    )
    .await
    .map_err(|_| {
        ApiError::conflict(
            "care_intake_idempotency_failed",
            "Care intake idempotency could not be recorded.",
        )
    })?
    .ok_or_else(|| {
        ApiError::conflict(
            "care_intake_idempotency_failed",
            "Care intake idempotency could not be recorded.",
        )
    })?;
    Ok(())
}

fn care_intake_hash(label: &str, value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(label.as_bytes());
    hasher.update([0]);
    hasher.update(value.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize())
}

fn optional_uuid_fingerprint(value: Option<Uuid>) -> String {
    value
        .map(|id| id.to_string())
        .unwrap_or_else(|| "none".to_owned())
}

async fn load_patient_for_intake(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    patient_id: Uuid,
    restricted_override: Option<&SpecialRecordOverride>,
    care_area: &'static str,
) -> Result<PatientRecord, ApiError> {
    let patient = load_patient_for_access(state, ctx, patient_id).await?;
    match patient.record_status {
        PatientRecordStatus::Registered => {
            if patient.vital_status == PatientVitalStatus::Deceased {
                return Err(ApiError::conflict(
                    "patient_deceased_intake_blocked",
                    "Deceased patient records cannot be used for normal intake.",
                ));
            }
            Ok(patient)
        }
        PatientRecordStatus::Restricted => {
            let Some(override_reason) = restricted_override else {
                return Err(ApiError::conflict(
                    "patient_restricted_intake_blocked",
                    "Restricted patient records require an override reason for intake.",
                ));
            };
            if !ctx.has_facility_permission(state.facility_id(), PermissionCode::PatientUpdate) {
                return Err(ApiError::forbidden(
                    "permission_denied",
                    "You do not have permission to override restricted patient records.",
                ));
            }
            let reason_code = normalize_record_override_reason_code(&override_reason.reason_code)?;
            let reason_note_present =
                normalize_record_override_reason_note(override_reason.reason_note.as_deref())?
                    .is_some();
            hms_db::patients::audit_patient_record_override(
                state.db_pool(),
                PatientRecordOverrideAudit {
                    facility_id: state.facility_id(),
                    patient_id: patient.id,
                    actor_user_id: ctx.user_id,
                    request_id: Some(ctx.request_id.clone()),
                    override_kind: format!("{care_area}_restricted_record_intake"),
                    reason_code,
                    reason_note_present,
                },
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "patient_record_override_audit_failed",
                    "Restricted patient record override could not be audited.",
                )
            })?;
            Ok(patient)
        }
        PatientRecordStatus::EnteredInError => Err(ApiError::conflict(
            "patient_entered_in_error_intake_blocked",
            "Entered-in-error patient records cannot be used for intake.",
        )),
        PatientRecordStatus::Superseded => Err(ApiError::conflict(
            "patient_superseded_intake_blocked",
            "Merged patient records cannot be used for intake. Use the canonical patient record.",
        )),
    }
}

fn normalize_record_override_reason_code(reason_code: &str) -> Result<String, ApiError> {
    let reason_code = reason_code.trim();
    if reason_code.is_empty() || reason_code.len() > 64 {
        return Err(ApiError::bad_request(
            "invalid_record_override",
            "Record override reason code is required.",
        ));
    }
    Ok(reason_code.to_owned())
}

fn normalize_record_override_reason_note(
    reason_note: Option<&str>,
) -> Result<Option<String>, ApiError> {
    let Some(reason_note) = reason_note.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if reason_note.len() > MAX_RECORD_OVERRIDE_REASON_LEN {
        return Err(ApiError::bad_request(
            "invalid_record_override",
            "Record override reason note is too long.",
        ));
    }
    Ok(Some(reason_note.to_owned()))
}

fn split_preview<T>(mut rows: Vec<T>, limit: usize) -> (Vec<T>, bool) {
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    (rows, has_more)
}

fn can_access_workflow(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> bool {
    hms_access::require_patient_workflow_access(ctx, facility_id, permission).is_ok()
}

fn can_view_all_ward_board(ctx: &hms_access::RequestContext, facility_id: Uuid) -> bool {
    ctx.has_facility_permission(facility_id, PermissionCode::WardBoardViewAll)
        || ctx.has_facility_permission(facility_id, PermissionCode::AdminStaffManage)
        || ctx.has_facility_permission(facility_id, PermissionCode::AdminAuthorityManage)
}

fn require_workflow_list_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(ctx, facility_id, permission).map_err(|error| {
        match error {
            hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
                "patient_access_denied",
                "You do not have access to patient workflow lists.",
            ),
            other => ApiError::from(other),
        }
    })
}

fn require_action_permission(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(ctx, facility_id, permission).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this action.",
        )
    })
}

fn validate_required_text(
    value: String,
    max_len: usize,
    field_name: &'static str,
) -> Result<String, ApiError> {
    validate_optional_text(Some(value), max_len, field_name)?.ok_or_else(|| {
        ApiError::bad_request("invalid_clinic", "Clinic code and name are required.")
    })
}

fn validate_optional_text(
    value: Option<String>,
    max_len: usize,
    field_name: &'static str,
) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(ApiError::bad_request(
            "invalid_clinic",
            "Clinic code and name cannot be blank.",
        ));
    }
    if value.len() > max_len {
        return Err(ApiError::bad_request(
            "invalid_clinic",
            match field_name {
                "clinic_code" => "Clinic code is too long.",
                "clinic_name" => "Clinic name is too long.",
                _ => "Clinic field is too long.",
            },
        ));
    }
    Ok(Some(value))
}

fn validate_optional_reason(value: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(ApiError::bad_request(
            "invalid_appointment",
            "Reason cannot be blank.",
        ));
    }
    if value.len() > 1_000 {
        return Err(ApiError::bad_request(
            "invalid_appointment",
            "Reason is too long.",
        ));
    }
    Ok(Some(value))
}

fn page_request(query: CursorListQuery) -> Result<(Option<CareCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| CareCursor { occurred_at, id },
    )?;
    Ok((page.cursor, page.limit))
}

fn page_response<T, F>(rows: Vec<T>, page_size: u8, cursor_for: F) -> ListResponse<T>
where
    F: Fn(&T) -> String,
{
    cursor_list::page_response(rows, page_size, cursor_for)
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    cursor_list::encode_cursor(occurred_at, id)
}
