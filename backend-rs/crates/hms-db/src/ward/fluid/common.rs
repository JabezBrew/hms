use super::{FluidActor, FluidError};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

#[derive(FromRow)]
pub(super) struct SavedCommand {
    pub actor_user_id: Uuid,
    pub kind: String,
    pub digest: Vec<u8>,
    pub result_id: Option<Uuid>,
    pub result_entry_id: Option<Uuid>,
    pub result_version: Option<i64>,
}
pub(super) async fn reserve<T: Serialize>(
    tx: &mut Transaction<'_, Postgres>,
    actor: &FluidActor,
    key: Uuid,
    kind: &str,
    payload: &T,
) -> anyhow::Result<Option<SavedCommand>> {
    if key.is_nil() {
        return Err(FluidError::InvalidRequest.into());
    }
    let digest = Sha256::digest(serde_json::to_vec(payload)?).to_vec();
    let inserted=sqlx::query("INSERT INTO fluid_write_commands(facility_id,client_request_id,actor_user_id,kind,digest) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING")
  .bind(actor.facility_id).bind(key).bind(actor.user_id).bind(kind).bind(&digest).execute(&mut **tx).await?;
    if inserted.rows_affected() == 1 {
        return Ok(None);
    }
    let saved=sqlx::query_as::<_,SavedCommand>("SELECT actor_user_id,kind,digest,result_id,result_entry_id,result_version FROM fluid_write_commands WHERE facility_id=$1 AND client_request_id=$2")
  .bind(actor.facility_id).bind(key).fetch_one(&mut **tx).await?;
    if saved.actor_user_id != actor.user_id || saved.kind != kind || saved.digest != digest {
        return Err(FluidError::RequestConflict.into());
    }
    if saved.result_id.is_none() || saved.result_version.is_none() {
        anyhow::bail!("fluid_command_incomplete");
    }
    Ok(Some(saved))
}
pub(super) async fn finish(
    tx: &mut Transaction<'_, Postgres>,
    actor: &FluidActor,
    key: Uuid,
    id: Uuid,
    entry: Option<Uuid>,
    version: i64,
) -> anyhow::Result<()> {
    sqlx::query("UPDATE fluid_write_commands SET result_id=$3,result_entry_id=$4,result_version=$5 WHERE facility_id=$1 AND client_request_id=$2")
 .bind(actor.facility_id).bind(key).bind(id).bind(entry).bind(version).execute(&mut **tx).await?;
    Ok(())
}
pub(super) async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    actor: &FluidActor,
    id: Uuid,
    event: &str,
    revision: i64,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'fluid_observation',$6,jsonb_build_object('revision',$7::bigint))")
 .bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(event).bind(id).bind(revision).execute(&mut **tx).await?;
    Ok(())
}
pub(super) async fn clock(tx: &mut Transaction<'_, Postgres>) -> anyhow::Result<DateTime<Utc>> {
    Ok(sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut **tx)
        .await?)
}
pub(super) fn reason(value: &str) -> anyhow::Result<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 1000 {
        return Err(FluidError::InvalidReason.into());
    }
    Ok(value.to_owned())
}
