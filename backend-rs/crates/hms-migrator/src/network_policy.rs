//! Explicit local-operator bootstrap/recovery. No facility/range/mode defaults.
use anyhow::{bail, Context};
use hms_domain::network::{NetworkOffsiteMode, NetworkRanges, UpdateNetworkPolicyRequest};
use std::io::Read;
use uuid::Uuid;

struct Options {
    facility: String,
    ranges: Vec<String>,
    mode: NetworkOffsiteMode,
    expected: i64,
    key: Uuid,
}
fn parse(args: impl IntoIterator<Item = String>) -> anyhow::Result<Options> {
    let mut args = args.into_iter();
    let (mut facility, mut mode, mut expected, mut key) = (None, None, None, None);
    let mut ranges = vec![];
    let mut reason_stdin = false;
    while let Some(flag) = args.next() {
        if flag == "--reason-stdin" {
            if reason_stdin {
                bail!("Specify --reason-stdin once.");
            }
            reason_stdin = true;
            continue;
        }
        let value = args
            .next()
            .ok_or_else(|| anyhow::anyhow!("Every network policy option requires a value."))?;
        match flag.as_str() {
            "--facility-code" if facility.is_none() => facility = Some(value.trim().to_owned()),
            "--onsite-cidr" => ranges.push(value),
            "--offsite-mode" if mode.is_none() => {
                mode = Some(match value.as_str() {
                    "readonly" => NetworkOffsiteMode::Readonly,
                    "deny" => NetworkOffsiteMode::Deny,
                    "fresh_reauth" => NetworkOffsiteMode::FreshReauth,
                    _ => bail!("Mode must be readonly, deny, or fresh_reauth."),
                })
            }
            "--expected-version" if expected.is_none() => {
                expected = Some(
                    value
                        .parse::<i64>()
                        .ok()
                        .filter(|v| *v >= 0)
                        .ok_or_else(|| {
                            anyhow::anyhow!("Expected version must be a non-negative integer.")
                        })?,
                )
            }
            "--request-id" if key.is_none() => {
                key = Some(
                    value
                        .parse::<Uuid>()
                        .ok()
                        .filter(|v| !v.is_nil())
                        .ok_or_else(|| {
                            anyhow::anyhow!(
                                "Request id must be a non-nil UUID retained for exact retries."
                            )
                        })?,
                )
            }
            _ => bail!("Unknown or repeated network policy option."),
        }
    }
    if !reason_stdin {
        bail!("Supply an explicit review reason through --reason-stdin.");
    }
    let facility = facility
        .filter(|v| !v.is_empty())
        .ok_or_else(|| anyhow::anyhow!("An explicit --facility-code is required."))?;
    let ranges = NetworkRanges::parse(&ranges, false)
        .map_err(anyhow::Error::msg)?
        .canonical();
    Ok(Options {
        facility,
        ranges,
        mode: mode.ok_or_else(|| anyhow::anyhow!("An explicit --offsite-mode is required."))?,
        expected: expected
            .ok_or_else(|| anyhow::anyhow!("An explicit --expected-version is required."))?,
        key: key.ok_or_else(|| anyhow::anyhow!("An explicit --request-id is required."))?,
    })
}
pub async fn run(args: impl IntoIterator<Item = String>) -> anyhow::Result<()> {
    let options = parse(args)?;
    let mut reason = String::new();
    std::io::stdin()
        .take(4097)
        .read_to_string(&mut reason)
        .context("Read a bounded UTF-8 review reason from stdin.")?;
    if reason.len() > 4096 || reason.trim().is_empty() || reason.trim().chars().count() > 1000 {
        bail!("The review reason must contain one to 1000 characters.");
    }
    let (url, connections) = crate::database_settings_from_env()?;
    let pool = hms_db::pool::connect_with_max_connections(&url, connections).await?;
    let facility = hms_db::facilities::facility_id_by_code(&pool, &options.facility)
        .await?
        .ok_or_else(|| anyhow::anyhow!("The explicit active facility could not be found."))?;
    let result=hms_db::network::update_policy(&pool,hms_db::network::NetworkPolicyActor{facility_id:facility,user_id:None,request_id:None,reauth_deadline:None,auth_versions:None,session_id:None,active_profile:None,resolved_policy_version:None},UpdateNetworkPolicyRequest{client_request_id:options.key,expected_version:options.expected,onsite_cidrs:options.ranges,offsite_mode:options.mode,reason},None).await.map_err(|error|{
  if let Some(typed)=error.downcast_ref::<hms_db::network::NetworkPolicyError>(){anyhow::anyhow!(typed.message())}else{anyhow::anyhow!("The policy write could not be confirmed. Review the policy and retain the exact request id and original options for an explicit retry.")}
 })?;
    println!("Network policy version {} confirmed; {} onsite ranges; replayed={}. No client addresses or ranges printed.",result.policy.version,result.policy.onsite_cidrs.len(),result.replayed);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn args() -> Vec<String> {
        [
            "--facility-code",
            "HMS",
            "--onsite-cidr",
            "127.0.0.1/32",
            "--offsite-mode",
            "fresh_reauth",
            "--expected-version",
            "0",
            "--request-id",
            "f00d0000-0000-4000-8000-000000000001",
            "--reason-stdin",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect()
    }
    #[test]
    fn explicit_bootstrap_has_no_implicit_ranges_or_facility() {
        let parsed = parse(args()).unwrap();
        assert_eq!(parsed.expected, 0);
        assert_eq!(parsed.ranges, vec!["127.0.0.1/32"]);
        assert!(parse(Vec::<String>::new()).is_err());
        for flag in [
            "--facility-code",
            "--onsite-cidr",
            "--offsite-mode",
            "--expected-version",
            "--request-id",
        ] {
            let mut values = args();
            let i = values.iter().position(|v| v == flag).unwrap();
            values.drain(i..i + 2);
            assert!(parse(values).is_err());
        }
    }
    #[test]
    fn universal_unknown_duplicate_and_nil_options_fail_before_database_access() {
        for value in ["0.0.0.0/0", "::/0"] {
            let mut values = args();
            values[3] = value.into();
            assert!(parse(values).is_err());
        }
        let mut values = args();
        values.extend(["--facility-code".into(), "OTHER".into()]);
        assert!(parse(values).is_err());
        let mut values = args();
        values[9] = Uuid::nil().to_string();
        assert!(parse(values).is_err());
    }
}
