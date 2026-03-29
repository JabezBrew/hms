# HMS Monitoring Bundle

This bundle provides a self-hostable baseline for:

- Prometheus scraping `/api/metrics/`
- Grafana dashboards backed by Prometheus and Loki
- Loki log storage
- Promtail log shipping from `backend/logs/`
- Alertmanager for local alert routing

## Usage

1. Start the main HMS stack and ensure the API service is reachable as `api:8000` on the Docker network.
2. If you want local log shipping, enable file logs with `FILE_LOGGING_ENABLED=true`.
3. Run:

```bash
docker compose -f monitoring/docker-compose.monitoring.yml up -d
```

## Default Ports

- Grafana: `3001`
- Prometheus: `9090`
- Loki: `3100`
- Alertmanager: `9093`

## Notes

- Prometheus scrapes `/api/metrics/` directly from the HMS API service.
- Grafana ships with an `HMS Operability` dashboard for dependency readiness, worker counts, and queue depth.
- The sample alert rules are intentionally conservative and should be tuned per deployment.
- If your Docker network is not `hms-network`, set `HMS_DOCKER_NETWORK` before starting the bundle.
