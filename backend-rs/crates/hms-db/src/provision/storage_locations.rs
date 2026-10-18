//! Default locations preserve governed metadata and never reactivate history.
use super::*;
pub(super) async fn retain(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    facility: Uuid,
    code: &str,
    name: &str,
    kind: &str,
    zone: &str,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name,location_type,temperature_zone)VALUES($1,$2,$3,$4,$5,$6)ON CONFLICT(facility_id,code)DO NOTHING").bind(id).bind(facility).bind(code).bind(name).bind(kind).bind(zone).execute(&mut **tx).await?;
    let valid:Option<bool>=sqlx::query_scalar("SELECT id=$3 AND location_type=$4 AND temperature_zone=$5 AND is_active FROM storage_locations WHERE facility_id=$1 AND code=$2 FOR SHARE NOWAIT").bind(facility).bind(code).bind(id).bind(kind).bind(zone).fetch_optional(&mut **tx).await?;
    anyhow::ensure!(
        valid == Some(true),
        "storage_location_seed_existing_configuration_unavailable"
    );
    Ok(())
}
