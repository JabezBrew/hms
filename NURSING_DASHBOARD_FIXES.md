# Nursing Dashboard Error Fixes

## Summary of Issues

The Nursing Dashboard was showing errors due to React Query hooks returning `undefined` data. This document outlines the issues found and the fixes implemented.

## Issues Identified

### 1. React Query Hook Undefined Returns
**Location**: `frontend/src/hooks/useNursingQueries.js`

**Problem**:
- The `usePatientMonitoring()` and `useActiveAlerts()` hooks had error handlers that tried to return fallback data, but React Query was still showing `undefined` in responses
- Error message: `Query data cannot be undefined. Please make sure to return a value other than undefined from your query function`

**Root Cause**:
- Error handlers were in try-catch blocks that masked actual API errors
- No placeholder data was provided during loading states
- Missing detailed error logging for debugging

### 2. Permission Issues
**Location**: `backend/apps/nursing/permissions.py`

**Problem**:
- The nursing endpoints require specific roles: `nurse`, `head_nurse`, or `nurse_practitioner`
- Users without these roles get 403 Forbidden errors
- No clear error messaging to users about permission issues

### 3. No Data in Database
**Problem**:
- The database may not have:
  - Admitted patients
  - Vital signs records
  - Nursing alerts
  - Nursing tasks
- This results in empty responses that combined with errors showed as undefined

## Fixes Implemented

### 1. Updated React Query Hooks (`useNursingQueries.js`)

#### `usePatientMonitoring` Hook
```javascript
// BEFORE: Error handling masked issues
queryFn: async () => {
  try {
    const response = await apiClient.get(...);
    return response.data;
  } catch (error) {
    return { count: 0, results: [] }; // Still returned undefined
  }
}

// AFTER: Proper error handling + placeholder data
queryFn: async () => {
  const response = await apiClient.get(...);
  if (!response.data) {
    return { count: 0, page: 1, page_size: 20, total_pages: 0, results: [] };
  }
  return response.data;
},
placeholderData: { count: 0, page: 1, page_size: 20, total_pages: 0, results: [] },
onError: (error) => {
  console.error('Patient monitoring error:', error);
  console.error('Error response:', error.response?.data);
  console.error('Error status:', error.response?.status);
}
```

**Changes**:
- Removed try-catch from queryFn (let React Query handle errors)
- Added `placeholderData` to provide initial data while loading
- Added `onError` callback for detailed error logging
- Ensured queryFn always returns a valid data structure

#### `useActiveAlerts` Hook
```javascript
// BEFORE
queryFn: async () => {
  try {
    const response = await apiClient.get('/nursing/alerts/active/');
    return response.data;
  } catch (error) {
    return []; // Still undefined
  }
}

// AFTER
queryFn: async () => {
  const response = await apiClient.get('/nursing/alerts/active/');
  if (!response.data) return [];
  return Array.isArray(response.data) ? response.data : [];
},
placeholderData: [],
onError: (error) => {
  console.error('Active alerts error:', error);
  console.error('Error response:', error.response?.data);
  console.error('Error status:', error.response?.status);
}
```

**Changes**:
- Same pattern as usePatientMonitoring
- Added type checking to ensure array response
- Placeholder data prevents undefined

### 2. Enhanced Dashboard Error Handling (`NursingDashboardPage.jsx`)

#### Added Error State Tracking
```javascript
const {
  data: monitoringResponse,
  isLoading: monitoringLoading,
  refetch,
  isFetching,
  error: monitoringError  // NEW
} = usePatientMonitoring(selectedWard, currentPage, pageSize);

const {
  data: activeAlerts,
  isLoading: alertsLoading,
  error: alertsError  // NEW
} = useActiveAlerts();
```

#### Added Error Logging
```javascript
// Log any errors
if (monitoringError) {
  console.error('Monitoring Error:', monitoringError);
}
if (alertsError) {
  console.error('Alerts Error:', alertsError);
}
```

#### Added User-Friendly Error Display
```jsx
{/* Error Alerts */}
{(monitoringError || alertsError) && (
  <Alert variant="destructive">
    <ShieldAlert className="h-4 w-4" />
    <AlertTitle>Error Loading Nursing Data</AlertTitle>
    <AlertDescription>
      {monitoringError && (
        <div className="mb-2">
          <strong>Patient Monitoring:</strong>{' '}
          {monitoringError.response?.status === 403
            ? 'You do not have permission to access nursing features. Please contact your administrator to assign you a nurse role.'
            : monitoringError.response?.status === 404
            ? 'Nursing endpoints not found. The nursing module may not be properly configured.'
            : monitoringError.message || 'Unable to load patient monitoring data.'}
        </div>
      )}
      {alertsError && (
        <div>
          <strong>Active Alerts:</strong>{' '}
          {alertsError.response?.status === 403
            ? 'You do not have permission to view alerts.'
            : alertsError.response?.status === 404
            ? 'Alerts endpoint not found.'
            : alertsError.message || 'Unable to load active alerts.'}
        </div>
      )}
    </AlertDescription>
  </Alert>
)}
```

**Benefits**:
- Users see helpful error messages instead of confusing undefined errors
- Permission issues are clearly explained
- Suggests actionable solutions (contact administrator)

### 3. Created Diagnostic Script (`check_nursing_permissions.py`)

Created a comprehensive diagnostic tool to identify setup and permission issues:

```bash
python3 check_nursing_permissions.py
```

**What it checks**:
1. **Database Tables**: Verifies nursing tables exist and shows record counts
2. **Admitted Patients**: Checks if there are any admitted patients
3. **User Roles**: Lists all users and their roles, highlighting who has nursing access
4. **Ward Configuration**: Shows ward and bed availability
5. **Recommendations**: Provides specific actions to fix identified issues

**Example output**:
```
============================================================
NURSING MODULE DIAGNOSTIC REPORT
============================================================

1. DATABASE TABLES
------------------------------------------------------------
✓ VitalSigns table exists: 0 records
✓ NursingAlert table exists: 0 records
✓ NursingTask table exists: 0 records
✓ MedicationAdministration table exists: 0 records

2. ADMITTED PATIENTS
------------------------------------------------------------
Current admitted patients: 0
⚠ No patients currently admitted
  The nursing dashboard will show 'No patients found'

3. USER ROLES
------------------------------------------------------------
✓ admin (admin@example.com): Superuser, Staff
✗ user1 (user@example.com): No roles

4. WARD CONFIGURATION
------------------------------------------------------------
Total wards: 5
Total beds: 25
Available beds: 20
✓ Wards are configured

5. RECOMMENDATIONS
------------------------------------------------------------
⚠ No users have nursing access. Assign nurse role to at least one user.
  You can do this by creating/updating a PractitionerProfile with role='nurse'
⚠ No admitted patients. Admit at least one patient to test the nursing dashboard.
============================================================
```

## Testing Instructions

### Step 1: Run the Diagnostic Script

```bash
cd backend
python3 check_nursing_permissions.py
```

Review the output and address any warnings.

### Step 2: Fix Permission Issues (if needed)

If users don't have nursing access, you can assign the nurse role using Django shell:

```bash
cd backend
python3 manage.py shell
```

```python
from django.contrib.auth import get_user_model
from apps.users.models import PractitionerProfile

User = get_user_model()

# Get the user
user = User.objects.get(username='your_username')

# Create or update practitioner profile
profile, created = PractitionerProfile.objects.get_or_create(
    user=user,
    defaults={
        'role': 'nurse',
        'license_number': 'RN12345',
        'specialization': 'General Nursing'
    }
)

if not created:
    profile.role = 'nurse'
    profile.save()

print(f"✓ User {user.username} now has nurse role")
```

### Step 3: Ensure Patients Are Admitted

Use the Django admin or the wards interface to admit at least one patient to a bed.

### Step 4: Test the Dashboard

1. Log in with a user that has nursing access (nurse role or superuser)
2. Navigate to the Nursing Dashboard
3. You should now see:
   - No "undefined" errors in console
   - Either patient data (if patients are admitted) OR
   - A friendly "No patients found" message
   - If there are permission issues, a clear error message explaining what to do

### Step 5: Verify Browser Console

Open browser DevTools > Console and check for:
- Detailed API error logging (if errors occur)
- Response data logging showing the API responses
- No "undefined" related errors

## Expected Behavior After Fixes

### With Proper Permissions + Admitted Patients
- Dashboard loads successfully
- Shows statistics (patient counts, alerts, tasks)
- Displays admitted patients with their monitoring data
- No console errors

### With Proper Permissions + No Admitted Patients
- Dashboard loads successfully
- Shows 0 for all statistics
- Displays "No patients found" message
- No console errors

### Without Proper Permissions
- Dashboard shows red error alert explaining permission issue
- Error message suggests contacting administrator
- Console shows 403 error with details
- Statistics show 0 (due to placeholder data)

## Files Modified

1. `frontend/src/hooks/useNursingQueries.js`
   - Updated `usePatientMonitoring` hook
   - Updated `useActiveAlerts` hook
   - Added placeholderData to prevent undefined
   - Added detailed error logging

2. `frontend/src/pages/nursing/NursingDashboardPage.jsx`
   - Added error state tracking
   - Added error logging
   - Added user-friendly error display UI
   - Imported Alert components

## Files Created

1. `backend/check_nursing_permissions.py`
   - Diagnostic script for identifying setup issues
   - Checks database tables, users, roles, and configuration

2. `NURSING_DASHBOARD_FIXES.md` (this file)
   - Documentation of issues and fixes
   - Testing instructions

## Common Issues and Solutions

### Issue: "You do not have permission to access nursing features"

**Solution**:
1. Run `python3 check_nursing_permissions.py` to see which users have access
2. Assign nurse role to your user (see Step 2 in Testing Instructions)
3. Log out and log back in
4. Refresh the dashboard

### Issue: "No patients found"

**Solution**:
1. This is expected if no patients are admitted
2. Admit a patient through the Wards > Ward Detail > Bed Assignment interface
3. Refresh the nursing dashboard

### Issue: Still seeing "undefined" errors

**Solution**:
1. Clear browser cache and hard refresh (Cmd+Shift+R or Ctrl+Shift+R)
2. Check browser console for specific error messages
3. Check Django server logs for backend errors
4. Verify the backend server is running
5. Check that `/api/nursing/monitoring/dashboard/` endpoint is accessible

## Backend Architecture Reference

### Permission Classes

**Location**: `backend/apps/nursing/permissions.py`

- `IsNurseOrAdmin`: Allows nurses, head nurses, nurse practitioners, and admins
- `IsNurseOrDoctor`: Allows doctors AND nurses

### API Endpoints

All endpoints are prefixed with `/api/nursing/`

- `GET /monitoring/dashboard/` - Patient monitoring data (paginated)
- `GET /monitoring/patient_detail/` - Detailed patient monitoring
- `GET /alerts/active/` - Active unacknowledged alerts
- `GET /tasks/today/` - Today's nursing tasks
- `GET /medications/due_now/` - Medications due in next hour

### Models

- `VitalSigns` - Patient vital signs records
- `NursingAlert` - Automated and manual alerts
- `NursingTask` - Scheduled nursing tasks
- `MedicationAdministration` - Medication tracking
- `ShiftHandoff` - Shift handoff notes

## Next Steps

1. Run the diagnostic script to verify setup
2. Fix any permission issues identified
3. Admit test patients if needed
4. Test the dashboard with different user roles
5. Verify error messages are clear and helpful
6. Consider adding more test data for a realistic dashboard view

## Questions or Issues?

If you continue to experience issues:
1. Check the browser console for detailed error logs
2. Check Django server logs for backend errors
3. Run the diagnostic script: `python3 check_nursing_permissions.py`
4. Verify migrations are up to date: `python3 manage.py migrate`
5. Review the permission classes in `backend/apps/nursing/permissions.py`
