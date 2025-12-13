from django.urls import path
from .views import (
    my_work_dashboard,
    clinic_schedule,
    nurse_dashboard,
    inpatient_dashboard,
    reception_dashboard,
    admin_dashboard,
    my_context_patients,
)

urlpatterns = [
    path('dashboards/my-work/', my_work_dashboard, name='my-work-dashboard'),
    path('dashboards/clinic/', clinic_schedule, name='clinic-schedule'),
    path('dashboards/nurse/', nurse_dashboard, name='nurse-dashboard'),
    path('dashboards/inpatient/', inpatient_dashboard, name='inpatient-dashboard'),
    path('dashboards/reception/', reception_dashboard, name='reception-dashboard'),
    path('dashboards/admin/', admin_dashboard, name='admin-dashboard'),
    path('dashboards/my-context-patients/', my_context_patients, name='my-context-patients'),
]
