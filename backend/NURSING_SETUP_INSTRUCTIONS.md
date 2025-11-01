# Nursing Module Setup Instructions

This document provides the manual steps needed to complete the nursing module setup after the frontend implementation.

## 1. Run Database Migrations

The nursing app has been added to `INSTALLED_APPS` and migrations have been created. You need to apply them:

```bash
cd backend
python3 manage.py migrate nursing
```

This will create the following database tables:
- `nursing_vitalsigns` - For recording patient vital signs
- `nursing_nursingtask` - For nursing tasks and checklists
- `nursing_nursingalert` - For automated alerts based on vitals/medications
- `nursing_medicationadministration` - For medication administration records (MAR)
- `nursing_shifthandoff` - For shift change handoff notes

## 2. Verify URL Configuration

The nursing URLs should already be registered in `hms_backend/urls.py`:

```python
path('api/nursing/', include('apps.nursing.urls')),
```

Verify this line exists around line 29.

## 3. Test the API Endpoints

Start the development server and test the endpoints:

```bash
python3 manage.py runserver
```

### Test Dashboard Endpoint

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/nursing/monitoring/dashboard/
```

Expected response:
```json
{
  "count": 0,
  "page": 1,
  "page_size": 20,
  "total_pages": 0,
  "results": []
}
```

### Test Active Alerts Endpoint

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/nursing/alerts/active/
```

Expected response:
```json
[]
```

## 4. Create Test Data (Optional)

If you have admitted patients, you can create test vital signs:

```bash
python3 manage.py shell
```

```python
from apps.nursing.models import VitalSigns
from apps.patients.models import PatientProfile
from apps.users.models import User

# Get a patient and a nurse
patient = PatientProfile.objects.first()
nurse = User.objects.filter(role='nurse').first()

# Create vital signs
vitals = VitalSigns.objects.create(
    patient=patient,
    recorded_by=nurse,
    temperature=38.5,  # This will trigger a critical alert
    heart_rate=95,
    blood_pressure="130/85",
    respiratory_rate=18,
    oxygen_saturation=96.0,
    notes="Patient complains of fever"
)

print(f"Created vitals: {vitals}")
print(f"Is critical: {vitals.is_critical}")
```

## 5. Verify Permissions

The nursing views use the `IsNurseOrAdmin` permission class. Ensure your users have the correct roles:

- `admin` - Full access
- `nurse` - Full access to nursing module
- `head_nurse` - Full access to nursing module
- `nurse_practitioner` - Full access to nursing module
- `doctor` - Read-only access to certain endpoints

## 6. Check for Migration Issues

If migrations fail, check:

1. **Database connection**: Ensure your database is running and accessible
2. **Migration conflicts**: Look for conflicting migrations in other apps
3. **Missing dependencies**: Some nursing models reference Patient and User models

Common fixes:

```bash
# Show migration status
python3 manage.py showmigrations nursing

# If needed, fake a migration (use with caution)
python3 manage.py migrate nursing --fake 0001_initial

# Then run the real migration
python3 manage.py migrate nursing
```

## 7. Monitor Backend Logs

When you access the nursing dashboard in the frontend, watch the Django console for:

1. **200 OK responses** - API is working correctly
2. **500 errors** - Check the traceback for issues
3. **404 errors** - URL configuration issue
4. **403 errors** - Permission issue

## 8. Common Issues and Solutions

### Issue: "Query data cannot be undefined"
**Cause**: API endpoint is not responding or migrations not applied
**Fix**: Run migrations and verify API endpoints are accessible

### Issue: "500 Internal Server Error"
**Cause**: Database query error or serialization error
**Fix**: Check Django console for traceback, ensure migrations are applied

### Issue: "No patients found"
**Cause**: No admitted patients in the system
**Fix**: Create test admissions or check admission status in database

### Issue: "Authentication failed"
**Cause**: JWT token expired or invalid
**Fix**: Log out and log back in to get new tokens

## 9. Performance Optimization (Production)

Once working, consider these optimizations:

1. **Database Indexes**: Already added in models
2. **Caching**: Add Redis caching for active alerts
3. **Query Optimization**: `select_related()` already implemented
4. **Pagination**: Already implemented (20 items per page)

## 10. Next Steps

After the nursing module is working:

1. Test vital signs recording
2. Test alert acknowledgment
3. Test nursing task creation and completion
4. Test medication administration recording
5. Test shift handoff creation
6. Verify real-time refetching (60-second intervals)
7. Test pagination with large datasets
8. Test ward filtering

## Files Created/Modified

### Backend:
- `backend/apps/nursing/` (entire new app)
- `backend/hms_backend/settings.py` (added nursing to INSTALLED_APPS)
- `backend/hms_backend/urls.py` (added nursing URLs)
- `backend/apps/wards/models.py` (removed cleaning status)
- `backend/apps/wards/views.py` (removed cleaning status)
- `backend/apps/wards/migrations/0003_remove_cleaning_status.py` (new migration)

### Frontend:
- `frontend/src/hooks/useNursingQueries.js` (new file)
- `frontend/src/components/nursing/PatientMonitoringCard.jsx` (new file)
- `frontend/src/components/nursing/AlertsPanel.jsx` (new file)
- `frontend/src/components/nursing/VitalSignsForm.jsx` (modified toast)
- `frontend/src/pages/nursing/NursingDashboardPage.jsx` (new file)
- `frontend/src/App.jsx` (already had route)
- `frontend/src/components/layout/sidebar.jsx` (already had link)

## Support

If you encounter issues:
1. Check Django console output for detailed error messages
2. Check browser console for frontend errors
3. Verify all migrations are applied: `python3 manage.py showmigrations`
4. Test API endpoints directly with curl or Postman
5. Check user permissions and roles
