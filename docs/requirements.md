# Hospital Management System (HMS) Specification for Junie

## 🎯 Project Goal
Build a modern, modular, and scalable Hospital Management System (HMS) using:
- **Backend**: Django REST Framework
- **Frontend**: React (Vite) with **shadcn/ui** components
- **Data Layer**: Google Cloud Healthcare API (FHIR, DICOM, HL7v2)

The system must be designed to integrate with Google Cloud Healthcare API while implementing custom modules and logic that the API doesn't natively support.

---

## 📌 Architecture Overview

- **Backend (Django)**:
  - Acts as a proxy/controller between React frontend and Google Cloud FHIR/DICOM/HL7v2 endpoints.
  - Validates and transforms user input to conform to FHIR resource structure.
  - Implements custom business logic and modules not covered by the Google API.

- **Frontend (React + shadcn/ui)**:
  - Uses modular, composable components (e.g., `PatientForm`, `EncounterForm`, `LabForm`, `PatientSelector`)
  - Dynamically interacts with backend endpoints.
  - Styled with clean UI, minimal state coupling, and reusable patterns.

---

## 🧠 Google Cloud Healthcare API – What It Offers

### ✅ Native Support (FHIR):
- **Patient Records** (`Patient`)
- **Appointments** (`Appointment`, `Schedule`, `Slot`)
- **Clinical Encounters** (`Encounter`)
- **Observations / Lab Results** (`Observation`, `DiagnosticReport`)
- **Medications** (`Medication`, `MedicationRequest`, `MedicationAdministration`)
- **Conditions & Diagnoses** (`Condition`)
- **Procedures** (`Procedure`)
- **Imaging** (via **DICOM Store**)
- **Messaging** (via **HL7v2 Store**)

### 🚧 Not Fully Covered (Requires Custom Implementation):
- User authentication, permissions & roles (Doctor, Nurse, Receptionist, Admin)
- Bed / Ward management
- Theatre scheduling and tracking
- Inventory / Pharmacy stock system
- Billing, claims processing (FHIR `Claim` is available but needs full custom integration)
- Audit logs and admin analytics
- Frontend workflows and contextual state management (booking, triaging, routing)

---

## 🧱 Core Modules (Minimum Requirements)

### 1. **User & Role Management**
- Custom Django models: `User`, `Staff`, `PractitionerProfile`, `PatientProfile`
- Role-based permissions using Django’s `groups` and `permissions`
- React: Unified login page, role-specific dashboards

### 2. **Patient Management**
- FHIR `Patient` resource (Google Cloud)
- Local serializer validation before proxying
- Common fields: Name, DOB, Gender, NHIS ID, Contact, Address, Emergency Contact
- Reusable frontend form + context-aware patient selector component

### 3. **Appointment Scheduling**
- FHIR `Appointment`, `Slot`, `Schedule`
- Custom logic for availability generation and conflict prevention
- Appointment types: walk-in, telemedicine, recurring

### 4. **Inpatient & Ward Management**
- Local Django models for `Ward`, `Bed`, `Admission`
- FHIR `Encounter` tracks admission period
- Custom logic for bed allocation, per-night billing, and auto-discharge
- Audit logs for every bed occupancy change

### 5. **Outpatient Management**
- Simple FHIR `Encounter` with class = `ambulatory`
- Quick-patient-triage, consult form, doctor’s note, discharge form
- Custom `ClinicalNote` model if needed for frontend-rich text

### 6. **Theater / Surgical Management**
- FHIR `Procedure` resource
- Pre-op and post-op encounter integration
- Custom scheduling interface + team assignments (doctor, nurse, anesthetist)

### 7. **Lab & Diagnostics**
- FHIR `Observation`, `DiagnosticReport`
- Lab orders, sample tracking, result uploads
- Graphs and historical view of vitals/tests
- Modular `LabForm` with patient selector

### 8. **Medications & Prescriptions**
- FHIR `Medication`, `MedicationRequest`, `MedicationAdministration`
- Integration with pharmacy inventory system (custom)
- Medication history per patient

### 9. **Billing & Claims**
- FHIR `Claim`, `ExplanationOfBenefit`
- Custom modules for:
  - Fee setup by department/service
  - Insurance claims processing (NHIS integration optional)
  - Invoicing and receipts
  - Automatic inpatient per-night charges

### 10. **Imaging / Radiology**
- Google Cloud DICOM Store
- Upload and retrieve studies linked to patient/encounter
- Embed DICOM web viewer in frontend (via OHIF or similar)

### 11. **Inventory / Pharmacy Stock**
- Local Django models: `InventoryItem`, `StockMovement`, `ExpiryTracker`
- Role-based access (storekeeper, pharmacist)
- Linked to prescriptions and billing

### 12. **Notifications & Alerts**
- Email/SMS integration (SendGrid, Twilio)
- Critical alerts: missed appointments, lab result abnormality, stock expiry
- In-app alert system with dismissal and read tracking

### 13. **Audit & Logs**
- Django audit middleware for local models
- Action logging (create/update/delete)
- Downloadable admin reports + BigQuery export for FHIR actions

### 14. **Reports & Dashboards**
- Backend endpoints for aggregated metrics
- Role-based metrics (e.g., doctor-wise patient count)
- BigQuery integration for heavy analytics
- React charts + tables (Recharts, shadcn `Card`, `Table` components)

---

## 🧩 Development Guidelines for Junie

- Structure Django apps per module (e.g., `appointments`, `patients`, `wards`, `inventory`)
- Place reusable serializers under `common/serializers/`
- Place proxy API services (Google FHIR calls) in `fhir_client/`
- Use DRF ViewSets when managing local data models
- Avoid local DB for FHIR-supported entities unless caching/querying is needed
- Write modular React components per resource:
  - e.g., `<PatientForm />`, `<EncounterForm />`, `<PatientSelector />`
- Extract API calls to `api/` folder (e.g., `api/patient.js`, `api/encounter.js`)
- Use React context or Zustand for shared state (e.g., currentPatient)
- Follow FHIR JSON structure strictly when sending to Google APIs
- Keep components loosely coupled and easily testable
- Use shadcn/ui’s `Card`, `Table`, `Button`, `Form`, `Dialog` and other components for UI. If the component is not,
installed, use this command to install it: `npx shadcn@latest add <component-name>` 

---

## 📦 Suggested Folder Structure

```
backend/
├── appointments/
├── patients/
├── wards/
├── inventory/
├── fhir_client/
├── users/
└── billing/

frontend/
├── components/
│   ├── PatientForm.jsx
│   ├── EncounterForm.jsx
│   ├── PatientSelector.jsx
│   └── Layout/
├── pages/
│   ├── Dashboard.jsx
│   ├── Appointments.jsx
│   ├── Labs.jsx
├── api/
│   ├── patient.js
│   ├── encounter.js
└── context/
    └── PatientContext.js
```

---

## 🔧 Additional Guidelines: Custom Models & Business Logic

### 📌 Custom Model Storage
- All models not natively supported by Google Cloud Healthcare API (e.g., `Ward`, `Bed`, `InventoryItem`, `Invoice`, `UserProfile`, `Admission`, `AuditLog`) must be stored in the local **PostgreSQL** database via Django ORM.
- These models should include timestamps, creator/modifier audit fields, and UUID primary keys.
- Use Django admin and DRF ViewSets for local management.

### 🔗 Integration Strategy
- Link local models with cloud-based FHIR resources using FHIR resource references (e.g., `Patient/123456`) and local foreign keys to `LocalPatientProfile`.
- Store the corresponding FHIR `resourceId` and `resourceType` for synchronization (if needed).
- Inward integration: Store local foreign keys referencing `FHIR Patient ID`.
- Outward integration: When sending new data to FHIR API, fetch the corresponding resource ID from local linkage table.

### 🧠 Business Logic (Custom Implementation Required)

#### Ward Management
- Allocate patients to beds with auto-discharge functionality based on encounter end time.
- Per-night billing linked to date range and encounter type.
- Auto-vacate beds on discharge.

#### Appointment Scheduling
- Enforce rules like max daily appointments per doctor, conflict resolution for overlapping slots.
- Allow schedule override for emergency walk-ins.

#### Billing
- Maintain service price list by department.
- Auto-generate bill upon service request (lab, procedure, medication).
- Allow partial payments, discounts, NHIS coverage.

#### Stock Tracking
- Deduct inventory on medication dispensation.
- Alert on low stock or expiry.
- Log every stock movement (add, dispense, discard).

#### Audit Logging
- Log every POST/PUT/DELETE request for local models.
- Capture who performed the action, at what time, and what was changed.

#### Dashboard Metrics
- Fetch patient counts, revenue summaries, stock alerts.
- Filterable by department, time range, staff member.

---

