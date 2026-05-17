mod common;
mod financial_workflow;
mod nhis;

pub use financial_workflow::FinancialWorkflowService;
pub use nhis::NhisService;

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

    pub fn nhis(&self) -> NhisService {
        NhisService::new(self.state.clone())
    }
}

impl AppState {
    pub fn billing_services(&self) -> BillingServices {
        BillingServices::new(self.clone())
    }
}
