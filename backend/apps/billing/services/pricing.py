"""
Pricing Service for multi-facility price resolution.

Implements a fallback chain for resolving service prices based on:
- Facility
- Department
- Time context (regular, after_hours, weekend, holiday, emergency)
- Effective date

Resolution order (most specific to least specific):
1. Facility + Department + Context specific
2. Facility + Context specific
3. Department + Context specific (any facility)
4. Context specific (any facility/dept)
5. Service.base_price (global default)
"""

from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from typing import Optional, Tuple
import logging

from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from apps.core.metadata_cache import get_or_set_metadata, invalidate_metadata_prefix, metadata_cache_key
from apps.billing.models import Service, ServicePrice

logger = logging.getLogger(__name__)


@dataclass
class ResolvedPrice:
    """
    Result of price resolution containing price details and source information.
    """
    price: Decimal
    tax_rate: Decimal
    total_price: Decimal
    source: str  # 'override' or 'base'
    service_price_id: Optional[str] = None  # UUID of the ServicePrice if override
    context: str = 'regular'
    facility_code: Optional[str] = None
    department_code: Optional[str] = None

    @property
    def is_override(self) -> bool:
        return self.source == 'override'


class PricingService:
    """
    Service for resolving prices with multi-facility fallback chain.

    Usage:
        price = PricingService.get_price(
            service=consultation_service,
            facility=main_hospital,
            department=emergency_dept,
            context='emergency',
            date=today
        )

        # Bulk resolution for multiple services
        prices = PricingService.get_prices_bulk(
            services=[service1, service2],
            facility=main_hospital,
            context='regular'
        )
    """

    # Cache timeout in seconds (5 minutes)
    CACHE_TIMEOUT = 300

    @classmethod
    def get_price(
        cls,
        service: Service,
        facility=None,
        department=None,
        context: str = 'regular',
        target_date: Optional[date] = None
    ) -> ResolvedPrice:
        """
        Resolve price with fallback chain.

        Args:
            service: The Service to get price for
            facility: Optional Facility for facility-specific pricing
            department: Optional Department for department-specific pricing
            context: Price context ('regular', 'after_hours', 'weekend', 'holiday', 'emergency')
            target_date: Date to check effective pricing (defaults to today)

        Returns:
            ResolvedPrice with resolved price details

        Resolution order:
        1. Facility + Department + Context specific
        2. Facility + Context specific
        3. Department + Context specific (any facility)
        4. Context specific (any facility/dept)
        5. Service.base_price (global default)
        """
        if target_date is None:
            target_date = timezone.now().date()

        # Build cache key
        cache_key = cls._build_cache_key(
            service.id,
            facility.id if facility else None,
            department.id if department else None,
            context,
            target_date
        )

        return get_or_set_metadata(
            cache_key,
            lambda: cls._resolve_price(
                service=service,
                facility=facility,
                department=department,
                context=context,
                target_date=target_date,
            ),
            timeout=cls.CACHE_TIMEOUT,
        )

    @classmethod
    def get_prices_bulk(
        cls,
        services: list,
        facility=None,
        department=None,
        context: str = 'regular',
        target_date: Optional[date] = None
    ) -> dict:
        """
        Resolve prices for multiple services efficiently.

        Args:
            services: List of Service objects
            facility: Optional Facility
            department: Optional Department
            context: Price context
            target_date: Date to check effective pricing

        Returns:
            Dict mapping service.id -> ResolvedPrice
        """
        if target_date is None:
            target_date = timezone.now().date()

        results = {}
        uncached_services = []

        # Check cache for each service
        for service in services:
            cache_key = cls._build_cache_key(
                service.id,
                facility.id if facility else None,
                department.id if department else None,
                context,
                target_date
            )
            cached = cache.get(cache_key)
            if cached is not None:
                results[service.id] = cached
                continue
            uncached_services.append(service)

        # Resolve uncached services
        if uncached_services:
            # Batch fetch all applicable price overrides
            service_ids = [s.id for s in uncached_services]
            overrides = cls._fetch_applicable_overrides(
                service_ids=service_ids,
                facility=facility,
                department=department,
                context=context,
                target_date=target_date
            )

            # Resolve each uncached service
            for service in uncached_services:
                resolved = cls._resolve_from_overrides(
                    service=service,
                    overrides=overrides.get(service.id, []),
                    facility=facility,
                    department=department,
                    context=context
                )
                results[service.id] = resolved

                # Cache the result
                cache_key = cls._build_cache_key(
                    service.id,
                    facility.id if facility else None,
                    department.id if department else None,
                    context,
                    target_date
                )
                cache.set(cache_key, resolved, cls.CACHE_TIMEOUT)

        return results

    @classmethod
    def determine_context(
        cls,
        timestamp: Optional[datetime] = None,
        is_emergency: bool = False,
        facility_settings=None
    ) -> str:
        """
        Determine the appropriate price context based on time and settings.

        Args:
            timestamp: The datetime to check (defaults to now)
            is_emergency: Whether this is an emergency service
            facility_settings: Optional FacilityBillingSettings for operating hours

        Returns:
            Price context string ('regular', 'after_hours', 'weekend', 'holiday', 'emergency')
        """
        if is_emergency:
            return 'emergency'

        if timestamp is None:
            timestamp = timezone.now()

        # Check if it's a weekend
        if timestamp.weekday() >= 5:  # Saturday = 5, Sunday = 6
            return 'weekend'

        # Check operating hours if facility settings provided
        if facility_settings:
            current_time = timestamp.time()
            regular_start = facility_settings.regular_hours_start
            regular_end = facility_settings.regular_hours_end

            if not (regular_start <= current_time <= regular_end):
                return 'after_hours'

        # Default to regular
        return 'regular'

    @classmethod
    def invalidate_cache(
        cls,
        service_id=None,
        facility_id=None,
        department_id=None
    ):
        """
        Invalidate pricing cache.

        Call this when:
        - ServicePrice is created/updated/deleted
        - Service base_price changes
        """
        # Try pattern-based deletion first (Redis, etc.)
        # Fall back to clearing all cache if not supported
        invalidate_metadata_prefix('service_price:')

        logger.info(
            f"Invalidated pricing cache: service={service_id}, "
            f"facility={facility_id}, department={department_id}"
        )

    # ==========================================================================
    # Private Methods
    # ==========================================================================

    @classmethod
    def _build_cache_key(
        cls,
        service_id,
        facility_id,
        department_id,
        context,
        target_date
    ) -> str:
        """Build a cache key for price lookup."""
        return (
            metadata_cache_key(
                'service_price',
                service_id,
                facility_id or 'all',
                department_id or 'all',
                context,
                target_date.isoformat(),
            )
        )

    @classmethod
    def _resolve_price(
        cls,
        service: Service,
        facility,
        department,
        context: str,
        target_date: date
    ) -> ResolvedPrice:
        """
        Resolve price through the fallback chain.
        """
        # Build query for applicable overrides
        base_query = Q(
            service=service,
            is_active=True,
            effective_from__lte=target_date
        ) & (
            Q(effective_until__isnull=True) | Q(effective_until__gte=target_date)
        )

        # Fallback chain queries (ordered by specificity)
        queries = []

        # 1. Facility + Department + Context (most specific)
        if facility and department:
            queries.append(
                base_query & Q(
                    facility=facility,
                    department=department,
                    price_context=context
                )
            )

        # 2. Facility + Context
        if facility:
            queries.append(
                base_query & Q(
                    facility=facility,
                    department__isnull=True,
                    price_context=context
                )
            )

        # 3. Department + Context (any facility)
        if department:
            queries.append(
                base_query & Q(
                    facility__isnull=True,
                    department=department,
                    price_context=context
                )
            )

        # 4. Context only (global override for context)
        queries.append(
            base_query & Q(
                facility__isnull=True,
                department__isnull=True,
                price_context=context
            )
        )

        # Try each query in order
        for query in queries:
            override = ServicePrice.objects.filter(query).order_by('-effective_from').first()
            if override:
                return ResolvedPrice(
                    price=override.price,
                    tax_rate=override.effective_tax_rate,
                    total_price=override.total_price,
                    source='override',
                    service_price_id=str(override.id),
                    context=context,
                    facility_code=override.facility.code if override.facility else None,
                    department_code=override.department.code if override.department else None
                )

        # 5. Fall back to service base price
        return ResolvedPrice(
            price=service.base_price,
            tax_rate=service.tax_rate,
            total_price=service.total_price,
            source='base',
            context=context,
            facility_code=facility.code if facility else None,
            department_code=department.code if department else None
        )

    @classmethod
    def _fetch_applicable_overrides(
        cls,
        service_ids: list,
        facility,
        department,
        context: str,
        target_date: date
    ) -> dict:
        """
        Fetch all applicable overrides for multiple services.

        Returns dict mapping service_id -> list of ServicePrice objects
        """
        base_query = Q(
            service_id__in=service_ids,
            is_active=True,
            effective_from__lte=target_date,
            price_context=context
        ) & (
            Q(effective_until__isnull=True) | Q(effective_until__gte=target_date)
        )

        # Build scope filter
        scope_query = Q()

        if facility and department:
            scope_query |= Q(facility=facility, department=department)
        if facility:
            scope_query |= Q(facility=facility, department__isnull=True)
        if department:
            scope_query |= Q(facility__isnull=True, department=department)
        scope_query |= Q(facility__isnull=True, department__isnull=True)

        overrides = ServicePrice.objects.filter(
            base_query & scope_query
        ).select_related('facility', 'department').order_by('-effective_from')

        # Group by service_id
        result = {}
        for override in overrides:
            if override.service_id not in result:
                result[override.service_id] = []
            result[override.service_id].append(override)

        return result

    @classmethod
    def _resolve_from_overrides(
        cls,
        service: Service,
        overrides: list,
        facility,
        department,
        context: str
    ) -> ResolvedPrice:
        """
        Resolve price from a list of pre-fetched overrides.
        """
        # Score overrides by specificity
        def specificity_score(override):
            score = 0
            if override.facility_id and facility and override.facility_id == facility.id:
                score += 2
            if override.department_id and department and override.department_id == department.id:
                score += 1
            return score

        # Sort by specificity (highest first)
        sorted_overrides = sorted(overrides, key=specificity_score, reverse=True)

        # Return the most specific match
        if sorted_overrides:
            override = sorted_overrides[0]
            return ResolvedPrice(
                price=override.price,
                tax_rate=override.effective_tax_rate,
                total_price=override.total_price,
                source='override',
                service_price_id=str(override.id),
                context=context,
                facility_code=override.facility.code if override.facility else None,
                department_code=override.department.code if override.department else None
            )

        # Fall back to base price
        return ResolvedPrice(
            price=service.base_price,
            tax_rate=service.tax_rate,
            total_price=service.total_price,
            source='base',
            context=context,
            facility_code=facility.code if facility else None,
            department_code=department.code if department else None
        )
