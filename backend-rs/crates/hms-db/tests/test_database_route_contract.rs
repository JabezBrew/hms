//! A dependency failure must never silently switch verification to a local server.
#![cfg(unix)]

use std::env;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

const CHILD: &str = "HMS_DATABASE_ROUTE_CONTRACT_CHILD";
const TEST: &str = "database_dependency_failure_does_not_start_a_postgres_server";

#[test]
fn database_dependency_failure_does_not_start_a_postgres_server() {
    if env::var(CHILD).as_deref() == Ok("1") {
        let error = match hms_db::test_support::TestDatabase::create() {
            Ok(_) => panic!("a failed database client must not produce a test database"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains("Docker Postgres at 127.0.0.1:5432"));
        assert!(error.contains("docker compose up -d postgres redis"));
        assert!(!error.contains("SYNTHETIC_CLIENT_DIAGNOSTIC"));
        assert!(!error.contains("synthetic-private-password"));
        return;
    }

    // Use a separate process so credential and PATH changes cannot affect other
    // database tests. These scripts never connect to or stop any database.
    let fixture = ClientFixture::create();
    fixture.script(
        "createdb",
        "printf '%s\\n' 'SYNTHETIC_CLIENT_DIAGNOSTIC' >&2\nexit 1\n",
    );
    for name in ["initdb", "postgres", "pg_ctl", "pg_isready"] {
        fixture.script(
            name,
            "printf '%s\\n' 'forbidden-server-command' > \
             \"$HMS_DATABASE_ROUTE_CONTRACT_DIR/server-started\"\nexit 99\n",
        );
    }
    let output = Command::new(env::current_exe().expect("test executable is available"))
        .args(["--exact", TEST, "--nocapture"])
        .env(CHILD, "1")
        .env("HMS_DATABASE_ROUTE_CONTRACT_DIR", &fixture.path)
        .env("PATH", &fixture.path)
        .env("USER", "")
        .env("HMS_TEST_DATABASE_PASSWORD", "synthetic-private-password")
        .env("PGPASSWORD", "synthetic-private-password")
        .env_remove("HMS_TEST_DATABASE_URL")
        .output()
        .expect("isolated database-route check starts");
    assert!(
        output.status.success(),
        "isolated database-route check failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!fixture.path.join("server-started").exists());
}

struct ClientFixture {
    path: PathBuf,
}

impl ClientFixture {
    fn create() -> Self {
        let path = env::temp_dir().join(format!("hms-db-client-route-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).expect("client fixture directory is created");
        Self { path }
    }

    fn script(&self, name: &str, body: &str) {
        let path = self.path.join(Path::new(name));
        fs::write(&path, format!("#!/bin/sh\n{body}")).expect("client fixture is written");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
            .expect("client fixture is executable");
    }
}

impl Drop for ClientFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
