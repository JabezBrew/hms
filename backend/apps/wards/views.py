from rest_framework import viewsets, permissions, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction, models
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_page
from django.views.decorators.vary import vary_on_headers
from django.core.cache import cache
from django.db.models import Count, Avg, Sum, F, Q
from django.db.models.functions import TruncDate
from apps.core.pagination import StandardResultsSetPagination
from datetime import timedelta, datetime

# Cache key constants for invalidation
WARD_LIST_CACHE_KEY = 'ward_list_view'
WARD_ANALYTICS_CACHE_KEY = 'ward_analytics_view'

from .models import Ward, Bed, Admission, BedAllocationLog, WardTransfer, Encounter, WardSection, BedAmenity, WardStaffAssignment, StaffRole
from .serializers import (
    WardSerializer, WardListSerializer, WardSearchSerializer,
    BedSerializer, BedListSerializer,
    AdmissionSerializer, AdmissionListSerializer,
    BedAllocationLogSerializer,
    WardTransferSerializer, WardTransferListSerializer,
    AdmissionCreateSerializer, DischargeSerializer, TransferRequestSerializer,
    WardSectionSerializer, WardSectionListSerializer, BedAmenitySerializer,
    WardStaffAssignmentListSerializer, WardStaffAssignmentDetailSerializer,
    WardStaffAssignmentCreateSerializer, StaffRoleSerializer
)
from ..users.permissions import IsAdminOrOwner
from ..core.security import FacilityScopedPermission, check_clinical_access, get_user_facility
from apps.organization.services import UnitHierarchyService
from ..users.models import PatientProfile


def invalidate_ward_caches():
    """
    Invalidate all ward-related caches when ward data changes.
    Uses pattern deletion for Redis or clears specific keys.
    """
    import logging
    logger = logging.getLogger(__name__)

    try:
        # Try pattern deletion (works with django-redis)
        if hasattr(cache, 'delete_pattern'):
            # Clear ward list and analytics caches
            cache.delete_pattern('views.decorators.cache.cache_page.*ward*')
            cache.delete_pattern('views.decorators.cache.cache_header.*ward*')
            logger.debug("Ward caches invalidated via pattern deletion")
        else:
            # For non-Redis backends, we need a different approach
            # Since cache_page generates complex keys, we'll use cache versioning
            # by storing a version number that changes on write
            version_key = 'ward_cache_version'
            current_version = cache.get(version_key, 0)
            cache.set(version_key, current_version + 1, timeout=None)
            logger.debug(f"Ward cache version bumped to {current_version + 1}")
    except Exception as e:
        # If cache deletion fails, log but don't break the request
        logger.warning(f"Failed to invalidate ward cache: {e}")


class WardViewSet(viewsets.ModelViewSet):
    """
    API endpoint for wards.

    Note: List view caching removed due to cache invalidation complexity.
    For high-traffic deployments, consider implementing cache versioning
    or using a cache key that includes a version number stored in Redis.
    """
    queryset = Ward.objects.prefetch_related('beds').all()
    serializer_class = WardSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    filterset_fields = ['ward_type', 'is_active']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return WardListSerializer
        return WardSerializer

    def get_queryset(self):
        """
        Override get_queryset to add search functionality.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return Ward.objects.none()

        queryset = super().get_queryset().filter(department__facility=facility)
        search_query = self.request.query_params.get('search', None)

        if search_query:
            queryset = queryset.filter(
                models.Q(name__icontains=search_query) |
                models.Q(description__icontains=search_query) |
                models.Q(ward_type__icontains=search_query)
            )

        return queryset

    @action(detail=False, methods=['get'])
    def search(self, request):
        """
        Search wards by name for picker UIs.
        """
        query = (request.query_params.get('q') or '').strip()
        if not query or len(query) < 2:
            return Response(
                {"detail": "Search query must be at least 2 characters long."},
                status=status.HTTP_400_BAD_REQUEST
            )

        include_inactive = request.query_params.get('include_inactive') == 'true'
        ward_type = request.query_params.get('ward_type')
        department = request.query_params.get('department')

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        queryset = Ward.objects.select_related('department').filter(
            department__facility=facility
        )

        if not include_inactive:
            queryset = queryset.filter(is_active=True)

        if ward_type:
            queryset = queryset.filter(ward_type=ward_type)

        if department:
            queryset = queryset.filter(department_id=department)

        queryset = queryset.filter(name__icontains=query).order_by('name')

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = WardSearchSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)
        serializer = WardSearchSerializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)

    def perform_create(self, serializer):
        # Get values from validated_data before saving
        auto_create_beds = serializer.validated_data.pop('auto_create_beds', True)
        total_beds = serializer.validated_data.get('total_beds', 0)

        # Save the ward first
        ward = serializer.save(created_by=self.request.user, updated_by=self.request.user)

        # Check if beds should be automatically created
        if auto_create_beds and total_beds > 0:
            # Determine default bed type based on ward type
            ward_type = ward.ward_type
            default_bed_type = 'standard'

            if ward_type == 'icu':
                default_bed_type = 'icu'
            elif ward_type == 'maternity':
                default_bed_type = 'maternity'
            elif ward_type == 'pediatric':
                default_bed_type = 'pediatric'

            # Create beds automatically
            with transaction.atomic():
                # Calculate grid size (square root of total beds, rounded up)
                import math
                grid_size = math.ceil(math.sqrt(total_beds))

                for i in range(1, total_beds + 1):
                    # Calculate x,y coordinates in a square grid
                    # i-1 gives us 0-based index, then we calculate row and column
                    row = (i-1) // grid_size
                    col = (i-1) % grid_size

                    Bed.objects.create(
                        ward=ward,
                        bed_number=f"{i:03d}",  # Format: 001, 002, etc.
                        bed_type=default_bed_type,
                        status='available',
                        additional_rate=0.00,
                        location_x=col,  # Column in the grid
                        location_y=row,  # Row in the grid
                        created_by=self.request.user,
                        updated_by=self.request.user
                    )

        # Invalidate cache after creating ward
        invalidate_ward_caches()

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
        # Invalidate cache after updating ward
        invalidate_ward_caches()

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        # Invalidate cache after deleting ward
        invalidate_ward_caches()

    @action(detail=True, methods=['get'])
    def beds(self, request, pk=None):
        """
        Get all beds in a ward.
        """
        ward = self.get_object()
        beds = ward.beds.all().order_by('bed_number')  # Add ordering for consistency

        # Get all results without pagination
        page_size = request.query_params.get('page_size', None)
        if page_size == 'all':
            serializer = BedSerializer(beds, many=True)
            return Response(serializer.data)

        # Filter by status if provided
        status_filter = request.query_params.get('status', None)
        if status_filter:
            beds = beds.filter(status=status_filter)

        # Use pagination if page_size is not 'all'
        page = self.paginate_queryset(beds)
        if page is not None:
            serializer = BedSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = BedSerializer(beds, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def staff(self, request, pk=None):
        """
        Get staff assigned to this ward.

        Query Parameters:
        - category: Filter by role category ('nursing', 'medical', 'allied')

        Returns lightweight list optimized for dropdowns (nurse selection, etc.)
        """
        ward = self.get_object()
        category = request.query_params.get('category', None)

        # Get active staff assignments with optimized joins
        assignments = ward.staff_assignments.filter(
            is_active=True
        ).select_related(
            'practitioner__staff__user',
            'role'
        )

        # Filter by role category if provided
        if category:
            assignments = assignments.filter(role__category=category)

        serializer = WardStaffAssignmentListSerializer(assignments, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def admissions(self, request, pk=None):
        """
        Get all admissions in a ward.
        """
        ward = self.get_object()

        # Get all beds in the ward
        beds = ward.beds.all()

        # Get all admissions for these beds
        admissions = Admission.objects.filter(bed__in=beds)

        # Filter by status if provided
        status_filter = request.query_params.get('status', None)
        if status_filter:
            admissions = admissions.filter(status=status_filter)

        serializer = AdmissionSerializer(admissions, many=True)
        return Response(serializer.data)

    @method_decorator(vary_on_headers('X-Facility-Code'))
    @method_decorator(cache_page(60 * 15))  # Cache for 15 minutes
    @action(detail=False, methods=['get'])
    def analytics(self, request):
        """
        Get ward analytics and reports data.
        Supports filtering by ward_id, start_date, and end_date.

        OPTIMIZED: Uses database-level aggregation to reduce queries from ~200 to ~8-10.
        CACHED: Results cached for 15 minutes to reduce database load.
        """
        # Get query parameters
        ward_id = request.query_params.get('ward_id', None)
        start_date_str = request.query_params.get('start_date', None)
        end_date_str = request.query_params.get('end_date', None)

        # Parse dates
        if start_date_str:
            start_date = datetime.fromisoformat(start_date_str.replace('Z', '+00:00'))
        else:
            start_date = timezone.now() - timedelta(days=30)

        if end_date_str:
            end_date = datetime.fromisoformat(end_date_str.replace('Z', '+00:00'))
        else:
            end_date = timezone.now()

        # Build base queryset - prefetch beds for total_beds calculation
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        wards = Ward.objects.prefetch_related('beds').filter(
            department__facility=facility
        )
        if ward_id and ward_id != 'all':
            wards = wards.filter(id=ward_id)

        # Convert to list once to avoid multiple queries
        wards_list = list(wards)
        ward_ids = [w.id for w in wards_list]
        ward_bed_counts = {w.id: w.total_beds for w in wards_list}
        ward_names = {w.id: w.name for w in wards_list}

        # Initialize response data
        analytics_data = {
            'occupancy_trends': [],
            'length_of_stay': [],
            'ward_utilization': [],
            'admissions_by_ward': []
        }

        # ============================================================
        # OCCUPANCY TRENDS - Optimized with batch query
        # ============================================================
        start_date_only = start_date.date()
        end_date_only = end_date.date()

        # Fetch all relevant admissions in a single query
        all_admissions = list(Admission.objects.filter(
            bed__ward_id__in=ward_ids,
            admission_date__lte=end_date_only,
            status__in=['admitted', 'transferred']
        ).filter(
            Q(actual_discharge_date__isnull=True) |
            Q(actual_discharge_date__gt=start_date_only)
        ).select_related('bed__ward').values(
            'id', 'bed__ward_id', 'admission_date', 'actual_discharge_date'
        ))

        # Occupancy Trends Optimization
        # Pre-initialize counters for the date range
        daily_ward_occupancy = {}
        current_date_iter = start_date_only
        while current_date_iter <= end_date_only:
            daily_ward_occupancy[current_date_iter] = {ward_id: 0 for ward_id in ward_ids}
            current_date_iter += timedelta(days=1)

        # Iterate admissions once
        for adm in all_admissions:
            # Determine effective start/end for this admission
            adm_start = adm['admission_date'].date() if hasattr(adm['admission_date'], 'date') else adm['admission_date']
            disc_raw = adm['actual_discharge_date']
            adm_end = disc_raw.date() if disc_raw and hasattr(disc_raw, 'date') else disc_raw

            # Clamp admission range to query range
            # Range is [max(adm_start, start_date), min(discharge_date, end_date + 1))
            # Note: discharge_date is exclusive for occupancy count in the original logic:
            # "if adm_date <= current_date and (discharge_date is None or discharge_date > current_date)"
            
            range_start = max(adm_start, start_date_only)
            
            if adm_end:
                 # If discharged, we count up to the day BEFORE discharge
                 range_end = min(adm_end, end_date_only + timedelta(days=1))
            else:
                 # If active, count up to end of query range
                 range_end = end_date_only + timedelta(days=1)
            
            # Iterate the intersection days
            curr = range_start
            while curr < range_end:
                if curr in daily_ward_occupancy:
                    daily_ward_occupancy[curr][adm['bed__ward_id']] += 1
                curr += timedelta(days=1)

        # Build response from pre-calculated data
        current_date = start_date_only
        while current_date <= end_date_only:
            date_data = {
                'date': current_date.strftime('%b %d'),
                'full_date': current_date.isoformat()
            }
            
            ward_occupancy = daily_ward_occupancy.get(current_date, {})
            
            for ward_id in ward_ids:
                total_beds = ward_bed_counts.get(ward_id, 0)
                if total_beds > 0:
                    occupancy_rate = round((ward_occupancy.get(ward_id, 0) / total_beds) * 100, 1)
                    date_data[ward_names[ward_id]] = occupancy_rate

            # Calculate overall occupancy
            if len(wards_list) > 0:
                ward_rates = [date_data.get(ward_names[w_id], 0) for w_id in ward_ids]
                date_data['Overall'] = round(sum(ward_rates) / len(ward_rates), 1) if ward_rates else 0

            analytics_data['occupancy_trends'].append(date_data)
            current_date += timedelta(days=1)

        # ============================================================
        # LENGTH OF STAY DISTRIBUTION - Optimized with single aggregation query
        # ============================================================
        discharged_admissions_qs = Admission.objects.filter(
            actual_discharge_date__gte=start_date,
            actual_discharge_date__lte=end_date
        )
        if ward_id and ward_id != 'all':
            discharged_admissions_qs = discharged_admissions_qs.filter(bed__ward_id=ward_id)

        # Use database-level aggregation for LOS ranges using Case/When
        from django.db.models import Case, When, IntegerField, Value

        los_aggregation = discharged_admissions_qs.annotate(
            los_days=models.ExpressionWrapper(
                F('actual_discharge_date') - F('admission_date'),
                output_field=models.DurationField()
            )
        ).aggregate(
            total=Count('id'),
            range_1_3=Count('id', filter=Q(los_days__gte=timedelta(days=1), los_days__lte=timedelta(days=3))),
            range_4_7=Count('id', filter=Q(los_days__gte=timedelta(days=4), los_days__lte=timedelta(days=7))),
            range_8_14=Count('id', filter=Q(los_days__gte=timedelta(days=8), los_days__lte=timedelta(days=14))),
            range_15_30=Count('id', filter=Q(los_days__gte=timedelta(days=15), los_days__lte=timedelta(days=30))),
            range_31_plus=Count('id', filter=Q(los_days__gt=timedelta(days=30))),
        )

        total_admissions = los_aggregation['total'] or 0
        los_ranges = [
            ('range_1_3', '1-3 days'),
            ('range_4_7', '4-7 days'),
            ('range_8_14', '8-14 days'),
            ('range_15_30', '15-30 days'),
            ('range_31_plus', '31+ days'),
        ]

        for key, range_label in los_ranges:
            count = los_aggregation.get(key, 0) or 0
            percentage = round((count / total_admissions * 100), 1) if total_admissions > 0 else 0
            analytics_data['length_of_stay'].append({
                'range': range_label,
                'count': count,
                'percentage': percentage
            })

        # ============================================================
        # WARD UTILIZATION - Optimized with grouped aggregation
        # ============================================================
        ward_stats = Admission.objects.filter(
            bed__ward_id__in=ward_ids,
            admission_date__gte=start_date,
            admission_date__lte=end_date
        ).values('bed__ward_id').annotate(
            admission_count=Count('id'),
            avg_los=Avg(F('actual_discharge_date') - F('admission_date')),
            total_revenue=Sum('daily_rate'),  # Simplified - use daily_rate as proxy
        )

        ward_stats_dict = {ws['bed__ward_id']: ws for ws in ward_stats}
        days_in_range = (end_date.date() - start_date.date()).days + 1

        for ward in wards_list:
            total_beds = ward_bed_counts.get(ward.id, 0)
            stats = ward_stats_dict.get(ward.id, {})

            if total_beds > 0:
                admission_count = stats.get('admission_count', 0) or 0
                avg_los = stats.get('avg_los')
                avg_los_days = round(avg_los.total_seconds() / 86400, 1) if avg_los else 0

                # Estimate occupancy from admission count and avg LOS
                estimated_bed_days = admission_count * avg_los_days if avg_los_days else 0
                total_bed_days = total_beds * days_in_range
                occupancy_rate = round((estimated_bed_days / total_bed_days) * 100, 1) if total_bed_days > 0 else 0
                occupancy_rate = min(occupancy_rate, 100)  # Cap at 100%

                turnover_rate = round(admission_count / total_beds, 2) if total_beds > 0 else 0
                revenue = float(stats.get('total_revenue', 0) or 0) * avg_los_days  # Estimate total revenue

                analytics_data['ward_utilization'].append({
                    'ward': ward.name,
                    'occupancy_rate': occupancy_rate,
                    'turnover_rate': turnover_rate,
                    'avg_los': avg_los_days,
                    'bed_days': int(estimated_bed_days),
                    'revenue': revenue
                })

        # ============================================================
        # ADMISSIONS BY WARD - Optimized with single annotated query
        # ============================================================
        # Get admissions and discharges counts per ward in one query
        ward_admission_stats = Admission.objects.filter(
            bed__ward_id__in=ward_ids
        ).values('bed__ward_id').annotate(
            admissions=Count('id', filter=Q(
                admission_date__gte=start_date,
                admission_date__lte=end_date
            )),
            discharges=Count('id', filter=Q(
                actual_discharge_date__gte=start_date,
                actual_discharge_date__lte=end_date,
                status='discharged'
            ))
        )

        ward_admission_dict = {ws['bed__ward_id']: ws for ws in ward_admission_stats}

        # Get transfer counts per ward (both in and out) in two queries
        transfers_in_stats = WardTransfer.objects.filter(
            to_admission__bed__ward_id__in=ward_ids,
            transfer_time__gte=start_date,
            transfer_time__lte=end_date
        ).values('to_admission__bed__ward_id').annotate(count=Count('id'))
        transfers_in_dict = {t['to_admission__bed__ward_id']: t['count'] for t in transfers_in_stats}

        transfers_out_stats = WardTransfer.objects.filter(
            from_admission__bed__ward_id__in=ward_ids,
            transfer_time__gte=start_date,
            transfer_time__lte=end_date
        ).values('from_admission__bed__ward_id').annotate(count=Count('id'))
        transfers_out_dict = {t['from_admission__bed__ward_id']: t['count'] for t in transfers_out_stats}

        for ward in wards_list:
            stats = ward_admission_dict.get(ward.id, {})
            transfers_in = transfers_in_dict.get(ward.id, 0)
            transfers_out = transfers_out_dict.get(ward.id, 0)

            analytics_data['admissions_by_ward'].append({
                'ward': ward.name,
                'admissions': stats.get('admissions', 0) or 0,
                'discharges': stats.get('discharges', 0) or 0,
                'transfers': transfers_in + transfers_out
            })

        return Response(analytics_data)


class BedViewSet(viewsets.ModelViewSet):
    """
    API endpoint for beds.
    """
    queryset = Bed.objects.select_related('ward').prefetch_related('admissions').all()
    serializer_class = BedSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    filterset_fields = ['ward', 'status', 'bed_type']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return BedListSerializer
        return BedSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return Bed.objects.none()
        return super().get_queryset().filter(facility=facility)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        ward = serializer.validated_data.get('ward')
        if ward and ward.department and ward.department.facility_id != facility.id:
            raise PermissionDenied("Ward does not belong to the active facility.")
        serializer.save(created_by=self.request.user, updated_by=self.request.user, facility=facility)

    def perform_update(self, serializer):
        # Get the old status before saving
        if self.get_object():
            old_status = self.get_object().status
            new_status = serializer.validated_data.get('status', old_status)

            # Save the bed
            bed = serializer.save(updated_by=self.request.user)

            # If status changed, create a log entry
            if old_status != new_status:
                BedAllocationLog.objects.create(
                    bed=bed,
                    facility=bed.facility,
                    previous_status=old_status,
                    new_status=new_status,
                    created_by=self.request.user
                )
        else:
            serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['get'])
    def admissions(self, request, pk=None):
        """
        Get all admissions for a bed.
        """
        bed = self.get_object()
        admissions = bed.admissions.all()

        # Filter by status if provided
        status_filter = request.query_params.get('status', None)
        if status_filter:
            admissions = admissions.filter(status=status_filter)

        serializer = AdmissionSerializer(admissions, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def allocation_logs(self, request, pk=None):
        """
        Get all allocation logs for a bed.
        """
        bed = self.get_object()
        logs = bed.allocation_logs.all()
        serializer = BedAllocationLogSerializer(logs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def available(self, request):
        """
        Get available beds with optional filters.
        Filters: ward, section, gender (M/F for patient), accommodation_tier,
                 isolation_capable, amenities (comma-separated codes)
        """
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        queryset = Bed.objects.select_related('ward', 'section').prefetch_related('amenities').filter(
            status='available',
            facility=facility
        )

        # Filter by ward
        ward_id = request.query_params.get('ward')
        if ward_id:
            queryset = queryset.filter(ward_id=ward_id)

        # Filter by section
        section_id = request.query_params.get('section')
        if section_id:
            queryset = queryset.filter(section_id=section_id)

        # Filter by gender compatibility
        gender = request.query_params.get('gender')
        if gender:
            # Exclude beds in male-only sections if patient is female
            if gender == 'F':
                queryset = queryset.exclude(section__gender_restriction='male_only')
            # Exclude beds in female-only sections if patient is male
            elif gender == 'M':
                queryset = queryset.exclude(section__gender_restriction='female_only')

        # Filter by accommodation tier
        accommodation_tier = request.query_params.get('accommodation_tier')
        if accommodation_tier:
            queryset = queryset.filter(
                Q(accommodation_tier=accommodation_tier) |
                Q(accommodation_tier__isnull=True, section__accommodation_tier=accommodation_tier)
            )

        # Filter by isolation capability
        isolation_capable = request.query_params.get('isolation_capable')
        if isolation_capable and isolation_capable.lower() == 'true':
            queryset = queryset.filter(
                Q(is_isolation_capable=True) |
                Q(section__is_isolation_capable=True)
            )

        # Filter by required amenities
        amenities = request.query_params.get('amenities')
        if amenities:
            amenity_codes = [code.strip() for code in amenities.split(',')]
            for code in amenity_codes:
                queryset = queryset.filter(amenities__code=code)

        serializer = BedListSerializer(queryset, many=True)
        return Response(serializer.data)


class AdmissionViewSet(viewsets.ModelViewSet):
    """
    API endpoint for admissions.
    """
    queryset = Admission.objects.select_related(
        'patient',
        'patient__user',
        'bed',
        'bed__ward',
        'admitting_doctor',
        'admitting_doctor__staff',
        'admitting_doctor__staff__user'
    ).all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    filterset_fields = ['patient', 'bed', 'status', 'admission_type', 'is_billed']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return AdmissionCreateSerializer
        elif self.action == 'list':
            return AdmissionListSerializer
        return AdmissionSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return Admission.objects.none()
        queryset = super().get_queryset().filter(facility=facility)
        patient_id = self.request.query_params.get('patient') or self.request.query_params.get('patient_id')
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return queryset.none()
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_clinical_access(self.request.user, patient)
        return queryset

    def perform_create(self, serializer):
        with transaction.atomic():
            facility = get_user_facility(self.request)
            if not facility:
                raise PermissionDenied("Facility context is required.")
            # Get the bed from validated data
            bed = serializer.validated_data.get('bed')
            patient = serializer.validated_data.get('patient')
            if patient and patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            if patient:
                check_clinical_access(self.request.user, patient)
            if bed and bed.ward and bed.ward.department and bed.ward.department.facility_id != facility.id:
                raise PermissionDenied("Bed does not belong to the active facility.")

            # Create the admission with daily_rate set from the bed
            admission = serializer.save(
                created_by=self.request.user,
                updated_by=self.request.user,
                status='admitted',
                daily_rate=bed.total_rate if bed else 0,
                facility=facility
            )

            department_unit = None
            if admission.bed and admission.bed.ward and admission.bed.ward.department:
                department_unit = UnitHierarchyService.get_department_unit_for_core_department(
                    admission.bed.ward.department,
                    facility=facility
                )

            ed_encounter = getattr(serializer, '_ed_encounter', None)
            if ed_encounter:
                location = admission.bed.ward.name if admission.bed else "Waiting List"
                encounter_updates = {
                    'encounter_type': 'inpatient',
                    'status': 'in-progress' if admission.bed else 'planned',
                    'admission': admission,
                    'location': location,
                    'service_type': f"Admission to {location}",
                    'admission_source': 'emergency',
                    'updated_by': self.request.user,
                }
                if department_unit:
                    encounter_updates['department'] = department_unit
                for field, value in encounter_updates.items():
                    setattr(ed_encounter, field, value)
                ed_encounter.save(update_fields=list(encounter_updates.keys()) + ['updated_at'])

                admission.fhir_encounter_id = str(ed_encounter.id)
                admission.save(update_fields=['fhir_encounter_id'])

                try:
                    from .tasks import sync_encounter_to_fhir
                    sync_encounter_to_fhir.delay(str(ed_encounter.id))
                except Exception:
                    pass
            else:
                # Create local Encounter (syncs to FHIR in background)
                try:
                    encounter = Encounter.objects.create(
                        patient=admission.patient,
                        facility=facility,
                        practitioner=admission.admitting_doctor,
                        department=department_unit,
                        encounter_type='inpatient',
                        status='in-progress',
                        start_time=admission.admission_date,
                        service_type=f"Admission to {admission.bed.ward.name}",
                        location=admission.bed.ward.name,
                        admission=admission,
                        created_by=self.request.user,
                    )

                    # Update the admission with the encounter reference (for backwards compatibility)
                    admission.fhir_encounter_id = str(encounter.id)
                    admission.save(update_fields=['fhir_encounter_id'])

                    # Queue FHIR sync in background
                    try:
                        from .tasks import sync_encounter_to_fhir
                        sync_encounter_to_fhir.delay(str(encounter.id))
                    except Exception:
                        pass  # Celery not available, will sync later

                except Exception as e:
                    # Log the error but continue (we don't want to roll back the admission)
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.error(f"Failed to create Encounter for admission {admission.id}: {str(e)}", exc_info=True)

            # Store the previous bed status before updating
            previous_status = bed.status

            # Update the bed status to occupied
            bed.status = 'occupied'
            bed.updated_by = self.request.user
            bed.save()

            # Create a bed allocation log
            BedAllocationLog.objects.create(
                bed=admission.bed,
                facility=facility,
                previous_status=previous_status,
                new_status='occupied',
                admission=admission,
                created_by=self.request.user
            )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def discharge(self, request, pk=None):
        """
        Discharge a patient.
        """
        admission = self.get_object()

        # Validate the discharge
        serializer = DischargeSerializer(
            data=request.data, 
            context={'admission': admission}
        )

        if serializer.is_valid():
            with transaction.atomic():
                # Discharge the patient
                discharge_notes = serializer.validated_data.get('discharge_notes', '')
                admission.discharge_patient(discharge_notes)

                # Update local Encounter if linked
                if hasattr(admission, 'encounter') and admission.encounter:
                    try:
                        admission.encounter.finish(end_time=admission.actual_discharge_date)
                        # Queue FHIR sync in background
                        try:
                            from .tasks import sync_encounter_to_fhir
                            sync_encounter_to_fhir.delay(str(admission.encounter.id))
                        except Exception:
                            pass
                    except Exception as e:
                        import logging
                        logger = logging.getLogger(__name__)
                        logger.error(f"Failed to update Encounter: {str(e)}")

                # Create a bed allocation log
                BedAllocationLog.objects.create(
                    bed=admission.bed,
                    facility=admission.facility,
                    previous_status='occupied',
                    new_status='available',
                    admission=admission,
                    notes=f"Patient discharged: {discharge_notes}",
                    created_by=request.user
                )

                return Response({
                    "message": "Patient discharged successfully.",
                    "admission": AdmissionSerializer(admission).data
                })

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class BedAllocationLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for bed allocation logs (read-only).
    """
    queryset = BedAllocationLog.objects.all()
    serializer_class = BedAllocationLogSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    filterset_fields = ['bed', 'previous_status', 'new_status', 'created_by']
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return BedAllocationLog.objects.none()
        return BedAllocationLog.objects.select_related(
            'bed',
            'bed__ward',
            'bed__ward__department'
        ).filter(facility=facility)


class WardTransferViewSet(viewsets.ModelViewSet):
    """
    API endpoint for ward transfers.
    """
    queryset = WardTransfer.objects.all()
    serializer_class = WardTransferSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    filterset_fields = ['patient', 'from_admission', 'to_admission', 'created_by']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return WardTransferListSerializer
        return WardTransferSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return WardTransfer.objects.none()
        queryset = WardTransfer.objects.select_related(
            'from_admission',
            'from_admission__patient',
            'to_admission',
            'to_admission__patient'
        ).filter(facility=facility)
        patient_id = self.request.query_params.get('patient') or self.request.query_params.get('patient_id')
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return queryset.none()
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_clinical_access(self.request.user, patient)
        return queryset

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        from_admission = serializer.validated_data.get('from_admission')
        if from_admission and from_admission.patient.facility_id != facility.id:
            raise PermissionDenied("Admission does not belong to the active facility.")
        if from_admission:
            check_clinical_access(self.request.user, from_admission.patient)
        serializer.save(created_by=self.request.user, facility=facility)

    @action(detail=False, methods=['post'])
    def request_transfer(self, request):
        """
        Request a patient transfer between wards.
        """
        serializer = TransferRequestSerializer(data=request.data)

        if serializer.is_valid():
            with transaction.atomic():
                # Get validated data
                from_admission = serializer.validated_data['from_admission']
                to_bed = serializer.validated_data['to_bed']
                reason = serializer.validated_data['reason']
                facility = get_user_facility(request)
                if not facility:
                    raise PermissionDenied("Facility context is required.")
                if from_admission.patient.facility_id != facility.id:
                    raise PermissionDenied("Admission does not belong to the active facility.")
                check_clinical_access(request.user, from_admission.patient)
                if to_bed.ward.department and to_bed.ward.department.facility_id != facility.id:
                    raise PermissionDenied("Destination bed does not belong to the active facility.")

                # Try to get admitting practitioner from duty roster for destination ward
                dest_practitioner = from_admission.admitting_doctor
                primary_team = from_admission.primary_team
                try:
                    from apps.organization.services import DutyRosterService
                    from apps.organization.models import UnitWardAllocation

                    unit_allocation = UnitWardAllocation.objects.filter(
                        ward=to_bed.ward, is_active=True
                    ).select_related('unit').first()

                    if unit_allocation:
                        roster_practitioner = DutyRosterService.get_admitting_practitioner(
                            unit=unit_allocation.unit
                        )
                        if roster_practitioner:
                            dest_practitioner = roster_practitioner
                        primary_team = unit_allocation.unit
                except Exception:
                    pass  # Fall back to original practitioner

                # Create a new admission for the destination bed
                to_admission = Admission.objects.create(
                    patient=from_admission.patient,
                    bed=to_bed,
                    fhir_encounter_id=from_admission.fhir_encounter_id,  # Use the same encounter
                    admission_date=timezone.now(),
                    expected_discharge_date=from_admission.expected_discharge_date,
                    status='admitted',
                    admission_type=from_admission.admission_type,
                    admission_notes=f"Transferred from {from_admission.bed.ward.name}: {reason}",
                    daily_rate=to_bed.total_rate,
                    admitting_doctor=dest_practitioner,
                    primary_team=primary_team,
                    created_by=request.user,
                    updated_by=request.user,
                    facility=facility
                )

                # Create the transfer record
                transfer = WardTransfer.objects.create(
                    patient=from_admission.patient,
                    from_admission=from_admission,
                    to_admission=to_admission,
                    reason=reason,
                    created_by=request.user,
                    facility=facility
                )

                # Update bed statuses
                source_bed = from_admission.bed
                source_bed.status = 'available'
                source_bed.save(update_fields=['status', 'updated_at'])

                to_bed.status = 'occupied'
                to_bed.save(update_fields=['status', 'updated_at'])

                # Update source admission status
                from_admission.status = 'transferred'
                from_admission.save(update_fields=['status', 'updated_at'])

                # Create bed allocation logs
                BedAllocationLog.objects.create(
                    bed=source_bed,
                    facility=facility,
                    previous_status='occupied',
                    new_status='available',
                    admission=from_admission,
                    notes=f"Patient transferred to {to_bed.ward.name}",
                    created_by=request.user
                )

                BedAllocationLog.objects.create(
                    bed=to_bed,
                    facility=facility,
                    previous_status='available',
                    new_status='occupied',
                    admission=to_admission,
                    notes=f"Patient transferred from {source_bed.ward.name}",
                    created_by=request.user
                )

                return Response({
                    "message": "Patient transferred successfully.",
                    "transfer": WardTransferSerializer(transfer).data
                })

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class WardSectionViewSet(viewsets.ModelViewSet):
    """
    API endpoint for ward sections.
    Supports CRUD operations for managing sections within wards.
    """
    queryset = WardSection.objects.select_related('ward').prefetch_related('beds').all()
    serializer_class = WardSectionSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    filterset_fields = ['ward', 'gender_restriction', 'accommodation_tier', 'is_isolation_capable', 'is_active']
    search_fields = ['name', 'description']
    ordering_fields = ['display_order', 'name', 'created_at']
    ordering = ['ward', 'display_order', 'name']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return WardSectionListSerializer
        return WardSectionSerializer

    def get_queryset(self):
        """
        Override to allow filtering by ward and add search.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return WardSection.objects.none()

        queryset = super().get_queryset().filter(ward__department__facility=facility)
        ward_id = self.request.query_params.get('ward', None)
        search_query = self.request.query_params.get('search', None)

        if ward_id:
            queryset = queryset.filter(ward_id=ward_id)

        if search_query:
            queryset = queryset.filter(
                Q(name__icontains=search_query) |
                Q(description__icontains=search_query)
            )

        return queryset

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        ward = serializer.validated_data.get('ward')
        if ward and ward.department and ward.department.facility_id != facility.id:
            raise PermissionDenied("Ward does not belong to the active facility.")
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['get'])
    def beds(self, request, pk=None):
        """
        Get all beds in this section.
        """
        section = self.get_object()
        beds = section.beds.all()
        serializer = BedListSerializer(beds, many=True)
        return Response(serializer.data)


class BedAmenityViewSet(viewsets.ModelViewSet):
    """
    API endpoint for bed amenities.
    Supports CRUD operations for managing amenity types.
    """
    queryset = BedAmenity.objects.all()
    serializer_class = BedAmenitySerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['category', 'is_active']
    search_fields = ['name', 'code', 'description']
    ordering_fields = ['category', 'name', 'additional_rate']
    ordering = ['category', 'name']
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Add search functionality.
        """
        queryset = super().get_queryset()
        search_query = self.request.query_params.get('search', None)

        if search_query:
            queryset = queryset.filter(
                Q(name__icontains=search_query) |
                Q(code__icontains=search_query) |
                Q(description__icontains=search_query)
            )

        return queryset

    def get_permissions(self):
        """
        Only admins can create/update/delete amenities.
        """
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]


class StaffRoleViewSet(viewsets.ModelViewSet):
    """
    API endpoint for staff roles.
    Roles are configurable per facility (Staff Nurse, Charge Nurse, etc.)
    """
    queryset = StaffRole.objects.all()
    serializer_class = StaffRoleSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['category', 'is_active']
    search_fields = ['name', 'code', 'description']
    ordering_fields = ['category', 'name']
    ordering = ['category', 'name']
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """Add search and filter only active by default."""
        queryset = super().get_queryset()

        # Filter active only unless explicitly requested
        show_inactive = self.request.query_params.get('show_inactive', 'false')
        if show_inactive.lower() != 'true':
            queryset = queryset.filter(is_active=True)

        # Search
        search_query = self.request.query_params.get('search', None)
        if search_query:
            queryset = queryset.filter(
                Q(name__icontains=search_query) |
                Q(code__icontains=search_query)
            )

        return queryset

    def get_permissions(self):
        """Only admins can create/update/delete roles."""
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]


class WardStaffAssignmentViewSet(viewsets.ModelViewSet):
    """
    API endpoint for ward staff assignments.
    Manages which practitioners are assigned to which wards.
    """
    queryset = WardStaffAssignment.objects.select_related(
        'ward', 'practitioner__staff__user', 'role', 'assigned_by'
    ).all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    filterset_fields = ['ward', 'practitioner', 'role', 'is_active', 'is_primary']
    ordering_fields = ['assigned_at', 'role__category', 'role__name']
    ordering = ['role__category', 'role__name', '-assigned_at']
    pagination_class = StandardResultsSetPagination

    def get_permissions(self):
        """Only admins can create/update/delete assignments."""
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAdminUser(), FacilityScopedPermission()]
        return [permissions.IsAuthenticated(), FacilityScopedPermission()]

    def get_serializer_class(self):
        if self.action == 'create':
            return WardStaffAssignmentCreateSerializer
        if self.action in ['update', 'partial_update']:
            return WardStaffAssignmentCreateSerializer
        return WardStaffAssignmentDetailSerializer

    def get_queryset(self):
        """
        Filter by ward, practitioner, role category, or active status.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return WardStaffAssignment.objects.none()

        queryset = super().get_queryset().filter(ward__department__facility=facility)

        # Filter by ward
        ward_id = self.request.query_params.get('ward', None)
        if ward_id:
            queryset = queryset.filter(ward_id=ward_id)

        # Filter by practitioner
        practitioner_id = self.request.query_params.get('practitioner', None)
        if practitioner_id:
            queryset = queryset.filter(practitioner_id=practitioner_id)

        # Filter by role category
        category = self.request.query_params.get('category', None)
        if category:
            queryset = queryset.filter(role__category=category)

        # Filter active only by default
        show_inactive = self.request.query_params.get('show_inactive', 'false')
        if show_inactive.lower() != 'true':
            queryset = queryset.filter(is_active=True)

        return queryset

    def perform_create(self, serializer):
        """Set assigned_by on create."""
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        ward = serializer.validated_data.get('ward')
        if ward and ward.department and ward.department.facility_id != facility.id:
            raise PermissionDenied("Ward does not belong to the active facility.")
        serializer.save(assigned_by=self.request.user)

    def perform_update(self, serializer):
        """Update the assignment."""
        serializer.save()

    @action(detail=False, methods=['get'])
    def by_practitioner(self, request):
        """
        Get all ward assignments for a specific practitioner.
        Used in Staff Detail page.

        Query params:
        - practitioner_id: UUID of the practitioner
        """
        practitioner_id = request.query_params.get('practitioner_id')
        if not practitioner_id:
            return Response(
                {'error': 'practitioner_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        assignments = self.get_queryset().filter(
            practitioner_id=practitioner_id,
            is_active=True
        )

        serializer = WardStaffAssignmentDetailSerializer(assignments, many=True)
        return Response(serializer.data)
