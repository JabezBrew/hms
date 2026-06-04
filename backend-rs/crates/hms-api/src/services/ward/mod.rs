mod admin;
mod admission_cases;
mod analytics;
mod bed_management;
mod common;
mod discharge_cases;
mod handoff;
mod mar;
mod nursing_task_board;
mod observations_monitoring;
mod ward_stock;

pub use admin::WardAdminService;
pub use admission_cases::AdmissionCasesService;
pub use analytics::WardAnalyticsService;
pub use bed_management::BedManagementService;
pub use discharge_cases::DischargeCasesService;
pub use handoff::HandoffService;
pub use mar::MarService;
pub use nursing_task_board::NursingTaskBoardService;
pub use observations_monitoring::ObservationsMonitoringService;
pub use ward_stock::WardStockService;

use crate::state::AppState;

#[derive(Clone)]
pub struct WardServices {
    state: AppState,
}

impl WardServices {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub fn admin(&self) -> WardAdminService {
        WardAdminService::new(self.state.clone())
    }

    pub fn analytics(&self) -> WardAnalyticsService {
        WardAnalyticsService::new(self.state.clone())
    }

    pub fn bed_management(&self) -> BedManagementService {
        BedManagementService::new(self.state.clone())
    }

    pub fn admission_cases(&self) -> AdmissionCasesService {
        AdmissionCasesService::new(self.state.clone())
    }

    pub fn discharge_cases(&self) -> DischargeCasesService {
        DischargeCasesService::new(self.state.clone())
    }

    pub fn nursing_task_board(&self) -> NursingTaskBoardService {
        NursingTaskBoardService::new(self.state.clone())
    }

    pub fn mar(&self) -> MarService {
        MarService::new(self.state.clone())
    }

    pub fn observations_monitoring(&self) -> ObservationsMonitoringService {
        ObservationsMonitoringService::new(self.state.clone())
    }

    pub fn handoff(&self) -> HandoffService {
        HandoffService::new(self.state.clone())
    }

    pub fn ward_stock(&self) -> WardStockService {
        WardStockService::new(self.state.clone())
    }
}

impl AppState {
    pub fn ward_services(&self) -> WardServices {
        WardServices::new(self.clone())
    }
}
