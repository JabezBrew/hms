mod catalog;
mod common;
mod controlled_substances;
mod pharmacy;
mod procurement;
mod stock_control;

pub use catalog::InventoryCatalogService;
pub use controlled_substances::ControlledSubstancesService;
pub use pharmacy::PharmacyService;
pub use procurement::ProcurementService;
pub use stock_control::StockControlService;

use crate::state::AppState;

#[derive(Clone)]
pub struct InventoryServices {
    state: AppState,
}

impl InventoryServices {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub fn controlled_substances(&self) -> ControlledSubstancesService {
        ControlledSubstancesService::new(self.state.clone())
    }

    pub fn catalog(&self) -> InventoryCatalogService {
        InventoryCatalogService::new(self.state.clone())
    }

    pub fn pharmacy(&self) -> PharmacyService {
        PharmacyService::new(self.state.clone())
    }

    pub fn procurement(&self) -> ProcurementService {
        ProcurementService::new(self.state.clone())
    }

    pub fn stock_control(&self) -> StockControlService {
        StockControlService::new(self.state.clone())
    }
}

impl AppState {
    pub fn inventory_services(&self) -> InventoryServices {
        InventoryServices::new(self.clone())
    }
}
