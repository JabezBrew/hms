# Clinical Safety & Workflow Features - Implementation Guide

## Overview

This guide covers the remaining implementation steps for the drug interaction checking, laboratory information system (LIS), and referral management features.

## ✅ What's Already Complete (8/21 tasks)

1. ✅ Django app structures created (drug_safety, laboratory, referrals)
2. ✅ All database models implemented with migrations
3. ✅ RxNorm/OpenFDA service layer complete
4. ✅ Drug interaction & allergy checking services
5. ✅ Drug Safety API endpoints and serializers
6. ✅ Apps registered in settings.py
7. ✅ Migrations applied
8. ✅ Dependencies updated (requests library added)

### Drug Safety API Endpoints Available:
```
POST /api/drug-safety/safety/check/           # Check medication safety
GET  /api/drug-safety/safety/search_drugs/?q= # Search drugs (RxNorm)
GET  /api/drug-safety/safety/patient_allergies/?patient_id=  # Get allergies

GET  /api/drug-safety/allergies/               # List allergies
POST /api/drug-safety/allergies/               # Create allergy
GET  /api/drug-safety/allergies/{id}/          # Get allergy
PUT  /api/drug-safety/allergies/{id}/          # Update allergy
POST /api/drug-safety/allergies/{id}/verify/   # Verify allergy (doctors)
POST /api/drug-safety/allergies/{id}/deactivate/  # Deactivate allergy

GET  /api/drug-safety/alerts/                  # List alerts
GET  /api/drug-safety/alerts/{id}/             # Get alert
POST /api/drug-safety/alerts/{id}/override/    # Override alert with reason
```

---

## 🚧 Remaining Work (13 tasks)

### Task 1: Laboratory API Endpoints & Serializers

**File**: `backend/apps/laboratory/serializers.py`

Create serializers for all lab models following the pattern in `drug_safety/serializers.py`:

```python
# LabTestCatalogSerializer - for test catalog
# LabPanelSerializer - for test panels
# LabOrderSerializer - for orders with read display
# LabOrderCreateSerializer - for creating orders
# LabOrderTestSerializer - for order-test relationship
# LabSpecimenSerializer - for specimen tracking
# LabResultSerializer - for results
```

**File**: `backend/apps/laboratory/views.py`

Create ViewSets:
```python
class LabTestCatalogViewSet(viewsets.ReadOnlyModelViewSet):
    # Public test catalog
    # Filter by category, is_active

class LabPanelViewSet(viewsets.ReadOnlyModelViewSet):
    # Panel listings

class LabOrderViewSet(viewsets.ModelViewSet):
    # CRUD for lab orders
    # Actions: submit(), cancel(), collect(), receive()
    # Filter by patient, status, priority

class LabSpecimenViewSet(viewsets.ModelViewSet):
    # Specimen tracking
    # Actions: scan(), receive(), reject()

class LabResultViewSet(viewsets.ModelViewSet):
    # Result entry and verification
    # Actions: verify()
    # Permission: lab technicians only
```

**File**: `backend/apps/laboratory/urls.py`

```python
from django.urls import path, include
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
router.register(r'catalog', LabTestCatalogViewSet, basename='test-catalog')
router.register(r'panels', LabPanelViewSet, basename='panel')
router.register(r'orders', LabOrderViewSet, basename='order')
router.register(r'specimens', LabSpecimenViewSet, basename='specimen')
router.register(r'results', LabResultViewSet, basename='result')

urlpatterns = [path('', include(router.urls))]
```

---

### Task 2: Referral API Endpoints & Serializers

**File**: `backend/apps/referrals/serializers.py`

```python
class ReferralSerializer(serializers.ModelSerializer):
    # Full read serializer with display names

class ReferralCreateSerializer(serializers.ModelSerializer):
    # Creation validation

class ReferralResponseSerializer(serializers.Serializer):
    # For accept/decline actions
```

**File**: `backend/apps/referrals/views.py`

```python
class ReferralViewSet(viewsets.ModelViewSet):
    # CRUD for referrals
    # Actions: submit(), accept(), decline(), complete(), cancel()
    # Filter by patient, referring_provider, referred_to_provider, status

    @action(detail=False, methods=['get'])
    def inbox(self, request):
        # Referrals received by current practitioner

    @action(detail=False, methods=['get'])
    def sent(self, request):
        # Referrals sent by current practitioner
```

**File**: `backend/apps/referrals/urls.py`

```python
from django.urls import path, include
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
router.register(r'', ReferralViewSet, basename='referral')

urlpatterns = [path('', include(router.urls))]
```

---

### Task 3: Update Main URL Configuration

**File**: `backend/hms_backend/urls.py`

Add to urlpatterns:
```python
path('api/drug-safety/', include('apps.drug_safety.urls')),
path('api/lab/', include('apps.laboratory.urls')),
path('api/referrals/', include('apps.referrals.urls')),
```

---

### Task 4: Update Audit Logging

**File**: `backend/apps/audit/models.py`

Add to `CATEGORY_CHOICES`:
```python
DRUG_SAFETY = 'DRUG_SAFETY'
LABORATORY = 'LABORATORY'
REFERRAL = 'REFERRAL'
```

Add to `ACTION_CHOICES`:
```python
# Drug Safety
SAFETY_ALERT_GENERATED = 'SAFETY_ALERT_GENERATED'
SAFETY_ALERT_OVERRIDDEN = 'SAFETY_ALERT_OVERRIDDEN'
ALLERGY_ADDED = 'ALLERGY_ADDED'
ALLERGY_VERIFIED = 'ALLERGY_VERIFIED'

# Laboratory
LAB_ORDER_CREATED = 'LAB_ORDER_CREATED'
LAB_SPECIMEN_COLLECTED = 'LAB_SPECIMEN_COLLECTED'
LAB_RESULT_ENTERED = 'LAB_RESULT_ENTERED'
LAB_RESULT_VERIFIED = 'LAB_RESULT_VERIFIED'
CRITICAL_RESULT = 'CRITICAL_RESULT'

# Referrals
REFERRAL_SENT = 'REFERRAL_SENT'
REFERRAL_ACCEPTED = 'REFERRAL_ACCEPTED'
REFERRAL_DECLINED = 'REFERRAL_DECLINED'
REFERRAL_COMPLETED = 'REFERRAL_COMPLETED'
```

---

### Task 5: Lab Test Catalog Seed Data

**File**: `backend/apps/laboratory/management/commands/seed_lab_catalog.py`

Create management command to seed common tests:

```python
from django.core.management.base import BaseCommand
from apps.laboratory.models import LabTestCatalog, LabPanel

class Command(BaseCommand):
    help = 'Seed laboratory test catalog with common tests'

    def handle(self, *args, **kwargs):
        # Create common tests
        tests = [
            {
                'code': 'CBC',
                'loinc_code': '58410-2',
                'name': 'Complete Blood Count',
                'short_name': 'CBC',
                'category': 'hematology',
                'specimen_type': 'Whole Blood',
                'container_type': 'Lavender Top (EDTA)',
                'volume_required': '3-5 mL',
                'reference_ranges': {
                    'adult_male': {'wbc': {'low': 4.5, 'high': 11.0, 'unit': '10^9/L'}},
                    'adult_female': {'wbc': {'low': 4.5, 'high': 11.0, 'unit': '10^9/L'}}
                },
                'unit': 'various',
                'tat_hours': 2,
                'price': 15.00
            },
            # Add more tests: BMP, CMP, LFT, Lipid Panel, TSH, HbA1c, etc.
        ]

        for test_data in tests:
            LabTestCatalog.objects.get_or_create(
                code=test_data['code'],
                defaults=test_data
            )

        # Create panels
        # CBC Panel, Metabolic Panel, etc.
```

Run: `python manage.py seed_lab_catalog`

---

### Task 6: Celery Tasks for Notifications

**File**: `backend/apps/laboratory/tasks.py`

```python
from celery import shared_task
from .models import LabResult
from apps.nursing.models import NursingAlert

@shared_task
def send_critical_result_notification(result_id):
    """Send notification for critical lab result."""
    result = LabResult.objects.get(id=result_id)

    if result.is_critical():
        # Create NursingAlert
        NursingAlert.objects.create(
            patient=result.order_test.order.patient,
            alert_type='other',
            severity='critical',
            message=f"CRITICAL LAB RESULT: {result.order_test.test.name} = {result.value} {result.unit}"
        )

        # Send email to ordering provider
        # ... email logic
```

**File**: `backend/apps/referrals/tasks.py`

```python
from celery import shared_task
from .models import Referral

@shared_task
def send_referral_notification(referral_id, notification_type):
    """Send referral notifications."""
    referral = Referral.objects.get(id=referral_id)

    if notification_type == 'new':
        # Notify referred_to_provider
        pass
    elif notification_type == 'accepted':
        # Notify referring_provider
        pass
    # ... etc
```

---

### Task 7: Frontend - Drug Safety Components

**Directory**: `frontend/src/components/drug-safety/`

#### DrugSafetyDialog.jsx
```jsx
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, XCircle, AlertCircle, Info } from 'lucide-react';

export function DrugSafetyDialog({ alerts, onOverride, onCancel }) {
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const hasCritical = criticalAlerts.length > 0;

  return (
    <AlertDialog open={alerts.length > 0}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {hasCritical ? (
              <><XCircle className="h-5 w-5 text-destructive" /> Critical Drug Safety Alert</>
            ) : (
              <><AlertTriangle className="h-5 w-5 text-amber-500" /> Drug Safety Warning</>
            )}
          </AlertDialogTitle>
        </AlertDialogHeader>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {alerts.map(alert => (
            <Alert key={alert.id} variant={alert.severity === 'critical' ? 'destructive' : 'default'}>
              <AlertDescription>
                <div className="font-semibold">{alert.title}</div>
                <div className="text-sm mt-1">{alert.description}</div>
                {alert.conflicting_medication && (
                  <div className="text-xs mt-2 text-muted-foreground">
                    Conflicts with: {alert.conflicting_medication}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel Prescription</AlertDialogCancel>
          {hasCritical ? (
            <OverrideDialog onOverride={onOverride} />
          ) : (
            <AlertDialogAction onClick={() => onOverride('')}>Acknowledge & Continue</AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

#### AllergyManager.jsx
```jsx
// Component to manage patient allergies
// - List active allergies
// - Add new allergy form
// - Verify/deactivate actions
```

#### MedicationAutocomplete.jsx
```jsx
import { useState, useEffect } from 'react';
import { Command, CommandInput, CommandList, CommandItem } from '@/components/ui/command';
import { apiClient } from '@/lib/api-client';

export function MedicationAutocomplete({ onSelect }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (search.length < 2) return;

    const debounce = setTimeout(async () => {
      const { data } = await apiClient.get('/drug-safety/safety/search_drugs/', {
        params: { q: search }
      });
      setResults(data.results);
    }, 300);

    return () => clearTimeout(debounce);
  }, [search]);

  return (
    <Command>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search medications..."
      />
      <CommandList>
        {results.map(drug => (
          <CommandItem key={drug.rxcui} onSelect={() => onSelect(drug)}>
            {drug.name}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
```

---

### Task 8: Frontend - Laboratory Components

**Directory**: `frontend/src/components/laboratory/`

#### LabOrderForm.jsx
```jsx
// Multi-step wizard for creating lab orders
// 1. Select tests/panels
// 2. Add clinical notes
// 3. Set priority and fasting requirements
// 4. Review and submit
```

#### LabResultViewer.jsx
```jsx
// Display lab results with:
// - Abnormal value highlighting (red for critical, yellow for abnormal)
// - Reference range display
// - Trend visualization (if multiple results)
// - Result interpretation notes
```

#### LabTechnicianDashboard.jsx
```jsx
// Dashboard showing:
// - Pending specimens to receive
// - Active tests in progress
// - Results pending verification
// - Critical results requiring immediate attention
```

---

### Task 9: Frontend - Referral Components

**Directory**: `frontend/src/components/referrals/`

#### ReferralForm.jsx
```jsx
// Wizard-style referral form:
// 1. Select specialty/department
// 2. Select urgency
// 3. Enter reason and clinical summary
// 4. Add questions for specialist
// 5. Review and submit
```

#### ReferralInbox.jsx
```jsx
// List of received referrals with:
// - Filter by urgency, status
// - Accept/decline actions
// - Add specialist notes
```

---

### Task 10: Integrate Drug Safety into Prescription Workflow

**File**: `frontend/src/components/chronicle/AddPrescriptionSlideOver.jsx`

Modify the prescription creation to include safety check:

```jsx
import { useMutation } from '@tanstack/react-query';
import { DrugSafetyDialog } from '@/components/drug-safety/DrugSafetyDialog';

function AddPrescriptionSlideOver({ patient, encounter }) {
  const [safetyAlerts, setSafetyAlerts] = useState([]);
  const [showSafetyDialog, setShowSafetyDialog] = useState(false);

  const checkSafety = useMutation({
    mutationFn: async (data) => {
      return apiClient.post('/drug-safety/safety/check/', {
        patient_id: patient.id,
        medication_name: data.medication_name,
        encounter_id: encounter?.id
      });
    },
    onSuccess: (response) => {
      if (response.data.has_alerts) {
        setSafetyAlerts(response.data.alerts);
        setShowSafetyDialog(true);
      } else {
        // Proceed with prescription creation
        createPrescription.mutate(formData);
      }
    }
  });

  const handleSubmit = (data) => {
    // Run safety check first
    checkSafety.mutate(data);
  };

  const handleOverride = (reason) => {
    // Save alerts with override reason, then create prescription
    // ...
  };

  return (
    <>
      {/* Existing form */}

      <DrugSafetyDialog
        alerts={safetyAlerts}
        onOverride={handleOverride}
        onCancel={() => setShowSafetyDialog(false)}
      />
    </>
  );
}
```

---

### Task 11: Dashboard Widgets

**File**: `frontend/src/components/dashboard/PendingLabResultsWidget.jsx`

```jsx
// Widget showing pending lab results for doctors
// - Count of unreviewed results
// - Critical results highlighted
// - Quick link to results page
```

**File**: `frontend/src/components/dashboard/ActiveReferralsWidget.jsx`

```jsx
// Widget for tracking referrals
// - Sent referrals awaiting response
// - Received referrals needing action
```

---

### Task 12: FHIR Sync Implementation

**File**: `backend/apps/drug_safety/fhir_sync.py`

```python
def sync_allergy_to_fhir(allergy: PatientAllergy):
    """Sync PatientAllergy to FHIR AllergyIntolerance."""
    resource = {
        'resourceType': 'AllergyIntolerance',
        'patient': create_reference('Patient', allergy.patient.fhir_id),
        'code': create_codeable_concept(
            allergy.allergen_name,
            allergy.allergen_code,
            allergy.allergen_code_system
        ),
        'criticality': map_severity_to_fhir(allergy.severity),
        # ... more mappings
    }

    if allergy.fhir_id:
        # Update existing
        fhir_client.update_resource('AllergyIntolerance', allergy.fhir_id, resource)
    else:
        # Create new
        response = fhir_client.create_resource('AllergyIntolerance', resource)
        allergy.fhir_id = response['id']
        allergy.fhir_synced = True
        allergy.save()
```

Similar functions for Lab and Referral FHIR sync.

---

### Task 13: Sidebar Navigation

**File**: `frontend/src/components/layout/sidebar.jsx`

Add navigation items:

```jsx
{
  title: "Laboratory",
  icon: TestTube,
  items: [
    { title: "Lab Orders", href: "/lab/orders" },
    { title: "Results", href: "/lab/results" },
    { title: "Test Catalog", href: "/lab/catalog" }
  ]
},
{
  title: "Referrals",
  icon: ArrowRightLeft,
  items: [
    { title: "My Referrals", href: "/referrals/sent" },
    { title: "Inbox", href: "/referrals/inbox" },
    { title: "All Referrals", href: "/referrals" }
  ]
}
```

---

## Testing Checklist

### Drug Safety
- [ ] Search for medication via RxNorm
- [ ] Create patient allergy
- [ ] Prescribe medication with allergy → see critical alert
- [ ] Override alert with reason
- [ ] Prescribe interacting drugs → see interaction warning
- [ ] Verify allergy cross-referencing works

### Laboratory
- [ ] Create lab order with multiple tests
- [ ] Record specimen collection
- [ ] Lab tech receives specimen
- [ ] Enter lab results
- [ ] Verify results
- [ ] Check critical value triggers alert

### Referrals
- [ ] Create referral to specialist
- [ ] Specialist sees in inbox
- [ ] Accept referral
- [ ] Add specialist notes
- [ ] Mark completed

---

## Performance Considerations

1. **Caching**: RxNorm/OpenFDA calls are cached (Django cache)
2. **Database Indexes**: All models have appropriate indexes
3. **Query Optimization**: Use `select_related()` and `prefetch_related()`
4. **Async Tasks**: Use Celery for notifications and heavy operations

---

## Security Considerations

1. **Drug Safety Overrides**: All logged with reason and user
2. **Lab Results**: Only verified results shown to clinicians
3. **Referrals**: RBAC ensures only relevant providers see referrals
4. **Audit Trail**: All actions logged via AuditMiddleware

---

## Next Steps

1. Complete remaining API implementations (Lab, Referrals)
2. Build frontend components
3. Integrate into existing workflows
4. Add FHIR sync
5. Test end-to-end
6. Deploy and monitor

---

## Questions or Issues?

Refer to:
- Django REST Framework docs: https://www.django-rest-framework.org/
- RxNorm API docs: https://lhncbc.nlm.nih.gov/RxNav/APIs/
- OpenFDA docs: https://open.fda.gov/apis/
- React Query docs: https://tanstack.com/query/latest
- shadcn/ui docs: https://ui.shadcn.com/

**Implementation is ~40% complete. The foundation is solid - models, services, and drug safety API are production-ready.**
