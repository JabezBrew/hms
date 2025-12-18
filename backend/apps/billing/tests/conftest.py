"""
Pytest configuration and fixtures for billing app tests.
"""
import pytest
from django.core.cache import cache

from apps.billing.tests.factories import (
    ServiceFactory, ServiceCategoryFactory, ServicePriceFactory,
    InsuranceProviderFactory, InsurancePlanFactory, PatientInsuranceFactory,
    InvoiceFactory, InvoiceItemFactory, PaymentFactory, ClaimFactory,
    BillingRuleFactory, SeniorDiscountRuleFactory, ChildDiscountRuleFactory,
    StaffDiscountRuleFactory, BulkDiscountRuleFactory, EmergencySurchargeRuleFactory,
    AfterHoursSurchargeRuleFactory, WeekendSurchargeRuleFactory, HolidaySurchargeRuleFactory,
    MinimumChargeRuleFactory, FacilityBillingSettingsFactory,
    create_multi_facility_pricing_setup
)
from apps.core.tests.factories import FacilityFactory, DepartmentFactory


@pytest.fixture(autouse=True)
def clear_cache_before_each_test():
    """Clear cache before and after each test."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def service_category():
    """Create a service category."""
    return ServiceCategoryFactory()


@pytest.fixture
def service(service_category):
    """Create a service."""
    return ServiceFactory(category=service_category)


@pytest.fixture
def facility():
    """Create a facility."""
    return FacilityFactory()


@pytest.fixture
def department(facility):
    """Create a department."""
    return DepartmentFactory(facility=facility)


@pytest.fixture
def service_with_overrides(service, facility, department):
    """Create a service with price overrides at various levels."""
    from decimal import Decimal
    from apps.billing.tests.factories import ServicePriceFactory

    overrides = {
        'global': ServicePriceFactory(
            service=service,
            facility=None,
            department=None,
            price_context='regular',
            price=Decimal('110.00')
        ),
        'facility': ServicePriceFactory(
            service=service,
            facility=facility,
            department=None,
            price_context='regular',
            price=Decimal('120.00')
        ),
        'department': ServicePriceFactory(
            service=service,
            facility=facility,
            department=department,
            price_context='regular',
            price=Decimal('130.00')
        ),
        'emergency': ServicePriceFactory(
            service=service,
            facility=None,
            department=None,
            price_context='emergency',
            price=Decimal('200.00')
        ),
    }

    return service, overrides


@pytest.fixture
def multi_facility_setup():
    """Create a complete multi-facility pricing setup."""
    return create_multi_facility_pricing_setup()


@pytest.fixture
def insurance_setup():
    """Create an insurance setup with provider, plan, and patient insurance."""
    from apps.users.tests.factories import PatientProfileFactory

    provider = InsuranceProviderFactory()
    plan = InsurancePlanFactory(provider=provider)
    patient = PatientProfileFactory()
    patient_insurance = PatientInsuranceFactory(patient=patient, plan=plan)

    return {
        'provider': provider,
        'plan': plan,
        'patient': patient,
        'patient_insurance': patient_insurance
    }


@pytest.fixture
def invoice_setup(insurance_setup, service):
    """Create an invoice setup with items."""
    invoice = InvoiceFactory(
        patient=insurance_setup['patient'],
        patient_insurance=insurance_setup['patient_insurance']
    )
    item = InvoiceItemFactory(invoice=invoice, service=service)

    return {
        'invoice': invoice,
        'item': item,
        **insurance_setup
    }
