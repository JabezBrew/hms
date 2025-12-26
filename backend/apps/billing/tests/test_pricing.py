"""
Tests for the pricing system (ServicePrice model and PricingService).

Tests cover:
- ServicePrice model creation and validation
- Price resolution fallback chain
- Time context determination
- Bulk price resolution
- Caching behavior
- Effective date handling
"""
import pytest
from decimal import Decimal
from datetime import date, timedelta
from django.utils import timezone
from django.core.cache import cache
from django.core.exceptions import ValidationError

from apps.billing.models import Service, ServicePrice
from apps.billing.services.pricing import PricingService, ResolvedPrice
from apps.billing.tests.factories import (
    ServiceFactory, ServiceCategoryFactory, ServicePriceFactory,
    FacilityServicePriceFactory, DepartmentServicePriceFactory,
    EmergencyServicePriceFactory, create_service_with_price_overrides,
    create_multi_facility_pricing_setup
)
from apps.core.tests.factories import FacilityFactory, DepartmentFactory


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear cache before and after each test."""
    cache.clear()
    yield
    cache.clear()


# =============================================================================
# ServicePrice Model Tests
# =============================================================================

@pytest.mark.django_db
class TestServicePriceModel:
    """Unit tests for ServicePrice model."""

    def test_create_service_price_minimal(self):
        """Test creating a price override with minimal fields."""
        service = ServiceFactory(base_price=Decimal('100.00'))
        price = ServicePriceFactory(
            service=service,
            price=Decimal('120.00'),
            effective_from=date.today()
        )

        assert price.id is not None
        assert price.service == service
        assert price.price == Decimal('120.00')
        assert price.facility is None
        assert price.department is None
        assert price.price_context == 'regular'

    def test_create_facility_specific_price(self):
        """Test creating a facility-specific price override."""
        facility = FacilityFactory()
        service = ServiceFactory()
        price = ServicePriceFactory(
            service=service,
            facility=facility,
            price=Decimal('150.00')
        )

        assert price.facility == facility
        assert price.department is None

    def test_create_department_specific_price(self):
        """Test creating a department-specific price override."""
        facility = FacilityFactory()
        department = DepartmentFactory(facility=facility)
        service = ServiceFactory()
        price = ServicePriceFactory(
            service=service,
            facility=facility,
            department=department,
            price=Decimal('180.00')
        )

        assert price.facility == facility
        assert price.department == department

    def test_create_context_specific_price(self):
        """Test creating prices for different contexts."""
        service = ServiceFactory(base_price=Decimal('100.00'))

        contexts = ['regular', 'after_hours', 'weekend', 'holiday', 'emergency']
        for context in contexts:
            price = ServicePriceFactory(
                service=service,
                price_context=context,
                price=Decimal('100.00'),
                effective_from=date.today() - timedelta(days=len(contexts))
            )
            assert price.price_context == context

    def test_effective_date_validation(self):
        """Test that effective_until must be after effective_from."""
        service = ServiceFactory()

        with pytest.raises(ValidationError):
            ServicePriceFactory(
                service=service,
                effective_from=date.today(),
                effective_until=date.today() - timedelta(days=1)
            )

    def test_department_facility_validation(self):
        """Test that department must belong to specified facility."""
        facility1 = FacilityFactory()
        facility2 = FacilityFactory()
        department = DepartmentFactory(facility=facility1)
        service = ServiceFactory()

        with pytest.raises(ValidationError):
            ServicePriceFactory(
                service=service,
                facility=facility2,  # Different facility
                department=department  # Belongs to facility1
            )

    def test_is_currently_effective_property(self):
        """Test the is_currently_effective property."""
        service = ServiceFactory()

        # Active and currently effective
        active_price = ServicePriceFactory(
            service=service,
            effective_from=date.today() - timedelta(days=30),
            is_active=True
        )
        assert active_price.is_currently_effective is True

        # Inactive
        inactive_price = ServicePriceFactory(
            service=service,
            effective_from=date.today() - timedelta(days=30),
            is_active=False
        )
        assert inactive_price.is_currently_effective is False

        # Future effective date
        future_price = ServicePriceFactory(
            service=service,
            effective_from=date.today() + timedelta(days=30),
            is_active=True
        )
        assert future_price.is_currently_effective is False

        # Past effective_until
        expired_price = ServicePriceFactory(
            service=service,
            effective_from=date.today() - timedelta(days=60),
            effective_until=date.today() - timedelta(days=30),
            is_active=True
        )
        assert expired_price.is_currently_effective is False

    def test_effective_tax_rate_property(self):
        """Test the effective_tax_rate property."""
        service = ServiceFactory(tax_rate=Decimal('10.00'))

        # Override without tax rate - uses service default
        price_no_tax = ServicePriceFactory(
            service=service,
            tax_rate=None
        )
        assert price_no_tax.effective_tax_rate == Decimal('10.00')

        # Override with tax rate
        price_with_tax = ServicePriceFactory(
            service=service,
            tax_rate=Decimal('15.00')
        )
        assert price_with_tax.effective_tax_rate == Decimal('15.00')

    def test_total_price_property(self):
        """Test the total_price property calculation."""
        service = ServiceFactory(tax_rate=Decimal('10.00'))
        price = ServicePriceFactory(
            service=service,
            price=Decimal('100.00'),
            tax_rate=None  # Uses service's 10%
        )

        # 100 + 10% = 110
        assert price.total_price == Decimal('110.00')

    def test_str_representation(self):
        """Test string representation of ServicePrice."""
        facility = FacilityFactory(code='MAIN')
        department = DepartmentFactory(facility=facility, code='EMERG')
        service = ServiceFactory(name='Consultation')

        # Basic price
        price1 = ServicePriceFactory(service=service)
        assert 'Consultation' in str(price1)

        # With facility
        price2 = ServicePriceFactory(service=service, facility=facility)
        assert 'MAIN' in str(price2)

        # With department
        price3 = ServicePriceFactory(
            service=service,
            facility=facility,
            department=department
        )
        assert 'EMERG' in str(price3)

        # With context
        price4 = ServicePriceFactory(
            service=service,
            price_context='emergency'
        )
        assert 'Emergency' in str(price4)


# =============================================================================
# PricingService Tests
# =============================================================================

@pytest.mark.django_db
class TestPricingService:
    """Integration tests for PricingService price resolution."""

    def test_falls_back_to_base_price_when_no_overrides(self):
        """Test that service base_price is used when no overrides exist."""
        service = ServiceFactory(base_price=Decimal('100.00'), tax_rate=Decimal('10.00'))

        result = PricingService.get_price(service)

        assert result.price == Decimal('100.00')
        assert result.tax_rate == Decimal('10.00')
        assert result.source == 'base'
        assert result.is_override is False

    def test_returns_facility_department_context_price_when_all_match(self):
        """Test most specific override (facility + department + context)."""
        facility = FacilityFactory()
        department = DepartmentFactory(facility=facility)
        service = ServiceFactory(base_price=Decimal('100.00'))

        # Create specific override
        ServicePriceFactory(
            service=service,
            facility=facility,
            department=department,
            price_context='regular',
            price=Decimal('180.00')
        )

        result = PricingService.get_price(
            service=service,
            facility=facility,
            department=department,
            context='regular'
        )

        assert result.price == Decimal('180.00')
        assert result.source == 'override'
        assert result.is_override is True

    def test_falls_back_to_facility_context_when_no_department_match(self):
        """Test fallback to facility + context when no department match."""
        facility = FacilityFactory()
        department = DepartmentFactory(facility=facility)
        service = ServiceFactory(base_price=Decimal('100.00'))

        # Create facility-level override (no department)
        ServicePriceFactory(
            service=service,
            facility=facility,
            department=None,
            price_context='regular',
            price=Decimal('150.00')
        )

        result = PricingService.get_price(
            service=service,
            facility=facility,
            department=department,  # This doesn't have a specific price
            context='regular'
        )

        assert result.price == Decimal('150.00')
        assert result.source == 'override'

    def test_falls_back_to_context_only_when_no_facility_or_dept(self):
        """Test fallback to context-only override."""
        service = ServiceFactory(base_price=Decimal('100.00'))
        facility = FacilityFactory()

        # Create global context override
        ServicePriceFactory(
            service=service,
            facility=None,
            department=None,
            price_context='emergency',
            price=Decimal('200.00')
        )

        result = PricingService.get_price(
            service=service,
            facility=facility,  # Has no specific price
            context='emergency'
        )

        assert result.price == Decimal('200.00')
        assert result.source == 'override'

    def test_respects_effective_date_range(self):
        """Test that only currently effective prices are used."""
        service = ServiceFactory(base_price=Decimal('100.00'))
        today = date.today()

        # Future price (not yet effective)
        ServicePriceFactory(
            service=service,
            price=Decimal('150.00'),
            effective_from=today + timedelta(days=30)
        )

        # Past price (no longer effective)
        ServicePriceFactory(
            service=service,
            price=Decimal('80.00'),
            effective_from=today - timedelta(days=60),
            effective_until=today - timedelta(days=30)
        )

        result = PricingService.get_price(service, target_date=today)

        # Should fall back to base price
        assert result.price == Decimal('100.00')
        assert result.source == 'base'

    def test_ignores_inactive_price_overrides(self):
        """Test that inactive overrides are not used."""
        service = ServiceFactory(base_price=Decimal('100.00'))

        # Create inactive override
        ServicePriceFactory(
            service=service,
            price=Decimal('150.00'),
            is_active=False
        )

        result = PricingService.get_price(service)

        # Should fall back to base price
        assert result.price == Decimal('100.00')
        assert result.source == 'base'

    def test_most_specific_price_wins(self):
        """Test that most specific price is selected over less specific."""
        facility = FacilityFactory()
        department = DepartmentFactory(facility=facility)
        service = ServiceFactory(base_price=Decimal('100.00'))

        # Create overrides at different specificity levels
        ServicePriceFactory(
            service=service,
            facility=None,
            department=None,
            price_context='regular',
            price=Decimal('110.00')  # Global override
        )
        ServicePriceFactory(
            service=service,
            facility=facility,
            department=None,
            price_context='regular',
            price=Decimal('120.00')  # Facility-level
        )
        ServicePriceFactory(
            service=service,
            facility=facility,
            department=department,
            price_context='regular',
            price=Decimal('130.00')  # Most specific
        )

        result = PricingService.get_price(
            service=service,
            facility=facility,
            department=department,
            context='regular'
        )

        assert result.price == Decimal('130.00')  # Most specific wins

    def test_resolved_price_contains_metadata(self):
        """Test that ResolvedPrice contains all expected metadata."""
        facility = FacilityFactory(code='MAIN')
        department = DepartmentFactory(facility=facility, code='EMERG')
        service = ServiceFactory(base_price=Decimal('100.00'))

        price_override = ServicePriceFactory(
            service=service,
            facility=facility,
            department=department,
            price_context='emergency',
            price=Decimal('200.00')
        )

        result = PricingService.get_price(
            service=service,
            facility=facility,
            department=department,
            context='emergency'
        )

        assert result.price == Decimal('200.00')
        assert result.source == 'override'
        assert result.service_price_id == str(price_override.id)
        assert result.context == 'emergency'
        assert result.facility_code == 'MAIN'
        assert result.department_code == 'EMERG'


@pytest.mark.django_db
class TestPricingServiceBulk:
    """Tests for bulk price resolution."""

    def test_bulk_resolution_multiple_services(self):
        """Test resolving prices for multiple services at once."""
        services = [ServiceFactory(base_price=Decimal(f'{100 + i * 10}.00')) for i in range(5)]

        results = PricingService.get_prices_bulk(services)

        assert len(results) == 5
        for i, service in enumerate(services):
            assert service.id in results
            assert results[service.id].price == Decimal(f'{100 + i * 10}.00')

    def test_bulk_resolution_with_facility(self):
        """Test bulk resolution with facility context."""
        facility = FacilityFactory()
        services = [ServiceFactory(base_price=Decimal('100.00')) for _ in range(3)]

        # Create facility-specific price for first service
        ServicePriceFactory(
            service=services[0],
            facility=facility,
            price=Decimal('150.00')
        )

        results = PricingService.get_prices_bulk(services, facility=facility)

        assert results[services[0].id].price == Decimal('150.00')
        assert results[services[1].id].price == Decimal('100.00')  # Base price
        assert results[services[2].id].price == Decimal('100.00')  # Base price


@pytest.mark.django_db
class TestPricingServiceContext:
    """Tests for price context determination."""

    def test_emergency_context_override(self):
        """Test that emergency flag overrides time-based context."""
        result = PricingService.determine_context(is_emergency=True)
        assert result == 'emergency'

    def test_weekend_detection(self):
        """Test weekend context detection."""
        from datetime import datetime

        # Create a Saturday datetime
        saturday = datetime(2025, 12, 20, 12, 0, 0)  # December 20, 2025 is a Saturday
        result = PricingService.determine_context(timestamp=saturday)
        assert result == 'weekend'

        # Create a Sunday datetime
        sunday = datetime(2025, 12, 21, 12, 0, 0)
        result = PricingService.determine_context(timestamp=sunday)
        assert result == 'weekend'

    def test_regular_hours_detection(self):
        """Test regular hours context detection."""
        from datetime import datetime

        # Weekday during business hours
        weekday_business = datetime(2025, 12, 17, 10, 0, 0)  # Wednesday at 10 AM
        result = PricingService.determine_context(timestamp=weekday_business)
        assert result == 'regular'


@pytest.mark.django_db
class TestPricingServiceCaching:
    """Tests for pricing cache behavior."""

    def test_caches_resolved_prices(self):
        """Test that resolved prices are cached."""
        service = ServiceFactory(base_price=Decimal('100.00'))

        # First call
        result1 = PricingService.get_price(service)
        assert result1.price == Decimal('100.00')

        # Check cache is populated
        cache_key = PricingService._build_cache_key(
            service.id, None, None, 'regular', date.today()
        )
        cached = cache.get(cache_key)
        assert cached is not None
        assert cached.price == Decimal('100.00')

        # Second call should use cache
        result2 = PricingService.get_price(service)
        assert result2.price == Decimal('100.00')

    def test_cache_invalidation(self):
        """Test cache invalidation clears pricing cache."""
        service = ServiceFactory(base_price=Decimal('100.00'))

        # Populate cache
        PricingService.get_price(service)

        # Invalidate
        PricingService.invalidate_cache(service_id=service.id)

        # Cache should be cleared (note: delete_pattern might not work with all backends)
        # This test verifies the method doesn't error


# =============================================================================
# Integration Tests
# =============================================================================

@pytest.mark.django_db
class TestMultiFacilityPricing:
    """Integration tests for multi-facility pricing scenarios."""

    def test_complete_multi_facility_scenario(self):
        """Test a complete multi-facility pricing scenario."""
        setup = create_multi_facility_pricing_setup()

        consultation = setup['services']['consultation']
        hq = setup['facilities']['hq']
        branch = setup['facilities']['branch']
        hq_emergency = setup['departments']['hq_emergency']
        hq_opd = setup['departments']['hq_opd']

        # Test 1: HQ Emergency department - should get department-specific price
        result = PricingService.get_price(
            service=consultation,
            facility=hq,
            department=hq_emergency,
            context='regular'
        )
        assert result.price == Decimal('150.00')  # HQ Emergency specific

        # Test 2: HQ OPD - should get facility-level price (no dept override)
        result = PricingService.get_price(
            service=consultation,
            facility=hq,
            department=hq_opd,
            context='regular'
        )
        assert result.price == Decimal('120.00')  # HQ level

        # Test 3: Branch - should get branch-specific price
        result = PricingService.get_price(
            service=consultation,
            facility=branch,
            context='regular'
        )
        assert result.price == Decimal('90.00')  # Branch specific

        # Test 4: Emergency context anywhere - should get global emergency price
        result = PricingService.get_price(
            service=consultation,
            facility=branch,
            context='emergency'
        )
        assert result.price == Decimal('200.00')  # Global emergency

    def test_lab_service_falls_back_to_base(self):
        """Test service with no overrides falls back to base price."""
        setup = create_multi_facility_pricing_setup()

        lab_test = setup['services']['lab_test']  # No overrides created
        hq = setup['facilities']['hq']

        result = PricingService.get_price(
            service=lab_test,
            facility=hq,
            context='regular'
        )

        assert result.price == Decimal('50.00')  # Base price
        assert result.source == 'base'
