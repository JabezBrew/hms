from rest_framework import serializers


class OnboardingStartSerializer(serializers.Serializer):
    flow_key = serializers.CharField(max_length=120)
    flow_version = serializers.IntegerField(min_value=1, required=False)


class OnboardingSkipStepSerializer(serializers.Serializer):
    flow_key = serializers.CharField(max_length=120)
    flow_version = serializers.IntegerField(min_value=1, required=False)
    step_id = serializers.CharField(max_length=120)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True)


class OnboardingEventSerializer(serializers.Serializer):
    event_id = serializers.CharField(max_length=64)
    name = serializers.CharField(max_length=120)
    ts = serializers.DateTimeField(required=False)
    payload = serializers.DictField(required=False, default=dict)


class OnboardingEventIngestSerializer(serializers.Serializer):
    events = OnboardingEventSerializer(many=True, allow_empty=False)
