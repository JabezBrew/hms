# k8s

Status: legacy/experimental deployment reference
Owner: Operations
Last reviewed: 2026-06-01
Scope: Kubernetes manifests retained in the repository.

## Contents

- `namespace.yaml`
- `configmap.yaml`
- `secrets.yaml`
- `api-deployment.yaml`
- `celery-deployment.yaml`
- `ws-deployment.yaml`
- `frontend-deployment.yaml`
- `migrator-job.yaml`
- `services.yaml`
- `ingress.yaml`
- `hpa.yaml`

## Current Role

These manifests are not the current HMS deployment path. Current staging runs on
GCP with the Rust V2 Compose stack; Hetzner V2 remains rollback/reference.

## Invariants

- Do not put real secrets in `secrets.yaml`.
- Do not assume these manifests match current Rust V2 runtime requirements.
- If Kubernetes becomes active again, write a new deployment runbook and verify
  migrations, health, worker, websocket, frontend, and observability paths.
