//! Deliberate local-operator authentication readiness and identity-check seam.
//! Never runs automatically, never creates roles or ordinary sessions.
use anyhow::{bail, Context};
use std::{
    io::{Read, Write},
    path::PathBuf,
};
use uuid::Uuid;

#[derive(Default)]
struct Options {
    facility: Option<String>,
    user: Option<Uuid>,
    credential: Option<Uuid>,
    token_file: Option<PathBuf>,
    identity_checked: bool,
    reason_stdin: bool,
}
fn parse(args: impl IntoIterator<Item = String>) -> anyhow::Result<Options> {
    let mut args = args.into_iter();
    let mut o = Options::default();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--identity-checked" if !o.identity_checked => o.identity_checked = true,
            "--reason-stdin" if !o.reason_stdin => o.reason_stdin = true,
            "--facility-code" if o.facility.is_none() => {
                o.facility = Some(args.next().context("A facility option is required")?);
            }
            "--user-id" if o.user.is_none() => {
                o.user = Some(
                    args.next()
                        .context("A named user is required")?
                        .parse()
                        .ok()
                        .filter(|v: &Uuid| !v.is_nil())
                        .context("A non-nil user UUID is required")?,
                );
            }
            "--credential-id" if o.credential.is_none() => {
                o.credential = Some(
                    args.next()
                        .context("A named key is required")?
                        .parse()
                        .ok()
                        .filter(|v: &Uuid| !v.is_nil())
                        .context("A non-nil key row UUID is required")?,
                );
            }
            "--token-file" if o.token_file.is_none() => {
                let path = PathBuf::from(args.next().context("A private token file is required")?);
                if !path.is_absolute() {
                    bail!("Use an explicit absolute token file path")
                };
                o.token_file = Some(path);
            }
            _ => bail!("Unsupported or repeated authentication operator option"),
        }
    }
    if o.facility
        .as_ref()
        .is_none_or(|v| v.trim().is_empty() || v.len() > 64)
    {
        bail!("An explicit facility code is required")
    }
    Ok(o)
}
async fn facility(pool: &hms_db::PgPool, code: &str) -> anyhow::Result<Uuid> {
    hms_db::facilities::facility_id_by_code(pool, code)
        .await?
        .context("The named active facility was not found")
}
pub async fn run(command: &str, args: impl IntoIterator<Item = String>) -> anyhow::Result<()> {
    let o = parse(args)?;
    if command == "auth-readiness"
        && (o.user.is_some()
            || o.credential.is_some()
            || o.token_file.is_some()
            || o.identity_checked
            || o.reason_stdin)
    {
        bail!("Readiness accepts only the explicit facility code")
    }
    if command != "auth-readiness" && (!o.identity_checked || o.user.is_none()) {
        bail!("Named-user recovery requires an explicit --identity-checked acknowledgment")
    }
    run_inner(command,o).await.map_err(|_|anyhow::anyhow!("Authentication operator action could not be confirmed. No identifiers, key material or connection details are printed; inspect the private workflow safely."))
}
async fn run_inner(command: &str, o: Options) -> anyhow::Result<()> {
    let (url, max) = crate::database_settings_from_env()?;
    let pool = hms_db::pool::connect_with_max_connections(&url, max).await?;
    let facility = facility(&pool, o.facility.as_deref().unwrap()).await?;
    match command {
        "auth-readiness" => {
            let counts = hms_db::auth::assurance::readiness_counts(&pool, facility).await?;
            let (mut after, mut invalid) = (None, 0_u64);
            loop {
                let rows =
                    hms_db::auth::assurance::key_readiness_page(&pool, facility, after).await?;
                if rows.is_empty() {
                    break;
                }
                for row in &rows {
                    if !hms_auth::passkey_record_is_structurally_valid(
                        &row.credential_id,
                        &row.passkey,
                    ) {
                        invalid += 1
                    }
                }
                after = rows.last().map(|r| r.id);
            }
            let rp = std::env::var("HMS_WEBAUTHN_RP_ID")
                .ok()
                .filter(|v| !v.is_empty());
            let origin = std::env::var("HMS_WEBAUTHN_RP_ORIGIN")
                .ok()
                .filter(|v| !v.is_empty());
            let valid = rp
                .as_ref()
                .zip(origin.as_ref())
                .is_some_and(|(rp, origin)| {
                    hms_auth::webauthn_config_is_valid(&hms_auth::WebAuthnConfig {
                        rp_id: rp.clone(),
                        rp_origin: origin.clone(),
                        ..hms_auth::WebAuthnConfig::localhost_for_tests()
                    })
                });
            println!(
                "{}",
                serde_json::json!({"privileged_unenrolled_accounts":counts.privileged_unenrolled_accounts,"active_keys":counts.active_keys,"structurally_invalid_active_keys":invalid,"over_cap_accounts":counts.over_cap_accounts,"rp_id_configured":rp.is_some(),"origin_configured":origin.is_some(),"origin_uses_https":origin.as_ref().is_some_and(|v|v.starts_with("https://")),"rp_config_valid":valid,"structural_validity_is_not_usability":true})
            );
        }
        "bootstrap-factor" => {
            if o.credential.is_some() || o.reason_stdin {
                bail!("Bootstrap accepts no credential retirement options")
            }
            let path = o
                .token_file
                .context("A new private token file is required")?;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(path)?;
            let raw = hms_db::provision::generate_secret_token();
            let expiry = hms_db::auth::assurance::issue_bootstrap_grant(
                &pool,
                facility,
                o.user.unwrap(),
                &hms_db::provision::hash_refresh_token(&raw),
            )
            .await?;
            file.write_all(raw.as_bytes())?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            println!(
                "{}",
                serde_json::json!({"bootstrap_issued":true,"expires_at":expiry,"token_written_to_private_file":true,"operator_identity_check_acknowledged":true,"ordinary_session_created":false})
            );
        }
        "retire-factor" => {
            if o.token_file.is_some() || !o.reason_stdin {
                bail!("Retirement requires only a named credential and --reason-stdin")
            }
            let mut reason = String::new();
            std::io::stdin().take(8193).read_to_string(&mut reason)?;
            if reason.len() > 8192 || reason.trim().is_empty() || reason.chars().count() > 2000 {
                bail!("A bounded nonempty operator review reason is required")
            }
            hms_db::auth::assurance::operator_retire_key(
                &pool,
                facility,
                o.user.unwrap(),
                o.credential.context("A named credential row is required")?,
                &reason,
            )
            .await?;
            println!(
                "{}",
                serde_json::json!({"credential_retirement_confirmed":true,"key_evidence_retained":true,"ordinary_session_created":false,"factor_assurance_created":false})
            );
        }
        _ => bail!("Unsupported authentication operator command"),
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn operator_options_require_explicit_scope_and_no_duplicates() {
        assert!(parse(Vec::<String>::new()).is_err());
        assert!(
            parse(["--facility-code", "HMS", "--facility-code", "OTHER"].map(str::to_owned))
                .is_err()
        );
        assert!(parse(
            [
                "--facility-code",
                "HMS",
                "--user-id",
                "00000000-0000-0000-0000-000000000000"
            ]
            .map(str::to_owned)
        )
        .is_err());
        assert!(
            parse(["--facility-code", "HMS", "--token-file", "relative"].map(str::to_owned))
                .is_err()
        );
        assert!(parse(["--facility-code", "HMS"].map(str::to_owned)).is_ok());
    }
}
