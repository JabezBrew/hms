# ADR-0001: Data Isolation and Deployment Model

Status: Accepted
Date: 2026-01-01
Owner: Platform

## Context

The HMS platform is deployed per customer (one deployment per customer). Customers vary in scale:
- Single-clinic or single-hospital customers with one facility.
- Multi-facility hospital networks requiring cross-facility workflows.
- Government or regulated customers requiring strict regional/data-residency isolation.

The system handles PHI and must follow least-privilege access control, predictable performance, and reliable operational boundaries. We need a model that:
- Avoids over-complexity for small deployments.
- Supports multi-facility operations and cross-facility workflows.
- Satisfies strict data-residency requirements where mandated.
- Keeps performance predictable at scale.

### Deployment Scope Clarification
- "One deployment per customer" means a **dedicated runtime boundary** per customer (separate server/container/namespace).
- Each customer deployment has its **own database**; there is no multi-tenant SaaS database.
- Deployments may run on shared infrastructure, but **data planes are isolated**.

## Decision

Adopt a **single-database, facility-scoped data model** as the default deployment model, with an **optional regional deployment isolation mode** for strict data-residency customers.

### Default Model (Most Customers)
- **One deployment per customer, one database.**
- Multiple facilities live in the same database and are **scoped by `facility_id`** across clinical and operational models.
- Cross-facility access is controlled by roles and explicit configuration.
- Facility scoping is centralized via a **FacilityScopingMiddleware** (see Detailed Architecture Notes).

### Regional Isolation Model (Strict Residency Customers)
- **One deployment per region**, each with its own database.
- PHI stays in-region; no live clinical data crosses regional boundaries.
- Cross-region reporting uses **aggregated or de-identified exports** (analytics-only).
- Cross-region transfers are explicit workflows (not implicit data sharing).

## Rationale

### Why single DB per customer?
- Simplest operational model for the majority of customers.
- Strong performance characteristics with careful indexing and query scoping.
- Enables multi-facility workflows (patient transfers, shared staff, shared scheduling).
- Avoids DB-per-facility operational overhead (migrations, monitoring, pooling).

### Why a regional isolation option?
- Some customers require data to stay in a geographic region.
- A regional deployment is cleaner and safer than DB-per-facility while meeting residency.
- Maintains operational isolation while avoiding fragmentation of data within a region.

## Goals

- **Correctness and isolation:** PHI is never exposed across facilities without explicit authorization.
- **Predictable performance:** Scoping and indexes avoid cross-facility table scans.
- **Operational clarity:** One standard deployment model with a policy-based option for residency.
- **Workflow support:** Cross-facility operations are possible when explicitly enabled.

## Non-Goals

- Multi-tenant SaaS hosting for multiple customers in a single deployment.
- Automated DB provisioning for each facility.
- Cross-region PHI sharing.

## Implications

### Data Model
- All PHI-bearing models must include `facility_id` (or a path to it).
- For shared entities, explicit join paths must exist (e.g., patient -> facility).
- Facility is the primary scoping dimension for querysets and caches.

### Access Control (Least-Privilege)
- Querysets must be filtered by facility at **both** list and object access levels.
- Access control is enforced via `apps/core/security.py`.
- Cross-facility access is role-based and feature-flagged.
- Auditable access path for every patient record access.

### User Model
- Users have a **primary facility** and optionally an **M2M facilities list**.
- Single-facility users never see a facility switcher.
- Multi-facility users must select an **active facility** when their access scope is ambiguous.

### Caching
- Cache keys must include `facility_id` and user identifiers.
- Shared caches must avoid cross-facility collisions.
- Cache invalidation must track facility and unit ancestry.

### Reporting and Analytics
- In default model: cross-facility reporting is permitted for authorized users.
- In regional isolation: reporting uses aggregated or de-identified exports to an analytics store.
- No live clinical data replication across regions.

### Backups and Restores
- Default model: full DB backups with facility-aware restore tooling.
- Regional isolation: backups per region; restoration is region-specific.
- Incident response must include PHI boundary verification.

### Performance
- Queries must be indexed by `facility_id` (composite indexes where relevant).
- Use `select_related` and aggregate counts to avoid N+1s.
- Avoid table scans across facilities by enforcing scoped querysets.

## Deployment Configuration

### Default Mode (Single-DB)
- `MULTI_FACILITY_MODE=true` when more than one facility exists.
- `ALLOW_CROSS_FACILITY_ACCESS=true` for enterprise roles with cross-facility needs.
- Facility switcher UI enabled only when the user has multi-facility access.

### Regional Isolation Mode
- Separate deployments per region with region-specific infrastructure.
- `ALLOW_CROSS_FACILITY_ACCESS` only applies within the region.
- Cross-region analytics via batch exports (no direct clinical DB reads).

## Detailed Architecture Notes

### Facility Scoping
- All clinical data must have a direct or indirect `facility_id`.
- Service-layer queries should enforce facility filters before any joins or aggregates.
- Admin workflows must clearly indicate whether the action is in a single facility or cross-facility scope.

### Facility Boundary Middleware
- Introduce `FacilityScopingMiddleware` to centralize facility context:
  - Sets `request.facility` based on the authenticated user and selected facility.
  - Exposes a `get_facility_queryset()` helper for consistent scoping.
  - Logs facility context for audit and troubleshooting.

### Cross-Facility Workflows
- Patient transfers across facilities are explicit workflows, not implicit record sharing.
- Staff assignments may be multi-facility only with explicit role permission.
- Scheduling and reporting across facilities are governed by the access policy.

### Regional Isolation Workflows
- Patient movement across regions is treated as a transfer with explicit consent and export/import.
- Analytics pipelines store only aggregated or de-identified data.
- Access logs must include region identifiers for auditing.

## Risks and Mitigations

### Risk: Query Leakage Across Facilities
- Mitigation: enforce facility-scoped querysets at the viewset level and in object-level permission checks.
- Add tests that assert facility boundaries on all endpoints that accept identifiers.

### Risk: Cache Key Collisions
- Mitigation: include facility and user identifiers in all cache keys.
- Use cache versioning keys for invalidation on writes.

### Risk: Residency Violations
- Mitigation: separate deployments per region; no cross-region read access to clinical DBs.
- Restrict and audit any export pipelines.

### Risk: Cross-Facility Access Overreach
- Mitigation: explicit RBAC controls and least-privilege roles.
- Log all cross-facility queries for audit.

## Operational Guidance

### Setup (Per Customer Deployment)
- Create facilities in the deployment once (CLI only).
  - `python manage.py create_facility --code MAIN --name "Hospital Name"`
  - `python manage.py create_admin --facility MAIN --email admin@example.com`
- Assign users to one or more facilities.
- Configure whether cross-facility access is permitted.
- No web-based provisioning wizard for security; any onboarding UI is post-bootstrap and non-privileged.

### Monitoring and Alerting
- Track query counts per request, p95 and p99 latency per facility.
- Monitor cache hit rates per facility keyspace.
- Alert on cross-facility access anomalies.

### Testing Requirements
- Every endpoint that accepts an identifier must have tests asserting facility isolation.
- Tests must verify that a user in Facility A cannot access Facility B data (list and detail).
- Include negative tests for object-level access and filtered list endpoints.

## Migration Plan (If Needed)

If moving from a database-per-facility model:
1. Consolidate facility schemas into a single database.
2. Add `facility_id` to all PHI-bearing models.
3. Backfill `facility_id` from source context.
4. Update queryset scoping and access control tests.
5. Validate access boundaries with integration tests.

## Alternatives Considered

### DB-per-Facility
- Pros: strict isolation, independent scaling.
- Cons: complex operations, migrations, pooled connections, and cross-facility workflows.
- Rejected as a default due to operational complexity for most customers.

### Single DB with No Facility Scoping
- Pros: simplicity.
- Cons: unacceptable for compliance and least-privilege access.
- Rejected.

### DB-per-Enterprise (Multi-Region Shared)
- Pros: can support large organizations.
- Cons: conflicts with strict regional residency requirements.
- Rejected as a default; regional isolation preferred where required.

## Open Questions

- Do we need optional PostgreSQL row-level security for high-compliance customers?
- What is the preferred analytics store for cross-region aggregated reporting?

## Decision Summary

Adopt **single DB per customer deployment with facility-scoped data** as the standard.
For strict regional residency, deploy **separate region-specific instances** and limit cross-region sharing to aggregated or de-identified analytics.
