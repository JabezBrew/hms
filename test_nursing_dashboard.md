# Testing Nursing Dashboard Fix

## Quick Test Checklist

### ✅ Backend is Running
```bash
cd backend
python3 manage.py runserver
```

### ✅ Frontend is Running
```bash
cd frontend
npm run dev
```

### ✅ Navigate to Nursing Dashboard
1. Log in to the application
2. Click "Nursing Dashboard" in the sidebar
3. Dashboard should load without errors

## Expected Results

### 1. Console Logs (Browser DevTools > Console)

You should see:
```
Patient Monitoring API Response: {data: {...}, status: 200, ...}
Response data type: Array  or  object
```

If you see "Array":
```
Backend returned array instead of paginated object. Wrapping response...
```

### 2. Dashboard Display

**Statistics Cards Should Show:**
- Total Patients: **1** (Christie Tow)
- Critical Patients: **0** (no critical vitals)
- Active Alerts: **0** (no alerts)
- Pending Tasks: **0** (no tasks)

**Patient List Should Show:**
- Christie Tow (HMS-2025-02267)
- Ward: Surgical 2
- Bed: 027
- Admitted: 2025-10-30
- Status indicators (vital signs, alerts, tasks)

### 3. No Errors

**Should NOT see:**
- ❌ "Query data cannot be undefined"
- ❌ Red error alerts
- ❌ "No patients found" (you have 1 admitted patient)

## What the Patient Card Should Display

Based on your data:

```
┌─────────────────────────────────────────────────────────────┐
│ Christie Tow                                    HMS-2025-02267│
│ Surgical 2 - Bed 027                                         │
├─────────────────────────────────────────────────────────────┤
│ Vital Signs: No recent vitals                               │
│ Alerts: None                                                 │
│ Tasks: None pending                                          │
│ Medications: None due                                        │
├─────────────────────────────────────────────────────────────┤
│ Admitted: Oct 30, 2025                                       │
│ Doctor: Dr. Isabella Asamoah (Infectious Diseases)          │
│ Length of Stay: 1 day                                        │
└─────────────────────────────────────────────────────────────┘
```

## If Dashboard is Still Empty

### Step 1: Check Browser Console

Look for the response structure:
```javascript
Patient Monitoring API Response: {
  data: [...],  // Should be array or object with 'results' key
  status: 200
}
```

### Step 2: Check What's Being Logged

```javascript
Monitoring Response: {
  count: 1,
  page: 1,
  page_size: 20,
  total_pages: 1,
  results: [...]
}
Monitoring Data: [...]  // Should be an array with 1 patient
Total Count: 1
```

### Step 3: Check Network Tab

1. Open DevTools > Network
2. Refresh the page
3. Find the request to `monitoring/dashboard/`
4. Click on it and check the **Response** tab
5. You should see either:
   - Array: `[{patient: {...}, admission: {...}, ...}]`
   - Or Object: `{count: 1, results: [{...}]}`

### Step 4: Verify the Fix is Applied

Check if the fix is in the code:

**In `frontend/src/hooks/useNursingQueries.js` around line 30:**
```javascript
// If backend returns array directly (not paginated), wrap it
if (Array.isArray(response.data)) {
  console.warn('Backend returned array instead of paginated object. Wrapping response...');
  return {
    count: response.data.length,
    page: page,
    page_size: pageSize,
    total_pages: Math.ceil(response.data.length / pageSize),
    results: response.data
  };
}
```

If this code is not there, the fix wasn't applied. You may need to:
1. Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
2. Clear browser cache
3. Restart the frontend dev server

## Debugging Commands

### Check Django Logs

The backend should print:
```
DEBUG: Returning paginated response with 1 total patients, page 1
DEBUG: Results count: 1
```

If you don't see this, the view isn't being called.

### Test API Directly

```bash
# Get auth token first (replace with your credentials)
curl -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email", "password": "your-password"}'

# Use the token to call the monitoring endpoint
curl -X GET http://localhost:8000/api/nursing/monitoring/dashboard/ \
  -H "Cookie: access_token=YOUR_TOKEN_HERE"
```

This will show you the raw API response.

### Run Diagnostic Script

```bash
cd backend
python3 check_nursing_permissions.py
```

Look for:
```
✓ admin (admin@example.com): Superuser, Staff
Current admitted patients: 1
✓ Patients are admitted and should appear on dashboard
```

## Success Criteria

✅ Dashboard loads without errors
✅ Shows "Total Patients: 1"
✅ Shows Christie Tow in the patient list
✅ No undefined errors in console
✅ Can see patient details (ward, bed, admission info)

## Common Issues

### Issue: Still seeing empty dashboard

**Solution 1**: Hard refresh the browser (Cmd+Shift+R)

**Solution 2**: Check if logged in user has nurse permissions
```bash
cd backend
python3 check_nursing_permissions.py
```

**Solution 3**: Verify frontend is getting the data
```javascript
// Should see in console:
Monitoring Data: [{patient: {...}, admission: {...}}]
Total Count: 1
```

### Issue: "No patients found" message

This means `filteredPatients.length === 0`.

Check:
1. Is `monitoringData` populated? (Check console)
2. Are you on a filtered tab (Critical, Alerts, Tasks) with no matching patients?
3. Click the "All" tab to see all patients

### Issue: Patient appears but no details

This is expected because:
- `latest_vitals: null` - No vital signs recorded in last 24 hours
- `active_alerts: []` - No active alerts
- `pending_tasks: []` - No pending tasks
- `medications_due: []` - No medications due

This is normal for a newly admitted patient. You can:
1. Add vital signs through the nursing interface
2. Create nursing tasks
3. Schedule medications

## Next Actions After Verification

Once the dashboard displays correctly:

1. **Add Vital Signs** for Christie Tow
2. **Create Nursing Tasks** to test the tasks panel
3. **Test Different Ward Filters** (currently in Surgical 2)
4. **Admit More Patients** to test pagination
5. **Create Alerts** to test alert functionality

This will make the dashboard more functional and realistic.
