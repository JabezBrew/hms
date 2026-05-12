use std::env;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use uuid::Uuid;

static SHARED_DATABASE: OnceLock<Mutex<Option<TestDatabase>>> = OnceLock::new();

pub fn test_database_url() -> anyhow::Result<String> {
    let mutex = SHARED_DATABASE.get_or_init(|| Mutex::new(None));
    let mut guard = mutex.lock().expect("test database mutex is not poisoned");
    if let Some(database) = guard.as_ref() {
        return Ok(database.database_url().to_owned());
    }

    let database = TestDatabase::create()?;
    let database_url = database.database_url().to_owned();
    *guard = Some(database);
    Ok(database_url)
}

pub struct TestDatabase {
    database_url: String,
    cleanup: TestDatabaseCleanup,
}

impl TestDatabase {
    pub fn create() -> anyhow::Result<Self> {
        if let Ok(url) = env::var("HMS_TEST_DATABASE_URL") {
            return Ok(Self {
                database_url: url,
                cleanup: TestDatabaseCleanup::None,
            });
        }

        create_local_database().or_else(|_| {
            let cluster = TestCluster::start()?;
            let database_url = cluster.database_url.clone();
            Ok(Self {
                database_url,
                cleanup: TestDatabaseCleanup::Cluster { _cluster: cluster },
            })
        })
    }

    pub fn database_url(&self) -> &str {
        &self.database_url
    }
}

impl Drop for TestDatabase {
    fn drop(&mut self) {
        match &mut self.cleanup {
            TestDatabaseCleanup::Local {
                host,
                port,
                user,
                database,
            } => {
                let _ = command("dropdb")
                    .args([
                        "-h",
                        host,
                        "-p",
                        &port.to_string(),
                        "-U",
                        user,
                        "-w",
                        "--if-exists",
                        "--force",
                        database,
                    ])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            TestDatabaseCleanup::Cluster { .. } | TestDatabaseCleanup::None => {}
        }
    }
}

enum TestDatabaseCleanup {
    Local {
        host: String,
        port: u16,
        user: String,
        database: String,
    },
    Cluster {
        _cluster: TestCluster,
    },
    None,
}

struct TestCluster {
    database_url: String,
    data_dir: PathBuf,
    process: Child,
}

impl TestCluster {
    fn start() -> anyhow::Result<Self> {
        let slug = Uuid::new_v4().simple().to_string();
        let root = Path::new("/tmp").join(format!("hms-pg-{}", &slug[..8]));
        let data_dir = root.join("data");
        let socket_dir = root.join("socket");
        let log_path = root.join("postgres.log");
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(&socket_dir)?;

        let initdb_output = command("initdb")
            .args(["-A", "trust", "-U", "postgres", "-D"])
            .arg(&data_dir)
            .stdout(Stdio::null())
            .output()?;
        initdb_output
            .status
            .success()
            .then_some(())
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "initdb failed: {}",
                    String::from_utf8_lossy(&initdb_output.stderr)
                )
            })?;

        let port = free_port()?;
        let log = std::fs::File::create(&log_path)?;
        let mut process = command("postgres")
            .arg("-D")
            .arg(&data_dir)
            .args(["-h", "127.0.0.1", "-p"])
            .arg(port.to_string())
            .arg("-k")
            .arg(&socket_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::from(log))
            .spawn()?;

        wait_for_postgres(&mut process, port, &log_path, Duration::from_secs(15))?;

        command("createdb")
            .args(["-h", "127.0.0.1", "-p"])
            .arg(port.to_string())
            .args(["-U", "postgres", "hms_v2_test"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?
            .success()
            .then_some(())
            .ok_or_else(|| anyhow::anyhow!("createdb failed"))?;

        Ok(Self {
            database_url: format!("postgres://postgres@127.0.0.1:{port}/hms_v2_test"),
            data_dir: root,
            process,
        })
    }
}

impl Drop for TestCluster {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
        let _ = std::fs::remove_dir_all(&self.data_dir);
    }
}

fn create_local_database() -> anyhow::Result<TestDatabase> {
    let host = "127.0.0.1".to_owned();
    let port = 5432;
    let mut last_error = None;

    for user in local_postgres_users() {
        let database = format!("hms_v2_test_{}", Uuid::new_v4().simple());
        let create_result = command("createdb")
            .args([
                "-h",
                &host,
                "-p",
                &port.to_string(),
                "-U",
                &user,
                "-w",
                &database,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output();

        match create_result {
            Ok(output) if output.status.success() => {
                return Ok(TestDatabase {
                    database_url: format!("postgres://{user}@{host}:{port}/{database}"),
                    cleanup: TestDatabaseCleanup::Local {
                        host,
                        port,
                        user,
                        database,
                    },
                });
            }
            Ok(output) => {
                last_error = Some(anyhow::anyhow!(
                    "createdb failed for local user {user}: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            Err(error) => {
                last_error = Some(error.into());
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("no local postgres users available")))
}

fn local_postgres_users() -> Vec<String> {
    let mut users = vec!["postgres".to_owned()];
    if let Ok(user) = env::var("USER") {
        if !user.is_empty() && user != "postgres" {
            users.push(user);
        }
    }
    users
}

fn free_port() -> anyhow::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

fn wait_for_postgres(
    process: &mut Child,
    port: u16,
    log_path: &Path,
    timeout: Duration,
) -> anyhow::Result<()> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(status) = process.try_wait()? {
            let log = std::fs::read_to_string(log_path).unwrap_or_default();
            return Err(anyhow::anyhow!(
                "temporary postgres exited with {status}: {log}"
            ));
        }

        if command("pg_isready")
            .args(["-h", "127.0.0.1", "-p"])
            .arg(port.to_string())
            .args(["-U", "postgres"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
        {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }

    let log = std::fs::read_to_string(log_path).unwrap_or_default();
    Err(anyhow::anyhow!(
        "temporary postgres did not become ready: {log}"
    ))
}

fn command(name: &str) -> Command {
    if let Some(path) = homebrew_postgres_bin(name) {
        Command::new(path)
    } else {
        Command::new(name)
    }
}

fn homebrew_postgres_bin(name: &str) -> Option<PathBuf> {
    ["/opt/homebrew/bin", "/usr/local/bin"]
        .iter()
        .map(|dir| Path::new(dir).join(name))
        .find(|path| path.exists())
}
