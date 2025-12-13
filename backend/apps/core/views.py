"""
Core views for system-wide settings and configuration APIs.
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response

from .models import FacilityFluidBalanceSettings
from .serializers import FacilityFluidBalanceSettingsSerializer


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
