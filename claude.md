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

---

## Tech Stack

**Frontend:** React 18+, React Router, TanStack Query, Tailwind CSS, shadcn/ui, React Hook Form, Zod

**Backend:** Django 4+, DRF, PostgreSQL, Celery, Redis, JWT

**Libraries:** date-fns, lucide-react, sonner

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

**Success = Clinical staff focus on patient care, not navigating software.**
