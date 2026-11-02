use super::*;
use hms_domain::inventory_categories::*;
#[utoipa::path(post,path="/api/v2/inventory/category-administration",operation_id="postInventoryCategory",tag="inventory",security(("bearerAuth"=[])),request_body=CreateInventoryCategoryRequest,responses((status=200,body=ObjectResponse<InventoryCategoryCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn create(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    input: Result<Json<CreateInventoryCategoryRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<InventoryCategoryCommandReceipt>>, ApiError> {
    let Json(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .categories()
            .command(
                &network.context,
                network.authorization_deadline,
                InventoryCategoryReviewedInput::Create {
                    client_request_id: i.client_request_id,
                    code: i.code,
                    name: i.name,
                    description: i.description,
                    parent: i.parent,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/categories/{id}/retire",operation_id="postInventoryCategoryRetire",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=InventoryCategoryLifecycleRequest,responses((status=200,body=ObjectResponse<InventoryCategoryCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn retire(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<InventoryCategoryLifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<InventoryCategoryCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Json(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .categories()
            .command(
                &network.context,
                network.authorization_deadline,
                InventoryCategoryReviewedInput::Retire {
                    client_request_id: i.client_request_id,
                    category_id: id,
                    expected_version: i.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/categories/{id}/reactivate",operation_id="postInventoryCategoryReactivate",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=InventoryCategoryLifecycleRequest,responses((status=200,body=ObjectResponse<InventoryCategoryCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn reactivate(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<InventoryCategoryLifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<InventoryCategoryCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Json(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .categories()
            .command(
                &network.context,
                network.authorization_deadline,
                InventoryCategoryReviewedInput::Reactivate {
                    client_request_id: i.client_request_id,
                    category_id: id,
                    expected_version: i.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/category-administration",operation_id="getInventoryCategoryAdministration",tag="inventory",security(("bearerAuth"=[])),params(InventoryCategoryAdministrationQuery),responses((status=200,body=ListResponse<InventoryCategoryAdministrationListItem>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn list(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    input: Result<
        Query<InventoryCategoryAdministrationQuery>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Json<ListResponse<InventoryCategoryAdministrationListItem>>, ApiError> {
    let Query(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .categories()
            .list(&ctx, i)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/categories/{id}/administration",operation_id="getInventoryCategoryAdministrationById",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,body=ObjectResponse<InventoryCategoryAdministration>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn detail(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<InventoryCategoryAdministration>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .categories()
            .detail(&ctx, id)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/categories/{id}/history",operation_id="getInventoryCategoryHistory",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path),InventoryCategoryHistoryQuery),responses((status=200,body=ListResponse<InventoryCategoryHistoryRow>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn history(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Query<InventoryCategoryHistoryQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<ListResponse<InventoryCategoryHistoryRow>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Query(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .categories()
            .history(&ctx, id, i)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/category-commands/{client_request_id}",operation_id="getInventoryCategoryCommandReceipt",tag="inventory",security(("bearerAuth"=[])),params(("client_request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<InventoryCategoryCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn receipt(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<InventoryCategoryCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .categories()
            .receipt(&network.context, network.authorization_deadline, id)
            .await?,
    ))
}
fn invalid() -> ApiError {
    ApiError::bad_request(
        "invalid_inventory_category_request",
        "Provide the supported category fields, current version and request reference.",
    )
}

#[utoipa::path(post,path="/api/v2/inventory/categories/{id}/corrections",operation_id="postInventoryCategoryCorrection",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=CorrectInventoryCategoryRequest,responses((status=200,body=ObjectResponse<InventoryCategoryCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn correct(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<CorrectInventoryCategoryRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<InventoryCategoryCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Json(i) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .inventory_services()
            .categories()
            .command(
                &network.context,
                network.authorization_deadline,
                InventoryCategoryReviewedInput::Correct {
                    client_request_id: i.client_request_id,
                    category_id: id,
                    expected_version: i.expected_version,
                    name: i.name,
                    description: i.description,
                    parent_change: i.parent_change,
                    reason: i.reason,
                },
            )
            .await?,
    ))
}
