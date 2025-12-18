"""
Factory Boy factories for core app models.

Provides test data factories for:
- Facility
- Department
"""
import factory
from factory import fuzzy
from django.contrib.auth import get_user_model

from apps.core.models import Facility, Department

User = get_user_model()


class FacilityFactory(factory.django.DjangoModelFactory):
    """Factory for creating Facility instances."""

    class Meta:
        model = Facility

    code = factory.Sequence(lambda n: f"FAC{n:03d}")
    name = factory.Faker('company')
    facility_type = 'hospital'

    # Location
    address = factory.Faker('street_address')
    city = factory.Faker('city')
    region = factory.Faker('state')
    country = 'Ghana'
    postal_code = factory.Faker('numerify', text='#####')  # Simple 5-digit postal code

    # Contact
    phone = factory.Faker('numerify', text='+233-##-###-####')  # Ghana phone format, max 16 chars
    email = factory.LazyAttribute(lambda o: f"contact@{o.code.lower()}.hospital.gh")

    # Settings
    timezone = 'Africa/Accra'
    currency = 'GHS'

    # Operational
    is_active = True
    is_headquarters = False

    @factory.lazy_attribute
    def created_by(self):
        """Get or create an admin user for audit fields."""
        admin = User.objects.filter(user_type='admin', is_active=True).first()
        if not admin:
            from apps.users.tests.factories import AdminUserFactory
            admin = AdminUserFactory()
        return admin

    @factory.lazy_attribute
    def updated_by(self):
        """Same as created_by for initial creation."""
        return self.created_by


class HeadquartersFacilityFactory(FacilityFactory):
    """Factory for creating headquarters/main facility."""

    code = factory.Sequence(lambda n: f"MAIN{n:03d}")
    name = factory.Sequence(lambda n: f"Main Hospital {n}")
    is_headquarters = True
    facility_type = 'hospital'


class ClinicFacilityFactory(FacilityFactory):
    """Factory for creating clinic facilities."""

    facility_type = 'clinic'
    name = factory.LazyAttribute(lambda o: f"{o.city} Health Clinic")


class BranchFacilityFactory(FacilityFactory):
    """Factory for creating branch facilities."""

    parent_facility = factory.SubFactory(HeadquartersFacilityFactory)
    is_headquarters = False

    @factory.lazy_attribute
    def name(self):
        return f"{self.city} Branch"


class DepartmentFactory(factory.django.DjangoModelFactory):
    """Factory for creating Department instances."""

    class Meta:
        model = Department

    facility = factory.SubFactory(FacilityFactory)
    code = factory.Sequence(lambda n: f"DEPT{n:03d}")
    name = factory.Faker('random_element', elements=[
        'Emergency', 'Outpatient', 'Inpatient', 'Laboratory',
        'Pharmacy', 'Radiology', 'Surgery', 'Pediatrics',
        'Cardiology', 'Neurology', 'Orthopedics', 'Internal Medicine'
    ])
    description = factory.Faker('sentence')
    department_type = 'clinical'

    # Contact
    phone_extension = factory.Sequence(lambda n: f"{100 + n}")
    email = factory.LazyAttribute(
        lambda o: f"{o.code.lower()}@{o.facility.code.lower()}.hospital.gh"
    )
    location = factory.Faker('random_element', elements=[
        'Building A, Floor 1', 'Building A, Floor 2', 'Building B, Ground',
        'Main Building, Floor 3', 'East Wing', 'West Wing'
    ])

    # Operational
    is_active = True
    is_clinical = True
    accepts_referrals = True
    operates_24_hours = False

    @factory.lazy_attribute
    def created_by(self):
        """Get or create an admin user for audit fields."""
        admin = User.objects.filter(user_type='admin', is_active=True).first()
        if not admin:
            from apps.users.tests.factories import AdminUserFactory
            admin = AdminUserFactory()
        return admin

    @factory.lazy_attribute
    def updated_by(self):
        """Same as created_by for initial creation."""
        return self.created_by


class EmergencyDepartmentFactory(DepartmentFactory):
    """Factory for creating emergency departments."""

    code = factory.Sequence(lambda n: f"EMERG{n:03d}")
    name = factory.Sequence(lambda n: f"Emergency Department {n}" if n > 0 else "Emergency Department")
    department_type = 'emergency'
    operates_24_hours = True
    is_clinical = True
    accepts_referrals = True


class PharmacyDepartmentFactory(DepartmentFactory):
    """Factory for creating pharmacy departments."""

    code = factory.Sequence(lambda n: f"PHARM{n:03d}")
    name = factory.Sequence(lambda n: f"Pharmacy {n}" if n > 0 else "Pharmacy")
    department_type = 'pharmacy'
    is_clinical = False
    accepts_referrals = False


class LaboratoryDepartmentFactory(DepartmentFactory):
    """Factory for creating laboratory departments."""

    code = factory.Sequence(lambda n: f"LAB{n:03d}")
    name = factory.Sequence(lambda n: f"Laboratory {n}" if n > 0 else "Laboratory")
    department_type = 'laboratory'
    is_clinical = False
    accepts_referrals = False


class OutpatientDepartmentFactory(DepartmentFactory):
    """Factory for creating outpatient departments."""

    code = factory.Sequence(lambda n: f"OPD{n:03d}")
    name = factory.Sequence(lambda n: f"Outpatient Department {n}" if n > 0 else "Outpatient Department")
    department_type = 'clinical'
    is_clinical = True
    accepts_referrals = True
    operates_24_hours = False


# =============================================================================
# Batch Creation Helpers
# =============================================================================

def create_facility_with_departments():
    """
    Create a facility with standard departments.

    Returns:
        tuple: (facility, dict of departments)
    """
    facility = FacilityFactory()

    departments = {
        'emergency': EmergencyDepartmentFactory(facility=facility),
        'opd': OutpatientDepartmentFactory(facility=facility),
        'pharmacy': PharmacyDepartmentFactory(facility=facility),
        'laboratory': LaboratoryDepartmentFactory(facility=facility),
    }

    return facility, departments


def create_multi_facility_setup():
    """
    Create a multi-facility setup for testing.

    Returns:
        dict: {
            'headquarters': Facility,
            'branch': Facility,
            'clinic': Facility,
            'departments': dict of departments for headquarters
        }
    """
    headquarters = HeadquartersFacilityFactory()
    branch = BranchFacilityFactory(parent_facility=headquarters)
    clinic = ClinicFacilityFactory()

    # Create departments for headquarters
    departments = {
        'emergency': EmergencyDepartmentFactory(facility=headquarters),
        'opd': OutpatientDepartmentFactory(facility=headquarters),
        'pharmacy': PharmacyDepartmentFactory(facility=headquarters),
        'laboratory': LaboratoryDepartmentFactory(facility=headquarters),
    }

    return {
        'headquarters': headquarters,
        'branch': branch,
        'clinic': clinic,
        'departments': departments,
    }


def create_department_of_each_type(facility=None):
    """
    Create one department of each type for a facility.

    Args:
        facility: Optional facility to use. Creates one if not provided.

    Returns:
        tuple: (facility, dict of departments by type)
    """
    if facility is None:
        facility = FacilityFactory()

    department_types = [
        ('clinical', 'General Medicine'),
        ('diagnostic', 'Diagnostic Imaging'),
        ('surgical', 'General Surgery'),
        ('emergency', 'Emergency'),
        ('support', 'Patient Support'),
        ('administrative', 'Administration'),
        ('pharmacy', 'Pharmacy'),
        ('laboratory', 'Laboratory'),
        ('radiology', 'Radiology'),
        ('nursing', 'Nursing Services'),
    ]

    departments = {}
    for dept_type, name in department_types:
        departments[dept_type] = DepartmentFactory(
            facility=facility,
            code=dept_type.upper()[:10],
            name=name,
            department_type=dept_type,
            is_clinical=dept_type in ['clinical', 'emergency', 'surgical', 'nursing']
        )

    return facility, departments
