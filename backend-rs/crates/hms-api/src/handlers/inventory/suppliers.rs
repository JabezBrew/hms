use super::*;
use hms_domain::inventory_suppliers::*;
#[utoipa::path(post,path="/api/v2/inventory/supplier-administration",operation_id="postInventorySupplier",tag="inventory",security(("bearerAuth"=[])),request_body=CreateInventorySupplierRequest,responses((status=200,body=ObjectResponse<InventorySupplierCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn create(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    input: Result<Json<CreateInventorySupplierRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<InventorySupplierCommandReceipt>>, ApiError> {
    let Json(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .suppliers()
            .command(
                &network.context,
                network.authorization_deadline,
                InventorySupplierReviewedInput::Create {
                    client_request_id: i.client_request_id,
                    code: i.code,
                    name: i.name,
                    contact_name: i.contact_name,
                    phone: i.phone,
                    email: i.email,
                    address: i.address,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/suppliers/{id}/retire",operation_id="postInventorySupplierRetire",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=InventorySupplierLifecycleRequest,responses((status=200,body=ObjectResponse<InventorySupplierCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn retire(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<InventorySupplierLifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<InventorySupplierCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Json(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .suppliers()
            .command(
                &network.context,
                network.authorization_deadline,
                InventorySupplierReviewedInput::Retire {
                    client_request_id: i.client_request_id,
                    supplier_id: id,
                    expected_version: i.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/suppliers/{id}/reactivate",operation_id="postInventorySupplierReactivate",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=InventorySupplierLifecycleRequest,responses((status=200,body=ObjectResponse<InventorySupplierCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn reactivate(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<InventorySupplierLifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<InventorySupplierCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Json(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .suppliers()
            .command(
                &network.context,
                network.authorization_deadline,
                InventorySupplierReviewedInput::Reactivate {
                    client_request_id: i.client_request_id,
                    supplier_id: id,
                    expected_version: i.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/supplier-administration",operation_id="getInventorySupplierAdministration",tag="inventory",security(("bearerAuth"=[])),params(InventorySupplierAdministrationQuery),responses((status=200,body=ListResponse<InventorySupplierAdministrationListItem>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn list(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    input: Result<
        Query<InventorySupplierAdministrationQuery>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Json<ListResponse<InventorySupplierAdministrationListItem>>, ApiError> {
    let Query(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state.inventory_services().suppliers().list(&ctx, i).await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/suppliers/{id}/administration",operation_id="getInventorySupplierAdministrationById",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,body=ObjectResponse<InventorySupplierAdministration>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn detail(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<InventorySupplierAdministration>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .suppliers()
            .detail(&ctx, id)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/suppliers/{id}/history",operation_id="getInventorySupplierHistory",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path),InventorySupplierHistoryQuery),responses((status=200,body=ListResponse<InventorySupplierHistoryRow>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn history(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Query<InventorySupplierHistoryQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<ListResponse<InventorySupplierHistoryRow>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Query(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .suppliers()
            .history(&ctx, id, i)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/supplier-commands/{client_request_id}",operation_id="getInventorySupplierCommandReceipt",tag="inventory",security(("bearerAuth"=[])),params(("client_request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<InventorySupplierCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn receipt(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<InventorySupplierCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .suppliers()
            .receipt(&network.context, network.authorization_deadline, id)
            .await?,
    ))
}
fn invalid() -> ApiError {
    ApiError::bad_request(
        "invalid_inventory_supplier_request",
        "Provide the supported supplier fields, current version and request reference.",
    )
}

#[utoipa::path(post,path="/api/v2/inventory/suppliers/{id}/corrections",operation_id="postInventorySupplierCorrection",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=CorrectInventorySupplierRequest,responses((status=200,body=ObjectResponse<InventorySupplierCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn correct(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<CorrectInventorySupplierRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<InventorySupplierCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Json(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .suppliers()
            .command(
                &network.context,
                network.authorization_deadline,
                InventorySupplierReviewedInput::Correct {
                    client_request_id: i.client_request_id,
                    supplier_id: id,
                    expected_version: i.expected_version,
                    name: i.name,
                    contact_name: i.contact_name,
                    phone: i.phone,
                    email: i.email,
                    address: i.address,
                    reason: i.reason,
                },
            )
            .await?,
    ))
}
