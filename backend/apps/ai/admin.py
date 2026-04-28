from django.contrib import admin

from .models import AIArtifact, AIFeedback, AIMessage, AISession


@admin.register(AISession)
class AISessionAdmin(admin.ModelAdmin):
    list_display = ('id', 'feature', 'status', 'facility', 'user', 'patient', 'started_at', 'ended_at')
    list_filter = ('feature', 'status', 'facility')
    search_fields = ('id', 'request_context_hash', 'user__email', 'patient__medical_record_number')
    readonly_fields = ('id', 'created_at', 'updated_at')


@admin.register(AIMessage)
class AIMessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'session', 'role', 'model_role', 'provider', 'input_tokens', 'output_tokens', 'latency_ms')
    list_filter = ('role', 'model_role', 'provider')
    search_fields = ('id', 'session__id', 'provider', 'model_name')
    readonly_fields = ('id', 'created_at', 'updated_at')


@admin.register(AIArtifact)
class AIArtifactAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'session',
        'artifact_type',
        'confidence_score',
        'requires_human_review',
        'accepted_by',
        'accepted_at',
    )
    list_filter = ('artifact_type', 'requires_human_review', 'schema_version')
    search_fields = ('id', 'session__id', 'schema_version')
    readonly_fields = ('id', 'created_at', 'updated_at')


@admin.register(AIFeedback)
class AIFeedbackAdmin(admin.ModelAdmin):
    list_display = ('id', 'artifact', 'user', 'thumb', 'created_at')
    list_filter = ('thumb',)
    search_fields = ('id', 'artifact__id', 'user__email')
    readonly_fields = ('id', 'created_at')
