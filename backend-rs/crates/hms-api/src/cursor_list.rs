use chrono::{DateTime, Utc};
use thiserror::Error;
use uuid::Uuid;

use crate::response::{list, ListResponse, PageInfo};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CursorPage<C> {
    pub cursor: Option<C>,
    pub limit: u8,
}

impl<C> CursorPage<C> {
    pub fn fetch_limit(&self) -> i64 {
        i64::from(self.limit) + 1
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CursorListError {
    #[error("cursor is invalid")]
    InvalidCursor,
}

pub fn page_request<C>(
    cursor: Option<&str>,
    limit: Option<u8>,
    default_limit: u8,
    max_limit: u8,
    build_cursor: impl FnOnce(DateTime<Utc>, Uuid) -> C,
) -> Result<CursorPage<C>, CursorListError> {
    let limit = limit.unwrap_or(default_limit).clamp(1, max_limit);
    let cursor = cursor
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| decode_cursor(value, build_cursor))
        .transpose()?;

    Ok(CursorPage { cursor, limit })
}

pub fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    format!("{}:{}", occurred_at.timestamp_micros(), id)
}

pub fn decode_cursor<C>(
    value: &str,
    build_cursor: impl FnOnce(DateTime<Utc>, Uuid) -> C,
) -> Result<C, CursorListError> {
    let (micros, id) = value
        .split_once(':')
        .ok_or(CursorListError::InvalidCursor)?;
    let micros = micros
        .parse::<i64>()
        .map_err(|_| CursorListError::InvalidCursor)?;
    let occurred_at =
        DateTime::<Utc>::from_timestamp_micros(micros).ok_or(CursorListError::InvalidCursor)?;
    let id = id.parse().map_err(|_| CursorListError::InvalidCursor)?;
    Ok(build_cursor(occurred_at, id))
}

pub fn page_response<T>(
    mut rows: Vec<T>,
    page_size: u8,
    cursor_for: impl Fn(&T) -> String,
) -> ListResponse<T> {
    let has_next = rows.len() > page_size as usize;
    if has_next {
        rows.truncate(page_size as usize);
    }
    let next_cursor = if has_next {
        rows.last().map(cursor_for)
    } else {
        None
    };

    list(
        rows,
        PageInfo {
            next_cursor,
            has_next,
            limit: page_size,
        },
    )
}

pub fn static_list<T>(items: Vec<T>, limit: u8) -> ListResponse<T> {
    list(
        items,
        PageInfo {
            next_cursor: None,
            has_next: false,
            limit,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Debug, Eq, PartialEq)]
    struct TestCursor {
        occurred_at: DateTime<Utc>,
        id: Uuid,
    }

    fn build(occurred_at: DateTime<Utc>, id: Uuid) -> TestCursor {
        TestCursor { occurred_at, id }
    }

    #[test]
    fn empty_cursor_is_ignored() {
        let page = page_request(Some("   "), Some(10), 25, 100, build).unwrap();
        assert_eq!(page.cursor, None);
        assert_eq!(page.limit, 10);
    }

    #[test]
    fn invalid_cursor_is_rejected() {
        assert_eq!(
            page_request(Some("not-a-cursor"), None, 25, 100, build),
            Err(CursorListError::InvalidCursor)
        );
    }

    #[test]
    fn max_limit_is_clamped_and_fetch_uses_limit_plus_one() {
        let page = page_request(None, Some(250), 25, 100, build).unwrap();
        assert_eq!(page.limit, 100);
        assert_eq!(page.fetch_limit(), 101);
    }

    #[test]
    fn page_response_reports_has_next_and_next_cursor() {
        let now = Utc::now();
        let first_id = Uuid::new_v4();
        let second_id = Uuid::new_v4();
        let rows = vec![
            TestCursor {
                occurred_at: now,
                id: first_id,
            },
            TestCursor {
                occurred_at: now,
                id: second_id,
            },
        ];

        let response = page_response(rows, 1, |row| encode_cursor(row.occurred_at, row.id));
        assert!(response.page.has_next);
        assert_eq!(response.page.limit, 1);
        assert_eq!(response.data.len(), 1);
        assert_eq!(
            response.page.next_cursor,
            Some(encode_cursor(now, first_id))
        );
    }
}
