mod cash_control;
mod catalog;
mod common;
mod financial_workflow;
mod nhis;
mod overview;

pub use cash_control::CashControlService;
pub use catalog::BillingCatalogService;
pub use financial_workflow::FinancialWorkflowService;
pub use nhis::NhisService;
pub use overview::BillingOverviewService;

use crate::state::AppState;

#[derive(Clone)]
pub struct BillingServices {
    state: AppState,
}

impl BillingServices {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub fn financial_workflow(&self) -> FinancialWorkflowService {
        FinancialWorkflowService::new(self.state.clone())
    }

    pub fn catalog(&self) -> BillingCatalogService {
        BillingCatalogService::new(self.state.clone())
    }

    pub fn cash_control(&self) -> CashControlService {
        CashControlService::new(self.state.clone())
    }

    pub fn overview(&self) -> BillingOverviewService {
        BillingOverviewService::new(self.state.clone())
    }

    pub fn nhis(&self) -> NhisService {
        NhisService::new(self.state.clone())
    }
}

impl AppState {
    pub fn billing_services(&self) -> BillingServices {
        BillingServices::new(self.clone())
    }
}
