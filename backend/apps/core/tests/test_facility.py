"""
Tests for Facility and Department models.

Tests cover:
- Model creation and validation
- Facility hierarchy (parent/child)
- Department uniqueness constraints
- Caching behavior
- Integration with Ward and Staff models
"""
import pytest
from django.core.cache import cache
from django.db import IntegrityError

from apps.core.models import Facility, Department
from apps.core.cache_utils import facility_cache_key
from apps.core.tests.factories import (
    FacilityFactory,
    HeadquartersFacilityFactory,
    BranchFacilityFactory,
    ClinicFacilityFactory,
    DepartmentFactory,
    EmergencyDepartmentFactory,
    OutpatientDepartmentFactory,
    create_facility_with_departments,
    create_multi_facility_setup,
)


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear cache before each test."""
    cache.clear()
    yield
    cache.clear()


# =============================================================================
# Facility Model Tests
# =============================================================================

@pytest.mark.django_db
class TestFacilityModel:
    """Unit tests for Facility model."""

    def test_create_facility_with_required_fields(self):
        """Test creating a facility with minimum required fields."""
        facility = FacilityFactory()

        assert facility.id is not None
        assert facility.code is not None
        assert facility.name is not None
        assert facility.is_active is True
        assert facility.facility_type == 'hospital'

    def test_facility_code_is_uppercase(self):
        """Test that facility code is automatically uppercased."""
        facility = FacilityFactory(code='lowercase')
        assert facility.code == 'LOWERCASE'

    def test_facility_code_uniqueness(self):
        """Test that facility codes must be unique."""
        FacilityFactory(code='UNIQUE001')

        with pytest.raises(IntegrityError):
            FacilityFactory(code='UNIQUE001')

    def test_facility_hierarchy_parent_child(self):
        """Test facility parent-child relationship."""
        headquarters = HeadquartersFacilityFactory()
        branch = BranchFacilityFactory(parent_facility=headquarters)

        assert branch.parent_facility == headquarters
        assert branch in headquarters.child_facilities.all()
        assert branch.is_branch is True
        assert headquarters.is_branch is False

    def test_facility_full_address_property(self):
        """Test the full_address property formatting."""
        facility = FacilityFactory(
            address='123 Hospital Street',
            city='Accra',
            region='Greater Accra',
            postal_code='00233',
            country='Ghana'
        )

        assert '123 Hospital Street' in facility.full_address
        assert 'Accra' in facility.full_address
        assert 'Greater Accra' in facility.full_address
        assert '00233' in facility.full_address
        assert 'Ghana' in facility.full_address

    def test_facility_str_representation(self):
        """Test string representation of facility."""
        facility = FacilityFactory(name='Test Hospital', code='TEST')
        assert str(facility) == 'Test Hospital (TEST)'

    def test_facility_types(self):
        """Test creating facilities of different types."""
        hospital = FacilityFactory(facility_type='hospital')
        clinic = ClinicFacilityFactory()
        lab = FacilityFactory(facility_type='laboratory')

        assert hospital.facility_type == 'hospital'
        assert clinic.facility_type == 'clinic'
        assert lab.facility_type == 'laboratory'

    def test_headquarters_flag(self):
        """Test the headquarters flag."""
        hq = HeadquartersFacilityFactory()
        branch = BranchFacilityFactory()

        assert hq.is_headquarters is True
        assert branch.is_headquarters is False


@pytest.mark.django_db
class TestFacilityCaching:
    """Tests for Facility caching behavior."""

    def test_get_active_facilities_caches_results(self):
        """Test that get_active_facilities uses caching."""
        FacilityFactory.create_batch(3)

        # First call should hit the database
        facilities = Facility.get_active_facilities()
        assert len(facilities) >= 3

        # Second call should use cache
        cached = cache.get(facility_cache_key('active_facilities'))
        assert cached is not None

    def test_get_by_code_caches_result(self):
        """Test that get_by_code uses caching."""
        facility = FacilityFactory(code='TESTCACHE')

        # First call
        result = Facility.get_by_code('testcache')
        assert result == facility

        # Check cache
        cached = cache.get(facility_cache_key('facility_TESTCACHE'))
        assert cached is not None

    def test_facility_save_clears_cache(self):
        """Test that saving a facility clears relevant caches."""
        facility = FacilityFactory(code='CLEARCACHE')

        # Populate cache
        Facility.get_active_facilities()
        Facility.get_by_code('CLEARCACHE')

        assert cache.get(facility_cache_key('active_facilities')) is not None
        assert cache.get(facility_cache_key('facility_CLEARCACHE')) is not None

        # Save the facility
        facility.name = 'Updated Name'
        facility.save()

        # Cache should be cleared
        assert cache.get(facility_cache_key('active_facilities')) is None
        assert cache.get(facility_cache_key('facility_CLEARCACHE')) is None


# =============================================================================
# Department Model Tests
# =============================================================================

@pytest.mark.django_db
class TestDepartmentModel:
    """Unit tests for Department model."""

    def test_create_department(self):
        """Test creating a department."""
        department = DepartmentFactory()

        assert department.id is not None
        assert department.facility is not None
        assert department.code is not None
        assert department.name is not None

    def test_department_code_is_uppercase(self):
        """Test that department code is automatically uppercased."""
        department = DepartmentFactory(code='lowercase')
        assert department.code == 'LOWERCASE'

    def test_department_unique_code_per_facility(self):
        """Test that department codes are unique within a facility."""
        facility = FacilityFactory()
        DepartmentFactory(facility=facility, code='UNIQUE')

        with pytest.raises(IntegrityError):
            DepartmentFactory(facility=facility, code='UNIQUE')

    def test_department_allows_same_code_different_facilities(self):
        """Test that same department code can exist in different facilities."""
        facility1 = FacilityFactory()
        facility2 = FacilityFactory()

        dept1 = DepartmentFactory(facility=facility1, code='EMERG')
        dept2 = DepartmentFactory(facility=facility2, code='EMERG')

        assert dept1.code == dept2.code
        assert dept1.facility != dept2.facility

    def test_department_str_representation(self):
        """Test string representation of department."""
        facility = FacilityFactory(code='HOSP')
        department = DepartmentFactory(
            facility=facility,
            name='Emergency'
        )
        assert 'Emergency' in str(department)
        assert 'HOSP' in str(department)

    def test_department_full_name_property(self):
        """Test the full_name property."""
        facility = FacilityFactory(name='Main Hospital')
        department = DepartmentFactory(
            facility=facility,
            name='Emergency'
        )
        assert department.full_name == 'Emergency (Main Hospital)'

    def test_department_types(self):
        """Test creating departments of different types."""
        facility = FacilityFactory()

        clinical = DepartmentFactory(
            facility=facility,
            department_type='clinical'
        )
        pharmacy = DepartmentFactory(
            facility=facility,
            department_type='pharmacy'
        )
        lab = DepartmentFactory(
            facility=facility,
            department_type='laboratory'
        )

        assert clinical.department_type == 'clinical'
        assert pharmacy.department_type == 'pharmacy'
        assert lab.department_type == 'laboratory'

    def test_department_clinical_flags(self):
        """Test clinical department flags."""
        emergency = EmergencyDepartmentFactory()
        assert emergency.is_clinical is True
        assert emergency.operates_24_hours is True

        opd = OutpatientDepartmentFactory()
        assert opd.is_clinical is True
        assert opd.operates_24_hours is False

    def test_department_cascade_delete(self):
        """Test that deleting a facility cascades to departments."""
        facility = FacilityFactory()
        department = DepartmentFactory(facility=facility)
        dept_id = department.id

        facility.delete()

        assert not Department.objects.filter(id=dept_id).exists()


@pytest.mark.django_db
class TestDepartmentCaching:
    """Tests for Department caching behavior."""

    def test_get_facility_departments_caches_results(self):
        """Test that get_facility_departments uses caching."""
        facility = FacilityFactory()
        DepartmentFactory.create_batch(3, facility=facility)

        # First call
        departments = Department.get_facility_departments(facility.id)
        assert len(departments) >= 3

        # Check cache
        cache_key = facility_cache_key(f'facility_departments_{facility.id}')
        cached = cache.get(cache_key)
        assert cached is not None

    def test_department_save_clears_cache(self):
        """Test that saving a department clears facility cache."""
        facility = FacilityFactory()
        department = DepartmentFactory(facility=facility)

        # Populate cache
        Department.get_facility_departments(facility.id)
        cache_key = facility_cache_key(f'facility_departments_{facility.id}')
        assert cache.get(cache_key) is not None

        # Save department
        department.name = 'Updated Name'
        department.save()

        # Cache should be cleared
        assert cache.get(cache_key) is None


# =============================================================================
# Integration Tests
# =============================================================================

@pytest.mark.django_db
class TestFacilityIntegration:
    """Integration tests for multi-facility setup."""

    def test_create_facility_with_departments(self):
        """Test the helper function to create facility with departments."""
        facility, departments = create_facility_with_departments()

        assert facility is not None
        assert 'emergency' in departments
        assert 'opd' in departments
        assert 'pharmacy' in departments
        assert 'laboratory' in departments

        # Verify all departments belong to the facility
        for dept in departments.values():
            assert dept.facility == facility

    def test_create_multi_facility_setup(self):
        """Test the helper function to create multi-facility setup."""
        setup = create_multi_facility_setup()

        assert setup['headquarters'].is_headquarters is True
        assert setup['branch'].parent_facility == setup['headquarters']
        assert setup['clinic'].facility_type == 'clinic'

        # Verify departments belong to headquarters
        for dept in setup['departments'].values():
            assert dept.facility == setup['headquarters']

    def test_facility_queryset_filtering(self):
        """Test filtering facilities by various criteria."""
        FacilityFactory(facility_type='hospital', is_active=True)
        FacilityFactory(facility_type='clinic', is_active=True)
        FacilityFactory(facility_type='hospital', is_active=False)

        active_hospitals = Facility.objects.filter(
            facility_type='hospital',
            is_active=True
        )
        assert active_hospitals.count() >= 1

        all_hospitals = Facility.objects.filter(facility_type='hospital')
        assert all_hospitals.count() >= 2

    def test_department_queryset_filtering(self):
        """Test filtering departments by various criteria."""
        facility = FacilityFactory()
        DepartmentFactory(facility=facility, is_clinical=True, is_active=True)
        DepartmentFactory(facility=facility, is_clinical=False, is_active=True)
        DepartmentFactory(facility=facility, is_clinical=True, is_active=False)

        clinical_active = Department.objects.filter(
            facility=facility,
            is_clinical=True,
            is_active=True
        )
        assert clinical_active.count() >= 1


@pytest.mark.django_db
@pytest.mark.multi_facility
class TestWardDepartmentIntegration:
    """Test Ward-Department-Facility relationship (hierarchy: Facility → Department → Ward)."""

    def test_ward_belongs_to_department(self):
        """Test that ward is associated with a department."""
        from apps.wards.tests.factories import WardFactory

        facility = FacilityFactory()
        department = DepartmentFactory(facility=facility)
        ward = WardFactory(department=department)

        assert ward.department == department
        assert ward in department.wards.all()

    def test_ward_accesses_facility_via_department(self):
        """Test that ward can access facility through its department."""
        from apps.wards.tests.factories import WardFactory

        facility = FacilityFactory()
        department = DepartmentFactory(facility=facility)
        ward = WardFactory(department=department)

        # Ward accesses facility via the property
        assert ward.facility == facility

    def test_ward_department_nullable(self):
        """Test that ward department can be null (backward compatibility)."""
        from apps.wards.tests.factories import WardFactory

        ward = WardFactory(department=None)
        assert ward.department is None
        assert ward.facility is None  # Facility property returns None when department is None


@pytest.mark.django_db
@pytest.mark.multi_facility
class TestStaffFacilityIntegration:
    """Test Staff-Facility relationship."""

    def test_staff_assigned_to_facility(self):
        """Test that staff can be assigned to a facility."""
        from apps.users.tests.factories import StaffFactory

        facility = FacilityFactory()
        staff = StaffFactory(primary_facility=facility)

        assert staff.primary_facility == facility
        assert staff in facility.staff_members.all()

    def test_staff_facility_nullable(self):
        """Test that staff facility can be null (backward compatibility)."""
        from apps.users.tests.factories import StaffFactory

        staff = StaffFactory(primary_facility=None)
        assert staff.primary_facility is None
