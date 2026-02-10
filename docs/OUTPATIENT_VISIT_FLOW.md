# Outpatient Visit Flow

## Scope and Decisions

- Outpatient encounters are created only at clinic check-in or appointment start.
- Registration is administrative and must not imply an outpatient encounter.
- Local `Appointment` is the source of truth; FHIR is synced asynchronously.
- Walk-ins must create an appointment first (with slot availability checks).
- Hard cutover: clinical entries must reference an explicit encounter.

## Current State (Implemented)

- **Clinic model** in `organization` app (facility-scoped).
- **Local Appointment model** with clinic/practitioner/patient links.
- **Encounter updates**: `clinic` and `appointment` FKs.
- **Start visit endpoint**: `POST /api/appointments/{id}/start_visit/` creates outpatient encounter.
- **Auto-creation removed**: encounter services now raise when no active encounter exists.

## Primary Flow

1. **Register patient** (no encounter created).
2. **Create appointment** (scheduled or walk-in) with clinic + practitioner + time range.
3. **Start visit** (`start_visit`) → creates outpatient encounter and marks appointment `arrived`.
4. **Clinical documentation** → requires encounter ID (hard enforcement).

## Remaining Work

- **FHIR sync**: backfill and sync local `Appointment` ↔ FHIR Appointment IDs.
- **Client workflows**: update UI to enforce appointment → start visit before any clinical entry.
- **Data migration**: migrate existing FHIR appointments into local Appointment rows.

## Enhancement Design

### 1. OutpatientVisit Lifecycle Model

**Purpose:** track outpatient visit state transitions and queue position.

**Location:** `apps/encounters/models.py`

```python
class OutpatientVisit(models.Model):
    class VisitStatus(models.TextChoices):
        CHECKED_IN = 'checked_in', 'Checked In'
        WAITING = 'waiting', 'Waiting'
        CALLED = 'called', 'Called'
        IN_PROGRESS = 'in_progress', 'With Doctor'
        ON_HOLD = 'on_hold', 'On Hold'
        READY_CHECKOUT = 'ready_checkout', 'Ready for Checkout'
        CHECKED_OUT = 'checked_out', 'Checked Out'
        NO_SHOW = 'no_show', 'No Show'
        CANCELLED = 'cancelled', 'Cancelled'

    appointment = models.OneToOneField('appointments.Appointment', on_delete=models.CASCADE, related_name='visit')
    encounter = models.OneToOneField('Encounter', on_delete=models.CASCADE, related_name='outpatient_visit')
    clinic = models.ForeignKey('organization.Clinic', on_delete=models.PROTECT)
    visit_status = models.CharField(max_length=20, choices=VisitStatus.choices, default=VisitStatus.CHECKED_IN)
    queue_number = models.PositiveIntegerField(null=True, blank=True)

    checked_in_at = models.DateTimeField(auto_now_add=True)
    checked_in_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='checkins')
    called_at = models.DateTimeField(null=True, blank=True)
    consultation_started_at = models.DateTimeField(null=True, blank=True)
    consultation_ended_at = models.DateTimeField(null=True, blank=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)
    checked_out_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='checkouts')

    class Meta:
        indexes = [
            models.Index(fields=['clinic', 'visit_status', 'checked_in_at']),
            models.Index(fields=['queue_number', 'checked_in_at']),
        ]
```

**Queue number generation:**
- Per clinic per day; use `select_for_update` to avoid collisions.
- Reset daily using `checked_in_at__date` filter.

### 2. TriageQueue Model & Workflow

**Purpose:** manage walk-in intake and assignment before visit starts.

**Location:** `apps/encounters/models.py`

```python
class TriageQueue(models.Model):
    class Priority(models.TextChoices):
        EMERGENCY = 'emergency', 'Emergency'
        URGENT = 'urgent', 'Urgent'
        ROUTINE = 'routine', 'Routine'

    class Status(models.TextChoices):
        WAITING = 'waiting', 'Waiting for Triage'
        TRIAGED = 'triaged', 'Triaged'
        ASSIGNED = 'assigned', 'Assigned to Clinic'
        CANCELLED = 'cancelled', 'Cancelled'

    facility = models.ForeignKey('core.Facility', on_delete=models.PROTECT)
    patient = models.ForeignKey('users.PatientProfile', on_delete=models.CASCADE)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.ROUTINE)
    chief_complaint = models.TextField(blank=True)
    triage_notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.WAITING)

    triaged_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='triage_assessments')
    triaged_at = models.DateTimeField(null=True, blank=True)

    assigned_clinic = models.ForeignKey('organization.Clinic', null=True, blank=True, on_delete=models.SET_NULL)
    assigned_practitioner = models.ForeignKey('users.PractitionerProfile', null=True, blank=True, on_delete=models.SET_NULL)
    assigned_at = models.DateTimeField(null=True, blank=True)

    appointment = models.OneToOneField('appointments.Appointment', null=True, blank=True, on_delete=models.SET_NULL, related_name='triage_entry')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['facility', 'status']),
            models.Index(fields=['patient', 'created_at']),
            models.Index(fields=['priority', 'created_at']),
        ]
```

**Workflow:**
1. Walk-in added to queue (status `waiting`).
2. Nurse triages → `triaged` with priority and notes.
3. Assignment selects clinic/practitioner and **creates Appointment** (source `walk_in`) after slot check.
4. Check-in starts visit → creates Encounter + OutpatientVisit.

### 3. Waiting Room Endpoints

**Preferred placement:** `OutpatientVisitViewSet` in `apps/encounters/views.py`.

Actions:
- `POST /api/visits/{encounter_id}/add_to_waiting/` → CHECKED_IN → WAITING
- `POST /api/visits/{encounter_id}/call/` → WAITING → CALLED
- `POST /api/visits/{encounter_id}/start_consultation/` → CALLED/ON_HOLD → IN_PROGRESS
- `POST /api/visits/{encounter_id}/hold/` → IN_PROGRESS → ON_HOLD
- `POST /api/visits/{encounter_id}/end_consultation/` → IN_PROGRESS → READY_CHECKOUT
- `POST /api/visits/{encounter_id}/checkout/` → READY_CHECKOUT → CHECKED_OUT
- `POST /api/visits/{encounter_id}/no_show/` → WAITING/CHECKED_IN → NO_SHOW
- `GET /api/visits/waiting_room/?clinic={id}` → ordered by `queue_number`

**Security:**
- Require `FacilityScopedPermission` + role (doctor/nurse/receptionist).
- Use `check_clinical_access` for patient-level access.

### 4. Checkout Requirements Automation

**Goal:** prevent checkout until required clinical/billing steps complete.

Rules (configurable per facility):
- Consultation finished (`consultation_ended_at` present)
- No pending prescriptions (`encounter.prescriptions.status='pending'`)
- No pending lab orders (`encounter.lab_orders.status in pending`)
- No unpaid invoices (`encounter.invoices.status='pending'`)

**Behavior:**
- `checkout()` validates requirements and returns a list of blockers.
- Optional `force=true` for admin override.
- When requirements are met, transition encounter to `finished` and appointment to `fulfilled`.
