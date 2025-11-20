# Quick Start: Consultation Workflow
**5-Minute Guide to Your First Workflow**

---

## 🚀 Start the Servers

**Terminal 1 - Backend:**
```bash
cd /Users/jebre/Desktop/hms/backend
source .venv/bin/activate
python manage.py runserver
```
✅ Backend running at http://localhost:8000

**Terminal 2 - Frontend:**
```bash
cd /Users/jebre/Desktop/hms/frontend
npm run dev
```
✅ Frontend running at http://localhost:5173

---

## 👤 Login as Doctor

1. Open browser: http://localhost:5173
2. Login with practitioner credentials
3. You should land on the home page

---

## 📋 Access Doctor Dashboard

**Navigate to:** http://localhost:5173/dashboard/doctor

You should see:
- **Today's Clinic** header
- **Current Patient** section (may be empty)
- **Upcoming** appointments (if any exist)
- **Completed** consultations

---

## 🩺 Start Your First Consultation

### Option 1: From Dashboard Button
If you have appointments:
1. Click **"Start"** or **"Begin Consultation"** on any appointment
2. Workflow launches automatically

### Option 2: Direct URL
If no appointments exist:
```
http://localhost:5173/workflows/consultation?patient_id=1
```
*(Replace `1` with actual patient ID from your database)*

---

## 📝 Walk Through the 3 Steps

### Step 1: Patient Review (Auto-loaded)
**What you'll see:**
- Patient name and MRN
- Active problems
- Current medications
- Recent lab results (if any)
- Allergies

**Action:** Click **"Continue"** to proceed

---

### Step 2: History & Exam
**Required field:**
- ✅ **Chief Complaint** (e.g., "Headache for 3 days")

**Optional fields:**
- HPI (History of Present Illness)
- ROS (Review of Systems)
- Physical Exam

**Example:**
```
Chief Complaint: Headache for 3 days

HPI: Patient reports severe headache starting 3 days ago.
Located bifrontally, throbbing in nature, 7/10 severity.
No relief with OTC acetaminophen. No nausea/vomiting.
No visual changes or neurological symptoms.

ROS: Constitutional: Denies fever, chills, weight loss.
Eyes: Denies vision changes. ENT: Denies congestion.
Neurological: Denies weakness, numbness, tingling.

Physical Exam:
Vitals: BP 120/80, HR 72, RR 16, Temp 37.0°C, SpO2 98%
General: Alert and oriented x3, no acute distress
HEENT: Normocephalic, atraumatic. PERRLA. No papilledema.
Neurological: Cranial nerves II-XII intact. Normal gait.
```

**Action:** Click **"Continue"** to proceed

---

### Step 3: Assessment & Plan
**Required field:**
- ✅ **Assessment** (e.g., "Migraine headache")

**Optional field:**
- Plan (Treatment recommendations)

**Example:**
```
Assessment:
Tension-type headache, likely related to stress.
No red flags for secondary headache.

Plan:
1. Ibuprofen 400mg PO q6h PRN for pain
2. Recommend stress reduction techniques
3. Encourage adequate hydration and sleep
4. Follow-up in 1 week if symptoms persist
5. Return immediately if develops fever, visual changes,
   or severe/sudden onset headache
```

**Action:** Click **"Complete Consultation"**

---

## ✅ Success!

After completion:
- ✅ Success toast appears
- ✅ Redirects to encounter detail page
- ✅ FHIR encounter is created
- ✅ Clinical note is generated

**View the created encounter:**
The URL will be: `/encounters/{encounter-id}`

---

## 🔍 Verify in Database (Optional)

```bash
cd backend
python manage.py shell
```

```python
from apps.workflows.models import ClinicalWorkflow

# Get latest workflow
workflow = ClinicalWorkflow.objects.latest('created_at')
print(f"Status: {workflow.status}")
print(f"Encounter ID: {workflow.encounter_id}")

# Get consultation data
consultation = workflow.consultation_data
print(f"\nChief Complaint: {consultation.chief_complaint}")
print(f"Assessment: {consultation.assessment}")
print(f"Plan: {consultation.plan}")
```

---

## 💡 Tips

### Auto-Save
- Workflow auto-saves every 30 seconds
- You can close the browser and resume later
- Check network tab to see auto-save API calls

### Cancel Workflow
- Click "Cancel" button at any time
- Confirm in dialog
- Returns to doctor dashboard

### Navigation
- **Back arrow** returns to dashboard without saving
- Use **"Previous"** button to go back steps
- Use **"Continue"** to advance with saving

### Validation
- Red error alerts appear if required fields missing
- Cannot advance without filling required fields
- Assessment is required to complete

---

## 🐛 Troubleshooting

### "Patient not found" error
- Verify patient ID exists: `PatientProfile.objects.all()`
- Check patient has FHIR ID set

### Dashboard shows empty
- Check if user has practitioner profile
- Check if user role is 'doctor', 'physician', or 'practitioner'
- Verify appointments exist for today

### Workflow won't start
- Check browser console for errors
- Verify API call succeeds: `POST /api/workflows/consultation/start/`
- Check backend logs for errors

### Auto-save not working
- Check network tab for `POST /api/workflows/{id}/save-draft/` calls
- Should trigger after 30 seconds of inactivity
- Check console for "Draft saved" message

---

## 📊 What Gets Created

**When you complete a consultation:**

1. **ClinicalWorkflow** record
   - Status: "completed"
   - Workflow type: "consultation"
   - Links to patient and practitioner

2. **ConsultationWorkflow** record
   - Stores chief complaint, HPI, ROS, exam
   - Stores assessment and plan
   - Links to workflow

3. **FHIR Encounter** resource
   - Status: "finished"
   - Type: "outpatient"
   - References patient and practitioner

4. **Clinical Note (NoteEntry)**
   - Formatted SOAP note
   - Links to encounter
   - Contains all consultation text

---

## 🎯 Next Steps

After your first successful consultation:

1. ✅ Run through the full test plan: `CONSULTATION_WORKFLOW_TEST_PLAN.md`
2. ✅ Try different scenarios (cancel, resume, errors)
3. ✅ Test with multiple patients
4. ✅ Review created encounters in database
5. ✅ Check clinical notes format

**Ready for Phase 2?**
- Add workflow templates
- Implement inline ordering (labs, prescriptions)
- Build Ward Rounds workflow
- Add voice-to-text
- Create workflow analytics

---

## 📞 Need Help?

Check the files:
- `claude.md` - Full design guidelines
- `CONSULTATION_WORKFLOW_TEST_PLAN.md` - Detailed test scenarios
- Backend API docs: http://localhost:8000/api/
- Frontend: Browser console for errors

---

**Enjoy your workflow-oriented HMS! 🎉**
