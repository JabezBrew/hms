from django.urls import path
from .views import my_work_dashboard, clinic_schedule

urlpatterns = [
    path('dashboards/my-work/', my_work_dashboard, name='my-work-dashboard'),
    path('dashboards/clinic/', clinic_schedule, name='clinic-schedule'),
]
