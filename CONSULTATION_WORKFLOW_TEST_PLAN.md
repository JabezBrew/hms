# Consultation Workflow Test Plan
**Phase 1 Prototype - End-to-End Testing**

Date: 2025-11-01
Version: 1.0

---

## Table of Contents
1. [Test Environment Setup](#test-environment-setup)
2. [Pre-Test Checklist](#pre-test-checklist)
3. [Test Scenarios](#test-scenarios)
4. [Expected Results](#expected-results)
5. [Bug Report Template](#bug-report-template)

---

## Test Environment Setup

### Prerequisites

**Backend:**
```bash
cd /Users/jebre/Desktop/hms/backend
source .venv/bin/activate
python manage.py runserver
```
✅ Backend should be running on http://localhost:8000

**Frontend:**
```bash
cd /Users/jebre/Desktop/hms/frontend
npm run dev
```
✅ Frontend should be running on http://localhost:5173 (or configured port)

### Database Verification

Run these checks before testing:

```bash
# Check if workflows tables exist
cd backend
python manage.py dbshell
```

```sql
-- Verify tables
\dt workflows_*

-- Expected tables:
-- workflows_clinical
-- workflows_consultation
-- workflows_template

-- Exit
\q
```

### Test Data Requirements

**Minimum required:**
1. ✅ At least 1 Patient in system (with PatientProfile)
2. ✅ At least 1 Practitioner user (with PractitionerProfile)
3. ✅ At least 1 Appointment scheduled for today (optional but recommended)
4. ✅ Practitioner user has role: 'doctor', 'physician', or 'practitioner'

**Create test data if needed:**

```bash
cd backend
python manage.py shell
```

```python
from apps.users.models import User, PatientProfile, PractitionerProfile
from datetime import datetime, timedelta

# Check existing data
print(f"Patients: {PatientProfile.objects.count()}")
print(f"Practitioners: {PractitionerProfile.objects.count()}")

# If needed, create test patient
# (Add creation script here if needed)
```

---

## Pre-Test Checklist

Before starting tests, verify:

- [ ] Backend server is running without errors
- [ ] Frontend server is running without errors
- [ ] Browser console is open (F12) to monitor errors
- [ ] Network tab is open to monitor API calls
- [ ] Test user credentials are ready
- [ ] At least one test patient exists in system
- [ ] Database migrations are up to date

---

## Test Scenarios

### Test 1: Doctor Dashboard Load
**Objective:** Verify doctor dashboard loads correctly with today's clinic

**Steps:**
1. Log in as a doctor/practitioner user
2. Navigate to `/dashboard/doctor`
3. Observe dashboard content

**Expected Results:**
- ✅ Dashboard loads without errors
- ✅ Header shows "Today's Clinic" with user's name
- ✅ Date displays correctly (today's date)
- ✅ Current Patient section displays (may be empty)
- ✅ Upcoming section displays appointments (if any exist)
- ✅ Completed section displays (if any exist)
- ✅ No JavaScript console errors

**API Calls to Monitor:**
- `GET /api/dashboards/my-work/` → Should return 200
- Response should have structure:
  ```json
  {
    "role": "doctor",
    "user_name": "...",
    "date": "2025-11-01",
    "current_patient": {...} or null,
    "upcoming": [...],
    "completed": [...]
  }
  ```

**Pass Criteria:** Dashboard loads and displays all sections correctly

---

### Test 2: Start Consultation from Dashboard
**Objective:** Launch consultation workflow from appointment

**Steps:**
1. From doctor dashboard, locate an appointment in "Upcoming" section
2. Click "Start" button next to an appointment
3. Observe navigation

**Expected Results:**
- ✅ User navigates to `/workflows/consultation?patient_id=X&appointment_id=Y`
- ✅ Workflow initializes without errors
- ✅ Loading state displays briefly
- ✅ Step 1 (Patient Review) loads

**API Calls to Monitor:**
- `POST /api/workflows/consultation/start/` → Should return 201
- Request body should include:
  ```json
  {
    "patient_id": 123,
    "appointment_id": "fhir-id" (optional)
  }
  ```
- Response should include workflow object with:
  - `id`, `workflow_type`: "consultation"
  - `current_step`: 1
  - `total_steps`: 3
  - `context_data` with `prep_data`

**Pass Criteria:** Workflow starts and Step 1 displays

---

### Test 3: Step 1 - Patient Review (PrepStep)
**Objective:** Verify patient context data is loaded and displayed

**Steps:**
1. On PrepStep, review displayed information
2. Check all sections are present
3. Click "Continue" button

**Expected Results:**
- ✅ Patient name displays correctly
- ✅ MRN displays (or "N/A" if not set)
- ✅ Sections present: Patient Information, Active Problems, Current Medications
- ✅ If no data, appropriate "No X on record" message displays
- ✅ "Continue" button is enabled
- ✅ Clicking "Continue" advances to Step 2

**Data Display Verification:**
- Patient name matches selected patient
- All sections render without errors
- No missing component errors in console

**Pass Criteria:** All patient data displays correctly, can advance to Step 2

---

### Test 4: Step 2 - History & Exam (HistoryStep)
**Objective:** Document clinical history and examination

**Steps:**
1. Enter text in "Chief Complaint" field (required)
   - Example: "Headache for 3 days"
2. Enter text in "HPI" field (optional)
   - Example: "Patient reports severe headache starting 3 days ago..."
3. Enter text in "ROS" field (optional)
   - Example: "Constitutional: Denies fever, chills..."
4. Enter text in "Physical Exam" field (optional)
   - Example: "Vitals: BP 120/80, HR 72, Temp 37.0°C..."
5. Click "Continue"

**Expected Results:**
- ✅ All fields are editable
- ✅ Text persists in fields as you type
- ✅ Required field indicator (*) shows on Chief Complaint
- ✅ Clicking "Continue" without chief complaint shows validation error
- ✅ After entering chief complaint, "Continue" advances to Step 3

**Auto-Save Test (Within this step):**
1. Type in chief complaint field
2. Wait 35 seconds (auto-save interval is 30s)
3. Check network tab for auto-save call

**Expected Auto-Save:**
- ✅ `POST /api/workflows/{id}/save-draft/` called after 30 seconds
- ✅ Request contains entered data in `context_data`
- ✅ No error toast appears
- ✅ Console logs "Draft saved"

**API Calls to Monitor:**
- `PATCH /api/workflows/{id}/consultation/step/` → When clicking Continue
- Request should include:
  ```json
  {
    "step_data": {...},
    "next_step": 3,
    "chief_complaint": "Headache for 3 days",
    "hpi": "...",
    "ros": "...",
    "physical_exam": "..."
  }
  ```

**Pass Criteria:**
- Can enter data in all fields
- Validation works correctly
- Auto-save triggers
- Advances to Step 3 after entering required data

---

### Test 5: Step 3 - Assessment & Plan (AssessmentStep)
**Objective:** Document assessment and treatment plan

**Steps:**
1. Review consultation summary displayed at top
2. Enter "Assessment" text (required)
   - Example: "Migraine headache, likely tension-type"
3. Enter "Plan" text (optional)
   - Example: "Ibuprofen 400mg PO q6h PRN, follow-up in 1 week if not improved"
4. Click "Complete Consultation"

**Expected Results:**
- ✅ Summary shows chief complaint from previous step
- ✅ Summary shows truncated HPI if entered
- ✅ Assessment field is editable
- ✅ Plan field is editable
- ✅ "Complete Consultation" button is enabled after entering assessment
- ✅ Clicking without assessment shows validation error
- ✅ After entering assessment, can complete

**API Calls to Monitor:**
- `POST /api/workflows/{id}/consultation/complete/` → When clicking Complete
- Request should include:
  ```json
  {
    "final_data": {
      "assessment": "...",
      "plan": "..."
    },
    "encounter_type": "outpatient",
    "encounter_status": "finished"
  }
  ```

**Expected Response:**
```json
{
  "success": true,
  "workflow_id": 123,
  "encounter_id": "fhir-encounter-id",
  "artifacts": [
    {"type": "encounter", "id": "fhir-encounter-id"},
    {"type": "note", "id": 456}
  ]
}
```

**Pass Criteria:**
- Can enter assessment and plan
- Validation works
- Complete button triggers completion

---

### Test 6: Workflow Completion & Navigation
**Objective:** Verify workflow completes and navigates correctly

**Steps:**
1. After clicking "Complete Consultation" in Step 3
2. Observe success message
3. Observe navigation

**Expected Results:**
- ✅ Success toast appears: "Consultation completed successfully"
- ✅ User navigates to `/encounters/{encounter_id}`
- ✅ Encounter detail page loads
- ✅ Encounter shows as "finished" status
- ✅ Clinical note is visible in encounter

**Database Verification (Optional):**
```bash
cd backend
python manage.py shell
```

```python
from apps.workflows.models import ClinicalWorkflow, ConsultationWorkflow

# Find the completed workflow
workflow = ClinicalWorkflow.objects.filter(status='completed').latest('created_at')
print(f"Workflow ID: {workflow.id}")
print(f"Status: {workflow.status}")
print(f"Encounter ID: {workflow.encounter_id}")
print(f"Completed at: {workflow.completed_at}")

# Check consultation data
consultation = workflow.consultation_data
print(f"Chief Complaint: {consultation.chief_complaint}")
print(f"Assessment: {consultation.assessment}")
print(f"Plan: {consultation.plan}")
```

**Pass Criteria:**
- Workflow completes successfully
- Encounter is created
- Clinical note is created
- Navigation works correctly

---

### Test 7: Cancel Workflow
**Objective:** Verify workflow cancellation works

**Steps:**
1. Start a new consultation workflow
2. Fill in Step 1, advance to Step 2
3. Enter some data in Step 2
4. Click "Cancel" button
5. Confirm cancellation in dialog
6. Observe result

**Expected Results:**
- ✅ Confirmation dialog appears
- ✅ Clicking "Confirm" cancels workflow
- ✅ User navigates back to `/dashboard/doctor`
- ✅ Workflow status is set to "cancelled" in database

**API Calls to Monitor:**
- `POST /api/workflows/{id}/cancel/` → Should return 200

**Pass Criteria:** Can cancel workflow at any step

---

### Test 8: Resume Draft Workflow
**Objective:** Verify draft workflows can be resumed

**Steps:**
1. Start a consultation workflow
2. Fill Step 1, advance to Step 2
3. Enter chief complaint and HPI
4. Close browser tab (don't complete or cancel)
5. Return to `/dashboard/doctor`
6. Start same patient's consultation again

**Expected Results:**
- ✅ System detects existing draft
- ✅ User prompted to resume or start new
- ✅ If resuming, workflow loads at correct step with saved data
- ✅ Entered data is still present

**API Calls to Monitor:**
- `GET /api/workflows/resume/?patient_id=X` → Should return drafts

**Pass Criteria:** Can resume interrupted workflow with data intact

---

### Test 9: Error Handling - Invalid Patient
**Objective:** Test error handling for invalid patient ID

**Steps:**
1. Manually navigate to `/workflows/consultation?patient_id=99999`
2. Observe result

**Expected Results:**
- ✅ Error message displays: "Patient not found" or similar
- ✅ User can navigate back to dashboard
- ✅ No application crash
- ✅ API returns 400 error

**Pass Criteria:** Graceful error handling for invalid input

---

### Test 10: Error Handling - Network Failure
**Objective:** Test behavior when API calls fail

**Steps:**
1. Start consultation workflow
2. Stop backend server while on Step 2
3. Try to click "Continue"
4. Observe result

**Expected Results:**
- ✅ Error toast appears: "Failed to update workflow" or similar
- ✅ User stays on current step
- ✅ Data is not lost
- ✅ After restarting backend, can retry

**Pass Criteria:** Graceful degradation on network errors

---

### Test 11: Concurrent Workflow Prevention
**Objective:** Verify user cannot start multiple workflows for same patient

**Steps:**
1. Start consultation for Patient A
2. In new browser tab, try to start another consultation for Patient A
3. Observe behavior

**Expected Results:**
- ✅ System detects existing workflow
- ✅ User prompted to resume existing or cancel and start new
- ✅ Cannot have two active workflows for same patient

**Pass Criteria:** System prevents duplicate workflows

---

### Test 12: Progress Indicator Accuracy
**Objective:** Verify progress indicator updates correctly

**Steps:**
1. Start consultation workflow
2. Observe progress indicator at each step
3. Verify visual states

**Expected Results:**
- ✅ Step 1: Patient Review is highlighted
- ✅ Step 2, 3: Grayed out
- ✅ After advancing: Step 1 shows checkmark, Step 2 highlighted
- ✅ After advancing: Step 1, 2 show checkmarks, Step 3 highlighted

**Pass Criteria:** Progress indicator accurately reflects current step

---

### Test 13: Responsive Design
**Objective:** Verify workflow works on different screen sizes

**Steps:**
1. Start consultation workflow on desktop
2. Resize browser to tablet size (768px)
3. Resize to mobile size (375px)
4. Test navigation and data entry

**Expected Results:**
- ✅ Layout adapts to screen size
- ✅ All buttons remain accessible
- ✅ Forms remain usable
- ✅ Progress indicator adapts (may stack vertically)
- ✅ No horizontal scrolling issues

**Pass Criteria:** Workflow is usable on all screen sizes

---

### Test 14: Browser Compatibility
**Objective:** Verify workflow works across browsers

**Test on:**
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

**Expected Results:**
- ✅ Workflow loads in all browsers
- ✅ No visual glitches
- ✅ All functionality works identically

**Pass Criteria:** Consistent behavior across browsers

---

### Test 15: Performance - Auto-Save Impact
**Objective:** Verify auto-save doesn't impact user experience

**Steps:**
1. Start consultation workflow
2. Type rapidly in HistoryStep fields
3. Monitor performance during auto-save
4. Check for any lag or freezing

**Expected Results:**
- ✅ No typing lag during auto-save
- ✅ Auto-save happens in background
- ✅ No visible performance degradation
- ✅ Form remains responsive

**Pass Criteria:** Auto-save is imperceptible to user

---

## Expected Results Summary

### Successful Workflow Completion Should Produce:

**1. ClinicalWorkflow Record:**
- `id`: Generated workflow ID
- `workflow_type`: "consultation"
- `status`: "completed"
- `user`: Practitioner user ID
- `patient`: Patient ID
- `encounter_id`: FHIR encounter ID
- `current_step`: 3
- `total_steps`: 3
- `steps_completed`: [1, 2, 3]
- `context_data`: Contains all step data
- `completed_at`: Timestamp

**2. ConsultationWorkflow Record:**
- `workflow`: Link to ClinicalWorkflow
- `appointment_id`: FHIR appointment ID (if provided)
- `chief_complaint`: User-entered text
- `hpi`: User-entered text
- `ros`: User-entered text
- `physical_exam`: User-entered text
- `assessment`: User-entered text
- `plan`: User-entered text

**3. FHIR Encounter Resource:**
- Created via EncounterProxy.create()
- Status: "finished"
- Type: "outpatient"
- Patient reference
- Practitioner reference
- Start time: Workflow creation time

**4. Clinical Note (NoteEntry):**
- `encounter_id`: FHIR encounter ID
- `author`: Practitioner user
- `content`: Formatted SOAP note
- `note_type`: "consultation"
- `title`: "Consultation Note - {Patient Name}"

---

## Bug Report Template

If you encounter issues during testing, use this template:

```markdown
### Bug Report #[NUMBER]

**Test:** [Test number and name]
**Date:** [Date/Time]
**Severity:** [Critical / High / Medium / Low]

**Environment:**
- OS: [e.g., macOS 14.0]
- Browser: [e.g., Chrome 120]
- Backend: [Running? Port?]
- Frontend: [Running? Port?]

**Steps to Reproduce:**
1.
2.
3.

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happened]

**Error Messages:**
```
[Paste console errors here]
```

**API Response (if applicable):**
```json
[Paste API response]
```

**Screenshots:**
[Attach screenshots]

**Workaround (if found):**
[Describe workaround]

**Additional Context:**
[Any other relevant information]
```

---

## Test Completion Checklist

After completing all tests, verify:

### Functionality
- [ ] All 15 test scenarios passed
- [ ] No critical bugs found
- [ ] Workflow completes successfully
- [ ] Data is saved correctly
- [ ] Navigation works as expected

### User Experience
- [ ] UI is intuitive and easy to use
- [ ] Error messages are clear and helpful
- [ ] Loading states are appropriate
- [ ] Success feedback is clear

### Technical
- [ ] No console errors
- [ ] All API calls return expected responses
- [ ] Database records are created correctly
- [ ] Auto-save works reliably
- [ ] Performance is acceptable

### Documentation
- [ ] Any bugs found are documented
- [ ] Test results are recorded
- [ ] Screenshots captured for issues
- [ ] Recommendations for improvements noted

---

## Sign-Off

**Tester Name:** _________________
**Date:** _________________
**Test Result:** [ ] PASS [ ] PASS WITH ISSUES [ ] FAIL

**Notes:**
```




```

**Recommendation:**
[ ] Ready for production
[ ] Requires bug fixes before production
[ ] Requires additional testing

---

## Next Steps After Testing

If tests pass:
1. ✅ Mark Task 13 as complete
2. ✅ Document any minor issues found
3. ✅ Create user training materials
4. ✅ Plan Phase 2 features (Ward Rounds, Templates, etc.)

If tests fail:
1. ❌ Document all failures using bug report template
2. ❌ Prioritize bugs by severity
3. ❌ Fix critical bugs first
4. ❌ Re-test after fixes
5. ❌ Repeat until all tests pass

---

**Happy Testing! 🧪**
