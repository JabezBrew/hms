# HMS Workflow-Oriented Design Guidelines

## Core Philosophy

**PRIORITY: Performance at scale + Security at all times.**

**FROM:** Data-centric CRUD → **TO:** Workflow-centric clinical tool
**Guiding Question:** "What are you trying to accomplish right now?"

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
frontend/src/                          backend/apps/
├── workflows/      # Consult, rounds  ├── workflows/    # models, views, engines
├── dashboards/     # Role dashboards  ├── dashboards/   # Role-based APIs
├── components/                        ├── suggestions/  # Smart suggestions
│   ├── workflow/   # Wizard, Progress └── templates/    # Clinical templates
│   ├── clinical/   # Context, Alerts
│   └── shared/     # SmartForm, ActionCard
├── contexts/       # Workflow, Role, ViewMode
└── hooks/          # useWorkflow, useSmartSuggestions
```

### Key APIs
```
POST /api/workflows/{type}/start/          GET  /api/dashboards/my-work/
GET  /api/workflows/{type}/{id}/           GET  /api/dashboards/ward-rounds/
PATCH /api/workflows/{type}/{id}/step/     GET  /api/dashboards/clinic/
POST /api/workflows/{type}/{id}/complete/
POST /api/workflows/{type}/{id}/save-draft/
```

### API Payload Optimization (MANDATORY)

1. **List Serializers**: ALL list endpoints use lightweight `*ListSerializer` (5-8 fields max, flattened)
2. **Pagination**: ALL `ModelViewSet` MUST set `pagination_class = StandardResultsSetPagination`
3. **Imports**: Use `apps.core.pagination.StandardResultsSetPagination`

```python
from apps.core.pagination import StandardResultsSetPagination

class MyViewSet(viewsets.ModelViewSet):
    pagination_class = StandardResultsSetPagination  # MANDATORY
    def get_serializer_class(self):
        return MyListSerializer if self.action == 'list' else MySerializer

# GOOD: patient_name = serializers.SerializerMethodField()
# BAD:  patient = PatientSerializer()  # Never nest in lists
```

**Reference:** `apps/core/serializers.py`, `apps/core/mixins.py` for `ListDetailSerializerMixin`

---

## Tech Stack

**Frontend:** React 18+, React Router, TanStack Query, Tailwind CSS, shadcn/ui, React Hook Form, Zod, date-fns, lucide-react, sonner
**Backend:** Django 4+, DRF, PostgreSQL, Celery, Redis, JWT

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
# Backend (from backend/, venv activated)
python -m pytest path/to/test.py -v --tb=short           # Specific file
python -m pytest path/to/test.py::TestClass -v --tb=short # Specific class
python -m pytest apps/app_name/tests/ -v --tb=short       # App tests
python -m pytest -v --tb=short                            # Full suite

# Migrations
python manage.py makemigrations && python manage.py migrate

# Frontend (from frontend/)
npm run test                              # Unit tests
npm run test -- path/to/test.test.jsx     # Specific file
npm run test:e2e                          # E2E (requires dev server)
```

**Markers:** `@pytest.mark.tier1` (critical), `@pytest.mark.integration`, `@pytest.mark.rbac`

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

```python
# BAD - N+1 queries
for p in Patient.objects.all():
    print(p.user.name)  # Extra query per patient

# GOOD - 2 queries total
patients = Patient.objects.select_related('user').prefetch_related(
    Prefetch('admissions', queryset=Admission.objects.filter(status='admitted')
             .select_related('bed__ward'), to_attr='active_admissions_list'))
```

**Use DB aggregation over Python loops:**
```python
# BAD:  total = sum(o.amount for o in Order.objects.filter(date=today))
# GOOD: total = Order.objects.filter(date=today).aggregate(total=Sum('amount'))['total']
```

**Verify query count in tests:**
```python
with CaptureQueriesContext(connection) as ctx:
    response = client.get('/api/endpoint/')
assert len(ctx) < 10, f"Too many queries: {len(ctx)}"
```

### Caching Strategy

```python
@method_decorator(cache_page(60 * 5), name='list')  # 5 min for list views
class WardViewSet(viewsets.ModelViewSet): pass

# Invalidate on writes
def perform_create(self, serializer):
    serializer.save()
    cache.delete_pattern('ward_list_*')
```

**Timeouts:** Static lookups: 5-15min | Analytics: 10-15min | Dashboards: 30-60s | Real-time: none/5-10s

### API Design for Scale

- **Pagination mandatory** - Never unbounded querysets
- **Search over dropdowns** - For >50 items, use search endpoints with `[:20]` limit
- **Lightweight list serializers** - 5-8 fields, flatten relationships

### Real-Time Features (WebSockets over Polling)

```python
# Backend broadcast
channel_layer = get_channel_layer()
async_to_sync(channel_layer.group_send)(f'ward_{alert.ward_id}', {'type': 'alert.new', 'data': data})
```
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
- [ ] Queries optimized? (`select_related`/`prefetch_related`)
- [ ] Query count <10 regardless of result size?
- [ ] Pagination implemented?
- [ ] Caching for read-heavy endpoints?
- [ ] Search over dropdown for >50 items?
- [ ] List serializer lightweight (5-8 fields, no nesting)?
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
