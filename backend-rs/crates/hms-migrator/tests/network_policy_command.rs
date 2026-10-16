//! Exercise the actual operator binary; arguments never imply an onsite range.
use hms_domain::{deployment::DeploymentProfile, network::NetworkOffsiteMode};
use std::{
    io::Write,
    process::{Command, Stdio},
};
use uuid::Uuid;

fn invoke(
    url: &str,
    request: Uuid,
    version: i64,
    ranges: &[&str],
    mode: &str,
) -> std::process::Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_hms-migrator"));
    command.env("HMS_DATABASE_URL", url).args([
        "configure-network",
        "--facility-code",
        "HMS",
        "--offsite-mode",
        mode,
        "--expected-version",
        &version.to_string(),
        "--request-id",
        &request.to_string(),
        "--reason-stdin",
    ]);
    for range in ranges {
        command.args(["--onsite-cidr", range]);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"Synthetic explicit operator review\n")
        .unwrap();
    child.wait_with_output().unwrap()
}

#[tokio::test]
async fn operator_binary_requires_explicit_bounded_policy_and_replays_exact_saved_version() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    hms_db::provision::provision_baseline(
        &pool,
        &hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .unwrap();
    let facility = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .unwrap()
        .unwrap();
    for ranges in [vec![], vec!["0.0.0.0/0"], vec!["0.0.0.0/1", "128.0.0.0/1"]] {
        assert!(!invoke(
            database.database_url(),
            Uuid::new_v4(),
            0,
            &ranges,
            "readonly"
        )
        .status
        .success());
        assert!(
            !hms_db::network::get_policy(&pool, facility)
                .await
                .unwrap()
                .configured
        );
    }
    let key = Uuid::new_v4();
    let saved = invoke(
        database.database_url(),
        key,
        0,
        &["127.0.0.1/32", "::1/128"],
        "fresh_reauth",
    );
    assert!(
        saved.status.success(),
        "explicit operator bootstrap must succeed"
    );
    let output = String::from_utf8(saved.stdout).unwrap();
    assert!(output.contains("version 1 confirmed") && output.contains("replayed=false"));
    assert!(
        !output.contains("127.0.0.1")
            && !output.contains("Synthetic explicit")
            && !output.contains(&key.to_string())
    );
    let actual = hms_db::network::get_policy(&pool, facility).await.unwrap();
    assert_eq!(actual.offsite_mode, NetworkOffsiteMode::FreshReauth);
    assert_eq!(actual.onsite_cidrs, vec!["127.0.0.1/32", "::1/128"]);
    let replay = invoke(
        database.database_url(),
        key,
        0,
        &["127.0.0.1/32", "::1/128"],
        "fresh_reauth",
    );
    assert!(replay.status.success());
    assert!(String::from_utf8(replay.stdout)
        .unwrap()
        .contains("replayed=true"));
    assert!(!invoke(
        database.database_url(),
        key,
        0,
        &["127.0.0.1/32", "::1/128"],
        "deny"
    )
    .status
    .success());
    assert!(!invoke(
        database.database_url(),
        Uuid::new_v4(),
        0,
        &["127.0.0.1/32"],
        "deny"
    )
    .status
    .success());
    assert_eq!(
        hms_db::network::get_policy(&pool, facility)
            .await
            .unwrap()
            .version,
        1
    );
}
