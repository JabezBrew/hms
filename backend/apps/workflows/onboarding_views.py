from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .onboarding_serializers import (
    OnboardingEventIngestSerializer,
    OnboardingSkipStepSerializer,
    OnboardingStartSerializer,
)
from .onboarding_service import (
    compute_flows_etag,
    get_active_flows_payload,
    get_progress,
    ingest_events,
    skip_step,
    start_progress,
)


class OnboardingActiveFlowsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        role = getattr(request.user, 'user_type', None)
        flows_payload = get_active_flows_payload(role)
        etag = compute_flows_etag(flows_payload)

        response = Response({'flows': flows_payload})
        response['ETag'] = f'"{etag}"'
        return response


class OnboardingProgressStartView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = OnboardingStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            snapshot = start_progress(
                user=request.user,
                flow_key=serializer.validated_data['flow_key'],
                flow_version=serializer.validated_data.get('flow_version'),
            )
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(snapshot, status=status.HTTP_200_OK)


class OnboardingProgressView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        flow_keys_param = request.query_params.get('flow_keys')
        flow_keys = None
        if flow_keys_param:
            flow_keys = [flow_key.strip() for flow_key in flow_keys_param.split(',') if flow_key.strip()]

        snapshots = get_progress(request.user, flow_keys=flow_keys)
        return Response({'progress': snapshots}, status=status.HTTP_200_OK)


class OnboardingEventsIngestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = OnboardingEventIngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        result = ingest_events(request.user, serializer.validated_data['events'])
        return Response(result, status=status.HTTP_200_OK)


class OnboardingSkipStepView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = OnboardingSkipStepSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            snapshot = skip_step(
                user=request.user,
                flow_key=serializer.validated_data['flow_key'],
                flow_version=serializer.validated_data.get('flow_version'),
                step_id=serializer.validated_data['step_id'],
                reason=serializer.validated_data.get('reason', ''),
            )
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(snapshot, status=status.HTTP_200_OK)
