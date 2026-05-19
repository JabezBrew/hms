use std::env;
use std::net::SocketAddr;
use std::time::Duration;

use anyhow::{bail, Context};
use hms_domain::deployment::DeploymentProfile;

#[derive(Clone, Debug)]
pub struct Config {
    pub environment: String,
    pub listen_addr: SocketAddr,
    pub database_url: String,
    pub database_max_connections: u32,
    pub redis_addr: Option<String>,
    pub facility_code: String,
    pub jwt_secret: String,
    pub access_token_ttl: Duration,
    pub refresh_token_ttl: Duration,
    pub cookie_secure: bool,
    pub deployment_profile: DeploymentProfile,
    pub auto_migrate: bool,
    pub provision_baseline: bool,
    pub search_index_rebuild_on_start: bool,
    pub rum_enabled: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let environment = env::var("HMS_ENV").unwrap_or_else(|_| "development".to_owned());
        let listen_addr = env::var("HMS_API_LISTEN_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:8080".to_owned())
            .parse()
            .context("HMS_API_LISTEN_ADDR must be a socket address")?;
        let database_url = env::var("HMS_DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres@127.0.0.1:5432/hms_v2".to_owned());
        let database_max_connections = match env::var("HMS_DATABASE_MAX_CONNECTIONS") {
            Ok(value) => parse_u32(&value, "HMS_DATABASE_MAX_CONNECTIONS")?,
            Err(_) => 10,
        };
        let redis_addr = env::var("HMS_REDIS_ADDR")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let facility_code = env::var("HMS_FACILITY_CODE").unwrap_or_else(|_| "HMS".to_owned());
        let jwt_secret = env::var("HMS_JWT_SECRET").unwrap_or_else(|_| {
            "development-only-hms-v2-jwt-secret-change-before-production".to_owned()
        });

        if environment == "production" && jwt_secret.contains("development-only") {
            bail!("HMS_JWT_SECRET must be set to a production secret");
        }
        if environment == "production" && database_url.contains("127.0.0.1") {
            bail!("HMS_DATABASE_URL must be set to a production database URL");
        }
        let cookie_secure = match env::var("HMS_COOKIE_SECURE") {
            Ok(value) => parse_bool(&value, "HMS_COOKIE_SECURE")?,
            Err(_) => environment == "production",
        };
        if environment == "production" && !cookie_secure {
            bail!("HMS_COOKIE_SECURE must stay enabled in production");
        }
        let deployment_profile = match env::var("HMS_DEPLOYMENT_PROFILE") {
            Ok(value) => parse_deployment_profile(&value)?,
            Err(_) => DeploymentProfile::Hospital,
        };
        let auto_migrate = match env::var("HMS_AUTO_MIGRATE") {
            Ok(value) => parse_bool(&value, "HMS_AUTO_MIGRATE")?,
            Err(_) => false,
        };
        let provision_baseline = match env::var("HMS_PROVISION_BASELINE") {
            Ok(value) => parse_bool(&value, "HMS_PROVISION_BASELINE")?,
            Err(_) => false,
        };
        let search_index_rebuild_on_start = match env::var("HMS_SEARCH_INDEX_REBUILD_ON_START") {
            Ok(value) => parse_bool(&value, "HMS_SEARCH_INDEX_REBUILD_ON_START")?,
            Err(_) => false,
        };
        let rum_enabled = match env::var("HMS_RUM_ENABLED") {
            Ok(value) => parse_bool(&value, "HMS_RUM_ENABLED")?,
            Err(_) => false,
        };

        Ok(Self {
            environment,
            listen_addr,
            database_url,
            database_max_connections,
            redis_addr,
            facility_code,
            jwt_secret,
            access_token_ttl: Duration::from_secs(10 * 60),
            refresh_token_ttl: Duration::from_secs(12 * 60 * 60),
            cookie_secure,
            deployment_profile,
            auto_migrate,
            provision_baseline,
            search_index_rebuild_on_start,
            rum_enabled,
        })
    }

    pub fn for_tests_with_database_url(database_url: String) -> Self {
        Self {
            environment: "test".to_owned(),
            listen_addr: "127.0.0.1:0".parse().expect("static test address parses"),
            database_url,
            database_max_connections: 10,
            redis_addr: None,
            facility_code: "HMS".to_owned(),
            jwt_secret: "test-only-hms-v2-jwt-secret".to_owned(),
            access_token_ttl: Duration::from_secs(10 * 60),
            refresh_token_ttl: Duration::from_secs(12 * 60 * 60),
            cookie_secure: false,
            deployment_profile: DeploymentProfile::Hospital,
            auto_migrate: true,
            provision_baseline: true,
            search_index_rebuild_on_start: true,
            rum_enabled: false,
        }
    }
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

fn parse_deployment_profile(value: &str) -> anyhow::Result<DeploymentProfile> {
    match value.trim() {
        "chps_compound" => Ok(DeploymentProfile::ChpsCompound),
        "health_center" => Ok(DeploymentProfile::HealthCenter),
        "clinic" => Ok(DeploymentProfile::Clinic),
        "hospital" => Ok(DeploymentProfile::Hospital),
        "district_hospital" => Ok(DeploymentProfile::DistrictHospital),
        "regional_hospital" => Ok(DeploymentProfile::RegionalHospital),
        "teaching_hospital" => Ok(DeploymentProfile::TeachingHospital),
        "hospital_network" => Ok(DeploymentProfile::HospitalNetwork),
        _ => bail!("HMS_DEPLOYMENT_PROFILE must be a supported deployment profile"),
    }
}
