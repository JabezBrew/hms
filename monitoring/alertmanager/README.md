# monitoring/alertmanager

Status: active observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Alertmanager config, templates, and secret mount path.

## Directory Map

| Path | Owns |
| --- | --- |
| `alertmanager.yml` | Alertmanager routing and receiver config when present. |
| `templates/` | Telegram alert templates. |
| `secrets/` | local/private secret mount path, not for committed secret values. |

## Invariants

- Telegram alerts must explain symptom, risk, likely cause, first checks, and
  runbook path.
- Alerts must not include request bodies, patient names, MRNs, clinical text, or
  secrets.
- Bot tokens belong in local secret files or deployment secret managers only.
