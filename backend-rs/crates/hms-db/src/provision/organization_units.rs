//! Seed defaults never overwrite governed organization identity or maintenance.
use super::*;

pub(super) async fn retain(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    facility: Uuid,
    parent: Option<Uuid>,
    code: &str,
    name: &str,
    unit_type: OrgUnitType,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO organization_units(id,facility_id,parent_unit_id,code,name,unit_type) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(facility_id,code) DO NOTHING")
        .bind(id).bind(facility).bind(parent).bind(code).bind(name).bind(codec::encode(unit_type)?).execute(&mut **tx).await?;
    let valid:Option<bool>=sqlx::query_scalar("SELECT id=$3 AND parent_unit_id IS NOT DISTINCT FROM $4 AND unit_type=$5 AND is_active FROM organization_units WHERE facility_id=$1 AND code=$2 FOR SHARE")
        .bind(facility).bind(code).bind(id).bind(parent).bind(codec::encode(unit_type)?).fetch_optional(&mut **tx).await?;
    anyhow::ensure!(
        valid == Some(true),
        "organization_seed_existing_configuration_unavailable"
    );
    Ok(())
}
