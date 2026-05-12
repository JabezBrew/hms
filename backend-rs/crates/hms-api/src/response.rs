use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use utoipa::ToSchema;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ObjectResponse<T> {
    pub data: T,
    pub meta: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ListResponse<T> {
    pub data: Vec<T>,
    pub page: PageInfo,
    pub meta: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PageInfo {
    pub next_cursor: Option<String>,
    pub has_next: bool,
    pub limit: u8,
}

pub fn object<T>(data: T) -> ObjectResponse<T> {
    ObjectResponse {
        data,
        meta: json!({}),
    }
}

pub fn list<T>(data: Vec<T>, page: PageInfo) -> ListResponse<T> {
    ListResponse {
        data,
        page,
        meta: json!({}),
    }
}
