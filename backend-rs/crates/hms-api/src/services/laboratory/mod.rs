mod catalog;
mod common;
mod orders;
mod results;
mod specimens;

pub use catalog::LabCatalogService;
pub use orders::LabOrdersService;
pub use results::LabResultsService;
pub use specimens::LabSpecimensService;

use crate::state::AppState;

#[derive(Clone)]
pub struct LaboratoryServices {
    state: AppState,
}

impl LaboratoryServices {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub fn catalog(&self) -> LabCatalogService {
        LabCatalogService::new(self.state.clone())
    }

    pub fn orders(&self) -> LabOrdersService {
        LabOrdersService::new(self.state.clone())
    }

    pub fn specimens(&self) -> LabSpecimensService {
        LabSpecimensService::new(self.state.clone())
    }

    pub fn results(&self) -> LabResultsService {
        LabResultsService::new(self.state.clone())
    }
}

impl AppState {
    pub fn laboratory_services(&self) -> LaboratoryServices {
        LaboratoryServices::new(self.clone())
    }
}
