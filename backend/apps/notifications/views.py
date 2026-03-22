from django.core.cache import cache
from django.core.cache import cache
from django.db.models import Q
from rest_framework import permissions, viewsets
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

    def get_queryset(self):
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

        status = self.request.query_params.get('status')
        if status:
            queryset = queryset.filter(status=status)

        action_required = self.request.query_params.get('action_required')
        if action_required is not None:
            queryset = queryset.filter(is_action_required=action_required.lower() == 'true')

        patient_ids = self._get_patient_ids_for_user(user)
        if patient_ids is not None:
            if user.user_type == 'doctor':
                queryset = queryset.filter(Q(recipient_user=user) | Q(patient_id__in=patient_ids) | Q(patient__isnull=True))
            else:
                queryset = queryset.filter(Q(patient_id__in=patient_ids) | Q(patient__isnull=True))

        if user.user_type not in ['doctor', 'nurse', 'head_nurse', 'nurse_practitioner', 'physician', 'practitioner', 'inpatient_doctor']:
            queryset = queryset.filter(
                Q(patient__isnull=True) | Q(source_type=InboxItem.SourceType.DISCHARGE)
            )

        return queryset.select_related('patient__user')

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
