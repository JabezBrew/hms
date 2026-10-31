use super::*;
use hms_domain::inventory_items::*;
#[utoipa::path(post,path="/api/v2/inventory/items",operation_id="postInventoryItemCreate",tag="inventory",security(("bearerAuth"=[])),request_body=CreateInventoryItemRequest,responses((status=200,body=ObjectResponse<InventoryItemCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn create(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    input: Result<Json<CreateInventoryItemRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<InventoryItemCommandReceipt>>, ApiError> {
    let Json(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .items()
            .command(
                &network.context,
                network.authorization_deadline,
                InventoryItemReviewedInput::Create {
                    client_request_id: i.client_request_id,
                    category_id: i.category_id,
                    code: i.code,
                    name: i.name,
                    unit: i.unit,
                    item_type: i.item_type,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/items/{id}/retire",operation_id="postInventoryItemRetire",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=InventoryItemLifecycleRequest,responses((status=200,body=ObjectResponse<InventoryItemCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn retire(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<InventoryItemLifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<InventoryItemCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Json(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .items()
            .command(
                &network.context,
                network.authorization_deadline,
                InventoryItemReviewedInput::Retire {
                    client_request_id: i.client_request_id,
                    item_id: id,
                    expected_version: i.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/items/{id}/reactivate",operation_id="postInventoryItemReactivate",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=InventoryItemLifecycleRequest,responses((status=200,body=ObjectResponse<InventoryItemCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn reactivate(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<InventoryItemLifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<InventoryItemCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Json(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .items()
            .command(
                &network.context,
                network.authorization_deadline,
                InventoryItemReviewedInput::Reactivate {
                    client_request_id: i.client_request_id,
                    item_id: id,
                    expected_version: i.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/items/administration",operation_id="getInventoryItemAdministration",tag="inventory",security(("bearerAuth"=[])),params(InventoryItemAdministrationQuery),responses((status=200,body=ListResponse<GovernedInventoryItem>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn list(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    input: Result<
        Query<InventoryItemAdministrationQuery>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Json<ListResponse<GovernedInventoryItem>>, ApiError> {
    let Query(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state.inventory_services().items().list(&ctx, i).await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/items/{id}/administration",operation_id="getInventoryItemAdministrationById",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,body=ObjectResponse<InventoryItemAdministration>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn detail(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<InventoryItemAdministration>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    Ok(Json(
        state.inventory_services().items().detail(&ctx, id).await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/items/{id}/catalog-history",operation_id="getInventoryItemCatalogHistory",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path),InventoryItemHistoryQuery),responses((status=200,body=ListResponse<InventoryItemHistoryRow>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn history(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Query<InventoryItemHistoryQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<ListResponse<InventoryItemHistoryRow>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Query(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .items()
            .history(&ctx, id, i)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/item-commands/{client_request_id}",operation_id="getInventoryItemCommand",tag="inventory",security(("bearerAuth"=[])),params(("client_request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<InventoryItemCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn receipt(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<InventoryItemCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .items()
            .receipt(&network.context, network.authorization_deadline, id)
            .await?,
    ))
}
fn invalid() -> ApiError {
    ApiError::bad_request(
        "invalid_inventory_item_request",
        "Provide the supported item fields, current version and request reference.",
    )
}
