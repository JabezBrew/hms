use std::env;

use anyhow::{bail, Context};
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::deployment::DeploymentProfile;
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let database_url = env::var("HMS_DATABASE_URL")
        .map_err(|_| anyhow::anyhow!("HMS_DATABASE_URL is required"))?;
    let max_connections = env::var("HMS_DATABASE_MAX_CONNECTIONS")
        .ok()
        .as_deref()
        .map(|value| parse_u32(value, "HMS_DATABASE_MAX_CONNECTIONS"))
        .transpose()?
        .unwrap_or(2);
    let profile = env::var("HMS_DEPLOYMENT_PROFILE")
        .ok()
        .as_deref()
        .map(parse_profile)
        .transpose()?
        .unwrap_or(DeploymentProfile::Hospital);
    let pool = hms_db::pool::connect_with_max_connections(&database_url, max_connections).await?;

    hms_db::migrate::run(&pool).await?;

    if env::var("HMS_PROVISION_BASELINE")
        .ok()
        .as_deref()
        .map(|value| parse_bool(value, "HMS_PROVISION_BASELINE"))
        .transpose()?
        .unwrap_or(false)
    {
        provision_baseline(&pool, &baseline_from_env(profile)?).await?;
    }

    Ok(())
}

fn baseline_from_env(profile: DeploymentProfile) -> anyhow::Result<BaselineProvisioning> {
    let environment = env::var("HMS_ENV").unwrap_or_else(|_| "development".to_owned());
    let production = environment == "production";
    let owner_email = env::var("HMS_BOOTSTRAP_ADMIN_EMAIL").ok();
    let owner_password = env::var("HMS_BOOTSTRAP_ADMIN_PASSWORD").ok();

    if production && owner_email.as_deref().unwrap_or("").trim().is_empty() {
        bail!("HMS_BOOTSTRAP_ADMIN_EMAIL is required when provisioning production");
    }
    if production && owner_password.as_deref().unwrap_or("").trim().is_empty() {
        bail!("HMS_BOOTSTRAP_ADMIN_PASSWORD is required when provisioning production");
    }

    Ok(BaselineProvisioning {
        facility_id: env::var("HMS_FACILITY_ID")
            .ok()
            .as_deref()
            .map(|value| Uuid::parse_str(value).context("HMS_FACILITY_ID must be a UUID"))
            .transpose()?
            .unwrap_or_else(|| Uuid::from_u128(hms_db::provision::FACILITY_ID)),
        facility_code: env::var("HMS_FACILITY_CODE").unwrap_or_else(|_| "HMS".to_owned()),
        facility_name: env::var("HMS_FACILITY_NAME")
            .unwrap_or_else(|_| "HMS Local Facility".to_owned()),
        deployment_profile: profile,
        owner_email: owner_email.unwrap_or_else(|| "owner@hms.local".to_owned()),
        owner_display_name: env::var("HMS_BOOTSTRAP_ADMIN_NAME")
            .unwrap_or_else(|_| "HMS Owner".to_owned()),
        owner_password: owner_password.unwrap_or_else(|| "ChangeMe123!".to_owned()),
        seed_demo_patients: env::var("HMS_SEED_DEMO_DATA")
            .ok()
            .as_deref()
            .map(|value| parse_bool(value, "HMS_SEED_DEMO_DATA"))
            .transpose()?
            .unwrap_or(false),
    })
}

fn parse_u32(value: &str, name: &str) -> anyhow::Result<u32> {
    let parsed = value
        .trim()
        .parse::<u32>()
        .with_context(|| format!("{name} must be an integer"))?;
    if parsed == 0 {
        bail!("{name} must be greater than zero");
    }
    Ok(parsed)
}

fn parse_bool(value: &str, name: &str) -> anyhow::Result<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => bail!("{name} must be a boolean"),
    }
}

fn parse_profile(value: &str) -> anyhow::Result<DeploymentProfile> {
    match value.trim() {
        "chps_compound" => Ok(DeploymentProfile::ChpsCompound),
        "health_center" => Ok(DeploymentProfile::HealthCenter),
        "clinic" => Ok(DeploymentProfile::Clinic),
        "hospital" => Ok(DeploymentProfile::Hospital),
        "district_hospital" => Ok(DeploymentProfile::DistrictHospital),
        "regional_hospital" => Ok(DeploymentProfile::RegionalHospital),
        "teaching_hospital" => Ok(DeploymentProfile::TeachingHospital),
        "hospital_network" => Ok(DeploymentProfile::HospitalNetwork),
        _ => Err(anyhow::anyhow!(
            "HMS_DEPLOYMENT_PROFILE must be a supported deployment profile"
        )),
    }
}
