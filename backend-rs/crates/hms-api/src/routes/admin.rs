use axum::routing::{get, patch, post, put};
use axum::Router;

use crate::handlers::admin;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v2/staff/directory", get(admin::list_staff_directory))
        .route(
            "/api/v2/admin/org-units",
            get(admin::list_org_units).post(admin::create_org_unit),
        )
        .route("/api/v2/admin/org-units/:id", get(admin::get_org_unit))
        .route(
            "/api/v2/admin/org-units/:id/ancestors",
            get(admin::list_org_unit_ancestors),
        )
        .route(
            "/api/v2/admin/org-units/:id/children",
            get(admin::list_org_unit_children),
        )
        .route(
            "/api/v2/admin/org-units/:id/descendants",
            get(admin::list_org_unit_descendants),
        )
        .route(
            "/api/v2/admin/position-templates",
            get(admin::list_position_templates).post(admin::create_position_template),
        )
        .route(
            "/api/v2/admin/positions",
            get(admin::list_positions).post(admin::create_position),
        )
        .route(
            "/api/v2/admin/authority-appointments",
            get(admin::list_authority_appointments).post(admin::create_authority_appointment),
        )
        .route(
            "/api/v2/admin/permission-assignments",
            get(admin::list_permission_assignments).post(admin::create_permission_assignment),
        )
        .route(
            "/api/v2/admin/features",
            get(admin::list_feature_entitlements),
        )
        .route(
            "/api/v2/admin/features/:key",
            patch(admin::update_feature_entitlement).delete(admin::delete_feature_entitlement),
        )
        .route(
            "/api/v2/admin/staff",
            get(admin::list_staff).post(admin::create_staff),
        )
        .route(
            "/api/v2/admin/staff/filter-facets",
            get(admin::staff_filter_facets),
        )
        .route(
            "/api/v2/admin/staff/:id",
            get(admin::get_staff).patch(admin::update_staff),
        )
        .route(
            "/api/v2/admin/staff/:id/force-password-reset",
            post(admin::force_staff_password_reset),
        )
        .route(
            "/api/v2/admin/staff/:id/deactivate",
            post(admin::deactivate_staff),
        )
        .route(
            "/api/v2/admin/staff/:id/reactivate",
            post(admin::reactivate_staff),
        )
        .route(
            "/api/v2/admin/staff/:id/practitioner-profile",
            put(admin::upsert_staff_practitioner_profile),
        )
        .route(
            "/api/v2/admin/practitioners",
            get(admin::list_practitioners),
        )
        .route(
            "/api/v2/admin/practitioners/:id",
            get(admin::get_practitioner),
        )
        .route(
            "/api/v2/admin/committees",
            get(admin::list_committees).post(admin::create_committee),
        )
        .route(
            "/api/v2/admin/delegations",
            get(admin::list_delegations).post(admin::create_delegation),
        )
        .route("/api/v2/admin/audit-events", get(admin::list_audit_events))
        .route(
            "/api/v2/admin/audit-events/search",
            post(admin::search_audit_events),
        )
}
