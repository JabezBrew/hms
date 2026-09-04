## Summary

<!-- What does this change do, and which workflow does it serve? -->

Fixes #

## Type

- [ ] fix
- [ ] feat
- [ ] docs
- [ ] perf
- [ ] ops / deploy
- [ ] refactor (no behavior change)

## Safety checklist

- [ ] No PHI, credentials, tokens, MRNs, names, accessions, request/response bodies, or dumps included
- [ ] Every endpoint accepting a patient id enforces patient access (or N/A)
- [ ] List endpoints are bounded + cursor-paginated with least-privilege DTOs (or N/A)
- [ ] Cache/query keys use sanitized scope only — no MRNs, names, raw URLs (or N/A)
- [ ] No PHI in logs, metric labels, screenshots, or fixtures
- [ ] External I/O (FHIR/export/email/PDF) kept off hot paths and out of open transactions (or N/A)

## Verification

<!-- Commands run + results. UI changes need demo-data screenshots. -->

```bash
# backend-rs
cargo fmt --all --check && cargo test --workspace
# frontend
npm run lint && npm run test:run && npm run build && npm run api:v2:generate:check
```

- [ ] OpenAPI regenerated (`hms-openapi`) if HTTP contracts changed
- [ ] Migrations are backwards-compatible / rollback considered (or N/A)
- [ ] Perf impact assessed for hot paths (or N/A)
