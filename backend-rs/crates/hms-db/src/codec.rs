use anyhow::Context;
use serde::de::DeserializeOwned;
use serde::Serialize;

pub fn encode<T>(value: T) -> anyhow::Result<String>
where
    T: Serialize,
{
    serde_json::to_value(value)?
        .as_str()
        .map(str::to_owned)
        .context("enum serializes to string")
}

pub fn decode<T>(value: &str) -> anyhow::Result<T>
where
    T: DeserializeOwned,
{
    Ok(serde_json::from_value(serde_json::Value::String(
        value.to_owned(),
    ))?)
}

pub fn encode_slice<T>(values: &[T]) -> anyhow::Result<Vec<String>>
where
    T: Copy + Serialize,
{
    values.iter().copied().map(encode).collect()
}
