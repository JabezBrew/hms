# HMS Workflow-Oriented Design Guidelines

## Table of Contents
1. [Core Philosophy](#core-philosophy)
2. [Design Principles](#design-principles)
3. [Workflow Design Patterns](#workflow-design-patterns)
4. [Role-Based Workflows](#role-based-workflows)
5. [Technical Architecture](#technical-architecture)
6. [Implementation Guidelines](#implementation-guidelines)
7. [Measurement & Success Criteria](#measurement--success-criteria)
8. [Reference Documents](#reference-documents)

---

## Core Philosophy

### The Transformation

**FROM:** Data-centric CRUD system
**TO:** Workflow-centric clinical tool

### Guiding Question
**"What are you trying to accomplish right now?"**

Not: "Here's all your data, go find what you need"
But: "What workflow are you in? Let me guide you through it."

### The Problem with Current Approach

#### Data-Oriented Thinking:
- Navigation mimics database structure (Patients, Encounters, Wards, etc.)
- Users must mentally map their workflow to database tables
- Lots of clicking between pages to complete a single task
- Information scattered across multiple views
- No guidance on what to do next

#### Workflow-Oriented Thinking:
- Navigation mirrors clinical processes (Consultation, Ward Rounds, Discharge, etc.)
- System guides users through their workflow step-by-step
- All relevant information and actions in one flow
- Context-aware interfaces
- Clear next steps and progress indication

---

## Design Principles

### 1. Progressive Disclosure
**Don't show everything at once. Show what's needed for the current task.**

✅ **Good Example:**
```
Patient Card - At-a-glance view:
- Name, Age, Allergies, Current location
- Click to expand: Full demographics
- Contextual expansion: If prescribing → Show medication history
```

❌ **Bad Example:**
```
Patient Card with all 50 fields visible:
- Name, Age, Gender, DOB, Address, Phone, Email,
  Insurance, Emergency Contact, Employer, etc.
  (overwhelming, most not needed for current task)
```

### 2. Guided Flows
**Multi-step processes with clear progress indication.**

Components of a good flow:
- Clear step indicators (Step 1 of 5)
- Progress visualization
- Validation at each step
- Ability to save and resume
- Clear "what's next" guidance

Example structure:
```
[1. Prep] → [2. History] → [3. Exam] → [4. Orders] → [5. Plan]
    ↓          ↓             ↓            ↓             ↓
  Auto-    Smart         Quick         Integrated   Auto-
  loaded   templates     entry         actions      complete
```

### 3. Smart Defaults & Suggestions
**System anticipates what you need.**

Examples:
- Booking follow-up? → Suggest 2 weeks based on diagnosis
- Ordering labs? → Show "commonly ordered together"
- Prescribing? → Pre-fill usual doses
- Creating note? → Template based on encounter type
- Discharge orders? → Checklist based on admission diagnosis

### 4. Action-Oriented Cards
**Every card should answer "What can I DO with this?"**

❌ **Information-only card:**
```jsx
<Card>
  <CardHeader>Lab Result</CardHeader>
  <CardContent>
    HbA1c: 8.2% (High)
    Date: Oct 28, 2025
  </CardContent>
</Card>
```

✅ **Action-oriented card:**
```jsx
<Card>
  <CardHeader>
    <AlertCircle /> Lab Result - Requires Action
  </CardHeader>
  <CardContent>
    HbA1c: 8.2% (High) - Ref: <7%
    Date: Oct 28, 2025
  </CardContent>
  <CardFooter>
    <Button>Adjust Medication</Button>
    <Button>Order Repeat in 3mo</Button>
    <Button>Call Patient</Button>
    <Button variant="outline">Mark Reviewed</Button>
  </CardFooter>
</Card>
```

### 5. Contextual Quick Actions
**Available actions change based on context.**

```javascript
// Quick Actions are context-aware:
const getQuickActions = (context) => {
  if (context.encounterType === 'inpatient') {
    return ['Order', 'Consult', 'Discharge'];
  } else if (context.encounterType === 'outpatient') {
    return ['Prescribe', 'Schedule F/U', 'Referral'];
  } else if (context.type === 'lab_result') {
    return ['Review', 'Order Repeat', 'Contact Patient'];
  }
  // etc.
};
```

### 6. Minimize Navigation
**Complete tasks within the workflow, not across pages.**

**Measure:** Count clicks and page loads to complete a task
- Target: Reduce by 50-70% vs current implementation
- Example: Consultation should be completable in single flow (0 navigations away)

### 7. Role-Based Personalization
**Different roles see different workflows and dashboards.**

```
Doctor landing page → "Today's Clinic" with scheduled consultations
Nurse landing page → "My Shift Dashboard" with assigned ward patients
Receptionist landing page → "Front Desk" with check-ins and registrations
```

---

## Workflow Design Patterns

### Pattern 1: The Wizard
Multi-step linear flow with validation.

**Use for:**
- Patient registration
- Admission process
- Discharge process
- Complex data entry

**Implementation:**
```jsx
<Wizard
  steps={[
    { id: 1, title: 'Basic Info', component: BasicInfo, required: true },
    { id: 2, title: 'Insurance', component: Insurance, required: false },
    { id: 3, title: 'Appointment', component: Appointment, required: true },
    { id: 4, title: 'Confirmation', component: Confirmation, required: false },
  ]}
  onComplete={handleComplete}
  onSave={handleSaveDraft}
  autoSave={true}
  allowSkip={true}
/>
```

### Pattern 2: The Dashboard
Role-specific landing page with prioritized information.

**Components:**
1. **Urgent section** (top, red/yellow alerts)
2. **Current work** (what I'm doing now)
3. **Upcoming work** (what's next)
4. **Completed work** (recent activity)
5. **Quick actions** (context-aware shortcuts)

**Layout:**
```
┌─────────────────────────────────────────┐
│ Good morning, [Name]                    │
│ [Role Context - e.g., "Ward 3A"]        │
├─────────────────────────────────────────┤
│ 🚨 URGENT (count)                        │
│ [Prioritized alerts requiring action]   │
├─────────────────────────────────────────┤
│ 📋 CURRENT WORK                          │
│ [What user is actively doing]           │
├─────────────────────────────────────────┤
│ 📅 UPCOMING                              │
│ [What's scheduled/pending]              │
├─────────────────────────────────────────┤
│ ✅ COMPLETED                             │
│ [Recent activity log]                   │
└─────────────────────────────────────────┘
```

### Pattern 3: The Guided Flow
Step-by-step process with context panel.

**Structure:**
- **Left/Top:** Progress indicator
- **Center:** Current step content
- **Right:** Contextual information (patient summary, alerts, history)
- **Bottom:** Navigation (Back, Save Draft, Next/Complete)

**Example: Consultation Flow**
```
┌──────────────────────────────────────────────────────────┐
│ [1.Prep] → [2.History] → [3.Exam] → [4.Orders] → [5.Plan]│
├────────────────────────────────┬─────────────────────────┤
│                                │ Patient Context Panel   │
│  CURRENT STEP CONTENT          │ - Demographics          │
│  (Forms, inputs, templates)    │ - Allergies (prominent) │
│                                │ - Active problems       │
│                                │ - Current meds          │
│                                │ - Recent results        │
│                                │                         │
├────────────────────────────────┴─────────────────────────┤
│ [← Back] [Save Draft] [Continue →]                       │
└──────────────────────────────────────────────────────────┘
```

### Pattern 4: The Checklist
Task list with completion tracking.

**Use for:**
- Ward rounds
- Pre-op checklist
- Discharge checklist
- Admission requirements

**Features:**
- Clear completion status
- Required vs optional tasks
- Dependencies (can't proceed until X is done)
- Auto-population of completed items
- Flag incomplete items

**Example:**
```jsx
<Checklist
  title="Discharge Checklist"
  items={[
    { id: 1, task: 'Clear all pending consults', required: true, completed: true },
    { id: 2, task: 'Discharge medications ordered', required: true, completed: true },
    { id: 3, task: 'Follow-up appointment scheduled', required: true, completed: false },
    { id: 4, task: 'Patient education completed', required: false, completed: false },
  ]}
  onComplete={() => enableDischarge()}
  blockProceed={true} // Can't proceed until all required items done
/>
```

### Pattern 5: The Timeline
Chronological view of patient journey.

**Use for:**
- Encounter history
- Treatment progress
- Event log

**Components:**
- Time markers
- Event type indicators
- Expandable details
- Filter by type
- Export/print summary

---

## Role-Based Workflows

### Nurse: Morning Shift Workflow

**Landing: "My Shift Dashboard"**

**Priority sections:**
1. 🚨 **URGENT** - Critical vitals, overdue meds, alerts
2. 📋 **WARD ROUNDS CHECKLIST** - Patient-by-patient tasks
3. 💊 **MEDICATION SCHEDULE** - Time-based med administration
4. 📊 **RECENT RESULTS** - Labs needing review

**Primary workflow: Ward Round Mode**

Flow structure:
```
For each patient in ward:
  1. Quick patient summary (name, age, diagnosis, day #)
  2. Vital signs recording (with normal ranges)
  3. Pain assessment
  4. Medication administration checklist
  5. Quick notes (templated)
  6. Flags/alerts review
  7. "Complete & Next" button

Progress: "Patient 3 of 8"
Can flag for doctor review
Can jump to specific patient
Auto-saves progress
```

**Quick Actions:**
- Record vitals
- Administer medication
- Report issue
- Call doctor
- Update care plan

### Doctor: Outpatient Clinic Workflow

**Landing: "Today's Clinic"**

**Sections:**
1. 🟢 **CURRENT PATIENT** - Who's in the room now
2. 📅 **UPCOMING** - Next patients with prep info
3. ✅ **COMPLETED** - Today's finished appointments
4. 📊 **MESSAGES/RESULTS** - Items needing review

**Primary workflow: Consultation Flow**

**Step 1: Pre-Consult Prep (Auto-assembled)**
- Last visit summary
- Recent results (auto-highlighted if abnormal)
- Active problems
- Current medications with adherence
- Alerts (overdue screenings, drug interactions)
- Reason for today's visit

**Step 2: History & Exam (Smart templates)**
- Chief complaint (pre-filled from appointment)
- Template selection based on visit type
- Focused HPI questions
- Physical exam with quick entry
- Voice-to-text support

**Step 3: Assessment & Plan (Integrated actions)**
- Problem list review
- Assessment notes
- Inline actions:
  - [Order Lab] → Lab selection modal
  - [Prescribe] → Medication selector with dosing
  - [Refer] → Referral form
  - [Schedule F/U] → Calendar picker
  - [Print Handouts] → Education materials

**Step 4: Complete → Auto-generates:**
- Encounter note
- Prescriptions → sent to pharmacy
- Lab orders → sent to lab
- Referrals → sent to specialist
- Follow-up → scheduled
- Patient summary → printed/emailed

### Receptionist: Patient Registration Workflow

**Landing: "Front Desk"**

**Sections:**
1. **CHECK-IN QUEUE** - Patients arrived for appointments
2. **REGISTRATION** - New patients to register
3. **SCHEDULING** - Appointment requests
4. **PAYMENTS** - Co-pays to collect

**Primary workflow: New Patient Intake Wizard**

**Step 1: Basic Information (Minimal)**
- Name, DOB, Sex, Phone
- Can proceed with just this

**Step 2: Insurance (Smart)**
- Scan card → auto-extract data
- Real-time verification
- Flag if inactive/invalid

**Step 3: Appointment Scheduling (Intelligent)**
- Visit reason → suggests appropriate specialty
- Provider recommendations based on availability
- Calendar view with available slots
- Conflict detection

**Step 4: Confirmation & Actions**
- Print appointment card
- Send SMS/email reminder
- Add to patient portal
- Co-pay collection prompt
- Medical history form assignment

### Doctor: Inpatient Ward Workflow

**Landing: "My Service"**

**Sections:**
1. **NEW ADMISSIONS** - Patients admitted overnight
2. **ACTIVE PATIENTS** - Current patient list
3. **DISCHARGES TODAY** - Planned discharges
4. **PENDING ITEMS** - Orders to sign, results to review

**Primary workflow: Morning Rounds**

For each patient:
- **Overnight summary** (nurse notes, vitals trends, events)
- **Updated problem list**
- **Today's plan** (orders, procedures, consults)
- **Discharge planning** (criteria, barriers, target date)

Quick actions:
- Place order
- Request consult
- Update plan
- Write progress note
- Initiate discharge

---

## Technical Architecture

### Frontend Structure

```
frontend/src/
├── workflows/
│   ├── consultation/
│   │   ├── ConsultationWorkflow.jsx
│   │   ├── steps/
│   │   │   ├── PrepStep.jsx
│   │   │   ├── HistoryStep.jsx
│   │   │   ├── ExamStep.jsx
│   │   │   ├── OrdersStep.jsx
│   │   │   └── PlanStep.jsx
│   │   ├── hooks/
│   │   │   ├── useConsultationWorkflow.js
│   │   │   └── useConsultationData.js
│   │   └── components/
│   │       ├── PatientContextPanel.jsx
│   │       ├── ConsultationProgress.jsx
│   │       └── ConsultationSummary.jsx
│   │
│   ├── ward-rounds/
│   │   ├── WardRoundsWorkflow.jsx
│   │   ├── components/
│   │   │   ├── PatientCard.jsx
│   │   │   ├── VitalsForm.jsx
│   │   │   └── RoundsSummary.jsx
│   │   └── hooks/
│   │       └── useWardRounds.js
│   │
│   ├── admission/
│   ├── discharge/
│   └── emergency-intake/
│
├── dashboards/
│   ├── NurseDashboard.jsx
│   ├── DoctorDashboard.jsx
│   ├── ReceptionistDashboard.jsx
│   └── hooks/
│       ├── useNurseDashboard.js
│       ├── useDoctorDashboard.js
│       └── useReceptionistDashboard.js
│
├── components/
│   ├── workflow/
│   │   ├── WorkflowWizard.jsx
│   │   ├── WorkflowProgress.jsx
│   │   ├── StepIndicator.jsx
│   │   └── WorkflowContext.jsx
│   │
│   ├── clinical/
│   │   ├── PatientContextPanel.jsx
│   │   ├── AlertsPanel.jsx
│   │   ├── VitalsDisplay.jsx
│   │   ├── MedicationSchedule.jsx
│   │   └── QuickActions.jsx
│   │
│   └── shared/
│       ├── SmartForm.jsx
│       ├── TemplateSelector.jsx
│       └── ActionCard.jsx
│
├── contexts/
│   ├── WorkflowContext.jsx
│   ├── RoleContext.jsx
│   └── ViewModeContext.jsx (existing)
│
└── hooks/
    ├── useWorkflow.js
    ├── useSmartSuggestions.js
    └── useRoleBasedAccess.js
```

### Backend Structure

```
backend/
├── apps/
│   ├── workflows/
│   │   ├── models.py
│   │   │   ├── Workflow (base model)
│   │   │   ├── ConsultationWorkflow
│   │   │   ├── WardRoundWorkflow
│   │   │   ├── AdmissionWorkflow
│   │   │   └── DischargeWorkflow
│   │   │
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   ├── engines.py (workflow execution logic)
│   │   ├── validators.py (business rules)
│   │   └── tasks.py (async operations)
│   │
│   ├── dashboards/
│   │   ├── views.py
│   │   │   ├── nurse_dashboard()
│   │   │   ├── doctor_dashboard()
│   │   │   └── receptionist_dashboard()
│   │   ├── serializers.py
│   │   └── urls.py
│   │
│   ├── suggestions/
│   │   ├── engine.py (suggestion logic)
│   │   ├── models.py (suggestion history)
│   │   └── views.py (API endpoints)
│   │
│   ├── templates/
│   │   ├── models.py (clinical templates)
│   │   ├── views.py
│   │   └── serializers.py
│   │
│   └── [existing apps: patients, encounters, etc.]
│
└── hms_backend/
    ├── settings.py
    └── urls.py
```

### Key Models

#### Workflow Model
```python
from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()

class WorkflowType(models.TextChoices):
    CONSULTATION = 'consultation', 'Consultation'
    WARD_ROUND = 'ward_round', 'Ward Round'
    ADMISSION = 'admission', 'Admission'
    DISCHARGE = 'discharge', 'Discharge'
    EMERGENCY = 'emergency', 'Emergency Intake'

class WorkflowStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    IN_PROGRESS = 'in_progress', 'In Progress'
    COMPLETED = 'completed', 'Completed'
    CANCELLED = 'cancelled', 'Cancelled'

class ClinicalWorkflow(models.Model):
    """
    Base model for all clinical workflows
    Tracks progress through multi-step processes
    """
    workflow_type = models.CharField(
        max_length=50,
        choices=WorkflowType.choices
    )
    status = models.CharField(
        max_length=20,
        choices=WorkflowStatus.choices,
        default=WorkflowStatus.DRAFT
    )

    # Context
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    patient = models.ForeignKey('patients.Patient', on_delete=models.CASCADE)
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.CASCADE,
        null=True,
        blank=True
    )

    # Progress tracking
    current_step = models.IntegerField(default=0)
    total_steps = models.IntegerField()
    steps_completed = models.JSONField(default=list)  # [1, 2, 3]

    # Data storage
    context_data = models.JSONField(default=dict)  # Workflow-specific data

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    # Auto-save drafts
    last_autosave = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'clinical_workflows'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['patient', 'workflow_type']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f"{self.get_workflow_type_display()} - {self.patient} ({self.status})"

    def is_complete(self):
        return len(self.steps_completed) == self.total_steps

    def can_proceed_to_next_step(self):
        # Implement validation logic
        return self.current_step < self.total_steps
```

#### Dashboard Data Model
```python
class DashboardData(models.Model):
    """
    Cached dashboard data for performance
    Refreshed periodically or on relevant events
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    role = models.CharField(max_length=50)

    # Dashboard sections
    urgent_items = models.JSONField(default=list)
    current_work = models.JSONField(default=list)
    upcoming_work = models.JSONField(default=list)
    completed_today = models.JSONField(default=list)

    # Metadata
    last_refresh = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'dashboard_data'
        unique_together = ['user', 'role']
```

### API Endpoints

#### Workflow APIs
```
# Start a new workflow
POST /api/workflows/{workflow_type}/start/
Body: { patient_id, encounter_id?, initial_data? }
Response: { id, workflow_type, current_step, context_data }

# Get workflow state
GET /api/workflows/{workflow_type}/{id}/
Response: { id, status, current_step, steps_completed, context_data }

# Update workflow step
PATCH /api/workflows/{workflow_type}/{id}/step/
Body: { step_data, next_step? }
Response: { id, current_step, updated_context }

# Complete workflow
POST /api/workflows/{workflow_type}/{id}/complete/
Body: { final_data }
Response: { id, status: 'completed', generated_artifacts }

# Save draft (auto-save)
POST /api/workflows/{workflow_type}/{id}/save-draft/
Body: { context_data }
Response: { success: true, last_autosave }

# Resume workflow
GET /api/workflows/{workflow_type}/resume/
Query: ?patient_id=123
Response: { workflows: [...drafts...] }
```

#### Dashboard APIs
```
# Get role-based dashboard
GET /api/dashboards/my-work/
Response: {
  role: 'nurse',
  urgent_items: [...],
  current_work: [...],
  upcoming_work: [...],
  completed_today: [...]
}

# Get specific workflow dashboard data
GET /api/dashboards/ward-rounds/
Query: ?ward_id=5
Response: {
  ward: {...},
  patients: [...],
  checklist: [...],
  alerts: [...]
}

# Get clinic schedule
GET /api/dashboards/clinic/
Query: ?date=2025-11-01
Response: {
  current_patient: {...},
  upcoming: [...],
  completed: [...]
}
```

#### Suggestion APIs
```
# Get smart suggestions
POST /api/suggestions/next-action/
Body: { context: { type, entity_id, current_data } }
Response: {
  suggestions: [
    { action: 'order_lab', confidence: 0.9, params: {...} },
    { action: 'schedule_followup', confidence: 0.7, params: {...} }
  ]
}

# Get template suggestions
GET /api/suggestions/templates/
Query: ?encounter_type=outpatient&chief_complaint=diabetes
Response: {
  templates: [
    { id: 1, name: 'Diabetes Follow-up', usage_count: 245 },
    { id: 2, name: 'Endocrine Review', usage_count: 89 }
  ]
}
```

---

## Implementation Guidelines

### Starting a New Workflow

#### 1. Define the workflow structure

Create a workflow definition file:

```javascript
// workflows/consultation/definition.js
export const CONSULTATION_WORKFLOW = {
  type: 'consultation',
  name: 'Clinical Consultation',
  totalSteps: 5,
  steps: [
    {
      id: 1,
      key: 'prep',
      title: 'Pre-Consult Prep',
      description: 'Review patient history and recent results',
      required: false, // Auto-loaded
      component: 'PrepStep',
      validationRules: [],
    },
    {
      id: 2,
      key: 'history',
      title: 'History & Exam',
      description: 'Document chief complaint, HPI, and physical exam',
      required: true,
      component: 'HistoryStep',
      validationRules: ['chief_complaint_required'],
    },
    {
      id: 3,
      key: 'assessment',
      title: 'Assessment & Plan',
      description: 'Formulate assessment and treatment plan',
      required: true,
      component: 'AssessmentStep',
      validationRules: ['assessment_required'],
    },
    {
      id: 4,
      key: 'orders',
      title: 'Orders & Actions',
      description: 'Place orders, prescriptions, referrals',
      required: false,
      component: 'OrdersStep',
      validationRules: [],
    },
    {
      id: 5,
      key: 'complete',
      title: 'Review & Complete',
      description: 'Review summary and complete encounter',
      required: true,
      component: 'CompleteStep',
      validationRules: ['review_required'],
    },
  ],
  autoSave: true,
  autoSaveInterval: 30000, // 30 seconds
};
```

#### 2. Create workflow component

```jsx
// workflows/consultation/ConsultationWorkflow.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { WorkflowWizard } from '@/components/workflow/WorkflowWizard';
import { useWorkflow } from '@/hooks/useWorkflow';
import { CONSULTATION_WORKFLOW } from './definition';

// Step components
import { PrepStep } from './steps/PrepStep';
import { HistoryStep } from './steps/HistoryStep';
import { AssessmentStep } from './steps/AssessmentStep';
import { OrdersStep } from './steps/OrdersStep';
import { CompleteStep } from './steps/CompleteStep';

const stepComponents = {
  PrepStep,
  HistoryStep,
  AssessmentStep,
  OrdersStep,
  CompleteStep,
};

export function ConsultationWorkflow() {
  const { appointmentId } = useParams();
  const navigate = useNavigate();

  const {
    workflow,
    loading,
    error,
    startWorkflow,
    updateStep,
    completeWorkflow,
    saveDraft,
  } = useWorkflow('consultation');

  // Initialize workflow
  useEffect(() => {
    if (appointmentId) {
      startWorkflow({ appointment_id: appointmentId });
    }
  }, [appointmentId]);

  const handleStepComplete = async (stepData) => {
    await updateStep(stepData);
  };

  const handleComplete = async (finalData) => {
    const result = await completeWorkflow(finalData);
    if (result.success) {
      navigate(`/encounters/${result.encounter_id}`);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorDisplay error={error} />;

  return (
    <WorkflowWizard
      definition={CONSULTATION_WORKFLOW}
      stepComponents={stepComponents}
      currentStep={workflow?.current_step || 0}
      contextData={workflow?.context_data || {}}
      onStepComplete={handleStepComplete}
      onComplete={handleComplete}
      onSaveDraft={saveDraft}
      autoSave={true}
    />
  );
}
```

#### 3. Create step components

```jsx
// workflows/consultation/steps/HistoryStep.jsx
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { TemplateSelector } from '@/components/clinical/TemplateSelector';

export function HistoryStep({ contextData, onComplete }) {
  const [formData, setFormData] = useState({
    chief_complaint: contextData?.chief_complaint || '',
    hpi: contextData?.hpi || '',
    ros: contextData?.ros || '',
    physical_exam: contextData?.physical_exam || '',
  });

  const handleTemplateApply = (template) => {
    setFormData(prev => ({
      ...prev,
      ...template.fields,
    }));
  };

  const handleSubmit = () => {
    onComplete({ history_data: formData });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Chief Complaint</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData.chief_complaint}
            onChange={(e) => setFormData({...formData, chief_complaint: e.target.value})}
            placeholder="Enter chief complaint..."
            rows={2}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>History of Present Illness</CardTitle>
            <TemplateSelector
              type="hpi"
              chiefComplaint={formData.chief_complaint}
              onApply={handleTemplateApply}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData.hpi}
            onChange={(e) => setFormData({...formData, hpi: e.target.value})}
            placeholder="Enter HPI..."
            rows={6}
          />
        </CardContent>
      </Card>

      {/* More sections... */}

      <div className="flex justify-end gap-2">
        <Button variant="outline">Save Draft</Button>
        <Button onClick={handleSubmit}>Continue</Button>
      </div>
    </div>
  );
}
```

#### 4. Create backend workflow views

```python
# apps/workflows/views.py
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from .models import ClinicalWorkflow
from .serializers import WorkflowSerializer
from .engines import ConsultationEngine, WardRoundEngine

class WorkflowViewSet(viewsets.ModelViewSet):
    """
    API endpoints for clinical workflows
    """
    serializer_class = WorkflowSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return ClinicalWorkflow.objects.filter(user=self.request.user)

    @action(detail=False, methods=['post'], url_path='consultation/start')
    def start_consultation(self, request):
        """
        Start a new consultation workflow
        """
        appointment_id = request.data.get('appointment_id')
        patient_id = request.data.get('patient_id')

        # Initialize workflow
        workflow = ConsultationEngine.start(
            user=request.user,
            appointment_id=appointment_id,
            patient_id=patient_id,
        )

        serializer = self.get_serializer(workflow)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch'], url_path='step')
    def update_step(self, request, pk=None):
        """
        Update workflow step data
        """
        workflow = self.get_object()
        step_data = request.data.get('step_data', {})
        next_step = request.data.get('next_step')

        # Get appropriate engine
        engine = self._get_engine(workflow.workflow_type)

        # Update step
        updated_workflow = engine.update_step(
            workflow=workflow,
            step_data=step_data,
            next_step=next_step,
        )

        serializer = self.get_serializer(updated_workflow)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='complete')
    def complete_workflow(self, request, pk=None):
        """
        Complete workflow and generate artifacts
        """
        workflow = self.get_object()
        final_data = request.data.get('final_data', {})

        # Get appropriate engine
        engine = self._get_engine(workflow.workflow_type)

        # Complete workflow
        result = engine.complete(
            workflow=workflow,
            final_data=final_data,
        )

        return Response({
            'success': True,
            'workflow_id': workflow.id,
            'encounter_id': result.get('encounter_id'),
            'generated_artifacts': result.get('artifacts', []),
        })

    @action(detail=True, methods=['post'], url_path='save-draft')
    def save_draft(self, request, pk=None):
        """
        Auto-save workflow draft
        """
        workflow = self.get_object()
        context_data = request.data.get('context_data', {})

        workflow.context_data.update(context_data)
        workflow.save()

        return Response({
            'success': True,
            'last_autosave': workflow.last_autosave,
        })

    def _get_engine(self, workflow_type):
        engines = {
            'consultation': ConsultationEngine,
            'ward_round': WardRoundEngine,
            # Add more engines
        }
        return engines.get(workflow_type)
```

#### 5. Create workflow engine

```python
# apps/workflows/engines.py
from django.db import transaction
from apps.encounters.models import Encounter
from apps.clinical_notes.models import NoteEntry
from .models import ClinicalWorkflow, WorkflowStatus

class ConsultationEngine:
    """
    Business logic for consultation workflow
    """

    @staticmethod
    def start(user, appointment_id=None, patient_id=None):
        """
        Initialize a new consultation workflow
        """
        # Get patient and appointment data
        # Pre-load relevant data into context

        workflow = ClinicalWorkflow.objects.create(
            workflow_type='consultation',
            user=user,
            patient_id=patient_id,
            current_step=1,
            total_steps=5,
            status=WorkflowStatus.IN_PROGRESS,
            context_data={
                'appointment_id': appointment_id,
                'prep_data': {
                    # Auto-loaded patient context
                },
            },
        )

        return workflow

    @staticmethod
    def update_step(workflow, step_data, next_step=None):
        """
        Update workflow step and advance if requested
        """
        # Update context data
        workflow.context_data.update(step_data)

        # Mark step as completed
        if workflow.current_step not in workflow.steps_completed:
            workflow.steps_completed.append(workflow.current_step)

        # Advance to next step if specified
        if next_step:
            workflow.current_step = next_step

        workflow.save()
        return workflow

    @staticmethod
    @transaction.atomic
    def complete(workflow, final_data):
        """
        Complete workflow and generate artifacts
        """
        context = workflow.context_data

        # Create encounter
        encounter = Encounter.objects.create(
            patient=workflow.patient,
            practitioner=workflow.user,
            encounter_type='outpatient',
            status='finished',
            reason=context.get('chief_complaint'),
            # ... other fields from context
        )

        # Create clinical note
        note = NoteEntry.objects.create(
            encounter=encounter,
            author=workflow.user,
            content=context.get('assessment_and_plan'),
            note_type='progress_note',
        )

        # Process orders (labs, prescriptions, etc.)
        # ... order creation logic

        # Mark workflow complete
        workflow.status = WorkflowStatus.COMPLETED
        workflow.completed_at = timezone.now()
        workflow.encounter = encounter
        workflow.save()

        return {
            'encounter_id': encounter.id,
            'artifacts': [
                {'type': 'encounter', 'id': encounter.id},
                {'type': 'note', 'id': note.id},
                # ... other artifacts
            ],
        }
```

### Creating a Role-Based Dashboard

#### 1. Define dashboard structure

```jsx
// dashboards/NurseDashboard.jsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useNurseDashboard } from './hooks/useNurseDashboard';
import { AlertTriangle, CheckCircle, Clock } from 'lucide-react';

export function NurseDashboard() {
  const { data, loading, error, startWardRounds } = useNurseDashboard();

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorDisplay error={error} />;

  const { urgentItems, wardRoundChecklist, medicationSchedule, pendingResults } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Good morning, {data.userName}</h1>
        <p className="text-muted-foreground">{data.assignedWard} - {data.patientCount} patients assigned</p>
      </div>

      {/* Urgent Items */}
      {urgentItems.length > 0 && (
        <Card className="border-red-200 dark:border-red-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              URGENT
              <Badge variant="destructive">{urgentItems.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {urgentItems.map((item) => (
              <Alert key={item.id} variant="destructive">
                <AlertDescription>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold">{item.patientName} (Bed {item.bedNumber})</div>
                      <div className="text-sm mt-1">{item.message}</div>
                      <div className="text-xs text-muted-foreground mt-1">{item.timeAgo}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm">Review</Button>
                      <Button size="sm" variant="outline">Call Doctor</Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Ward Rounds Checklist */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Morning Rounds Checklist</CardTitle>
            <Badge variant="secondary">
              {wardRoundChecklist.completed}/{wardRoundChecklist.total} complete
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {wardRoundChecklist.patients.map((patient) => (
              <div
                key={patient.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {patient.completed ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <div className="font-medium">{patient.name}</div>
                    <div className="text-sm text-muted-foreground">Bed {patient.bedNumber}</div>
                  </div>
                </div>
                {!patient.completed && (
                  <Button size="sm" variant="outline">Start</Button>
                )}
              </div>
            ))}
          </div>
          <Button className="w-full mt-4" onClick={() => startWardRounds(data.assignedWard)}>
            Start Ward Round
          </Button>
        </CardContent>
      </Card>

      {/* Medication Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Medication Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Medication schedule content */}
        </CardContent>
      </Card>

      {/* Recent Results */}
      {pendingResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Results Needing Review</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Results content */}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

#### 2. Create dashboard data hook

```javascript
// dashboards/hooks/useNurseDashboard.js
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api-client';

export function useNurseDashboard() {
  const navigate = useNavigate();

  // Fetch dashboard data
  const { data, isLoading, error } = useQuery({
    queryKey: ['nurse-dashboard'],
    queryFn: () => apiClient.get('/api/dashboards/my-work/'),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Start ward rounds workflow
  const startWardRoundsMutation = useMutation({
    mutationFn: (wardId) =>
      apiClient.post('/api/workflows/ward-round/start/', { ward_id: wardId }),
    onSuccess: (data) => {
      navigate(`/workflows/ward-rounds/${data.id}`);
    },
  });

  return {
    data: data || {},
    loading: isLoading,
    error,
    startWardRounds: startWardRoundsMutation.mutate,
  };
}
```

#### 3. Create backend dashboard API

```python
# apps/dashboards/views.py
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from datetime import timedelta
from apps.wards.models import Ward, Bed
from apps.nursing.models import VitalSigns, MedicationAdministration

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_work_dashboard(request):
    """
    Role-based dashboard data
    """
    user = request.user
    role = user.role

    # Route to appropriate dashboard
    if role == 'nurse':
        return Response(get_nurse_dashboard_data(user))
    elif role == 'doctor':
        return Response(get_doctor_dashboard_data(user))
    elif role == 'receptionist':
        return Response(get_receptionist_dashboard_data(user))
    else:
        return Response({'error': 'Unknown role'}, status=400)

def get_nurse_dashboard_data(user):
    """
    Nurse dashboard: urgent items, ward rounds, meds, results
    """
    # Get assigned ward
    assigned_ward = user.assigned_ward
    if not assigned_ward:
        return {'error': 'No ward assigned'}

    # Get urgent items (critical vitals, overdue meds, alerts)
    urgent_items = []

    # Critical vitals in last hour
    recent_vitals = VitalSigns.objects.filter(
        patient__bed__ward=assigned_ward,
        recorded_at__gte=timezone.now() - timedelta(hours=1),
        is_critical=True,
    )
    for vital in recent_vitals:
        urgent_items.append({
            'id': f'vital-{vital.id}',
            'type': 'critical_vital',
            'patientName': vital.patient.full_name,
            'bedNumber': vital.patient.bed.bed_number,
            'message': f'{vital.vital_type}: {vital.value} {vital.unit}',
            'timeAgo': format_time_ago(vital.recorded_at),
        })

    # Overdue medications
    overdue_meds = MedicationAdministration.objects.filter(
        patient__bed__ward=assigned_ward,
        scheduled_time__lt=timezone.now(),
        status='pending',
    )
    for med in overdue_meds:
        urgent_items.append({
            'id': f'med-{med.id}',
            'type': 'overdue_medication',
            'patientName': med.patient.full_name,
            'bedNumber': med.patient.bed.bed_number,
            'message': f'Medication due: {med.medication.name} {med.dose}',
            'timeAgo': format_time_ago(med.scheduled_time),
        })

    # Get ward round checklist
    patients_in_ward = assigned_ward.beds.filter(
        status='occupied'
    ).select_related('patient')

    ward_round_checklist = {
        'total': patients_in_ward.count(),
        'completed': 0,  # Calculate from WardRoundTask model
        'patients': []
    }

    for bed in patients_in_ward:
        # Check if ward round completed today
        completed_today = False  # Check WardRoundTask

        ward_round_checklist['patients'].append({
            'id': bed.patient.id,
            'name': bed.patient.full_name,
            'bedNumber': bed.bed_number,
            'completed': completed_today,
        })

        if completed_today:
            ward_round_checklist['completed'] += 1

    # Get medication schedule
    medication_schedule = get_medication_schedule(assigned_ward)

    # Get pending results
    pending_results = get_pending_results(assigned_ward)

    return {
        'userName': user.first_name,
        'assignedWard': assigned_ward.name,
        'patientCount': patients_in_ward.count(),
        'urgentItems': urgent_items,
        'wardRoundChecklist': ward_round_checklist,
        'medicationSchedule': medication_schedule,
        'pendingResults': pending_results,
    }

def format_time_ago(timestamp):
    """Helper to format time ago"""
    delta = timezone.now() - timestamp
    if delta.seconds < 60:
        return 'Just now'
    elif delta.seconds < 3600:
        return f'{delta.seconds // 60} min ago'
    elif delta.seconds < 86400:
        return f'{delta.seconds // 3600} hours ago'
    else:
        return f'{delta.days} days ago'
```

### Design System for Workflows

Use consistent visual language:

#### Status Colors
```javascript
const statusColors = {
  urgent: 'bg-red-500 text-white',
  warning: 'bg-amber-500 text-white',
  normal: 'bg-green-500 text-white',
  info: 'bg-blue-500 text-white',
};
```

#### Priority Indicators
```jsx
const PriorityBadge = ({ priority }) => {
  const variants = {
    urgent: 'destructive',
    high: 'warning',
    medium: 'secondary',
    low: 'outline',
  };

  return <Badge variant={variants[priority]}>{priority}</Badge>;
};
```

#### Workflow Step Indicator
```jsx
const WorkflowProgress = ({ steps, currentStep }) => {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, index) => (
        <React.Fragment key={step.id}>
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg",
            index + 1 === currentStep && "bg-primary text-primary-foreground",
            index + 1 < currentStep && "bg-green-100 text-green-800",
            index + 1 > currentStep && "bg-gray-100 text-gray-500"
          )}>
            {index + 1 < currentStep && <CheckCircle className="h-4 w-4" />}
            {index + 1 === currentStep && <Circle className="h-4 w-4" />}
            {index + 1 > currentStep && <Circle className="h-4 w-4 opacity-30" />}
            <span className="text-sm font-medium">{step.title}</span>
          </div>
          {index < steps.length - 1 && (
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};
```

---

## Measurement & Success Criteria

### Quantitative Metrics

#### Efficiency Metrics (Target: 50-70% improvement)
```
Time to Complete Consultation
Before: 15 minutes (avg)
After: 7-8 minutes (target)

Clicks to Complete Ward Round
Before: 45 clicks per patient
After: 15 clicks per patient (target)

Page Navigations per Task
Before: 8-12 navigations
After: 0-2 navigations (target)
```

#### Quality Metrics
```
Documentation Completeness
- % of encounters with complete SOAP notes
- % of required fields filled
- Target: >95%

Error Rate
- Validation errors caught by workflow
- Duplicate entries prevented
- Target: <2% error rate

Task Completion Rate
- % of started workflows completed
- % of required tasks completed
- Target: >90%
```

#### Adoption Metrics
```
User Engagement
- % of users using workflow features vs old paths
- Daily active workflow sessions
- Target: >80% adoption within 3 months

Feature Usage
- Most used workflows
- Most used quick actions
- Template usage rate
```

### Qualitative Metrics

#### User Satisfaction (Survey after 1 month)
```
Questions (1-5 scale):
1. The new workflow system helps me complete my tasks faster
2. I can find what I need without navigating multiple pages
3. The system guides me through my clinical workflows effectively
4. Quick actions save me time
5. I would recommend this system to colleagues

Target: Average score >4.0
```

#### Usability Testing
```
Task Success Rate:
- Can user complete consultation without assistance?
- Can user find urgent items quickly?
- Can user resume interrupted workflow?
Target: >90% success rate

Time on Task:
- How long to complete first consultation?
- How long to complete ward round?
Compare to baseline

Perceived Effort:
- NASA Task Load Index
- Target: <40 (low to moderate workload)
```

### Monitoring Dashboard

Create admin dashboard to track metrics:

```jsx
// Admin Workflow Analytics Dashboard
<DashboardCard title="Workflow Usage (Last 30 days)">
  <BarChart data={workflowUsage} />
  {/*
    - Consultations: 450 completed
    - Ward Rounds: 230 completed
    - Admissions: 89 completed
    - Discharges: 87 completed
  */}
</DashboardCard>

<DashboardCard title="Average Time to Complete">
  <LineChart data={completionTimes} />
  {/*
    Track over time to see improvements
  */}
</DashboardCard>

<DashboardCard title="Step Completion Rates">
  <FunnelChart data={stepCompletions} />
  {/*
    Where are users dropping off?
    Which steps take longest?
  */}
</DashboardCard>
```

---

## Reference Documents

### Related Documentation

#### Internal Documents (in this repo)
- `/backend/NURSING_SETUP_INSTRUCTIONS.md` - Nursing module setup
- `/frontend/IMPROVEMENTS.md` - Frontend enhancement history
- `/NURSING_API_CLIENT_FIX.md` - API client improvements
- `/NURSING_DASHBOARD_FIXES.md` - Dashboard bug fixes
- `/NURSING_RESPONSE_FORMAT_FIX.md` - Response format standardization

#### External Standards
- **HL7 FHIR Workflow Module**: https://www.hl7.org/fhir/workflow.html
  - Reference for clinical workflow patterns

- **HIMSS EHR Usability**: https://www.himss.org/resources/ehr-usability
  - Best practices for EHR interface design

- **Nielsen Norman Group - Healthcare UX**: https://www.nngroup.com/topic/healthcare-ux/
  - Research on healthcare workflows and usability

### Design Inspiration

#### EHR Wireframe Analysis (from user's screenshot)
Key insights captured:
1. **3-Column Layout**: Patient context | Clinical workflow | Live data
2. **Problem-Focused Notes**: Not exhaustive data entry
3. **Inline Actions**: Order, prescribe, schedule within the workflow
4. **Decision Support**: Alerts and suggestions in context
5. **Quick Access**: Frequently used actions prominent

#### Implementation in HMS
- **Documentation Mode**: Full-screen tabs (current, for deep documentation)
- **Review Mode**: 3-column layout (inspired by wireframe, for quick review)
- **Monitoring Mode**: Vitals-prominent (for ward rounds/ICU)

### Technology Stack

#### Frontend
- React 18+ with hooks
- React Router for navigation
- TanStack Query for data fetching
- Tailwind CSS for styling
- shadcn/ui for components
- React Hook Form for forms
- Zod for validation

#### Backend
- Django 4+ with Django REST Framework
- PostgreSQL database
- Celery for async tasks
- Redis for caching
- JWT for authentication

#### Key Libraries
- date-fns for date handling
- lucide-react for icons
- sonner for toast notifications

---

## Getting Started with Workflow Implementation

### Phase 1: Single Workflow Prototype (Week 1-2)

**Objective**: Build one complete workflow end-to-end to validate approach

**Recommended**: Start with **Consultation Workflow** (most common, well-understood)

**Tasks**:
1. Create workflow models and migrations
2. Build workflow API endpoints
3. Create ConsultationWorkflow component with 3 steps (simplified)
4. Test with real users
5. Iterate based on feedback

**Success Criteria**:
- User can complete consultation in single flow
- No page navigations required
- Time to complete <10 minutes
- Positive user feedback

### Phase 2: Expand Workflows (Week 3-4)

**Add**:
- Ward Rounds workflow
- Admission workflow
- Discharge workflow

**Focus**:
- Consistent patterns
- Reusable components
- Performance optimization

### Phase 3: Dashboards (Week 5-6)

**Build**:
- Nurse dashboard
- Doctor dashboard
- Receptionist dashboard

**Features**:
- Real-time data
- Urgent items prominent
- Quick workflow launchers

### Phase 4: Intelligence Layer (Week 7-8)

**Add**:
- Smart suggestions
- Template library
- Auto-population
- Decision support

---

## Common Pitfalls to Avoid

### 1. Over-Engineering Early
❌ **Don't**: Build complex workflow engine with 20 workflow types before testing one
✅ **Do**: Build one complete workflow, validate with users, then expand

### 2. Ignoring Performance
❌ **Don't**: Load all patient data upfront
✅ **Do**: Progressive loading, caching, optimistic updates

### 3. Forgetting Edge Cases
❌ **Don't**: Assume happy path only
✅ **Do**: Handle interrupted workflows, network errors, validation failures

### 4. Not Validating with Users
❌ **Don't**: Build entire system then user test
✅ **Do**: Test each workflow with real users before moving to next

### 5. Losing Data-Oriented Features
❌ **Don't**: Remove all search/browse functionality
✅ **Do**: Keep data views accessible but deprioritize them

### 6. Inconsistent Patterns
❌ **Don't**: Each workflow uses different UI patterns
✅ **Do**: Establish consistent patterns, reusable components

### 7. Forgetting Mobile
❌ **Don't**: Desktop-only design
✅ **Do**: Responsive design, consider mobile workflows

---

## Questions to Ask When Designing New Workflow

Before implementing a new workflow, answer:

1. **What is the user trying to accomplish?**
   - Single sentence goal

2. **What are the natural steps in this process?**
   - Break down into 3-7 steps

3. **What information does the user need at each step?**
   - Don't show everything, just what's needed

4. **What actions can they take at each step?**
   - Make actions obvious and accessible

5. **What validations are required?**
   - What must be complete before proceeding?

6. **What happens if they're interrupted?**
   - Can they resume? Where's the data saved?

7. **What gets auto-generated when complete?**
   - Documents, orders, appointments, etc.

8. **How does this workflow connect to others?**
   - What's the before/after in patient journey?

---

## Conclusion

This redesign transforms HMS from a **data-centric CRUD system** into a **workflow-centric clinical tool**.

**Core principles**:
- Guide users through workflows, don't make them hunt for data
- Show what's needed for current task, hide the rest
- Actions prominent, always answer "what can I do?"
- Role-based personalization
- Minimize navigation
- Smart defaults and suggestions

**Implementation approach**:
- Start with one workflow
- Validate with real users
- Expand systematically
- Measure everything

**Success = Clinical staff can focus on patient care, not navigating software.**

---

## Future Enhancements

### Role-Specific Dashboards

#### Admin Dashboard (`/dashboard/admin`)
**Purpose**: System-wide oversight and management view

**Key Features**:
- **System Statistics**:
  - Total patients, staff, active encounters
  - Today's total appointments across all practitioners
  - Ward occupancy rates
  - Recent registrations and admissions

- **All Appointments View**:
  - Shows appointments for all practitioners (not filtered by one practitioner)
  - Filterable by practitioner, department, status
  - Real-time updates on appointment status changes

- **Staff Activity Monitor**:
  - Which practitioners are currently in consultations
  - Completed workflows by staff member
  - Performance metrics (average consultation time, etc.)

- **Quick Actions**:
  - Create new staff accounts
  - Manage ward allocations
  - View system alerts and notifications
  - Access audit logs

**Design Notes**:
- Admin dashboard should show **aggregate data** (birds-eye view)
- Doctor dashboard shows **individual practitioner** appointments (ground-level view)
- Both accessible to admin role, but serve different purposes
- Admin can switch between views using dashboard dropdown

**Implementation Priority**: Phase 3 (after core clinical workflows)

#### Other Role Dashboards
- **Nurse Dashboard**: Ward assignments, medication schedules, urgent alerts (already defined in `apps/dashboards/views.py:149`)
- **Receptionist Dashboard**: Check-in queue, pending registrations (already defined in `apps/dashboards/views.py:181`)
- **Lab Dashboard**: Pending tests, critical results, turnaround times
- **Pharmacy Dashboard**: Pending prescriptions, stock alerts, dispensing queue

---

**Last Updated**: 2025-11-01
**Version**: 1.0
**Authors**: HMS Development Team
