use super::*;
use hms_domain::storage_locations::*;
#[utoipa::path(post,path="/api/v2/inventory/storage-locations",operation_id="postStorageLocationCreate",tag="inventory",security(("bearerAuth"=[])),request_body=CreateStorageLocationRequest,responses((status=200,body=ObjectResponse<StorageLocationCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn create(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    input: Result<Json<CreateStorageLocationRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<StorageLocationCommandReceipt>>, ApiError> {
    let Json(input) = input.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .inventory_services()
            .storage_locations()
            .command(
                &network.context,
                network.authorization_deadline,
                StorageLocationReviewedInput::Create {
                    client_request_id: input.client_request_id,
                    code: input.code,
                    name: input.name,
                    location_type: input.location_type,
                    temperature_zone: input.temperature_zone,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/storage-locations/{id}/rename",operation_id="postStorageLocationRename",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=RenameStorageLocationRequest,responses((status=200,body=ObjectResponse<StorageLocationCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn rename(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<RenameStorageLocationRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<StorageLocationCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid_request())?;
    let Json(input) = input.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .inventory_services()
            .storage_locations()
            .command(
                &network.context,
                network.authorization_deadline,
                StorageLocationReviewedInput::Rename {
                    client_request_id: input.client_request_id,
                    location_id: id,
                    expected_version: input.expected_version,
                    name: input.name,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/storage-locations/{id}/retire",operation_id="postStorageLocationRetire",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=StorageLocationLifecycleRequest,responses((status=200,body=ObjectResponse<StorageLocationCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn retire(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<StorageLocationLifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<StorageLocationCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid_request())?;
    let Json(input) = input.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .inventory_services()
            .storage_locations()
            .command(
                &network.context,
                network.authorization_deadline,
                StorageLocationReviewedInput::Retire {
                    client_request_id: input.client_request_id,
                    location_id: id,
                    expected_version: input.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/storage-locations/{id}/reactivate",operation_id="postStorageLocationReactivate",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=StorageLocationLifecycleRequest,responses((status=200,body=ObjectResponse<StorageLocationCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn reactivate(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<StorageLocationLifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<StorageLocationCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid_request())?;
    let Json(input) = input.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .inventory_services()
            .storage_locations()
            .command(
                &network.context,
                network.authorization_deadline,
                StorageLocationReviewedInput::Reactivate {
                    client_request_id: input.client_request_id,
                    location_id: id,
                    expected_version: input.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/storage-locations/commands/{client_request_id}",operation_id="getStorageLocationCommand",tag="inventory",security(("bearerAuth"=[])),params(("client_request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<StorageLocationCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn receipt(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<StorageLocationCommandReceipt>>, ApiError> {
    let Path(key) = path.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .inventory_services()
            .storage_locations()
            .receipt(&network.context, network.authorization_deadline, key)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/storage-locations/administration",operation_id="getStorageLocationAdministration",tag="inventory",security(("bearerAuth"=[])),params(StorageLocationAdministrationQuery),responses((status=200,body=ListResponse<GovernedStorageLocation>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse)))]
pub async fn list(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    input: Result<
        Query<StorageLocationAdministrationQuery>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Json<ListResponse<GovernedStorageLocation>>, ApiError> {
    let Query(input) = input.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .inventory_services()
            .storage_locations()
            .list(&user, input)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/storage-locations/{id}/administration",operation_id="getStorageLocationAdministrationById",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,body=ObjectResponse<GovernedStorageLocation>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse)))]
pub async fn detail(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<GovernedStorageLocation>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .inventory_services()
            .storage_locations()
            .detail(&user, id)
            .await?,
    ))
}

fn invalid_request() -> ApiError {
    ApiError::bad_request(
        "invalid_storage_location_command",
        "Review the supported storage location fields, exact identifier and bounded filters.",
    )
}
