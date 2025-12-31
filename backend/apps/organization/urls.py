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
    UnitLeadershipViewSet,
    StaffUnitAssignmentViewSet,
    UnitMemberAssignmentViewSet,
    CrossCoverageScheduleViewSet,
    UnitWardAllocationViewSet,
)

router = DefaultRouter()

# Configuration endpoints
router.register(r'unit-types', UnitTypeConfigViewSet, basename='unit-type')
router.register(r'leadership-roles', LeadershipRoleConfigViewSet, basename='leadership-role')
router.register(r'assignment-types', StaffAssignmentTypeConfigViewSet, basename='assignment-type')

# Core organization endpoints
router.register(r'units', ClinicalUnitViewSet, basename='clinical-unit')
router.register(r'leadership', UnitLeadershipViewSet, basename='leadership')
router.register(r'staff-assignments', StaffUnitAssignmentViewSet, basename='staff-assignment')
router.register(r'unit-members', UnitMemberAssignmentViewSet, basename='unit-member')
router.register(r'cross-coverage', CrossCoverageScheduleViewSet, basename='cross-coverage')
router.register(r'ward-allocations', UnitWardAllocationViewSet, basename='ward-allocation')

unit_staff_counts = ClinicalUnitViewSet.as_view({'get': 'staff_counts'})
unit_member_counts = ClinicalUnitViewSet.as_view({'get': 'members_counts'})

urlpatterns = [
    path('units/<uuid:pk>/staff/counts/', unit_staff_counts, name='clinical-unit-staff-counts'),
    path('units/<uuid:pk>/members/counts/', unit_member_counts, name='clinical-unit-members-counts'),
    path('', include(router.urls)),
]
