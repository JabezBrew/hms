//! Small read-only protocol used before deployment runtime rollback.
use std::time::Duration;

pub async fn run() -> anyhow::Result<()> {
    if std::env::args().nth(2).is_some() {
        anyhow::bail!("schema-compatibility accepts no arguments.");
    }
    let outcome = tokio::time::timeout(Duration::from_secs(8), async {
        let (url, _) = super::database_settings_from_env()?;
        let pool = hms_db::pool::connect_with_max_connections(&url, 1).await?;
        hms_db::schema_compatibility::committed_breaking_epoch(&pool).await
    })
    .await;
    match outcome {
        Ok(Ok(epoch)) => {
            println!("{epoch}");
            Ok(())
        }
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    }
}
