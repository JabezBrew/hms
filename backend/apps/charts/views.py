"""
Chart Builder ViewSets

Provides API endpoints for chart template management, assignments, and entries.
"""

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import Q, Count, OuterRef, Subquery
from django.utils import timezone

from apps.charts.models import ChartTemplate, ChartField, ChartAssignment, ChartEntry
from apps.charts.serializers import (
    ChartTemplateListSerializer, ChartTemplateSerializer, ChartTemplateCreateSerializer,
    ChartFieldSerializer, ChartFieldCreateSerializer,
    ChartAssignmentListSerializer, ChartAssignmentSerializer, ChartAssignmentCreateSerializer,
    ChartEntryListSerializer, ChartEntrySerializer, ChartEntryCreateSerializer,
    ChartEntrySummarySerializer, ChartEntryTrendSerializer,
)
from apps.charts.permissions import (
    ChartTemplatePermission, ChartAssignmentPermission, ChartEntryPermission
)
from apps.charts.services import ChartEntryService


class StandardResultsSetPagination(PageNumberPagination):
    """Standard pagination for charts endpoints."""
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


class ChartTemplateViewSet(viewsets.ModelViewSet):
    """
    ViewSet for chart template CRUD operations.

    list: Get all templates (filtered by visibility)
    create: Create a new template
    retrieve: Get template details with fields
    update: Update template settings
    destroy: Soft delete template
    clone: Create a copy of a template
    categories: Get available category choices
    """

    permission_classes = [IsAuthenticated, ChartTemplatePermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['category', 'visibility', 'is_active']
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'category', 'created_at']
    ordering = ['category', 'name']

    def get_queryset(self):
        """Filter templates based on visibility rules."""
        user = self.request.user
        queryset = ChartTemplate.objects.all()

        # Build visibility filter
        visibility_q = Q(visibility='facility')

        # Private templates created by user
        visibility_q |= Q(visibility='private', created_by=user)

        # Role-based templates
        if hasattr(user, 'user_type'):
            visibility_q |= Q(
                visibility='role',
                created_by__user_type=user.user_type
            )

        # Department-based templates
        if hasattr(user, 'practitioner_profile'):
            dept = getattr(user.practitioner_profile, 'department', None)
            if dept:
                visibility_q |= Q(visibility='department', department=dept)

        queryset = queryset.filter(visibility_q)

        # Annotate with field count for list view
        if self.action == 'list':
            queryset = queryset.annotate(
                field_count_annotation=Count('fields')
            )

        return queryset.select_related('created_by', 'updated_by')

    def get_serializer_class(self):
        if self.action == 'list':
            return ChartTemplateListSerializer
        elif self.action in ['create', 'update', 'partial_update']:
            return ChartTemplateCreateSerializer
        return ChartTemplateSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        instance = serializer.instance
        instance.version += 1
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        """Soft delete - mark as inactive instead of deleting."""
        if instance.is_system:
            return Response(
                {"error": "System templates cannot be deleted"},
                status=status.HTTP_403_FORBIDDEN
            )

        # Check if template has active assignments
        active_assignments = instance.assignments.filter(status='active').count()
        if active_assignments > 0:
            return Response(
                {"error": f"Cannot delete template with {active_assignments} active assignments"},
                status=status.HTTP_400_BAD_REQUEST
            )

        instance.is_active = False
        instance.updated_by = self.request.user
        instance.save()

    @action(detail=True, methods=['post'])
    def clone(self, request, pk=None):
        """Clone a template for customization."""
        template = self.get_object()
        new_name = request.data.get('name')

        cloned = template.clone(user=request.user, new_name=new_name)
        serializer = ChartTemplateSerializer(cloned)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def categories(self, request):
        """Get available template categories."""
        return Response({
            'categories': [
                {'value': value, 'label': label}
                for value, label in ChartTemplate.CATEGORY_CHOICES
            ]
        })

    @action(detail=False, methods=['get'])
    def intervals(self, request):
        """Get available monitoring intervals."""
        return Response({
            'intervals': [
                {'value': value, 'label': label}
                for value, label in ChartTemplate.INTERVAL_CHOICES
            ]
        })

    # --- Field Management (nested under template) ---

    @action(detail=True, methods=['post'], url_path='fields')
    def add_field(self, request, pk=None):
        """Add a field to the template."""
        template = self.get_object()

        serializer = ChartFieldCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Check for duplicate field_key
        field_key = serializer.validated_data['field_key']
        if template.fields.filter(field_key=field_key).exists():
            return Response(
                {"error": f"Field with key '{field_key}' already exists"},
                status=status.HTTP_400_BAD_REQUEST
            )

        field = serializer.save(template=template)
        template.version += 1
        template.updated_by = request.user
        template.save()

        return Response(ChartFieldSerializer(field).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['put', 'patch'], url_path='fields/(?P<field_id>[^/.]+)')
    def update_field(self, request, pk=None, field_id=None):
        """Update a field in the template."""
        template = self.get_object()

        try:
            field = template.fields.get(id=field_id)
        except ChartField.DoesNotExist:
            return Response(
                {"error": "Field not found"},
                status=status.HTTP_404_NOT_FOUND
            )

        serializer = ChartFieldCreateSerializer(
            field,
            data=request.data,
            partial=(request.method == 'PATCH')
        )
        serializer.is_valid(raise_exception=True)

        # Check for duplicate field_key if changing it
        new_key = serializer.validated_data.get('field_key')
        if new_key and new_key != field.field_key:
            if template.fields.filter(field_key=new_key).exists():
                return Response(
                    {"error": f"Field with key '{new_key}' already exists"},
                    status=status.HTTP_400_BAD_REQUEST
                )

        serializer.save()
        template.version += 1
        template.updated_by = request.user
        template.save()

        return Response(ChartFieldSerializer(field).data)

    @action(detail=True, methods=['delete'], url_path='fields/(?P<field_id>[^/.]+)/delete')
    def delete_field(self, request, pk=None, field_id=None):
        """Remove a field from the template."""
        template = self.get_object()

        try:
            field = template.fields.get(id=field_id)
        except ChartField.DoesNotExist:
            return Response(
                {"error": "Field not found"},
                status=status.HTTP_404_NOT_FOUND
            )

        # Check if field is used in calculated fields
        dependent_fields = template.fields.filter(
            field_type='calculated',
            config__depends_on__contains=[field.field_key]
        )
        if dependent_fields.exists():
            return Response(
                {"error": f"Field is used in calculations: {', '.join(f.name for f in dependent_fields)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        field.delete()
        template.version += 1
        template.updated_by = request.user
        template.save()

        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['patch'], url_path='fields/reorder')
    def reorder_fields(self, request, pk=None):
        """Reorder fields in the template."""
        template = self.get_object()

        # Expect list of {id: uuid, display_order: int}
        field_orders = request.data.get('fields', [])

        for item in field_orders:
            field_id = item.get('id')
            order = item.get('display_order')

            if field_id and order is not None:
                template.fields.filter(id=field_id).update(display_order=order)

        template.version += 1
        template.updated_by = request.user
        template.save()

        return Response({"status": "reordered"})


class ChartAssignmentViewSet(viewsets.ModelViewSet):
    """
    ViewSet for chart assignments (linking templates to patients).

    list: Get all assignments (filter by patient, admission, status)
    create: Assign a chart to a patient
    retrieve: Get assignment details
    update: Update assignment settings
    by_patient: Get all charts for a specific patient
    complete: Mark assignment as completed
    pause: Pause monitoring
    resume: Resume monitoring
    discontinue: Discontinue chart with reason
    """

    permission_classes = [IsAuthenticated, ChartAssignmentPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['patient', 'admission', 'template', 'status']
    ordering_fields = ['created_at', 'start_datetime', 'status']
    ordering = ['-created_at']

    def get_queryset(self):
        queryset = ChartAssignment.objects.select_related(
            'template', 'patient__user', 'admission', 'ordered_by__staff__user'
        )

        if self.action in ['list', 'by_patient']:
            last_entry_subquery = ChartEntry.objects.filter(
                assignment=OuterRef('pk'),
                is_deleted=False
            ).order_by('-observation_datetime').values('observation_datetime')[:1]

            queryset = queryset.annotate(
                last_entry_at=Subquery(last_entry_subquery),
                entry_count=Count(
                    'entries',
                    filter=Q(entries__is_deleted=False),
                    distinct=True
                ),
            )
        else:
            queryset = queryset.prefetch_related('entries')

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return ChartAssignmentListSerializer
        elif self.action == 'create':
            return ChartAssignmentCreateSerializer
        return ChartAssignmentSerializer

    def perform_create(self, serializer):
        # Get practitioner profile for ordered_by
        ordered_by = None
        if hasattr(self.request.user, 'practitioner_profile'):
            ordered_by = self.request.user.practitioner_profile

        serializer.save(
            created_by=self.request.user,
            ordered_by=serializer.validated_data.get('ordered_by') or ordered_by
        )

    @action(detail=False, methods=['get'], url_path='by-patient')
    def by_patient(self, request):
        """Get all chart assignments for a patient."""
        patient_id = request.query_params.get('patient_id')
        if not patient_id:
            return Response(
                {"error": "patient_id is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        queryset = self.get_queryset().filter(patient_id=patient_id)

        # Optional status filter
        status_filter = request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        serializer = ChartAssignmentListSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Mark assignment as completed."""
        assignment = self.get_object()

        if assignment.status == 'completed':
            return Response(
                {"error": "Assignment is already completed"},
                status=status.HTTP_400_BAD_REQUEST
            )

        assignment.status = 'completed'
        assignment.end_datetime = timezone.now()
        assignment.save()

        return Response(ChartAssignmentSerializer(assignment).data)

    @action(detail=True, methods=['post'])
    def pause(self, request, pk=None):
        """Pause monitoring."""
        assignment = self.get_object()

        if assignment.status != 'active':
            return Response(
                {"error": "Can only pause active assignments"},
                status=status.HTTP_400_BAD_REQUEST
            )

        assignment.status = 'paused'
        assignment.save()

        return Response(ChartAssignmentSerializer(assignment).data)

    @action(detail=True, methods=['post'])
    def resume(self, request, pk=None):
        """Resume monitoring."""
        assignment = self.get_object()

        if assignment.status != 'paused':
            return Response(
                {"error": "Can only resume paused assignments"},
                status=status.HTTP_400_BAD_REQUEST
            )

        assignment.status = 'active'
        assignment.save()

        return Response(ChartAssignmentSerializer(assignment).data)

    @action(detail=True, methods=['post'])
    def discontinue(self, request, pk=None):
        """Discontinue chart with reason."""
        assignment = self.get_object()

        if assignment.status in ['completed', 'discontinued']:
            return Response(
                {"error": "Assignment is already completed or discontinued"},
                status=status.HTTP_400_BAD_REQUEST
            )

        reason = request.data.get('reason', '')
        assignment.discontinue(user=request.user, reason=reason)

        return Response(ChartAssignmentSerializer(assignment).data)


class ChartEntryViewSet(viewsets.ModelViewSet):
    """
    ViewSet for chart entries (observations).

    list: Get entries (filter by assignment, date range)
    create: Record new entry
    retrieve: Get entry details
    update: Update entry (within time window)
    destroy: Soft delete entry
    summary: Get summary statistics for assignment
    trends: Get trend data for visualization
    """

    permission_classes = [IsAuthenticated, ChartEntryPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['assignment', 'has_critical_values']
    ordering_fields = ['observation_datetime', 'created_at']
    ordering = ['-observation_datetime']

    def get_queryset(self):
        queryset = ChartEntry.objects.filter(is_deleted=False).select_related(
            'assignment__template',
            'assignment__patient__user',
            'recorded_by__staff__user',
            'created_by',
        )

        # Date range filtering
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')

        if start_date:
            queryset = queryset.filter(observation_datetime__gte=start_date)
        if end_date:
            queryset = queryset.filter(observation_datetime__lte=end_date)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return ChartEntryListSerializer
        elif self.action == 'create':
            return ChartEntryCreateSerializer
        return ChartEntrySerializer

    def perform_create(self, serializer):
        assignment = serializer.validated_data['assignment']
        data = serializer.validated_data['data']
        notes = serializer.validated_data.get('notes', '')
        observation_datetime = serializer.validated_data.get('observation_datetime')

        # Get practitioner profile
        recorded_by = None
        if hasattr(self.request.user, 'practitioner_profile'):
            recorded_by = self.request.user.practitioner_profile

        # Use service to create entry with computed fields and critical detection
        entry = ChartEntryService.create_entry(
            assignment=assignment,
            data=data,
            recorded_by=serializer.validated_data.get('recorded_by') or recorded_by,
            user=self.request.user,
            notes=notes,
            observation_datetime=observation_datetime,
        )

        # Update serializer instance for response
        serializer.instance = entry

    def perform_update(self, serializer):
        serializer.save(modified_by=self.request.user)

    def perform_destroy(self, instance):
        """Soft delete with reason."""
        reason = self.request.data.get('reason', '')
        instance.soft_delete(user=self.request.user, reason=reason)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Get summary statistics for an assignment."""
        assignment_id = request.query_params.get('assignment_id')
        if not assignment_id:
            return Response(
                {"error": "assignment_id is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            assignment = ChartAssignment.objects.get(id=assignment_id)
        except ChartAssignment.DoesNotExist:
            return Response(
                {"error": "Assignment not found"},
                status=status.HTTP_404_NOT_FOUND
            )

        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')

        summary = ChartEntryService.get_entry_summary(
            assignment, start_date=start_date, end_date=end_date
        )

        serializer = ChartEntrySummarySerializer(summary)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def trends(self, request):
        """Get trend data for a specific field."""
        assignment_id = request.query_params.get('assignment_id')
        field_key = request.query_params.get('field_key')
        limit = int(request.query_params.get('limit', 50))

        if not assignment_id or not field_key:
            return Response(
                {"error": "assignment_id and field_key are required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            assignment = ChartAssignment.objects.get(id=assignment_id)
        except ChartAssignment.DoesNotExist:
            return Response(
                {"error": "Assignment not found"},
                status=status.HTTP_404_NOT_FOUND
            )

        trend_data = ChartEntryService.get_trend_data(
            assignment, field_key=field_key, limit=limit
        )

        serializer = ChartEntryTrendSerializer(trend_data, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='by-patient')
    def by_patient(self, request):
        """Get all chart entries for a patient (across all assignments)."""
        patient_id = request.query_params.get('patient_id')
        if not patient_id:
            return Response(
                {"error": "patient_id is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        queryset = self.get_queryset().filter(assignment__patient_id=patient_id)

        # Optional template filter
        template_id = request.query_params.get('template_id')
        if template_id:
            queryset = queryset.filter(assignment__template_id=template_id)

        # Limit results
        limit = int(request.query_params.get('limit', 100))
        queryset = queryset[:limit]

        serializer = ChartEntryListSerializer(queryset, many=True)
        return Response(serializer.data)
