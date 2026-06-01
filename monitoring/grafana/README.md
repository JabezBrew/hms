# monitoring/grafana

Status: active observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Grafana dashboards and provisioning.

## Directory Map

| Path | Owns |
| --- | --- |
| `dashboards/` | HMS dashboard JSON definitions. |
| `provisioning/` | datasource and dashboard provisioning config. |

## Invariants

- Dashboards should use aggregate operational signals.
- Do not add panels that require PHI-bearing labels, raw URLs, or clinical text.
- Dashboard filenames and folders should make incident navigation obvious.
