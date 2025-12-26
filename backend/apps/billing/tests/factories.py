"""
Factory Boy factories for billing app models.

Provides test data factories for:
- ServiceCategory
- Service
- ServicePrice
- InsuranceProvider
- InsurancePlan
- PatientInsurance
- Invoice
- InvoiceItem
- Payment
- Claim
- Receipt
"""
import factory
from factory.django import DjangoModelFactory
from django.utils import timezone
from decimal import Decimal
from datetime import timedelta

from apps.billing.models import (
    ServiceCategory, Service, ServicePrice,
    InsuranceProvider, InsurancePlan, PatientInsurance,
    Invoice, InvoiceItem, Payment, Claim, Receipt,
    BillingRule, FacilityBillingSettings,
)
from apps.users.tests.factories import UserFactory, PatientProfileFactory
from apps.core.tests.factories import FacilityFactory, DepartmentFactory


class ServiceCategoryFactory(DjangoModelFactory):
    """Factory for creating ServiceCategory instances."""

    class Meta:
        model = ServiceCategory

    name = factory.Sequence(lambda n: f"Service Category {n}")
    description = factory.Faker('sentence')
    is_active = True
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class ServiceFactory(DjangoModelFactory):
    """Factory for creating Service instances."""

    class Meta:
        model = Service

    name = factory.Sequence(lambda n: f"Service {n}")
    description = factory.Faker('sentence')
    category = factory.SubFactory(ServiceCategoryFactory)
    code = factory.Sequence(lambda n: f"SVC{n:04d}")
    base_price = factory.LazyFunction(lambda: Decimal('100.00'))
    tax_rate = factory.LazyFunction(lambda: Decimal('0.00'))
    is_active = True
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class ConsultationServiceFactory(ServiceFactory):
    """Factory for consultation services."""

    name = factory.Sequence(lambda n: f"Consultation {n}")
    code = factory.Sequence(lambda n: f"CONS{n:04d}")
    base_price = factory.LazyFunction(lambda: Decimal('150.00'))


class LabServiceFactory(ServiceFactory):
    """Factory for laboratory services."""

    name = factory.Sequence(lambda n: f"Lab Test {n}")
    code = factory.Sequence(lambda n: f"LAB{n:04d}")
    base_price = factory.LazyFunction(lambda: Decimal('50.00'))


class ServicePriceFactory(DjangoModelFactory):
    """Factory for creating ServicePrice instances (price overrides)."""

    class Meta:
        model = ServicePrice

    service = factory.SubFactory(ServiceFactory)
    facility = None  # Null = all facilities
    department = None  # Null = all departments
    price_context = 'regular'
    price = factory.LazyFunction(lambda: Decimal('120.00'))
    tax_rate = None  # Use service default
    effective_from = factory.LazyFunction(lambda: timezone.now().date())
    effective_until = None  # Indefinite
    is_active = True
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class FacilityServicePriceFactory(ServicePriceFactory):
    """Factory for facility-specific prices."""

    facility = factory.SubFactory(FacilityFactory)


class DepartmentServicePriceFactory(ServicePriceFactory):
    """Factory for department-specific prices."""

    department = factory.SubFactory(DepartmentFactory)


class EmergencyServicePriceFactory(ServicePriceFactory):
    """Factory for emergency context prices."""

    price_context = 'emergency'
    price = factory.LazyFunction(lambda: Decimal('200.00'))  # Higher for emergency


class AfterHoursServicePriceFactory(ServicePriceFactory):
    """Factory for after-hours context prices."""

    price_context = 'after_hours'
    price = factory.LazyFunction(lambda: Decimal('180.00'))  # Higher for after-hours


class WeekendServicePriceFactory(ServicePriceFactory):
    """Factory for weekend context prices."""

    price_context = 'weekend'
    price = factory.LazyFunction(lambda: Decimal('160.00'))


class InsuranceProviderFactory(DjangoModelFactory):
    """Factory for creating InsuranceProvider instances."""

    class Meta:
        model = InsuranceProvider

    name = factory.Sequence(lambda n: f"Insurance Provider {n}")
    code = factory.Sequence(lambda n: f"INS{n:03d}")
    contact_person = factory.Faker('name')
    email = factory.LazyAttribute(lambda obj: f"contact@{obj.code.lower()}.com")
    phone = factory.Faker('numerify', text='+233-##-###-####')
    address = factory.Faker('address')
    is_active = True
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class InsurancePlanFactory(DjangoModelFactory):
    """Factory for creating InsurancePlan instances."""

    class Meta:
        model = InsurancePlan

    provider = factory.SubFactory(InsuranceProviderFactory)
    name = factory.Sequence(lambda n: f"Plan {n}")
    code = factory.Sequence(lambda n: f"PLN{n:03d}")
    description = factory.Faker('sentence')
    coverage_percentage = factory.LazyFunction(lambda: Decimal('80.00'))
    annual_limit = factory.LazyFunction(lambda: Decimal('100000.00'))
    is_active = True
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class PatientInsuranceFactory(DjangoModelFactory):
    """Factory for creating PatientInsurance instances."""

    class Meta:
        model = PatientInsurance

    patient = factory.SubFactory(PatientProfileFactory)
    plan = factory.SubFactory(InsurancePlanFactory)
    policy_number = factory.Sequence(lambda n: f"POL{n:08d}")
    valid_from = factory.LazyFunction(lambda: timezone.now().date() - timedelta(days=365))
    valid_until = factory.LazyFunction(lambda: timezone.now().date() + timedelta(days=365))
    is_active = True
    notes = factory.Faker('sentence')
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class InvoiceFactory(DjangoModelFactory):
    """Factory for creating Invoice instances."""

    class Meta:
        model = Invoice

    invoice_number = factory.Sequence(lambda n: f"INV{n:08d}")
    patient = factory.SubFactory(PatientProfileFactory)
    invoice_date = factory.LazyFunction(lambda: timezone.now().date())
    due_date = factory.LazyFunction(lambda: timezone.now().date() + timedelta(days=30))
    subtotal = factory.LazyFunction(lambda: Decimal('0.00'))
    tax_amount = factory.LazyFunction(lambda: Decimal('0.00'))
    discount_amount = factory.LazyFunction(lambda: Decimal('0.00'))
    total_amount = factory.LazyFunction(lambda: Decimal('0.00'))
    insurance_amount = factory.LazyFunction(lambda: Decimal('0.00'))
    patient_responsibility = factory.LazyFunction(lambda: Decimal('0.00'))
    status = 'draft'
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class InvoiceItemFactory(DjangoModelFactory):
    """Factory for creating InvoiceItem instances."""

    class Meta:
        model = InvoiceItem

    invoice = factory.SubFactory(InvoiceFactory)
    service = factory.SubFactory(ServiceFactory)
    quantity = 1
    unit_price = factory.LazyAttribute(lambda obj: obj.service.base_price)
    tax_rate = factory.LazyAttribute(lambda obj: obj.service.tax_rate)
    discount_percentage = factory.LazyFunction(lambda: Decimal('0.00'))
    description = factory.Faker('sentence')
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class PaymentFactory(DjangoModelFactory):
    """Factory for creating Payment instances."""

    class Meta:
        model = Payment

    invoice = factory.SubFactory(InvoiceFactory)
    payment_date = factory.LazyFunction(lambda: timezone.now().date())
    amount = factory.LazyFunction(lambda: Decimal('100.00'))
    payment_method = 'cash'
    reference_number = factory.Sequence(lambda n: f"REF{n:08d}")
    notes = factory.Faker('sentence')
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class ClaimFactory(DjangoModelFactory):
    """Factory for creating Claim instances."""

    class Meta:
        model = Claim

    claim_number = factory.Sequence(lambda n: f"CLM{n:08d}")
    invoice = factory.SubFactory(InvoiceFactory)
    submission_date = factory.LazyFunction(lambda: timezone.now().date())
    status = 'draft'
    claimed_amount = factory.LazyFunction(lambda: Decimal('100.00'))
    approved_amount = factory.LazyFunction(lambda: Decimal('0.00'))
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class ReceiptFactory(DjangoModelFactory):
    """Factory for creating Receipt instances."""

    class Meta:
        model = Receipt

    receipt_number = factory.Sequence(lambda n: f"RCP{n:08d}")
    payment = factory.SubFactory(PaymentFactory)
    receipt_date = factory.LazyFunction(lambda: timezone.now().date())
    notes = factory.Faker('sentence')
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


# =============================================================================
# Billing Rules Factories
# =============================================================================

class BillingRuleFactory(DjangoModelFactory):
    """Factory for creating BillingRule instances."""

    class Meta:
        model = BillingRule

    name = factory.Sequence(lambda n: f"Billing Rule {n}")
    code = factory.Sequence(lambda n: f"RULE{n:04d}")
    description = factory.Faker('sentence')
    facility = None  # Null = global rule
    rule_type = 'senior_discount'
    parameters = factory.LazyFunction(lambda: {'min_age': 65})
    adjustment_type = 'percentage'
    adjustment_value = factory.LazyFunction(lambda: Decimal('10.00'))
    priority = 100
    is_stackable = False
    applies_to_insurance = True
    applies_to_self_pay = True
    effective_from = factory.LazyFunction(lambda: timezone.now().date())
    effective_until = None
    is_active = True
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class SeniorDiscountRuleFactory(BillingRuleFactory):
    """Factory for senior citizen discount rules."""

    name = factory.Sequence(lambda n: f"Senior Discount {n}")
    code = factory.Sequence(lambda n: f"SENIOR{n:04d}")
    rule_type = 'senior_discount'
    parameters = factory.LazyFunction(lambda: {'min_age': 65})
    adjustment_type = 'percentage'
    adjustment_value = factory.LazyFunction(lambda: Decimal('10.00'))


class ChildDiscountRuleFactory(BillingRuleFactory):
    """Factory for child discount rules."""

    name = factory.Sequence(lambda n: f"Child Discount {n}")
    code = factory.Sequence(lambda n: f"CHILD{n:04d}")
    rule_type = 'child_discount'
    parameters = factory.LazyFunction(lambda: {'max_age': 12})
    adjustment_type = 'percentage'
    adjustment_value = factory.LazyFunction(lambda: Decimal('15.00'))


class StaffDiscountRuleFactory(BillingRuleFactory):
    """Factory for staff/employee discount rules."""

    name = factory.Sequence(lambda n: f"Staff Discount {n}")
    code = factory.Sequence(lambda n: f"STAFF{n:04d}")
    rule_type = 'staff_discount'
    parameters = factory.LazyFunction(lambda: {})
    adjustment_type = 'percentage'
    adjustment_value = factory.LazyFunction(lambda: Decimal('20.00'))


class BulkDiscountRuleFactory(BillingRuleFactory):
    """Factory for bulk/quantity discount rules."""

    name = factory.Sequence(lambda n: f"Bulk Discount {n}")
    code = factory.Sequence(lambda n: f"BULK{n:04d}")
    rule_type = 'bulk_discount'
    parameters = factory.LazyFunction(lambda: {'min_quantity': 5})
    adjustment_type = 'percentage'
    adjustment_value = factory.LazyFunction(lambda: Decimal('10.00'))


class EmergencySurchargeRuleFactory(BillingRuleFactory):
    """Factory for emergency surcharge rules."""

    name = factory.Sequence(lambda n: f"Emergency Surcharge {n}")
    code = factory.Sequence(lambda n: f"EMERG{n:04d}")
    rule_type = 'emergency_surcharge'
    parameters = factory.LazyFunction(lambda: {})
    adjustment_type = 'percentage'
    adjustment_value = factory.LazyFunction(lambda: Decimal('25.00'))


class AfterHoursSurchargeRuleFactory(BillingRuleFactory):
    """Factory for after-hours surcharge rules."""

    name = factory.Sequence(lambda n: f"After Hours Surcharge {n}")
    code = factory.Sequence(lambda n: f"AFTER{n:04d}")
    rule_type = 'after_hours_surcharge'
    parameters = factory.LazyFunction(lambda: {})
    adjustment_type = 'percentage'
    adjustment_value = factory.LazyFunction(lambda: Decimal('15.00'))


class WeekendSurchargeRuleFactory(BillingRuleFactory):
    """Factory for weekend surcharge rules."""

    name = factory.Sequence(lambda n: f"Weekend Surcharge {n}")
    code = factory.Sequence(lambda n: f"WKND{n:04d}")
    rule_type = 'weekend_surcharge'
    parameters = factory.LazyFunction(lambda: {'include_saturday': True, 'include_sunday': True})
    adjustment_type = 'percentage'
    adjustment_value = factory.LazyFunction(lambda: Decimal('10.00'))


class HolidaySurchargeRuleFactory(BillingRuleFactory):
    """Factory for holiday surcharge rules."""

    name = factory.Sequence(lambda n: f"Holiday Surcharge {n}")
    code = factory.Sequence(lambda n: f"HOLIDAY{n:04d}")
    rule_type = 'holiday_surcharge'
    parameters = factory.LazyFunction(lambda: {})
    adjustment_type = 'percentage'
    adjustment_value = factory.LazyFunction(lambda: Decimal('20.00'))


class MinimumChargeRuleFactory(BillingRuleFactory):
    """Factory for minimum charge rules."""

    name = factory.Sequence(lambda n: f"Minimum Charge {n}")
    code = factory.Sequence(lambda n: f"MINCHG{n:04d}")
    rule_type = 'minimum_charge'
    parameters = factory.LazyFunction(lambda: {'minimum_amount': 50})
    adjustment_type = 'fixed'
    adjustment_value = factory.LazyFunction(lambda: Decimal('0.00'))


class FacilityBillingSettingsFactory(DjangoModelFactory):
    """Factory for creating FacilityBillingSettings instances."""

    class Meta:
        model = FacilityBillingSettings

    facility = factory.SubFactory(FacilityFactory)

    # Invoice settings
    invoice_prefix = 'INV'
    invoice_number_length = 8
    invoice_due_days = 30
    invoice_footer_text = factory.Faker('sentence')

    # Tax settings
    default_tax_rate = factory.LazyFunction(lambda: Decimal('0.00'))
    tax_inclusive_pricing = False
    tax_registration_number = ''

    # Payment settings
    accepted_payment_methods = factory.LazyFunction(
        lambda: ['cash', 'credit_card', 'mobile_money']
    )
    default_payment_method = 'cash'

    # Auto-billing settings
    auto_generate_invoice_on_encounter_complete = True
    auto_generate_invoice_on_discharge = True
    require_deposit_for_admission = False
    minimum_deposit_amount = factory.LazyFunction(lambda: Decimal('0.00'))
    minimum_deposit_percentage = factory.LazyFunction(lambda: Decimal('0.00'))

    # Operating hours
    regular_hours_start = '08:00'
    regular_hours_end = '17:00'
    weekend_hours_start = None
    weekend_hours_end = None

    # Holiday configuration
    holidays = factory.LazyFunction(lambda: [])

    # Currency settings
    currency_override = ''
    decimal_places = 2
    rounding_method = 'round_half_up'

    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


# =============================================================================
# Helper Functions
# =============================================================================

def create_service_with_price_overrides(
    base_price=Decimal('100.00'),
    facility=None,
    department=None,
    include_contexts=('regular', 'emergency', 'after_hours', 'weekend')
):
    """
    Create a service with price overrides for different contexts.

    Args:
        base_price: Base price for the service
        facility: Optional facility for facility-specific prices
        department: Optional department for department-specific prices
        include_contexts: Tuple of contexts to create overrides for

    Returns:
        tuple: (service, dict of ServicePrice by context)
    """
    service = ServiceFactory(base_price=base_price)

    context_multipliers = {
        'regular': Decimal('1.0'),
        'after_hours': Decimal('1.5'),
        'weekend': Decimal('1.3'),
        'holiday': Decimal('1.5'),
        'emergency': Decimal('2.0'),
    }

    prices = {}
    for context in include_contexts:
        multiplier = context_multipliers.get(context, Decimal('1.0'))
        price_override = ServicePriceFactory(
            service=service,
            facility=facility,
            department=department,
            price_context=context,
            price=base_price * multiplier
        )
        prices[context] = price_override

    return service, prices


def create_multi_facility_pricing_setup():
    """
    Create a complete multi-facility pricing setup for testing.

    Returns:
        dict with facilities, departments, services, and price overrides
    """
    from apps.core.tests.factories import (
        FacilityFactory, DepartmentFactory,
        HeadquartersFacilityFactory
    )

    # Create facilities
    hq = HeadquartersFacilityFactory()
    branch = FacilityFactory(parent_facility=hq)

    # Create departments
    hq_emergency = DepartmentFactory(facility=hq, code='EMERG', name='Emergency', department_type='emergency')
    hq_opd = DepartmentFactory(facility=hq, code='OPD', name='Outpatient', department_type='clinical')
    branch_opd = DepartmentFactory(facility=branch, code='OPD', name='Outpatient', department_type='clinical')

    # Create services
    consultation = ConsultationServiceFactory(base_price=Decimal('100.00'))
    lab_test = LabServiceFactory(base_price=Decimal('50.00'))

    # Create price overrides
    prices = {
        # Global emergency override
        'consultation_emergency': ServicePriceFactory(
            service=consultation,
            price_context='emergency',
            price=Decimal('200.00')
        ),
        # HQ-specific regular price
        'consultation_hq': ServicePriceFactory(
            service=consultation,
            facility=hq,
            price_context='regular',
            price=Decimal('120.00')
        ),
        # HQ Emergency department specific
        'consultation_hq_emerg': ServicePriceFactory(
            service=consultation,
            facility=hq,
            department=hq_emergency,
            price_context='regular',
            price=Decimal('150.00')
        ),
        # Branch-specific price
        'consultation_branch': ServicePriceFactory(
            service=consultation,
            facility=branch,
            price_context='regular',
            price=Decimal('90.00')  # Lower at branch
        ),
    }

    return {
        'facilities': {'hq': hq, 'branch': branch},
        'departments': {
            'hq_emergency': hq_emergency,
            'hq_opd': hq_opd,
            'branch_opd': branch_opd
        },
        'services': {'consultation': consultation, 'lab_test': lab_test},
        'prices': prices
    }
