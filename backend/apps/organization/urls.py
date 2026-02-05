"""
URL configuration for the organization app.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    UnitTypeConfigViewSet,
    LeadershipRoleConfigViewSet,
    StaffAssignmentTypeConfigViewSet,
    ClinicalUnitViewSet,
    ClinicViewSet,
    ClinicScheduleViewSet,
    UnitLeadershipViewSet,
    StaffUnitAssignmentViewSet,
    UnitMemberAssignmentViewSet,
    CrossCoverageScheduleViewSet,
    UnitWardAllocationViewSet,
    DepartmentDutyTypeViewSet,
    RotationRuleViewSet,
    RosterEntryViewSet,
    RosterValidationRuleViewSet,
)

router = DefaultRouter()

# Configuration endpoints
router.register(r'unit-types', UnitTypeConfigViewSet, basename='unit-type')
router.register(r'leadership-roles', LeadershipRoleConfigViewSet, basename='leadership-role')
router.register(r'assignment-types', StaffAssignmentTypeConfigViewSet, basename='assignment-type')

# Core organization endpoints
router.register(r'units', ClinicalUnitViewSet, basename='clinical-unit')
router.register(r'clinics', ClinicViewSet, basename='clinic')
router.register(r'clinic-schedules', ClinicScheduleViewSet, basename='clinic-schedule')
router.register(r'leadership', UnitLeadershipViewSet, basename='leadership')
router.register(r'staff-assignments', StaffUnitAssignmentViewSet, basename='staff-assignment')
router.register(r'unit-members', UnitMemberAssignmentViewSet, basename='unit-member')
router.register(r'cross-coverage', CrossCoverageScheduleViewSet, basename='cross-coverage')
router.register(r'ward-allocations', UnitWardAllocationViewSet, basename='ward-allocation')

# Department roster endpoints
router.register(r'department-duty-types', DepartmentDutyTypeViewSet, basename='department-duty-type')

unit_staff_counts = ClinicalUnitViewSet.as_view({'get': 'staff_counts'})
unit_member_counts = ClinicalUnitViewSet.as_view({'get': 'members_counts'})

urlpatterns = [
    path('units/<uuid:pk>/staff/counts/', unit_staff_counts, name='clinical-unit-staff-counts'),
    path('units/<uuid:pk>/members/counts/', unit_member_counts, name='clinical-unit-members-counts'),
    path(
        'departments/<uuid:department_id>/rotation-rules/',
        RotationRuleViewSet.as_view({'get': 'list', 'post': 'create'}),
        name='department-rotation-rules'
    ),
    path(
        'rotation-rules/<uuid:pk>/',
        RotationRuleViewSet.as_view({'get': 'retrieve', 'patch': 'partial_update', 'delete': 'destroy'}),
        name='rotation-rule-detail'
    ),
    path(
        'departments/<uuid:department_id>/roster/',
        RosterEntryViewSet.as_view({'get': 'list', 'post': 'create'}),
        name='department-roster'
    ),
    path(
        'departments/<uuid:department_id>/roster/generate/',
        RosterEntryViewSet.as_view({'post': 'generate'}),
        name='department-roster-generate'
    ),
    path(
        'departments/<uuid:department_id>/roster/bulk/',
        RosterEntryViewSet.as_view({'post': 'bulk'}),
        name='department-roster-bulk'
    ),
    path(
        'departments/<uuid:department_id>/roster/import/',
        RosterEntryViewSet.as_view({'post': 'import_csv'}),
        name='department-roster-import'
    ),
    path(
        'departments/<uuid:department_id>/roster/publish/',
        RosterEntryViewSet.as_view({'post': 'publish'}),
        name='department-roster-publish'
    ),
    path(
        'departments/<uuid:department_id>/roster/clear/',
        RosterEntryViewSet.as_view({'post': 'clear'}),
        name='department-roster-clear'
    ),
    path(
        'departments/<uuid:department_id>/roster/print/',
        RosterEntryViewSet.as_view({'get': 'print_roster'}),
        name='department-roster-print'
    ),
    path(
        'roster/<uuid:pk>/',
        RosterEntryViewSet.as_view({'get': 'retrieve', 'patch': 'partial_update', 'delete': 'destroy'}),
        name='roster-entry-detail'
    ),
    path(
        'roster/<uuid:pk>/override/',
        RosterEntryViewSet.as_view({'post': 'override'}),
        name='roster-entry-override'
    ),
    path(
        'departments/<uuid:department_id>/on-duty/',
        RosterEntryViewSet.as_view({'get': 'on_duty_department'}),
        name='department-on-duty'
    ),
    path(
        'on-duty/',
        RosterEntryViewSet.as_view({'get': 'on_duty'}),
        name='on-duty'
    ),
    # Validation rules endpoints
    path(
        'departments/<uuid:department_id>/validation-rules/',
        RosterValidationRuleViewSet.as_view({'get': 'list', 'post': 'create'}),
        name='department-validation-rules'
    ),
    path(
        'validation-rules/<uuid:pk>/',
        RosterValidationRuleViewSet.as_view({'get': 'retrieve', 'patch': 'partial_update', 'delete': 'destroy'}),
        name='validation-rule-detail'
    ),
    path(
        'validation-rules/templates/',
        RosterValidationRuleViewSet.as_view({'get': 'templates'}),
        name='validation-rule-templates'
    ),
    path(
        'validation-rules/validate/',
        RosterValidationRuleViewSet.as_view({'post': 'validate_roster'}),
        name='validate-roster'
    ),
    path('', include(router.urls)),
]
