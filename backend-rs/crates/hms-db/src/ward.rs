use chrono::{DateTime, Utc};
use uuid::Uuid;

mod admin;
mod admission_cases;
mod analytics;
mod bed_management;
mod discharge_cases;
pub mod fluid;
mod handoff;
mod mar;
pub mod nursing_access;
mod nursing_task_board;
mod observations_monitoring;
pub mod patient_handover;
pub(crate) mod prn;
mod staff_assignments;
mod ward_stock;

pub use admin::{
    create_ward, create_ward_section, get_ward, get_ward_section_by_id, list_ward_sections,
    list_wards, update_ward, update_ward_section, ward_exists, NewWard, NewWardSection,
    WardSectionUpdate, WardUpdate,
};
pub use admission_cases::{
    activate_admission_case, admit_patient, cancel_admission_case, create_admission_case,
    get_admission_case, get_admission_context, get_ward_board_admission, list_admission_cases,
    list_ward_board, reserve_admission_bed, AdmissionContext, NewAdmission, NewAdmissionCase,
};
pub use analytics::ward_analytics;
pub use bed_management::{
    create_bed, get_bed_by_id, get_ward_bed_map, list_section_beds, list_ward_beds,
    release_cleaned_beds, update_bed, BedUpdate, NewBed,
};
pub use discharge_cases::{
    cancel_discharge, complete_discharge, get_discharge_case, hold_discharge_blocker,
    list_discharge_cases, override_discharge_blocker, record_nursing_release, request_discharge,
};
pub use fluid::*;
pub use handoff::{
    complete_handoff, create_handoff, get_handoff, list_handoffs, list_handoffs_scoped,
    HandoffError, HandoffFilters, NewHandoff,
};
pub use mar::{
    administer_medication, create_treatment_sheet, get_medication_administration,
    list_medication_administrations, list_medication_administrations_scoped, list_treatment_sheets,
    list_treatment_sheets_scoped, record_medication_outcome, schedule_medication_administration,
    treatment_sheet_access_context, MedicationAdministrationFilters, MedicationOutcomeError,
    NewMedicationAdministration, NewTreatmentSheet, RecordMedicationOutcome, TreatmentSheetFilters,
};
pub use nursing_task_board::{
    cancel_nursing_task, complete_nursing_task, create_nursing_task, create_nursing_task_for_actor,
    decide_nursing_task_for_actor, get_nursing_task, list_nursing_tasks,
    list_nursing_tasks_for_actor, NewNursingTask, NursingTaskFilters,
};
pub use observations_monitoring::{
    acknowledge_nursing_alert, acknowledge_nursing_alert_for_actor,
    acknowledge_nursing_alert_with_request, create_fluid_balance_entry, create_monitoring_event,
    create_monitoring_event_for_actor, create_nursing_alert, create_nursing_alert_for_actor,
    create_patient_vitals, create_patient_vitals_for_actor, fluid_balance_summary,
    fluid_balance_trends, get_nursing_alert, list_fluid_balance_entries,
    list_fluid_balance_entries_scoped, list_monitoring_events, list_monitoring_events_for_actor,
    list_nursing_alerts, list_nursing_alerts_for_actor, list_nursing_alerts_scoped,
    list_patient_vitals, list_patient_vitals_for_actor, FluidBalanceFilters, NewFluidBalanceEntry,
    NewMonitoringEvent, NewNursingAlert, NewPatientVitals, NursingAlertFilters,
};
pub use prn::{list_prn_orders, request_prn_dose, PrnError, RequestPrnDose};
pub use staff_assignments::{
    create_ward_staff_assignment, deactivate_ward_staff_assignment, get_ward_staff_assignment,
    list_user_ward_board_assignments, list_ward_staff, list_ward_staff_assignments,
    update_ward_staff_assignment, user_has_active_ward_assignment, ward_staff_role_by_code,
    ward_staff_roles, NewWardStaffAssignment, WardStaffAssignmentUpdate,
};
pub use ward_stock::{
    approve_ward_stock_request, create_ward_stock_request, fulfill_ward_stock_request,
    list_ward_stock_requests, NewWardStockRequest,
};

#[derive(Clone, Debug)]
pub struct WardCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Debug)]
pub enum WardBoardCursor {
    Admitted(WardCursor),
    Attention {
        rank: i32,
        occurred_at: DateTime<Utc>,
        id: Uuid,
    },
}
