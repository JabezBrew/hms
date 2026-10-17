//! Actual isolated operator binary. Output must contain aggregates only.
use hms_domain::deployment::DeploymentProfile;
use std::{
    io::Write,
    process::{Command, Stdio},
};
use uuid::Uuid;

fn invoke(url: &str, args: &[&str], reason: Option<&str>) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_hms-migrator"))
        .env("HMS_DATABASE_URL", url)
        .env("HMS_WEBAUTHN_RP_ID", "localhost")
        .env("HMS_WEBAUTHN_RP_ORIGIN", "http://localhost:8080")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(reason) = reason {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(reason.as_bytes())
            .unwrap();
    } else {
        drop(child.stdin.take());
    }
    child.wait_with_output().unwrap()
}

#[tokio::test]
async fn actual_operator_readiness_bootstrap_and_retirement_preserve_evidence_without_session_or_secret_output(
) {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    hms_db::provision::provision_baseline(
        &pool,
        &hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .unwrap();
    let user = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let user_arg = user.to_string();
    let facility = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .unwrap()
        .unwrap();
    let path = std::env::temp_dir().join(format!("hms-factor-private-{}.token", Uuid::new_v4()));
    let path_arg = path.to_str().unwrap();
    let denied = invoke(
        database.database_url(),
        &[
            "bootstrap-factor",
            "--facility-code",
            "HMS",
            "--user-id",
            &user_arg,
            "--token-file",
            path_arg,
        ],
        None,
    );
    assert!(!denied.status.success());
    assert!(!path.exists());
    let issued = invoke(
        database.database_url(),
        &[
            "bootstrap-factor",
            "--facility-code",
            "HMS",
            "--user-id",
            &user_arg,
            "--token-file",
            path_arg,
            "--identity-checked",
        ],
        None,
    );
    assert!(
        issued.status.success(),
        "explicit synthetic operator bootstrap succeeds"
    );
    let raw = std::fs::read_to_string(&path).unwrap();
    let raw = raw.trim();
    assert!(raw.len() >= 32);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    let text = String::from_utf8(issued.stdout).unwrap();
    assert!(
        !text.contains(raw)
            && !text.contains(&user_arg)
            && !text.contains(path_arg)
            && !text.contains(database.database_url())
    );
    let receipt: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(receipt["ordinary_session_created"], false);
    let stored:String=sqlx::query_scalar("SELECT token_hash FROM auth_factor_bootstrap_grants WHERE user_id=$1 AND consumed_at IS NULL").bind(user).fetch_one(&pool).await.unwrap();
    assert!(stored == hms_db::provision::hash_refresh_token(raw));
    let duplicate = invoke(
        database.database_url(),
        &[
            "bootstrap-factor",
            "--facility-code",
            "HMS",
            "--user-id",
            &user_arg,
            "--token-file",
            path_arg,
            "--identity-checked",
        ],
        None,
    );
    assert!(!duplicate.status.success());
    assert!(std::fs::read_to_string(&path).unwrap().trim() == raw);
    // Deliberately preserve a malformed imported record for readiness review.
    let key = Uuid::new_v4();
    sqlx::query("INSERT INTO auth_webauthn_credentials(id,facility_id,user_id,credential_id,passkey) VALUES($1,$2,$3,'operator-fixture-invalid-key','{}'::jsonb)").bind(key).bind(facility).bind(user).execute(&pool).await.unwrap();
    let report = invoke(
        database.database_url(),
        &["auth-readiness", "--facility-code", "HMS"],
        None,
    );
    assert!(report.status.success());
    let text = String::from_utf8(report.stdout).unwrap();
    assert!(
        !text.contains(&user_arg)
            && !text.contains("operator-fixture-invalid-key")
            && !text.contains(raw)
            && !text.contains(database.database_url())
    );
    let report: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(report["structurally_invalid_active_keys"], 1);
    assert_eq!(report["structural_validity_is_not_usability"], true);
    assert_eq!(report["rp_config_valid"], true);
    let key_arg = key.to_string();
    let reason = "Synthetic operator identity check and retained-key review";
    let retired = invoke(
        database.database_url(),
        &[
            "retire-factor",
            "--facility-code",
            "HMS",
            "--user-id",
            &user_arg,
            "--credential-id",
            &key_arg,
            "--identity-checked",
            "--reason-stdin",
        ],
        Some(reason),
    );
    assert!(retired.status.success());
    let text = String::from_utf8(retired.stdout).unwrap();
    assert!(
        !text.contains(reason)
            && !text.contains(&user_arg)
            && !text.contains(&key_arg)
            && !text.contains(raw)
    );
    let evidence:(bool,serde_json::Value,i64,i64,i64)=sqlx::query_as("SELECT k.disabled_at IS NOT NULL,k.passkey,(SELECT count(*) FROM auth_factor_operator_actions WHERE credential_id=k.id),(SELECT count(*) FROM refresh_sessions),(SELECT count(*) FROM auth_session_assurance) FROM auth_webauthn_credentials k WHERE k.id=$1").bind(key).fetch_one(&pool).await.unwrap();
    assert_eq!(evidence, (true, serde_json::json!({}), 1, 0, 0));
    let changed = sqlx::query(
        "UPDATE auth_factor_operator_actions SET reason='replacement' WHERE credential_id=$1",
    )
    .bind(key)
    .execute(&pool)
    .await;
    assert!(changed.is_err(), "operator evidence is immutable");
    std::fs::remove_file(path).unwrap();
}
