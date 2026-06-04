use chrono::{DateTime, Utc};
use uuid::Uuid;

mod admin;
mod admission_cases;
mod analytics;
mod bed_management;
mod discharge_cases;
mod handoff;
mod mar;
mod nursing_task_board;
mod observations_monitoring;
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
pub use handoff::{complete_handoff, create_handoff, get_handoff, list_handoffs, NewHandoff};
pub use mar::{
    administer_medication, create_treatment_sheet, get_medication_administration,
    list_medication_administrations, list_treatment_sheets, schedule_medication_administration,
    NewMedicationAdministration, NewTreatmentSheet,
};
pub use nursing_task_board::{
    cancel_nursing_task, complete_nursing_task, create_nursing_task, get_nursing_task,
    list_nursing_tasks, NewNursingTask, NursingTaskFilters,
};
pub use observations_monitoring::{
    acknowledge_nursing_alert, create_fluid_balance_entry, create_monitoring_event,
    create_nursing_alert, create_patient_vitals, get_nursing_alert, list_fluid_balance_entries,
    list_monitoring_events, list_nursing_alerts, list_patient_vitals, NewFluidBalanceEntry,
    NewMonitoringEvent, NewNursingAlert, NewPatientVitals,
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
