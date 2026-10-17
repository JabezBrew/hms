//! The actual worker refuses an older schema before binding readiness or polling.
use std::borrow::Cow;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct Worker(Child);
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start(database_url: &str, address: SocketAddr) -> Worker {
    Worker(
        Command::new(env!("CARGO_BIN_EXE_hms-worker"))
            .env("HMS_DATABASE_URL", database_url)
            .env("HMS_WORKER_DATABASE_MAX_CONNECTIONS", "1")
            .env("HMS_WORKER_METRICS_LISTEN_ADDR", address.to_string())
            .env("HMS_WORKER_POLL_INTERVAL_SECONDS", "3600")
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("worker process starts"),
    )
}

fn ready(address: SocketAddr) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(100)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));
    if stream
        .write_all(b"GET /health/ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = [0_u8; 256];
    stream
        .read(&mut response)
        .is_ok_and(|count| response[..count].starts_with(b"HTTP/1.1 200 "))
}

async fn refuses_before_serving_and_serves_required_schema(before: i64) {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|migration| migration.version < before)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let reservation = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = reservation.local_addr().unwrap();
    drop(reservation);
    let mut worker = start(database.database_url(), address);
    let deadline = Instant::now() + Duration::from_secs(12);
    let exit = loop {
        if let Some(exit) = worker.0.try_wait().unwrap() {
            break exit;
        }
        assert!(!ready(address), "old schema must never expose readiness");
        assert!(Instant::now() < deadline, "schema refusal is bounded");
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert!(!exit.success());
    let mut error = String::new();
    worker
        .0
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut error)
        .unwrap();
    assert!(error.contains("Database schema does not meet this runtime's required schema."));
    assert!(!error.contains(database.database_url()));
    assert!(!ready(address));
    let identities: (i64, i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM facilities),(SELECT count(*) FROM users),(SELECT count(*) FROM audit_events)")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(identities, (0, 0, 0));
    drop(worker);

    hms_db::migrate::run(&pool).await.unwrap();
    let mut worker = start(database.database_url(), address);
    let deadline = Instant::now() + Duration::from_secs(12);
    loop {
        assert!(
            worker.0.try_wait().unwrap().is_none(),
            "required schema permits worker startup"
        );
        if ready(address) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "required schema reaches readiness"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    drop(worker);
}

#[tokio::test]
async fn actual_worker_refuses_023_before_serving() {
    refuses_before_serving_and_serves_required_schema(202610170024).await;
}

#[tokio::test]
async fn actual_worker_refuses_024_and_serves_after_required_025() {
    refuses_before_serving_and_serves_required_schema(202610170025).await;
}
