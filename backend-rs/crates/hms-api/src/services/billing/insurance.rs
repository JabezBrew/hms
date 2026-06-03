use hms_db::billing::{InsurancePlanFilters, InsuranceProviderFilters, PatientInsuranceFilters};
use hms_domain::billing::{
    BillingListQuery, InsurancePlanListItem, InsurancePlanListQuery, InsuranceProviderListItem,
    InsuranceProviderListQuery, PatientInsuranceListItem, PatientInsuranceListQuery,
};
use hms_domain::deployment::PermissionCode;
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::ListResponse;
use crate::state::AppState;

fn mask_sensitive_identifier(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let suffix = trimmed
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("redacted-{suffix}")
}

fn redact_patient_insurance_identifiers(
    mut item: PatientInsuranceListItem,
) -> PatientInsuranceListItem {
    item.policy_number = mask_sensitive_identifier(&item.policy_number);
    item.member_id = None;
    item.subscriber_number = None;
    item
}

#[derive(Clone)]
pub struct InsuranceService {
    state: AppState,
}

impl InsuranceService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_providers(
        &self,
        ctx: &hms_access::RequestContext,
        query: InsuranceProviderListQuery,
    ) -> Result<ListResponse<InsuranceProviderListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let (cursor, page_size) = common::decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::billing::list_insurance_providers(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            InsuranceProviderFilters {
                search: query.search,
                is_active: query.is_active,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "insurance_provider_list_failed",
                "Insurance providers could not be loaded.",
            )
        })?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn list_plans(
        &self,
        ctx: &hms_access::RequestContext,
        query: InsurancePlanListQuery,
    ) -> Result<ListResponse<InsurancePlanListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let (cursor, page_size) = common::decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::billing::list_insurance_plans(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            InsurancePlanFilters {
                provider_id: query.provider_id,
                search: query.search,
                is_active: query.is_active,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "insurance_plan_list_failed",
                "Insurance plans could not be loaded.",
            )
        })?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn list_patient_insurances(
        &self,
        ctx: &hms_access::RequestContext,
        query: PatientInsuranceListQuery,
    ) -> Result<ListResponse<PatientInsuranceListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let patient_id = query.patient_id;
        let include_sensitive_identifiers = patient_id.is_some();
        if let Some(patient_id) = patient_id {
            let _patient = common::load_patient_for_access(&self.state, ctx, patient_id).await?;
        }
        let (cursor, page_size) = common::page_request(BillingListQuery {
            cursor: query.cursor,
            limit: query.limit,
            patient_id,
        })?;
        let rows = hms_db::billing::list_patient_insurances(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            PatientInsuranceFilters {
                patient_id,
                search: query.search,
                is_active: query.is_active,
                search_sensitive_identifiers: include_sensitive_identifiers,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_insurance_list_failed",
                "Patient insurance records could not be loaded.",
            )
        })?;
        let rows = if include_sensitive_identifiers {
            rows
        } else {
            rows.into_iter()
                .map(redact_patient_insurance_identifiers)
                .collect()
        };
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }
}
