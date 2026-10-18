use super::*;
use hms_domain::organization_units::*;

#[utoipa::path(post,path="/api/v2/admin/org-units/{id}/rename",operation_id="postAdminOrgUnitRename",tag="admin",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=RenameOrganizationUnitRequest,responses((status=200,body=ObjectResponse<OrganizationUnitCommandReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn rename(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    path: Result<Path<Uuid>, PathRejection>,
    input: Result<Json<RenameOrganizationUnitRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<OrganizationUnitCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid_organization_request())?;
    let Json(input) = input.map_err(|_| invalid_organization_request())?;
    Ok(Json(
        state
            .admin_service()
            .command_org_unit(
                &user,
                OrganizationUnitReviewedInput::Rename {
                    client_request_id: input.client_request_id,
                    unit_id: id,
                    expected_version: input.expected_version,
                    name: input.name,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/admin/org-units/{id}/retire",operation_id="postAdminOrgUnitRetire",tag="admin",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=OrganizationUnitLifecycleRequest,responses((status=200,body=ObjectResponse<OrganizationUnitCommandReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn retire(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    path: Result<Path<Uuid>, PathRejection>,
    input: Result<Json<OrganizationUnitLifecycleRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<OrganizationUnitCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid_organization_request())?;
    let Json(input) = input.map_err(|_| invalid_organization_request())?;
    Ok(Json(
        state
            .admin_service()
            .command_org_unit(
                &user,
                OrganizationUnitReviewedInput::Retire {
                    client_request_id: input.client_request_id,
                    unit_id: id,
                    expected_version: input.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/admin/org-units/{id}/reactivate",operation_id="postAdminOrgUnitReactivate",tag="admin",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=OrganizationUnitLifecycleRequest,responses((status=200,body=ObjectResponse<OrganizationUnitCommandReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn reactivate(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    path: Result<Path<Uuid>, PathRejection>,
    input: Result<Json<OrganizationUnitLifecycleRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<OrganizationUnitCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid_organization_request())?;
    let Json(input) = input.map_err(|_| invalid_organization_request())?;
    Ok(Json(
        state
            .admin_service()
            .command_org_unit(
                &user,
                OrganizationUnitReviewedInput::Reactivate {
                    client_request_id: input.client_request_id,
                    unit_id: id,
                    expected_version: input.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/admin/org-units/commands/{client_request_id}",operation_id="getAdminOrgUnitCommand",tag="admin",security(("bearerAuth"=[])),params(("client_request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<OrganizationUnitCommandReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn receipt(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ObjectResponse<OrganizationUnitCommandReceipt>>, ApiError> {
    let Path(key) = path.map_err(|_| invalid_organization_request())?;
    Ok(Json(
        state.admin_service().org_unit_receipt(&user, key).await?,
    ))
}
