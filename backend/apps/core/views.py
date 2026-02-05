"""
Core views for system-wide settings and configuration APIs.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response

from .models import Facility, FacilityFluidBalanceSettings
from .pagination import StandardResultsSetPagination
from .serializers import FacilityFluidBalanceSettingsSerializer, FacilityListSerializer
from .mixins import FacilityScopedCreateMixin
from .security import FacilityScopedPermission, FacilityScopedQuerysetMixin, get_user_facility_codes


class FacilityScopedViewSet(FacilityScopedQuerysetMixin, FacilityScopedCreateMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination


class FacilityViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    serializer_class = FacilityListSerializer

    def get_queryset(self):
        include_inactive = self.request.query_params.get('include_inactive')
        include_inactive = str(include_inactive).lower() in {'1', 'true', 'yes', 'on'}

        queryset = Facility.objects.select_related('parent_facility').order_by('name')

        user = self.request.user
        if not user or not user.is_authenticated:
            return queryset.none()

        allow_cross = getattr(self.request, 'allow_cross_facility', None)
        if allow_cross is None:
            from django.conf import settings
            allow_cross = getattr(settings, 'ALLOW_CROSS_FACILITY_ACCESS', False)

        if allow_cross and user.user_type == 'admin':
            scoped = queryset
        else:
            codes = get_user_facility_codes(user)
            if not codes:
                return queryset.none()
            scoped = queryset.filter(code__in=codes)

        if not include_inactive or user.user_type != 'admin':
            scoped = scoped.filter(is_active=True)

        return scoped


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def fluid_balance_settings(request):
    """
    Get current facility fluid balance alert settings.

    Returns the current threshold values for fluid balance monitoring.
    Available to all authenticated users.
    """
    settings = FacilityFluidBalanceSettings.get_settings()
    serializer = FacilityFluidBalanceSettingsSerializer(settings)
    return Response(serializer.data)


@api_view(['PATCH'])
@permission_classes([IsAdminUser])
def update_fluid_balance_settings(request):
    """
    Update facility fluid balance alert settings.

    Only admin users can update these settings.
    Accepts partial updates - only send the fields you want to change.
    """
    settings = FacilityFluidBalanceSettings.get_settings()
    serializer = FacilityFluidBalanceSettingsSerializer(data=request.data, partial=True)

    if serializer.is_valid():
        # Update only the fields that were provided
        for field, value in serializer.validated_data.items():
            setattr(settings, field, value)
        settings.save()

        # Return the updated settings
        return Response(FacilityFluidBalanceSettingsSerializer(settings).data)

    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
