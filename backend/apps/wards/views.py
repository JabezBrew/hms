from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction, models
from django.utils import timezone
from django.db.models import Count, Avg, Sum, F, Q
from django.db.models.functions import TruncDate
from rest_framework.pagination import PageNumberPagination
from datetime import timedelta, datetime

from .models import Ward, Bed, Admission, BedAllocationLog, WardTransfer, Encounter
from .serializers import (
    WardSerializer, BedSerializer, AdmissionSerializer,
    BedAllocationLogSerializer, WardTransferSerializer,
    AdmissionCreateSerializer, DischargeSerializer, TransferRequestSerializer
)
from ..users.permissions import IsAdminOrOwner


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 1000


class WardViewSet(viewsets.ModelViewSet):
    """
    API endpoint for wards.
    """
    queryset = Ward.objects.prefetch_related('beds').all()
    serializer_class = WardSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filterset_fields = ['ward_type', 'is_active']
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Override get_queryset to add search functionality.
        """
        queryset = super().get_queryset()
        search_query = self.request.query_params.get('search', None)

        if search_query:
            queryset = queryset.filter(
                models.Q(name__icontains=search_query) |
                models.Q(description__icontains=search_query) |
                models.Q(ward_type__icontains=search_query)
            )

        return queryset

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

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

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

    @action(detail=False, methods=['get'])
    def analytics(self, request):
        """
        Get ward analytics and reports data.
        Supports filtering by ward_id, start_date, and end_date.
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

        # Build base queryset
        wards = Ward.objects.all()
        if ward_id and ward_id != 'all':
            wards = wards.filter(id=ward_id)

        # Initialize response data
        analytics_data = {
            'occupancy_trends': [],
            'length_of_stay': [],
            'ward_utilization': [],
            'admissions_by_ward': []
        }

        # Generate daily occupancy trends
        current_date = start_date.date()
        end_date_only = end_date.date()

        while current_date <= end_date_only:
            date_data = {
                'date': current_date.strftime('%b %d'),
                'full_date': current_date.isoformat()
            }

            # Calculate occupancy for each ward on this date
            for ward in wards:
                total_beds = ward.total_beds
                if total_beds > 0:
                    # Count occupied beds on this date
                    occupied = Admission.objects.filter(
                        bed__ward=ward,
                        admission_date__lte=current_date,
                        status__in=['admitted', 'transferred']
                    ).filter(
                        Q(actual_discharge_date__isnull=True) |
                        Q(actual_discharge_date__gt=current_date)
                    ).count()

                    occupancy_rate = round((occupied / total_beds) * 100, 1)
                    date_data[ward.name] = occupancy_rate

            # Calculate overall occupancy
            if len(wards) > 0:
                ward_rates = [date_data.get(w.name, 0) for w in wards]
                date_data['Overall'] = round(sum(ward_rates) / len(ward_rates), 1)

            analytics_data['occupancy_trends'].append(date_data)
            current_date += timedelta(days=1)

        # Calculate length of stay distribution
        admissions = Admission.objects.filter(
            actual_discharge_date__gte=start_date,
            actual_discharge_date__lte=end_date
        )

        if ward_id and ward_id != 'all':
            admissions = admissions.filter(bed__ward_id=ward_id)

        los_ranges = [
            (1, 3, '1-3 days'),
            (4, 7, '4-7 days'),
            (8, 14, '8-14 days'),
            (15, 30, '15-30 days'),
            (31, 999, '31+ days')
        ]

        total_admissions = admissions.count()

        for min_days, max_days, range_label in los_ranges:
            count = sum(
                1 for admission in admissions
                if min_days <= admission.length_of_stay <= max_days
            )
            percentage = round((count / total_admissions * 100), 1) if total_admissions > 0 else 0

            analytics_data['length_of_stay'].append({
                'range': range_label,
                'count': count,
                'percentage': percentage
            })

        # Calculate ward utilization metrics
        for ward in wards:
            ward_admissions = Admission.objects.filter(
                bed__ward=ward,
                admission_date__gte=start_date,
                admission_date__lte=end_date
            )

            total_beds = ward.total_beds
            if total_beds > 0:
                # Calculate average occupancy
                days_in_range = (end_date.date() - start_date.date()).days + 1
                occupied_bed_days = 0
                for admission in ward_admissions:
                    discharge_date = (admission.actual_discharge_date or end_date).date()
                    admission_start = max(admission.admission_date.date(), start_date.date())
                    admission_end = min(discharge_date, end_date.date())
                    if admission_end >= admission_start:
                        occupied_bed_days += (admission_end - admission_start).days + 1

                total_bed_days = total_beds * days_in_range
                occupancy_rate = round((occupied_bed_days / total_bed_days) * 100, 1) if total_bed_days > 0 else 0

                # Calculate average length of stay
                avg_los = ward_admissions.aggregate(
                    avg_los=Avg(
                        F('actual_discharge_date') - F('admission_date')
                    )
                )['avg_los']

                avg_los_days = round(avg_los.total_seconds() / 86400, 1) if avg_los else 0

                # Calculate turnover rate (admissions per bed per period)
                turnover_rate = round(ward_admissions.count() / total_beds, 2) if total_beds > 0 else 0

                # Calculate revenue
                revenue = sum(admission.total_cost for admission in ward_admissions)

                analytics_data['ward_utilization'].append({
                    'ward': ward.name,
                    'occupancy_rate': occupancy_rate,
                    'turnover_rate': turnover_rate,
                    'avg_los': avg_los_days,
                    'bed_days': occupied_bed_days,
                    'revenue': float(revenue)
                })

        # Calculate admissions, discharges, and transfers by ward
        for ward in wards:
            ward_beds = Bed.objects.filter(ward=ward)

            admissions_count = Admission.objects.filter(
                bed__in=ward_beds,
                admission_date__gte=start_date,
                admission_date__lte=end_date
            ).count()

            discharges_count = Admission.objects.filter(
                bed__in=ward_beds,
                actual_discharge_date__gte=start_date,
                actual_discharge_date__lte=end_date,
                status='discharged'
            ).count()

            transfers_in = WardTransfer.objects.filter(
                to_admission__bed__ward=ward,
                transfer_time__gte=start_date,
                transfer_time__lte=end_date
            ).count()

            transfers_out = WardTransfer.objects.filter(
                from_admission__bed__ward=ward,
                transfer_time__gte=start_date,
                transfer_time__lte=end_date
            ).count()

            analytics_data['admissions_by_ward'].append({
                'ward': ward.name,
                'admissions': admissions_count,
                'discharges': discharges_count,
                'transfers': transfers_out + transfers_in
            })

        return Response(analytics_data)


class BedViewSet(viewsets.ModelViewSet):
    """
    API endpoint for beds.
    """
    queryset = Bed.objects.select_related('ward').prefetch_related('admissions').all()
    serializer_class = BedSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filterset_fields = ['ward', 'status', 'bed_type']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

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
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filterset_fields = ['patient', 'bed', 'status', 'admission_type', 'is_billed']

    def get_serializer_class(self):
        if self.action == 'create':
            return AdmissionCreateSerializer
        return AdmissionSerializer

    def perform_create(self, serializer):
        with transaction.atomic():
            # Get the bed from validated data
            bed = serializer.validated_data.get('bed')

            # Create the admission with daily_rate set from the bed
            admission = serializer.save(
                created_by=self.request.user,
                updated_by=self.request.user,
                status='admitted',
                daily_rate=bed.total_rate if bed else 0
            )

            # Create local Encounter (syncs to FHIR in background)
            try:
                encounter = Encounter.objects.create(
                    patient=admission.patient,
                    practitioner=admission.admitting_doctor,
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
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['bed', 'previous_status', 'new_status', 'created_by']


class WardTransferViewSet(viewsets.ModelViewSet):
    """
    API endpoint for ward transfers.
    """
    queryset = WardTransfer.objects.all()
    serializer_class = WardTransferSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filterset_fields = ['patient', 'from_admission', 'to_admission', 'created_by']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

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
                    admitting_doctor=from_admission.admitting_doctor,
                    created_by=request.user,
                    updated_by=request.user
                )

                # Create the transfer record
                transfer = WardTransfer.objects.create(
                    patient=from_admission.patient,
                    from_admission=from_admission,
                    to_admission=to_admission,
                    reason=reason,
                    created_by=request.user
                )

                # Create bed allocation logs
                BedAllocationLog.objects.create(
                    bed=from_admission.bed,
                    previous_status='occupied',
                    new_status='available',
                    admission=from_admission,
                    notes=f"Patient transferred to {to_bed.ward.name}",
                    created_by=request.user
                )

                BedAllocationLog.objects.create(
                    bed=to_bed,
                    previous_status='available',
                    new_status='occupied',
                    admission=to_admission,
                    notes=f"Patient transferred from {from_admission.bed.ward.name}",
                    created_by=request.user
                )

                return Response({
                    "message": "Patient transferred successfully.",
                    "transfer": WardTransferSerializer(transfer).data
                })

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
