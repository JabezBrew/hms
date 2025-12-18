"""
Pytest configuration and fixtures for core app tests.
"""
import pytest
from django.core.cache import cache

from apps.core.tests.factories import (
    FacilityFactory,
    HeadquartersFacilityFactory,
    BranchFacilityFactory,
    DepartmentFactory,
    EmergencyDepartmentFactory,
    OutpatientDepartmentFactory,
    create_facility_with_departments,
    create_multi_facility_setup,
)


@pytest.fixture(autouse=True)
def clear_cache_before_each_test():
    """Clear cache before and after each test."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def facility():
    """Create a single test facility."""
    return FacilityFactory()


@pytest.fixture
def headquarters_facility():
    """Create a headquarters facility."""
    return HeadquartersFacilityFactory()


@pytest.fixture
def branch_facility(headquarters_facility):
    """Create a branch facility linked to headquarters."""
    return BranchFacilityFactory(parent_facility=headquarters_facility)


@pytest.fixture
def department(facility):
    """Create a department for the test facility."""
    return DepartmentFactory(facility=facility)


@pytest.fixture
def emergency_department(facility):
    """Create an emergency department."""
    return EmergencyDepartmentFactory(facility=facility)


@pytest.fixture
def opd_department(facility):
    """Create an outpatient department."""
    return OutpatientDepartmentFactory(facility=facility)


@pytest.fixture
def facility_with_departments():
    """Create a facility with standard departments."""
    return create_facility_with_departments()


@pytest.fixture
def multi_facility_setup():
    """Create a multi-facility setup with headquarters, branch, and clinic."""
    return create_multi_facility_setup()
