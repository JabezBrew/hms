# HMS Workflow-Oriented Design Guidelines

## Core Philosophy

**PRIORITY: Performance at scale + Security at all times.**

**FROM:** Data-centric CRUD → **TO:** Workflow-centric clinical tool
**Guiding Question:** "What are you trying to accomplish right now?"

## Architecture Mode

The active HMS backend is Rust V2 under `backend-rs/`. Use
`docs/v2/rust-v2-backend-spec.md` as the implementation architecture for
backend work.

The Django/DRF/Celery backend under `backend/` is legacy reference code. Use it
only when the task explicitly asks for legacy Django maintenance, parity
research, or comparison against old behavior.

When Django-specific guidance here conflicts with Rust V2 guidance, the Rust V2
spec wins for active backend work.

Shared principles remain mandatory in both architectures: workflow-first UX,
PHI safety, least privilege, patient access enforcement, facility scoping,
pagination, scoped cache keys, no PHI logs, query-count discipline, and no
external I/O inside open DB transactions.

During Rust V2 work, translate current concepts into Rust equivalents:
DRF serializers become explicit DTOs, Django ORM guidance becomes SQL/query-plan
guidance, `apps/core/security.py` becomes `hms-access`, Celery becomes
`hms-worker`, and Django migrations become `hms-migrator` migrations plus
seed/provisioning commands.

| Data-Oriented (Bad) | Workflow-Oriented (Good) |
|---------------------|--------------------------|
| Navigation mimics DB structure | Navigation mirrors clinical processes |
| Users map workflows to tables | System guides step-by-step |
| Info scattered across pages | All info/actions in one flow |
| No next-step guidance | Clear progress indication |

---

## Design Principles

1. **Progressive Disclosure** - Show only what's needed for current task
2. **Guided Flows** - Step indicators, progress viz, validation, save/resume, "what's next"
3. **Smart Defaults** - Anticipate needs: follow-up dates, lab bundles, usual doses, templates
4. **Action-Oriented Cards** - Every card answers "What can I DO?" Include action buttons
5. **Contextual Quick Actions** - Actions change by context (inpatient vs outpatient)
6. **Minimize Navigation** - Target: 50-70% click reduction. Complete consultation in single flow
7. **Role-Based Personalization** - Doctor→"Today's Clinic", Nurse→"My Shift Dashboard", Receptionist→"Front Desk"

---

## Workflow Patterns

| Pattern | Description | Use For |
|---------|-------------|---------|
| **Wizard** | Multi-step linear flow with validation | Registration, admission, discharge |
| **Dashboard** | Role-specific: Urgent→Current→Upcoming→Completed→Quick Actions | Role landing pages |
| **Guided Flow** | Step-by-step + context panel (patient summary, allergies, meds) | Clinical workflows |
| **Checklist** | Task list with completion tracking, dependencies, auto-population | Ward rounds, handoffs |
| **Timeline** | Chronological patient journey with expandable details/filters | Patient history |

---

## Role Workflows

### Nurse Dashboard
**URGENT**: Critical vitals, overdue meds, alerts | **WARD ROUNDS**: Patient checklist | **MEDS**: Time-based schedule | **RESULTS**: Labs to review

### Doctor (Outpatient)
**CURRENT**: In room | **UPCOMING**: Next patients + prep | **COMPLETED**: Done today | **MESSAGES/RESULTS**: To review

**Consultation Flow:** Pre-Consult Prep (auto) → History & Exam (templates) → Assessment & Plan (inline orders) → Complete (auto-generates note/orders/follow-up)

### Doctor (Inpatient)
**NEW ADMISSIONS**: Overnight | **ACTIVE**: Current list | **DISCHARGES TODAY** | **PENDING**: Orders to sign, results to review

### Receptionist
**CHECK-IN QUEUE** | **REGISTRATION** | **SCHEDULING** | **PAYMENTS**

---

## Technical Architecture

### Structure
```
frontend/src/                         backend-rs/crates/
├── features/       # Product UI       ├── hms-api/            # axum HTTP API
├── components/     # UI primitives    ├── hms-db/             # sqlx repositories
├── hooks/          # React hooks      ├── hms-domain/         # domain types/policies
├── lib/api/v2/     # Rust API bridge  ├── hms-access/         # access decisions
└── app/routes/     # Route metadata   ├── hms-auth/           # auth/session logic
                                      ├── hms-worker/         # async jobs
                                      └── hms-migrator/       # migrations/provisioning
```

### Rust V2 Module Rules

Use deep modules for backend work. A useful module exposes a small Interface,
hides implementation detail, and owns a product invariant. File splitting is
secondary; split when the new module gives callers more Leverage and better
Locality.

Current request flow:

```
routes/* -> handlers/* -> services/* -> hms-access -> hms-db
                                      -> hms-domain
```

- `routes/*` mounts URLs only.
- `handlers/*` handles HTTP extractors, OpenAPI response mapping, and typed
  service calls. No SQL, product-state transitions, or handler-local access
  shortcuts.
- `services/*` is the workflow Seam inside `hms-api`. Add new workflow modules
  here before expanding handlers or `state.rs`.
- `hms-access::RequestContext` owns facility, session, profile, permission,
  feature, patient-visibility, offsite, and reauth facts.
- `hms-api/src/cursor_list.rs` owns bounded cursor-list behavior.
- `AppState` is a runtime Adapter/facade for pools, config, auth/session,
  deployment capabilities, and service factories. It is not a workflow module.

### Key APIs
```
GET  /api/v2/health/ready
POST /api/v2/auth/login
GET  /api/v2/system/deployment-capabilities
GET  /api/v2/patients
GET  /api/v2/patients/{id}/chronicle
```

### API Payload Optimization (MANDATORY)

1. **List DTOs**: ALL list endpoints use lightweight DTOs (5-8 fields max unless justified, flattened)
2. **Cursor Pagination**: Hot list endpoints must be bounded and cursor-paginated server-side
3. **Generated Contracts**: OpenAPI comes from Rust source and frontend helpers are regenerated from it

```rust
// GOOD: explicit lightweight DTO returned by a bounded repository query.
pub struct PatientListItem {
    pub id: Uuid,
    pub patient_code: String,
    pub display_name: String,
    pub sex: Sex,
    pub age_years: Option<i32>,
}

// BAD: returning full patient rows or nested clinical records from a hot list.
```

**Reference:** `backend-rs/TESTING.md`, `backend-rs/crates/hms-api/src/openapi.rs`, and `frontend/scripts/generate-v2-api-client.mjs`.

---

## Tech Stack

**Frontend:** React 18+, React Router, TanStack Query, Tailwind CSS, React Hook Form, Zod, date-fns, lucide-react, sonner
**Backend:** Rust, axum, tokio, sqlx, PostgreSQL, Redis, utoipa/OpenAPI, JWT + refresh-session cookie

## Frontend Performance Budget

- Assume many deployments run on modest client hardware; the default UI must remain fast without opt-in.
- Keep initial JS and render work low: defer charts/calendars, virtualize long lists, and avoid render-time side effects.
- Keep motion lightweight and honor reduced-motion preferences.

---

## Frontend Modularization (Current)

- Feature code lives in `frontend/src/features/<domain>/` with `api/`, `hooks/`, `components/`, `pages/`, `routes.js`, `index.js`.
- `frontend/src/pages/*` are route wrappers only. Keep page logic in feature `pages/`.
- Shared primitives belong in `frontend/src/shared/` (page shell, meta hooks, constants, utils).
- Route metadata is centralized in `frontend/src/app/routes/*` and rendered via `renderRoutes` with role gating.
- Prefer `PageShell`, `PageHeader`, and `PageState` for consistent Chronicle layout and error/loading states.
- Use `usePageMeta` to set titles and breadcrumbs; avoid per-page ad hoc `Helmet` + breadcrumb wiring.
- Prefer feature/shared API modules over `frontend/src/lib/api.js` (legacy compatibility only).
- Standardize React Query keys with `shared/lib/queryKeys.js` and feature key exports.

### shadcn/ui Components
If a UI component doesn't exist in `frontend/src/components/ui/`, install it:
```bash
cd frontend && npx shadcn@latest add <component-name> -y
```
Example: `npx shadcn@latest add accordion -y`

---

## Chronicle Design System

**See:** [`frontend/CHRONICLE_DESIGN_SYSTEM.md`](frontend/CHRONICLE_DESIGN_SYSTEM.md)

**Philosophy:** "Patient data as story, not spreadsheet." Editorial medical journal aesthetic.

### Typography & Colors
| Type | Font | Use |
|------|------|-----|
| Display (`font-display`) | Fraunces | Patient names, titles |
| Heading (`font-heading`) | DM Sans | Section headers |
| Data (`font-mono`) | IBM Plex Mono | MRNs, vitals, timestamps |

**Colors:** Warm charcoal base, cream text | **Amber**: actions/timeline | **Emerald**: stable | **Rose**: critical | **Sky**: info/meds

### Components & Patterns
```jsx
import { PatientChronicleCard, TimelineEntry, ClinicalSummarySidebar, PatientIdentityHero } from '@/components/chronicle';
```
- **Patient List**: Grid of chronicle cards + search/filter
- **Patient Detail**: Hero + sidebar + filterable timeline
- **CSS**: `.animate-chronicle-enter`, `.timeline-node-amber`, `.status-ribbon-critical`, `.badge-chronicle-rose`

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Consultation time | 15min → 7-8min |
| Clicks per ward round patient | 45 → 15 |
| Page navigations per task | 8-12 → 0-2 |
| Documentation completeness | >95% |
| Error rate | <2% |
| Workflow adoption | >80% in 3 months |

---

## Common Pitfalls

1. **Over-engineering early** - Build one workflow, validate, then expand
2. **Ignoring performance** - Progressive loading, caching, optimistic updates
3. **Forgetting edge cases** - Handle interruptions, errors, validation failures
4. **Not validating with users** - Test each workflow before building next
5. **Losing data features** - Keep search/browse accessible, just deprioritize
6. **Inconsistent patterns** - Establish consistent UI across workflows
7. **Forgetting mobile** - Design responsive from start
8. **Git commit** - Don't credit yourself in commit messages!

---

## Testing Requirements

**Always run tests after code changes.**

### Rules
1. Write tests for every new feature
2. Run tests at end of implementation
3. Fix failing tests before moving on

### When to Run
- **Bug fixes**: Specific test + related module tests
- **New features**: New tests + existing module tests
- **Refactoring**: Full suite for affected areas
- **Before commit**: Minimum tests for changed files

### Commands
```bash
# Backend (from backend-rs/)
docker compose up -d postgres redis                      # From repo root; starts local Postgres/Redis
cargo fmt --all --check                                  # Formatting
cargo test -p hms-access                                 # Access/policy tests
cargo test -p hms-db --test ward --test patients         # Focused DB contracts
cargo test -p hms-api --test patients_contract           # Focused API contracts
cargo test --workspace                                   # Full active backend suite
cargo run -p hms-api --bin hms-openapi -- openapi/hms-v2.openapi.json

# Legacy Django only when explicitly requested
cd backend && pytest -n auto

# Frontend (from frontend/)
npm run test                              # Unit tests
npm run test -- path/to/test.test.jsx     # Specific file
npm run test:coverage                     # Coverage run
npm run api:v2:generate:check             # Generated Rust API client freshness
```

**Rust test seams:** `hms-access` for authorization decisions, `hms-db` for
repository contracts, and `hms-api` for handler/DTO/middleware contracts.

Legacy Django pytest uses `hms_backend.settings_test`; that is not the active
backend test architecture.

---

## Workflow Design Checklist

1. What is user trying to accomplish? (single sentence)
2. What are the natural steps? (3-7)
3. What info needed at each step?
4. What actions at each step?
5. What validations required?
6. What if interrupted? (save/resume)
7. What auto-generates on completion?
8. How does it connect to other workflows?

---

## Future: Role Dashboards

**Admin**: System stats, all appointments, staff activity, quick actions (accounts, wards, audit)
**Lab**: Pending tests, critical results, turnaround times
**Pharmacy**: Pending prescriptions, stock alerts, dispensing queue

---

## Architectural Rules

### Patient Clinical Data Location (CRITICAL)
All patient clinical info (vitals, fluid balance, notes, meds, labs) MUST be accessible ONLY from `PatientChroniclePage`. Never scatter across pages.

- **Correct**: Clinical features as slide-overs/panels within PatientChroniclePage
- **Incorrect**: Standalone pages like `/nursing/fluid-balance/:patientId`

**Ensures:** Single source of truth, consistent UX, proper context (hero/sidebar visible), audit trail

---

## Scalability & Performance Guidelines

**Target:** 10,000+ concurrent users, sub-second response times.

### Database Query Optimization (CRITICAL: Avoid N+1)

```rust
// BAD: fetch a page, then query patient/ward data once per row.
let rows = repo.list_admissions(ctx, page).await?;
for row in rows {
    let patient = repo.get_patient(row.patient_id).await?;
    let ward = repo.get_ward(row.ward_id).await?;
}

// GOOD: repository returns one bounded projection for the list DTO.
let rows = repo
    .list_admission_board(ctx, AdmissionBoardQuery { limit, cursor })
    .await?;
```

**Use SQL aggregation over application loops:**
```sql
-- GOOD: aggregate in the query used by the repository contract.
SELECT invoice_id, sum(amount_minor) AS total_minor
FROM invoice_items
WHERE facility_id = $1
GROUP BY invoice_id;
```

**Verify bounded behavior in tests:** use `hms-db` repository tests for SQL
scope and bounded list contracts, and `hms-api` contract tests for DTO shape,
cursor behavior, and authorization wiring.

### Caching Strategy

Use scoped cache keys that include facility, user/patient access scope, feature
profile, and query parameters whenever access varies. Invalidate or refresh
projections through explicit repository/service boundaries and `hms-worker`
jobs.

**Timeouts:** Static lookups: 5-15min | Analytics: 10-15min | Dashboards: 30-60s | Real-time: none/5-10s

### API Design for Scale

- **Pagination mandatory** - Never unbounded clinical lists
- **Search over dropdowns** - For >50 items, use search endpoints with `[:20]` limit
- **Lightweight list DTOs** - 5-8 fields, flatten relationships

### Real-Time Features (WebSockets over Polling)

Rust realtime channels must use PHI-safe channel names, facility/patient/ward
access checks before subscription, and event payloads that match generated V2
contracts.

```javascript
// Frontend - poll only as WebSocket fallback
const { alerts } = useAlertWebSocket({ wardId, onAlert: (a) => toast.warning(a.message) });
```

### Frontend Performance

```javascript
// React Query caching
useQuery({ queryKey: ['patients', filters], queryFn: fetchPatients, staleTime: 30000, cacheTime: 300000 });

// Virtualize lists >100 items
import { useVirtualizer } from '@tanstack/react-virtual';

// Debounce search inputs (300ms)
const debouncedSearch = useDebouncedCallback((v) => searchPatients(v), 300);
```

### Feature Checklist
- [ ] Repository query is bounded and facility scoped?
- [ ] Query count <10 regardless of result size?
- [ ] Pagination implemented?
- [ ] Caching for read-heavy endpoints?
- [ ] Search over dropdown for >50 items?
- [ ] List DTO lightweight (5-8 fields, no nesting)?
- [ ] WebSocket for real-time (not polling)?
- [ ] Frontend optimized (React Query, virtualization)?

### Performance Testing
```bash
locust -f tests/load/locustfile.py --host=http://localhost:8000 --headless -u 50 -r 5 -t 2m
k6 run tests/load/k6-test.js
```
**Targets:** P95 <500ms | Error rate <1% | Query count constant with result size

---

## Summary

**Success = Clinical staff focus on patient care, not navigating software.**

- Test-driven development: write tests first
- Configurable over hardcoded: facilities differ
- Search over dropdowns: thousands of staff/patients
- Scale-first: every feature handles 10,000+ concurrent users

# Agent Behaviour Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
