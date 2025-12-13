# HMS Workflow-Oriented Design Guidelines

## Core Philosophy

**FROM:** Data-centric CRUD system → **TO:** Workflow-centric clinical tool

**Guiding Question:** "What are you trying to accomplish right now?"

### Data-Oriented (Bad)
- Navigation mimics database structure
- Users mentally map workflows to tables
- Information scattered across pages
- No guidance on next steps

### Workflow-Oriented (Good)
- Navigation mirrors clinical processes
- System guides step-by-step
- All relevant info/actions in one flow
- Clear progress indication

---

## Design Principles

### 1. Progressive Disclosure
Show what's needed for the current task, not everything at once.

### 2. Guided Flows
Multi-step processes with: step indicators, progress visualization, validation, save/resume, "what's next" guidance.

### 3. Smart Defaults
System anticipates needs: suggest follow-up dates, common lab bundles, usual doses, templates by encounter type.

### 4. Action-Oriented Cards
Every card answers "What can I DO with this?" Include action buttons, not just information display.

### 5. Contextual Quick Actions
Actions change based on context (inpatient vs outpatient, lab result vs encounter).

### 6. Minimize Navigation
Target: 50-70% reduction in clicks/page loads. Consultation completable in single flow.

### 7. Role-Based Personalization
- Doctor → "Today's Clinic" with scheduled consultations
- Nurse → "My Shift Dashboard" with ward patients
- Receptionist → "Front Desk" with check-ins

---

## Workflow Patterns

### Pattern 1: Wizard
Multi-step linear flow with validation. Use for: registration, admission, discharge, complex data entry.

### Pattern 2: Dashboard
Role-specific landing with sections: Urgent (top), Current Work, Upcoming, Completed, Quick Actions.

### Pattern 3: Guided Flow
Step-by-step with context panel showing patient summary, allergies, active problems, current meds.

### Pattern 4: Checklist
Task list with completion tracking, required/optional items, dependencies, auto-population.

### Pattern 5: Timeline
Chronological patient journey view with expandable details and filters.

---

## Role Workflows

### Nurse Dashboard
- **URGENT**: Critical vitals, overdue meds, alerts
- **WARD ROUNDS**: Patient-by-patient checklist
- **MEDS**: Time-based administration schedule
- **RESULTS**: Labs needing review

### Doctor (Outpatient)
- **CURRENT**: Who's in the room
- **UPCOMING**: Next patients with prep info
- **COMPLETED**: Today's finished
- **MESSAGES/RESULTS**: Items to review

**Consultation Flow:**
1. Pre-Consult Prep (auto-loaded)
2. History & Exam (smart templates)
3. Assessment & Plan (inline orders/prescriptions)
4. Complete (auto-generates note, orders, follow-up)

### Doctor (Inpatient)
- **NEW ADMISSIONS**: Overnight admits
- **ACTIVE PATIENTS**: Current list
- **DISCHARGES TODAY**: Planned discharges
- **PENDING**: Orders to sign, results to review

### Receptionist
- **CHECK-IN QUEUE**: Arrived patients
- **REGISTRATION**: New patients
- **SCHEDULING**: Appointment requests
- **PAYMENTS**: Co-pays

---

## Technical Architecture

### Frontend Structure
```
frontend/src/
├── workflows/           # Consultation, ward-rounds, admission, discharge
├── dashboards/          # Nurse, Doctor, Receptionist dashboards
├── components/
│   ├── workflow/        # WorkflowWizard, Progress, StepIndicator
│   ├── clinical/        # PatientContextPanel, AlertsPanel, QuickActions
│   └── shared/          # SmartForm, TemplateSelector, ActionCard
├── contexts/            # WorkflowContext, RoleContext, ViewModeContext
└── hooks/               # useWorkflow, useSmartSuggestions, useRoleBasedAccess
```

### Backend Structure
```
backend/apps/
├── workflows/           # models, views, engines, validators
├── dashboards/          # Role-based dashboard APIs
├── suggestions/         # Smart suggestion engine
└── templates/           # Clinical templates
```

### Key APIs
```
POST /api/workflows/{type}/start/     # Start workflow
GET  /api/workflows/{type}/{id}/      # Get state
PATCH /api/workflows/{type}/{id}/step/ # Update step
POST /api/workflows/{type}/{id}/complete/ # Complete
POST /api/workflows/{type}/{id}/save-draft/ # Auto-save

GET /api/dashboards/my-work/          # Role-based dashboard
GET /api/dashboards/ward-rounds/      # Ward-specific data
GET /api/dashboards/clinic/           # Clinic schedule
```

### API Payload Optimization

**Critical:** Keep API response payloads minimal. Only return fields the frontend actually needs.

**Patterns:**
- Use **List Serializers** for list endpoints (5-8 fields max)
- Use **Detail Serializers** for single-item retrieval (full data)
- Flatten nested relationships with `SerializerMethodField` (e.g., `patient_name` instead of nested `patient` object)
- Return counts instead of full arrays when listing (e.g., `items_count` instead of `items[]`)

**Example:**
```python
# In ViewSet
def get_serializer_class(self):
    if self.action == 'list':
        return MyListSerializer  # Lightweight
    return MySerializer          # Full details

# List serializer: return name, not full nested object
patient_name = serializers.SerializerMethodField()  # Good
patient = PatientSerializer()                        # Bad for lists
```

**Reference:** See `apps/core/serializers.py` for minimal serializers and `apps/core/mixins.py` for `ListDetailSerializerMixin`.

---

## Tech Stack

**Frontend:** React 18+, React Router, TanStack Query, Tailwind CSS, shadcn/ui, React Hook Form, Zod

**Backend:** Django 4+, DRF, PostgreSQL, Celery, Redis, JWT

**Libraries:** date-fns, lucide-react, sonner

---

## Chronicle Design System

**See:** [`frontend/CHRONICLE_DESIGN_SYSTEM.md`](frontend/CHRONICLE_DESIGN_SYSTEM.md) for full documentation.

### Philosophy
"Patient data as story, not spreadsheet." Editorial medical journal aesthetic with narrative-focused presentation.

### Typography
- **Display** (`font-display`): Fraunces - patient names, page titles
- **Heading** (`font-heading`): DM Sans - section headers
- **Data** (`font-mono`): IBM Plex Mono - MRNs, vitals, timestamps

### Colors (Warm Stone + Accents)
- **Base**: Warm charcoal background, cream text
- **Amber**: Primary actions, timeline nodes
- **Emerald**: Positive/stable status
- **Rose**: Critical alerts, allergies
- **Sky**: Informational, medications

### Key Components
```jsx
import {
  PatientChronicleCard,    // Magazine-style patient list card
  TimelineEntry,           // Chronological clinical events
  ClinicalSummarySidebar,  // Always-visible patient context
  PatientIdentityHero      // Editorial patient header
} from '@/components/chronicle';
```

### Page Patterns
- **Patient List**: Grid of chronicle cards with search/filter
- **Patient Detail**: Hero header + sidebar + filterable timeline

### CSS Utilities
```css
.animate-chronicle-enter   /* Staggered entry animation */
.timeline-node-amber       /* Colored timeline nodes */
.status-ribbon-critical    /* Priority indication */
.badge-chronicle-rose      /* Accent badges */
```

---

## Success Metrics

### Efficiency (Target: 50-70% improvement)
- Consultation time: 15min → 7-8min
- Clicks per ward round patient: 45 → 15
- Page navigations per task: 8-12 → 0-2

### Quality
- Documentation completeness: >95%
- Error rate: <2%
- Task completion: >90%

### Adoption
- Workflow feature usage: >80% within 3 months

---

## Common Pitfalls

1. **Over-engineering early** - Build one workflow, validate, then expand
2. **Ignoring performance** - Use progressive loading, caching, optimistic updates
3. **Forgetting edge cases** - Handle interruptions, errors, validation failures
4. **Not validating with users** - Test each workflow before building next
5. **Losing data features** - Keep search/browse accessible, just deprioritize
6. **Inconsistent patterns** - Establish consistent UI patterns across workflows
7. **Forgetting mobile** - Design responsive from the start

---

## Testing Requirements

**Always run tests after making code changes** to ensure no breaking changes.

### Core Rules
1. **Write tests for every new feature** - No feature is complete without tests
2. **Run tests at the end of implementation** - Verify the feature works as expected
3. **Fix failing tests before moving on** - Never leave broken tests behind

### When to Run Tests
- **Bug fixes**: Run the specific test + related tests in the same module
- **New features**: Write new tests, then run them + existing tests for the module
- **Refactoring**: Run full test suite for affected areas
- **Before committing**: Run at minimum the tests for changed files

### Test Commands

```bash
# Backend (from backend/ directory)
source .venv/bin/activate

# Run specific test file
python -m pytest path/to/test_file.py -v --tb=short

# Run specific test class
python -m pytest path/to/test_file.py::TestClassName -v --tb=short

# Run specific test method
python -m pytest path/to/test_file.py::TestClassName::test_method -v --tb=short

# Run tests for an app
python -m pytest apps/app_name/tests/ -v --tb=short

# Run full backend suite
python -m pytest -v --tb=short
```

```bash
# Frontend (from frontend/ directory)
# Run unit tests
npm run test

# Run specific test file
npm run test -- path/to/test.test.jsx

# Run E2E tests (requires dev server)
npm run test:e2e
```

### Test Markers (Backend)
- `@pytest.mark.tier1` - Critical tests, run frequently
- `@pytest.mark.integration` - Integration tests
- `@pytest.mark.rbac` - Role-based access control tests

---

## Workflow Design Checklist

Before implementing a new workflow:
1. What is the user trying to accomplish? (single sentence)
2. What are the natural steps? (3-7 steps)
3. What info needed at each step?
4. What actions at each step?
5. What validations required?
6. What if interrupted? (save/resume)
7. What auto-generates on completion?
8. How does it connect to other workflows?

---

## Future: Role Dashboards

### Admin Dashboard
- System stats (patients, staff, encounters, occupancy)
- All appointments across practitioners
- Staff activity monitor
- Quick actions: create accounts, manage wards, audit logs

### Other Dashboards
- **Lab**: Pending tests, critical results, turnaround times
- **Pharmacy**: Pending prescriptions, stock alerts, dispensing queue

---

## Architectural Rules

### Patient Clinical Data Location
**CRITICAL:** All patient clinical information (vitals, fluid balance, clinical notes, medications, labs, etc.) MUST be accessible ONLY from the `PatientChroniclePage`. Never scatter patient clinical data across different pages or dashboards.

- **Correct**: Add clinical features as slide-overs/panels within PatientChroniclePage
- **Incorrect**: Creating standalone pages for patient-specific clinical data (e.g., `/nursing/fluid-balance/:patientId`)

This ensures:
1. Single source of truth for patient clinical data
2. Consistent user experience - clinicians always know where to find patient info
3. Proper context - patient identity hero and clinical sidebar are always visible
4. Audit trail - all clinical actions happen within patient context

---

**Success = Clinical staff focus on patient care, not navigating software.**
- let's do test driven development from now!
- Because the system would be used by facilities with different approaches, most features should be configurable instead of hardcoding
- Always take into account the fact that the system will deploy in large hospitals that will have large numbers of staff, patients etc so in places where a selection needs to be made, it would be ideal and efficient to use a search mechanism than loading all entiities and displaying in a drop-down list