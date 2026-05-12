use std::net::SocketAddr;

use anyhow::Context;
use hms_api::app::build_app;
use hms_api::config::Config;
use hms_api::state::AppState;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    hms_api::middleware::tracing::init_tracing();

    let config = Config::from_env()?;
    let state = AppState::new(config.clone())
        .await
        .context("failed to initialize application state")?;
    let app = build_app(state);
    let listener = tokio::net::TcpListener::bind(config.listen_addr).await?;
    let addr: SocketAddr = listener.local_addr()?;

    info!(%addr, "hms-api listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
