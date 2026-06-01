# monitoring/alertmanager/templates

Status: active observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Alertmanager notification templates.

## File Map

| File | Owns |
| --- | --- |
| `telegram.tmpl` | Telegram alert message format. |

## Invariants

- Alerts must be diagnostic without dumping logs or PHI.
- Include symptom, risk, likely cause, first checks, and runbook pointer.
