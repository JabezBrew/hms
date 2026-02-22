from datetime import timedelta
from typing import Any
import logging

from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ai.crypto import encrypt_ai_text
from apps.ai.logging_utils import redact_text, safe_ai_log
from apps.ai.models import AIArtifact, AIFeedback, AIMessage, AISession
from apps.ai.serializers import (
    AIArtifactRejectSerializer,
    AIArtifactSerializer,
    AIFeedbackSerializer,
    AIObservabilitySummarySerializer,
    AISessionCreateSerializer,
    AISessionSerializer,
)
from apps.ai.services.orchestrator import AIOrchestrator
from apps.ai.services.policy import build_response_envelope, ensure_feature_enabled
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import get_user_facility


logger_name = 'apps.ai'
logger = logging.getLogger(logger_name)


def _percentile(values: list[int], percentile: float) -> int | None:
    if not values:
        return None
    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return sorted_values[0]

    rank = int(round((len(sorted_values) - 1) * percentile))
    rank = min(max(rank, 0), len(sorted_values) - 1)
    return sorted_values[rank]


def _safe_encrypt_text(raw_text: str | None) -> str:
    if not raw_text:
        return ''
    try:
        return encrypt_ai_text(raw_text)
    except Exception:
        return ''


class AISessionViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return AISession.objects.none()

        queryset = AISession.objects.select_related('facility', 'user', 'patient', 'encounter').filter(facility=facility)
        if self.request.user.user_type != 'admin':
            queryset = queryset.filter(user=self.request.user)
        return queryset

    def get_serializer_class(self):
        if self.action == 'create':
            return AISessionCreateSerializer
        return AISessionSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.save()

        safe_ai_log(
            logger,
            logging.INFO,
            'ai_session_created',
            {
                'session_id': str(session.id),
                'feature': session.feature,
                'facility_id': str(session.facility_id),
                'user_id': str(request.user.id),
            },
        )

        output = AISessionSerializer(session, context=self.get_serializer_context())
        return Response(output.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def ask(self, request, pk=None):
        session = self.get_object()
        ensure_feature_enabled(session.feature)

        question = str(request.data.get('question', '')).strip()
        if not question:
            return Response({'detail': 'question is required.'}, status=status.HTTP_400_BAD_REQUEST)

        session.status = AISession.STATUS_RUNNING
        session.save(update_fields=['status', 'updated_at'])

        AIMessage.objects.create(
            session=session,
            role=AIMessage.ROLE_USER,
            content_encrypted=_safe_encrypt_text(question),
            content_redacted=redact_text(question),
        )

        orchestrator = AIOrchestrator()
        generated = orchestrator.run_generation(feature=session.feature, prompt=question)

        response_text = generated.get('provider_result', {}).get('message', 'AI response is not yet configured.')

        AIMessage.objects.create(
            session=session,
            role=AIMessage.ROLE_ASSISTANT,
            content_encrypted=_safe_encrypt_text(response_text),
            content_redacted=redact_text(response_text),
            model_role=generated['route']['role'],
            model_name=generated['route']['model'],
            provider='noop',
            input_tokens=generated['usage']['input_tokens'],
            output_tokens=generated['usage']['output_tokens'],
            latency_ms=generated['usage']['latency_ms'],
        )

        envelope = build_response_envelope(
            feature=session.feature,
            confidence=0.0,
            result={
                'answer': response_text,
                'route': generated['route'],
            },
            citations=[],
            requires_human_review=True,
        )

        artifact = AIArtifact.objects.create(
            session=session,
            artifact_type=AIArtifact.TYPE_ANSWER,
            payload_json=envelope,
            confidence_score='0',
            requires_human_review=True,
            schema_version=envelope['schema_version'],
        )

        session.status = AISession.STATUS_COMPLETED
        session.ended_at = timezone.now()
        session.save(update_fields=['status', 'ended_at', 'updated_at'])

        safe_ai_log(
            logger,
            logging.INFO,
            'ai_session_asked',
            {
                'session_id': str(session.id),
                'artifact_id': str(artifact.id),
                'feature': session.feature,
            },
        )

        return Response(AIArtifactSerializer(artifact, context={'request': request}).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'])
    def artifacts(self, request, pk=None):
        session = self.get_object()
        artifacts_qs = session.artifacts.all().order_by('-created_at')

        page = self.paginate_queryset(artifacts_qs)
        if page is not None:
            serializer = AIArtifactSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)

        serializer = AIArtifactSerializer(artifacts_qs, many=True, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)


class AIArtifactViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return AIArtifact.objects.none()

        queryset = AIArtifact.objects.select_related('session', 'session__facility', 'session__user').filter(
            session__facility=facility,
        )
        if self.request.user.user_type != 'admin':
            queryset = queryset.filter(session__user=self.request.user)
        return queryset

    serializer_class = AIArtifactSerializer

    @action(detail=True, methods=['post'])
    def accept(self, request, pk=None):
        artifact = self.get_object()
        artifact.accepted_by = request.user
        artifact.accepted_at = timezone.now()
        artifact.rejected_reason = ''
        artifact.save(update_fields=['accepted_by', 'accepted_at', 'rejected_reason', 'updated_at'])

        safe_ai_log(
            logger,
            logging.INFO,
            'ai_artifact_accepted',
            {
                'artifact_id': str(artifact.id),
                'session_id': str(artifact.session_id),
                'user_id': str(request.user.id),
            },
        )

        return Response(self.get_serializer(artifact).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        artifact = self.get_object()
        serializer = AIArtifactRejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        artifact.accepted_by = None
        artifact.accepted_at = None
        artifact.rejected_reason = serializer.validated_data['reason']
        artifact.save(update_fields=['accepted_by', 'accepted_at', 'rejected_reason', 'updated_at'])

        safe_ai_log(
            logger,
            logging.INFO,
            'ai_artifact_rejected',
            {
                'artifact_id': str(artifact.id),
                'session_id': str(artifact.session_id),
                'user_id': str(request.user.id),
            },
        )

        return Response(self.get_serializer(artifact).data, status=status.HTTP_200_OK)


class AIFeedbackViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AIFeedbackSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return AIFeedback.objects.none()

        queryset = AIFeedback.objects.select_related('artifact', 'artifact__session', 'user').filter(
            artifact__session__facility=facility,
        )
        if self.request.user.user_type != 'admin':
            queryset = queryset.filter(user=self.request.user)
        return queryset


class AIObservabilitySummaryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        if request.user.user_type != 'admin':
            raise PermissionDenied('Only admin users can access AI observability summary.')

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied('Facility context is required.')

        try:
            window_hours = int(request.query_params.get('window_hours', '24'))
        except ValueError:
            window_hours = 24
        window_hours = min(max(window_hours, 1), 168)

        window_start = timezone.now() - timedelta(hours=window_hours)

        sessions_qs = AISession.objects.filter(facility=facility, created_at__gte=window_start)
        total_sessions = sessions_qs.count()
        failed_sessions = sessions_qs.filter(status=AISession.STATUS_FAILED).count()
        error_rate = (failed_sessions / total_sessions) if total_sessions else 0.0

        features = list(
            sessions_qs.values('feature').annotate(
                total=Count('id'),
                failed=Count('id', filter=Q(status=AISession.STATUS_FAILED)),
            ).order_by('feature')
        )

        messages_qs = AIMessage.objects.filter(session__facility=facility, created_at__gte=window_start)
        token_totals = messages_qs.aggregate(
            input_tokens=Sum('input_tokens'),
            output_tokens=Sum('output_tokens'),
        )
        cost_totals = messages_qs.aggregate(total_cost_usd=Sum('estimated_cost_usd'))

        latencies = list(
            messages_qs.exclude(latency_ms__isnull=True).values_list('latency_ms', flat=True)[:5000]
        )

        payload: dict[str, Any] = {
            'window_hours': window_hours,
            'facility_code': facility.code,
            'sessions': {
                'total': total_sessions,
                'failed': failed_sessions,
                'error_rate': round(error_rate, 4),
            },
            'features': features,
            'tokens': {
                'input': int(token_totals['input_tokens'] or 0),
                'output': int(token_totals['output_tokens'] or 0),
            },
            'cost': {
                'estimated_usd': float(cost_totals['total_cost_usd'] or 0),
            },
            'latency_ms': {
                'p50': _percentile(latencies, 0.50),
                'p95': _percentile(latencies, 0.95),
                'max': max(latencies) if latencies else None,
            },
        }

        serializer = AIObservabilitySummarySerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.validated_data, status=status.HTTP_200_OK)
