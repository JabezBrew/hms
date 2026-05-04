from django.core.cache import cache
from django.db.models import Count, Q
from django.http import Http404
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.cache_utils import facility_cache_key
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import FacilityScopedPermission, get_accessible_patients_for_clinician, get_user_facility

from .models import InboxItem
from .serializers import InboxItemListSerializer


class InboxItemViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = InboxItemListSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def _get_patient_ids_for_user(self, user):
        if user.user_type in ['doctor', 'nurse', 'head_nurse', 'nurse_practitioner', 'physician', 'practitioner', 'inpatient_doctor']:
            return get_accessible_patients_for_clinician(user).values_list('id', flat=True)
        return None

    def _build_cache_key(self, facility_code, user_id, role, page, page_size, status, action_required):
        return facility_cache_key(
            f"inbox:{facility_code}:{user_id}:{role}:{page}:{page_size}:{status}:{action_required}"
        )

    def _build_counts_cache_key(self, facility_code, user_id, role):
        return facility_cache_key(f"inbox-counts:{facility_code}:{user_id}:{role}")

    def _get_scoped_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return InboxItem.objects.none()

        user = self.request.user
        base_filters = Q(facility=facility)
        role_filter = Q(recipient_role=user.user_type)
        user_filter = Q(recipient_user=user)
        default_scope = Q(recipient_user__isnull=True) & Q(recipient_role='')
        scoped_filters = base_filters & (user_filter | role_filter | default_scope)

        queryset = InboxItem.objects.filter(scoped_filters)

        patient_ids = self._get_patient_ids_for_user(user)
        if patient_ids is not None:
            if user.user_type == 'doctor':
                queryset = queryset.filter(Q(recipient_user=user) | Q(patient_id__in=patient_ids) | Q(patient__isnull=True))
            else:
                queryset = queryset.filter(Q(patient_id__in=patient_ids) | Q(patient__isnull=True))

        if user.user_type not in ['doctor', 'nurse', 'head_nurse', 'nurse_practitioner', 'physician', 'practitioner', 'inpatient_doctor']:
            queryset = queryset.filter(
                Q(patient__isnull=True)
                | Q(source_type=InboxItem.SourceType.DISCHARGE)
                | Q(source_type=InboxItem.SourceType.ADMISSION)
            )

        return queryset

    def _apply_list_filters(self, queryset):
        status = self.request.query_params.get('status')
        if status:
            queryset = queryset.filter(status=status)

        action_required = self.request.query_params.get('action_required')
        if action_required is not None:
            queryset = queryset.filter(is_action_required=action_required.lower() == 'true')

        return queryset

    def get_queryset(self):
        return self._apply_list_filters(self._get_scoped_queryset()).select_related('patient__user')

    def list(self, request, *args, **kwargs):
        facility = get_user_facility(request)
        if not facility:
            return Response({'results': []})

        page = request.query_params.get('page', '1')
        page_size = request.query_params.get('page_size', self.pagination_class.page_size)
        status = request.query_params.get('status', '')
        action_required = request.query_params.get('action_required', '')

        cache_key = self._build_cache_key(
            facility.code,
            request.user.id,
            request.user.user_type,
            page,
            page_size,
            status,
            action_required,
        )
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        response = super().list(request, *args, **kwargs)
        cache.set(cache_key, response.data, timeout=30)
        return response

    @action(detail=False, methods=['get'], url_path='counts')
    def counts(self, request):
        facility = get_user_facility(request)
        if not facility:
            return Response({'total': 0, 'unread': 0, 'action_required': 0})

        cache_key = self._build_counts_cache_key(
            facility.code,
            request.user.id,
            request.user.user_type,
        )
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        counts = self._get_scoped_queryset().aggregate(
            total=Count('id'),
            unread=Count('id', filter=Q(status=InboxItem.ItemStatus.UNREAD)),
            action_required=Count('id', filter=Q(is_action_required=True)),
        )
        payload = {
            'total': counts['total'] or 0,
            'unread': counts['unread'] or 0,
            'action_required': counts['action_required'] or 0,
        }
        cache.set(cache_key, payload, timeout=30)
        return Response(payload)

    def _invalidate_user_inbox_cache(self, facility_code, user_id, role):
        try:
            cache.delete_pattern(f"*inbox:{facility_code}:{user_id}:*")
            cache.delete_pattern(f"*inbox-counts:{facility_code}:{user_id}:*")
        except AttributeError:
            cache.delete(self._build_counts_cache_key(facility_code, user_id, role))

    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        facility = get_user_facility(request)
        if not facility:
            return Response({'detail': 'Facility context required.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            item = InboxItem.objects.get(
                pk=pk,
                facility=facility,
                recipient_user=request.user,
            )
        except InboxItem.DoesNotExist:
            raise Http404

        if not item.is_read or item.status == InboxItem.ItemStatus.UNREAD:
            item.is_read = True
            if item.status == InboxItem.ItemStatus.UNREAD:
                item.status = InboxItem.ItemStatus.READ
            item.updated_at = timezone.now()
            item.save(update_fields=['is_read', 'status', 'updated_at'])
            self._invalidate_user_inbox_cache(facility.code, request.user.id, request.user.user_type)

        return Response(InboxItemListSerializer(item).data)
