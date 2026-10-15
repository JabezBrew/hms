# CI policy and local validation

Status: GitHub Actions disabled
Owner: Engineering
Last reviewed: 2026-10-14
Scope: repository automation policy and local validation.

GitHub Actions is disabled in the repository settings to avoid consuming the
account's Actions allowance. The CI, CodeQL and dependency-review workflow
files have been removed. No replacement CI provider is configured yet.

Run the relevant local checks before pushing or deploying changes. Follow
[`scripts/check-local.sh`](../../scripts/check-local.sh) for the combined local
release gate (or select `frontend`, `backend`, or `ops`). Follow
[`AGENTS.md`](../../AGENTS.md) for the maintained backend, frontend and database
verification commands, and [`ops/tests/README.md`](../../ops/tests/README.md)
for deployment checks. Automated CodeQL and dependency-review runs are no
longer provided by this repository.

The application is deployed separately using the maintained
[`operations runbooks`](../../ops/README.md). Disabling GitHub Actions does
not stop the running application.

To restore Actions later, review the workflows from Git history, select the
required checks and budget, and explicitly re-enable Actions in repository
settings. Adding a workflow file alone will not re-enable repository Actions.
