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
from apps.ai import constants
from apps.ai.logging_utils import redact_text, safe_ai_log
from apps.ai.models import AIArtifact, AIFeedback, AIMessage, AISession
from apps.ai.serializers import (
    AIArtifactRejectSerializer,
    AIArtifactSerializer,
    AIChronicleAskRequestSerializer,
    AIChronicleSummarizeRequestSerializer,
    AILabInterpretRequestSerializer,
    AINoteDraftRequestSerializer,
    AINoteLintRequestSerializer,
    AIOmniExecutePreviewRequestSerializer,
    AIOmniParseRequestSerializer,
    AIFeedbackSerializer,
    AIObservabilitySummarySerializer,
    AISessionCreateSerializer,
    AISessionSerializer,
)
from apps.ai.services.chronicle_copilot import ask_chronicle, summarize_chronicle
from apps.ai.services.lab_interpretation import interpret_order, interpret_result
from apps.ai.services.note_assistant import build_note_draft, lint_note_draft
from apps.ai.services.omni import normalize_omni_text, parse_omni_intent, preview_omni_intent
from apps.ai.services.orchestrator import AIOrchestrator
from apps.ai.services.policy import build_response_envelope, confidence_band, ensure_feature_enabled
from apps.ai.services.retrieval import build_minimal_context_bundle, resolve_time_window
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import check_clinical_access, check_lab_access, get_user_facility
from apps.laboratory.models import LabOrder, LabResult
from apps.users.models import PatientProfile


logger_name = 'apps.ai'
logger = logging.getLogger(logger_name)


LAB_REVIEW_MESSAGE_BY_BAND = {
    'needs_review': 'Needs review. Use full chart context and consider repeat confirmation before acting.',
    'advisory': 'Advisory output. Correlate with symptoms, exam findings, and current treatment plan.',
    'normal': 'Advisory output. Clinical sign-off is still required before treatment decisions.',
    'fallback': 'Needs review. Confidence is low, so rely on standard clinical workflow.',
}


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


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _resolve_clinical_patient(*, patient_id, facility, user):
    patient = (
        PatientProfile.objects.select_related('user')
        .filter(id=patient_id, facility_id=facility.id)
        .first()
    )
    if not patient:
        return None

    check_clinical_access(user, patient)
    return patient


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


class AIOmniParseView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        ensure_feature_enabled(constants.FEATURE_OMNI_NL)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied('Facility context is required.')

        serializer = AIOmniParseRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        parsed_intent = parse_omni_intent(serializer.validated_data['text'])
        preview = preview_omni_intent(parsed_intent, user=request.user, facility=facility)

        result_payload = {
            'intent_type': parsed_intent['intent_type'],
            'entities': parsed_intent['entities'],
            'target_route': parsed_intent['target_route'],
            'normalized_query': parsed_intent['normalized_query'],
            'requires_confirmation': parsed_intent['requires_confirmation'],
            'fallback_to_legacy': parsed_intent['fallback_to_legacy'],
            'preview': preview,
        }
        envelope = build_response_envelope(
            feature=constants.FEATURE_OMNI_NL,
            confidence=parsed_intent['confidence'],
            result=result_payload,
            citations=[],
            requires_human_review=True,
        )

        safe_ai_log(
            logger,
            logging.INFO,
            'ai_omni_parse',
            {
                'facility_id': str(facility.id),
                'user_id': str(request.user.id),
                'intent_type': parsed_intent['intent_type'],
                'requires_confirmation': parsed_intent['requires_confirmation'],
                'fallback_to_legacy': parsed_intent['fallback_to_legacy'],
            },
        )

        return Response(envelope, status=status.HTTP_200_OK)


class AIOmniExecutePreviewView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _normalize_intent_payload(self, *, payload: dict[str, Any], raw_text: str) -> dict[str, Any]:
        intent_type = str(payload.get('intent_type') or '').strip().lower() or 'search.global'

        entities = payload.get('entities') if isinstance(payload.get('entities'), dict) else {}
        route_payload = payload.get('target_route') if isinstance(payload.get('target_route'), dict) else {}
        route_path = str(route_payload.get('path') or '').strip() or '/patients'
        route_query = route_payload.get('query') if isinstance(route_payload.get('query'), dict) else {}

        normalized_query = str(payload.get('normalized_query') or '').strip() or normalize_omni_text(raw_text)
        confidence = _safe_float(payload.get('confidence'), default=0.55)
        confidence = round(max(0.0, min(1.0, confidence)), 3)

        fallback_to_legacy = bool(payload.get('fallback_to_legacy')) or confidence < 0.65

        return {
            'intent_type': intent_type,
            'entities': entities,
            'target_route': {'path': route_path, 'query': route_query},
            'normalized_query': normalized_query,
            'requires_confirmation': bool(payload.get('requires_confirmation')) or confidence < 0.85,
            'fallback_to_legacy': fallback_to_legacy,
            'confidence': confidence,
        }

    def post(self, request, *args, **kwargs):
        ensure_feature_enabled(constants.FEATURE_OMNI_NL)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied('Facility context is required.')

        serializer = AIOmniExecutePreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        raw_text = (serializer.validated_data.get('text') or '').strip()
        provided_intent = serializer.validated_data.get('intent')
        if provided_intent:
            intent_payload = self._normalize_intent_payload(payload=provided_intent, raw_text=raw_text)
        else:
            intent_payload = parse_omni_intent(raw_text)

        preview = preview_omni_intent(intent_payload, user=request.user, facility=facility)
        intent_payload['requires_confirmation'] = preview['requires_confirmation']

        result_payload = {
            'intent': {
                'intent_type': intent_payload['intent_type'],
                'entities': intent_payload['entities'],
                'target_route': intent_payload['target_route'] if preview['allowed'] else None,
                'normalized_query': intent_payload['normalized_query'],
                'requires_confirmation': intent_payload['requires_confirmation'],
                'fallback_to_legacy': intent_payload['fallback_to_legacy'],
            },
            'preview': preview,
        }
        envelope = build_response_envelope(
            feature=constants.FEATURE_OMNI_NL,
            confidence=intent_payload['confidence'],
            result=result_payload,
            citations=[],
            requires_human_review=True,
        )

        safe_ai_log(
            logger,
            logging.INFO,
            'ai_omni_execute_preview',
            {
                'facility_id': str(facility.id),
                'user_id': str(request.user.id),
                'intent_type': intent_payload['intent_type'],
                'allowed': preview['allowed'],
                'requires_confirmation': preview['requires_confirmation'],
            },
        )

        return Response(envelope, status=status.HTTP_200_OK)


class AIChronicleSummarizeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, patient_id, *args, **kwargs):
        ensure_feature_enabled(constants.FEATURE_CHRONICLE_COPILOT)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied('Facility context is required.')

        patient = _resolve_clinical_patient(
            patient_id=patient_id,
            facility=facility,
            user=request.user,
        )
        if not patient:
            return Response({'detail': 'Patient not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = AIChronicleSummarizeRequestSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)

        time_window = serializer.validated_data['time_window']
        normalized_window, start_at, end_at = resolve_time_window(time_window)
        encounter_id = serializer.validated_data.get('encounter_id')

        context_bundle = build_minimal_context_bundle(
            patient=patient,
            start_at=start_at,
            end_at=end_at,
            encounter_id=encounter_id,
            timeline_limit=24,
        )

        summary_payload = summarize_chronicle(
            context_bundle=context_bundle,
            focus=serializer.validated_data['focus'],
            time_window=normalized_window,
        )

        envelope = build_response_envelope(
            feature=constants.FEATURE_CHRONICLE_COPILOT,
            confidence=summary_payload['confidence'],
            result=summary_payload['result'],
            citations=summary_payload['citations'],
            requires_human_review=True,
        )

        safe_ai_log(
            logger,
            logging.INFO,
            'ai_chronicle_summarize',
            {
                'facility_id': str(facility.id),
                'user_id': str(request.user.id),
                'patient_id': str(patient.id),
                'time_window': normalized_window,
                'focus': serializer.validated_data['focus'],
                'encounter_id': str(encounter_id) if encounter_id else None,
            },
        )

        return Response(envelope, status=status.HTTP_200_OK)


class AIChronicleAskView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, patient_id, *args, **kwargs):
        ensure_feature_enabled(constants.FEATURE_CHRONICLE_COPILOT)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied('Facility context is required.')

        patient = _resolve_clinical_patient(
            patient_id=patient_id,
            facility=facility,
            user=request.user,
        )
        if not patient:
            return Response({'detail': 'Patient not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = AIChronicleAskRequestSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)

        normalized_window, start_at, end_at = resolve_time_window(serializer.validated_data['time_window'])
        encounter_id = serializer.validated_data.get('encounter_id')

        context_bundle = build_minimal_context_bundle(
            patient=patient,
            start_at=start_at,
            end_at=end_at,
            encounter_id=encounter_id,
            timeline_limit=24,
        )
        ask_payload = ask_chronicle(
            context_bundle=context_bundle,
            question=serializer.validated_data['question'],
            time_window=normalized_window,
        )

        envelope = build_response_envelope(
            feature=constants.FEATURE_CHRONICLE_COPILOT,
            confidence=ask_payload['confidence'],
            result=ask_payload['result'],
            citations=ask_payload['citations'],
            requires_human_review=True,
        )

        safe_ai_log(
            logger,
            logging.INFO,
            'ai_chronicle_ask',
            {
                'facility_id': str(facility.id),
                'user_id': str(request.user.id),
                'patient_id': str(patient.id),
                'time_window': normalized_window,
                'question_len': len(serializer.validated_data['question'].strip()),
                'encounter_id': str(encounter_id) if encounter_id else None,
            },
        )

        return Response(envelope, status=status.HTTP_200_OK)


class AINoteDraftView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        ensure_feature_enabled(constants.FEATURE_NOTE_DRAFT)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied('Facility context is required.')

        serializer = AINoteDraftRequestSerializer(data=request.data or {}, context={'request': request})
        serializer.is_valid(raise_exception=True)

        draft_payload = build_note_draft(
            patient=serializer.validated_data['patient'],
            template=serializer.validated_data['template'],
            template_revision=serializer.validated_data['template_revision'],
            encounter=serializer.validated_data.get('encounter'),
            prompt=serializer.validated_data.get('prompt', ''),
        )

        envelope = build_response_envelope(
            feature=constants.FEATURE_NOTE_DRAFT,
            confidence=draft_payload['confidence'],
            result=draft_payload['result'],
            citations=draft_payload['citations'],
            requires_human_review=True,
        )

        safe_ai_log(
            logger,
            logging.INFO,
            'ai_note_draft',
            {
                'facility_id': str(facility.id),
                'user_id': str(request.user.id),
                'patient_id': str(serializer.validated_data['patient'].id),
                'template_id': str(serializer.validated_data['template'].id),
                'template_revision_id': str(serializer.validated_data['template_revision'].id),
                'encounter_id': (
                    str(serializer.validated_data['encounter'].id)
                    if serializer.validated_data.get('encounter')
                    else None
                ),
                'section_count': len(draft_payload['result'].get('sections') or []),
                'prompt_len': len(str(serializer.validated_data.get('prompt') or '').strip()),
            },
        )

        return Response(envelope, status=status.HTTP_200_OK)


class AINoteLintView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        ensure_feature_enabled(constants.FEATURE_NOTE_LINT)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied('Facility context is required.')

        serializer = AINoteLintRequestSerializer(data=request.data or {}, context={'request': request})
        serializer.is_valid(raise_exception=True)

        lint_payload = lint_note_draft(
            template_revision=serializer.validated_data['template_revision'],
            note_data=serializer.validated_data['note_data'],
        )

        envelope = build_response_envelope(
            feature=constants.FEATURE_NOTE_LINT,
            confidence=lint_payload['confidence'],
            result=lint_payload['result'],
            citations=lint_payload['citations'],
            requires_human_review=True,
        )

        issue_counts = lint_payload['result'].get('issue_counts') or {}
        safe_ai_log(
            logger,
            logging.INFO,
            'ai_note_lint',
            {
                'facility_id': str(facility.id),
                'user_id': str(request.user.id),
                'patient_id': str(serializer.validated_data['patient'].id),
                'template_id': str(serializer.validated_data['template'].id),
                'template_revision_id': str(serializer.validated_data['template_revision'].id),
                'critical_count': int(issue_counts.get('critical', 0)),
                'major_count': int(issue_counts.get('major', 0)),
                'minor_count': int(issue_counts.get('minor', 0)),
                'can_finalize': bool(lint_payload['result'].get('can_finalize')),
                'requires_major_acknowledgement': bool(
                    lint_payload['result'].get('requires_major_acknowledgement')
                ),
            },
        )

        return Response(envelope, status=status.HTTP_200_OK)


class AILabInterpretView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        ensure_feature_enabled(constants.FEATURE_LAB_INTERPRETATION)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied('Facility context is required.')

        serializer = AILabInterpretRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        audience = serializer.validated_data['audience']
        result_id = serializer.validated_data.get('result_id')
        order_id = serializer.validated_data.get('order_id')

        if result_id:
            lab_result = (
                LabResult.objects.select_related(
                    'order_test__test',
                    'order_test__order',
                    'order_test__order__patient',
                )
                .filter(id=result_id, facility_id=facility.id)
                .first()
            )
            if not lab_result:
                return Response({'detail': 'Lab result not found.'}, status=status.HTTP_404_NOT_FOUND)

            check_lab_access(request.user, lab_result.order_test.order.patient)
            interpretation = interpret_result(lab_result, audience=audience)
            source_kind = 'result'
            source_id = str(lab_result.id)
        else:
            lab_order = (
                LabOrder.objects.select_related('patient')
                .filter(id=order_id, facility_id=facility.id)
                .first()
            )
            if not lab_order:
                return Response({'detail': 'Lab order not found.'}, status=status.HTTP_404_NOT_FOUND)

            check_lab_access(request.user, lab_order.patient)
            interpretation = interpret_order(lab_order, audience=audience)
            source_kind = 'order'
            source_id = str(lab_order.id)

        result_payload = interpretation['result']
        interpreted_confidence = interpretation['confidence']
        review_band = confidence_band(interpreted_confidence, feature=constants.FEATURE_LAB_INTERPRETATION)

        result_payload['advisory_only'] = True
        result_payload['review_label'] = review_band
        result_payload['review_message'] = LAB_REVIEW_MESSAGE_BY_BAND.get(
            review_band,
            LAB_REVIEW_MESSAGE_BY_BAND['needs_review'],
        )
        result_payload['safety_notice'] = (
            'Advisory only. Clinical review is required before treatment or ordering decisions.'
        )

        envelope = build_response_envelope(
            feature=constants.FEATURE_LAB_INTERPRETATION,
            confidence=interpreted_confidence,
            result=result_payload,
            citations=interpretation['citations'],
            requires_human_review=True,
        )

        safe_ai_log(
            logger,
            logging.INFO,
            'ai_lab_interpret',
            {
                'facility_id': str(facility.id),
                'user_id': str(request.user.id),
                'source_kind': source_kind,
                'source_id': source_id,
                'audience': audience,
            },
        )

        return Response(envelope, status=status.HTTP_200_OK)


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
