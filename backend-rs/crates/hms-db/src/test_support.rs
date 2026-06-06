use std::env;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use chrono::NaiveDate;
use hms_domain::deployment::DeploymentProfile;
use hms_domain::patients::{PatientRecord, Sex};
use hms_domain::ward::{AdmissionCaseListItem, BedListItem, WardListItem, WardSectionListItem};
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

pub struct TestDb {
    pool: crate::PgPool,
    facility_id: Uuid,
    owner_user_id: Uuid,
    _database: TestDatabase,
}

impl TestDb {
    pub async fn hospital() -> anyhow::Result<Self> {
        Self::with_profile(DeploymentProfile::Hospital).await
    }

    pub async fn with_profile(deployment_profile: DeploymentProfile) -> anyhow::Result<Self> {
        let database = TestDatabase::create()?;
        let pool = crate::connect(database.database_url()).await?;

        crate::migrate::run(&pool).await?;
        crate::provision::provision_baseline(
            &pool,
            &crate::provision::BaselineProvisioning::hms_local(deployment_profile),
        )
        .await?;

        let facility_id = crate::facilities::facility_id_by_code(&pool, "HMS")
            .await?
            .ok_or_else(|| anyhow::anyhow!("test facility HMS was not provisioned"))?;
        let owner_user_id = Uuid::from_u128(crate::provision::OWNER_USER_ID);

        Ok(Self {
            pool,
            facility_id,
            owner_user_id,
            _database: database,
        })
    }

    pub fn pool(&self) -> &crate::PgPool {
        &self.pool
    }

    pub fn facility_id(&self) -> Uuid {
        self.facility_id
    }

    pub fn owner_user_id(&self) -> Uuid {
        self.owner_user_id
    }

    pub fn scenario(&self, slug: impl Into<String>) -> ScenarioBuilder<'_> {
        ScenarioBuilder {
            db: self,
            slug: slug.into(),
        }
    }
}

pub struct ScenarioBuilder<'a> {
    db: &'a TestDb,
    slug: String,
}

pub struct WardBedScenario {
    pub ward: WardListItem,
    pub section: WardSectionListItem,
    pub bed: BedListItem,
}

pub struct AdmissionScenario {
    pub patient: PatientRecord,
    pub ward: WardListItem,
    pub section: WardSectionListItem,
    pub bed: BedListItem,
    pub admission: AdmissionCaseListItem,
}

impl ScenarioBuilder<'_> {
    pub async fn registered_patient(&self) -> anyhow::Result<PatientRecord> {
        let token = scenario_token(&self.slug);
        crate::patients::create_patient(
            self.db.pool(),
            crate::patients::NewPatient {
                id: Uuid::new_v4(),
                facility_id: self.db.facility_id(),
                created_by_user_id: self.db.owner_user_id(),
                request_id: None,
                patient_code: format!("P-{token}"),
                first_name: format!("Test{token}"),
                last_name: "Patient".to_owned(),
                date_of_birth: NaiveDate::from_ymd_opt(1990, 1, 1)
                    .expect("static test date is valid"),
                sex: Sex::Female,
                duplicate_override: None,
            },
        )
        .await
    }

    pub async fn ward_with_available_bed(&self) -> anyhow::Result<WardBedScenario> {
        let token = scenario_token(&self.slug);
        let ward = crate::ward::create_ward(
            self.db.pool(),
            crate::ward::NewWard {
                id: Uuid::new_v4(),
                facility_id: self.db.facility_id(),
                code: format!("W-{token}"),
                name: format!("Ward {token}"),
            },
        )
        .await?;
        let section = crate::ward::create_ward_section(
            self.db.pool(),
            crate::ward::NewWardSection {
                id: Uuid::new_v4(),
                facility_id: self.db.facility_id(),
                ward_id: ward.id,
                code: format!("S-{token}"),
                name: format!("Section {token}"),
                actor_user_id: self.db.owner_user_id(),
            },
        )
        .await?;
        let bed = crate::ward::create_bed(
            self.db.pool(),
            crate::ward::NewBed {
                id: Uuid::new_v4(),
                facility_id: self.db.facility_id(),
                ward_id: ward.id,
                section_id: Some(section.id),
                bed_code: format!("B-{token}"),
                actor_user_id: self.db.owner_user_id(),
            },
        )
        .await?;

        Ok(WardBedScenario { ward, section, bed })
    }

    pub async fn admission_case_with_available_bed(&self) -> anyhow::Result<AdmissionScenario> {
        let patient = self.registered_patient().await?;
        let WardBedScenario { ward, section, bed } = self.ward_with_available_bed().await?;
        let admission = crate::ward::create_admission_case(
            self.db.pool(),
            crate::ward::NewAdmissionCase {
                id: Uuid::new_v4(),
                facility_id: self.db.facility_id(),
                patient_id: patient.id,
                ward_id: ward.id,
                encounter_id: None,
                visit_id: None,
                actor_user_id: self.db.owner_user_id(),
            },
        )
        .await?;

        Ok(AdmissionScenario {
            patient,
            ward,
            section,
            bed,
            admission,
        })
    }
}

fn scenario_token(slug: &str) -> String {
    let prefix: String = slug
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_ascii_uppercase();
    let prefix = if prefix.is_empty() {
        "SCENARIO".to_owned()
    } else {
        prefix
    };
    let id = Uuid::new_v4().simple().to_string();
    let suffix = id[..8].to_ascii_uppercase();
    format!("{prefix}{suffix}")
}

impl Drop for TestDatabase {
    fn drop(&mut self) {
        match &mut self.cleanup {
            TestDatabaseCleanup::Local {
                host,
                port,
                user,
                password,
                database,
            } => {
                let mut dropdb = command("dropdb");
                apply_pgpassword(&mut dropdb, password.as_deref());
                let _ = dropdb
                    .args(["-h", host, "-p", &port.to_string(), "-U", user, "-w"])
                    .args(["--if-exists", "--force", database])
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
        password: Option<String>,
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
        let pg_data_dir = self.data_dir.join("data");
        let _ = command("pg_ctl")
            .arg("-D")
            .arg(&pg_data_dir)
            .args(["-m", "fast", "stop"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if matches!(self.process.try_wait(), Ok(None)) {
            let _ = self.process.kill();
        }
        let _ = self.process.wait();
        let _ = std::fs::remove_dir_all(&self.data_dir);
    }
}

fn create_local_database() -> anyhow::Result<TestDatabase> {
    let host = "127.0.0.1".to_owned();
    let port = 5432;
    let mut last_error = None;

    for credentials in local_postgres_credentials() {
        let database = format!("hms_v2_test_{}", Uuid::new_v4().simple());
        let mut createdb = command("createdb");
        apply_pgpassword(&mut createdb, credentials.password.as_deref());
        let create_result = createdb
            .args(["-h", &host, "-p", &port.to_string()])
            .args(["-U", &credentials.user, "-w", &database])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output();

        match create_result {
            Ok(output) if output.status.success() => {
                return Ok(TestDatabase {
                    database_url: local_database_url(
                        &credentials.user,
                        credentials.password.as_deref(),
                        &host,
                        port,
                        &database,
                    ),
                    cleanup: TestDatabaseCleanup::Local {
                        host,
                        port,
                        user: credentials.user,
                        password: credentials.password,
                        database,
                    },
                });
            }
            Ok(output) => {
                last_error = Some(anyhow::anyhow!(
                    "createdb failed for local user {} using {} auth: {}",
                    credentials.user,
                    credentials.auth_label(),
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

struct LocalPostgresCredentials {
    user: String,
    password: Option<String>,
}

impl LocalPostgresCredentials {
    fn auth_label(&self) -> &'static str {
        if self.password.is_some() {
            "password"
        } else {
            "passwordless"
        }
    }
}

fn local_postgres_credentials() -> Vec<LocalPostgresCredentials> {
    let mut credentials = Vec::new();
    let passwords = local_postgres_passwords();

    for user in local_postgres_users() {
        credentials.push(LocalPostgresCredentials {
            user: user.clone(),
            password: None,
        });
        for password in &passwords {
            credentials.push(LocalPostgresCredentials {
                user: user.clone(),
                password: Some(password.clone()),
            });
        }
        if user == "postgres" && !passwords.iter().any(|password| password == "postgres") {
            credentials.push(LocalPostgresCredentials {
                user,
                password: Some("postgres".to_owned()),
            });
        }
    }

    credentials
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

fn local_postgres_passwords() -> Vec<String> {
    let mut passwords = Vec::new();
    for name in ["HMS_TEST_DATABASE_PASSWORD", "PGPASSWORD"] {
        if let Ok(password) = env::var(name) {
            if !password.is_empty() && !passwords.contains(&password) {
                passwords.push(password);
            }
        }
    }
    passwords
}

fn local_database_url(
    user: &str,
    password: Option<&str>,
    host: &str,
    port: u16,
    database: &str,
) -> String {
    let user = percent_encode_url_component(user);
    let auth = match password {
        Some(password) => format!("{user}:{}", percent_encode_url_component(password)),
        None => user,
    };
    format!("postgres://{auth}@{host}:{port}/{database}")
}

fn percent_encode_url_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push('%');
                encoded.push(HEX[(byte >> 4) as usize] as char);
                encoded.push(HEX[(byte & 0x0f) as usize] as char);
            }
        }
    }
    encoded
}

fn apply_pgpassword(command: &mut Command, password: Option<&str>) {
    command.env("PGCONNECT_TIMEOUT", "2");
    if let Some(password) = password {
        command.env("PGPASSWORD", password);
    } else {
        command.env_remove("PGPASSWORD");
    }
}

const HEX: &[u8; 16] = b"0123456789ABCDEF";

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
